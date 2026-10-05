// training.mjs — End-session cleanup pipeline (dump → review → docs → delete).
//
// Flow: POST /api/training/end-session dumps the full transcript of a session
// into data/astra-training.db (WAL), then a worker (`hermes chat` oneshot,
// pinned glm-5.3-flash/zai) reads the transcript and updates skills/agent/
// project docs on disk. Success → the session is deleted through the gateway
// (sidebar refreshes via the existing sessions.changed event). Failure →
// status `awaiting_retry`, next_attempt_at = now + 5h; a sweeper retries due
// jobs; 6 strikes → `failed` (visible, kept). Transcripts stay retrievable via
// /api/training/sessions[/<id>] forever.
//
// Model pin is ABSOLUTE: glm-5.3-flash or the job waits. No fallback model.
// Env knobs (also the test seam): TRAINING_DB_PATH, TRAINING_DATA_DIR,
// TRAINING_HERMES_BIN, ASTRA_HERMES_URL, TRAINING_REVIEW_TIMEOUT_MS,
// TRAINING_RETRY_DELAY_MS, TRAINING_SWEEP_INTERVAL_MS.
import { DatabaseSync } from "node:sqlite";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";
import { broadcastFrame, clearHermesCookie } from "./hermes-proxy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.TRAINING_DATA_DIR || join(__dirname, "..", "data");
const DB_PATH = process.env.TRAINING_DB_PATH || join(DATA_DIR, "astra-training.db");

const REVIEW_MODEL = "glm-5.3-flash";
const REVIEW_PROVIDER = "zai";
const REVIEW_TIMEOUT_MS = Number(process.env.TRAINING_REVIEW_TIMEOUT_MS || 20 * 60 * 1000);
const RETRY_DELAY_MS = Number(process.env.TRAINING_RETRY_DELAY_MS || 5 * 60 * 60 * 1000);
const MAX_RETRIES = 6;
const SWEEP_INTERVAL_MS = Number(process.env.TRAINING_SWEEP_INTERVAL_MS || 60 * 1000);
const STALE_MS = 25 * 60 * 1000; // dumping/reviewing unchanged this long = restart mid-job
const DUMP_PAGE = 200;
const HERMES_BIN = process.env.TRAINING_HERMES_BIN || join(process.env.HOME || "/home/notjitin", ".local", "bin", "hermes");

// ---- DB ----------------------------------------------------------------

let db = null;

export function openTrainingDb() {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  // Migration: dbs created before these columns existed — guarded ALTER ADD.
  try {
    const cols = db.prepare("PRAGMA table_info(sessions)").all().map((c) => c.name);
    for (const [col, def] of [["ingested_at", "INTEGER"], ["last_activity_at", "INTEGER"], ["analysis_status", "TEXT"], ["analysis", "TEXT"]]) {
      if (!cols.includes(col)) db.exec(`ALTER TABLE sessions ADD COLUMN ${col} ${def}`);
    }
  } catch { /* fresh db created with them above */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      title TEXT,
      source TEXT,
      created_at INTEGER,
      ended_at INTEGER NOT NULL,
      message_rows INTEGER NOT NULL,
      token_stats TEXT,
      review_status TEXT NOT NULL DEFAULT 'dumped',
      /* ingest bookkeeping: NULL = never dumped for training. read by
         ingest.mjs / retention.mjs / backfill.mjs; fresh clones need it. */
      ingested_at INTEGER,
      /* conversation-ordering + analysis fields (live db has carried them
         since the ordering migration; fresh clones need them too). */
      last_activity_at INTEGER,
      analysis_status TEXT,
      analysis TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      sid TEXT NOT NULL,
      row_id TEXT NOT NULL,
      ts REAL,
      role TEXT NOT NULL,
      content TEXT,
      tool_calls TEXT,
      reasoning TEXT,
      PRIMARY KEY (sid, row_id)
    );
    CREATE TABLE IF NOT EXISTS review_jobs (
      sid TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER,
      last_error TEXT,
      worker_log TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_sid ON messages(sid);
  `);
  return db;
}

// ---- WS push -------------------------------------------------------------

function pushJob(job) {
  try {
    broadcastFrame(JSON.stringify({
      method: "event",
      params: { type: "training.updated", payload: job },
    }));
  } catch { /* no live ws clients is not an error */ }
}

function jobRow(database, sid) {
  return database.prepare("SELECT * FROM review_jobs WHERE sid = ?").get(sid);
}

// ---- Gateway plumbing ------------------------------------------------------

function gatewayReq(method, path, cookie, body) {
  const hermesUrl = process.env.ASTRA_HERMES_URL || "http://127.0.0.1:9119";
  const headers = { Cookie: cookie };
  let payload;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(payload);
  }
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${hermesUrl}${path}`, { method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

let cookieRef = null;
export function setGatewayCookieProvider(fn) { cookieRef = fn; }
function gatewayCookie() {
  if (!cookieRef) throw new Error("no gateway cookie provider wired");
  return cookieRef();
}

// History page with one 401 retry: the cached gateway cookie can age out
// mid-dump; clearing it makes getHermesCookie re-login on the next call.
async function historyPage(sid, offset) {
  let cookie = await gatewayCookie();
  let res = await gatewayReq("GET", `/api/sessions/${encodeURIComponent(sid)}/messages?order=oldest&limit=${DUMP_PAGE}&offset=${offset}`, cookie);
  if (res.status === 401) {
    clearHermesCookie();
    cookie = await gatewayCookie();
    res = await gatewayReq("GET", `/api/sessions/${encodeURIComponent(sid)}/messages?order=oldest&limit=${DUMP_PAGE}&offset=${offset}`, cookie);
  }
  if (res.status !== 200) throw new Error(`history page HTTP ${res.status}`);
  try {
    return JSON.parse(res.body);
  } catch {
    throw new Error(`history page not JSON (HTTP ${res.status})`);
  }
}

// ---- Job lifecycle ---------------------------------------------------------

// In-flight guard: one worker per sid, across button double-clicks, sweeper
// ticks and restart resume. Checked on every spawn path.
const running = new Set();

export function startEndSession(sid, title, source) {
  const database = openTrainingDb();
  const existing = jobRow(database, sid);
  if (existing && !["done", "failed"].includes(existing.status)) {
    return { job: existing, conflict: true };
  }
  const now = Date.now();
  database.prepare(`
    INSERT INTO review_jobs (sid, status, attempts, next_attempt_at, created_at, updated_at)
    VALUES (?, 'dumping', 0, NULL, ?, ?)
    ON CONFLICT(sid) DO UPDATE SET status='dumping', updated_at=excluded.updated_at, last_error=NULL
  `).run(sid, now, now);
  const job = jobRow(database, sid);
  pushJob(job);
  if (!running.has(sid)) {
    running.add(sid);
    void dumpAndReview(sid, title ?? null, source ?? null)
      .catch((e) => {
        console.error(`[training] ${sid}:`, e && e.message);
        scheduleRetry(sid, `dump/review: ${e && e.message}`, null);
      })
      .finally(() => running.delete(sid));
  }
  return { job, conflict: false };
}

function statsFor(msgs) {
  let user = 0, assistant = 0, toolCalls = 0, chars = 0;
  for (const m of msgs) {
    if (m.role === "user") user++;
    if (m.role === "assistant") assistant++;
    if (Array.isArray(m.tool_calls)) toolCalls += m.tool_calls.length;
    chars += (m.content || "").length + (m.reasoning || "").length;
  }
  return { user_msgs: user, assistant_msgs: assistant, tool_calls: toolCalls, total_chars: chars };
}

async function dumpAndReview(sid, title, source) {
  const database = openTrainingDb();
  try {
    // Paged, idempotent dump: order=oldest anchors the window at the session
    // start and offset skips forward; upsert by (sid,row_id) makes retries safe.
    const ins = database.prepare(`
      INSERT INTO messages (sid, row_id, ts, role, content, tool_calls, reasoning)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(sid, row_id) DO UPDATE SET content=excluded.content, tool_calls=excluded.tool_calls, reasoning=excluded.reasoning, ts=excluded.ts
    `);
    let offset = 0;
    let rows = 0;
    let firstTs = null;
    let stats = { user_msgs: 0, assistant_msgs: 0, tool_calls: 0, total_chars: 0 };
    for (;;) {
      const data = await historyPage(sid, offset);
      const msgs = data.messages || [];
      if (!msgs.length) break;
      database.exec("BEGIN");
      for (const m of msgs) {
        ins.run(sid, String(m.id), m.timestamp ?? null, m.role ?? "unknown",
          m.content ?? m.text ?? null,
          m.tool_calls ? JSON.stringify(m.tool_calls) : null,
          m.reasoning ?? null);
        if (firstTs === null && m.timestamp != null) firstTs = m.timestamp < 1e12 ? m.timestamp * 1000 : m.timestamp;
        rows++;
      }
      database.exec("COMMIT");
      offset += msgs.length;
      if (msgs.length < DUMP_PAGE) break;
    }
    if (rows === 0) throw new Error("session has no history rows (already deleted?)");
    // stats from the DB (source of truth after upserts), not the last page
    stats = statsFor(database.prepare("SELECT role, tool_calls, content, reasoning FROM messages WHERE sid = ?").all(sid));
    database.prepare(`
      INSERT INTO sessions (sid, title, source, created_at, ended_at, message_rows, token_stats, review_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'dumped')
      ON CONFLICT(sid) DO UPDATE SET title=COALESCE(excluded.title, sessions.title),
        source=COALESCE(excluded.source, sessions.source),
        created_at=COALESCE(sessions.created_at, excluded.created_at),
        ended_at=excluded.ended_at, message_rows=excluded.message_rows, token_stats=excluded.token_stats
    `).run(sid, title, source, firstTs, Date.now(), rows, JSON.stringify(stats));
    database.prepare("UPDATE review_jobs SET status='reviewing', updated_at=? WHERE sid=?").run(Date.now(), sid);
    pushJob(jobRow(database, sid));

    // Pre-review safety snapshot of everything the reviewer may touch
    // (skills tree + SOUL.md + project AGENTS.md files). One tarball per session.
    try { snapshotDocEstate(sid); } catch (e) {
      console.error(`[training] ${sid}: snapshot failed (continuing):`, e && e.message);
    }

    await runReviewWorker(sid);
  } catch (err) {
    scheduleRetry(sid, `dump/review: ${err && err.message}`, null);
  }
}

function snapshotDocEstate(sid) {
  const home = process.env.HOME || "/home/notjitin";
  const listPath = join(DATA_DIR, "training-exports", `${sid}.snapshot-list.txt`);
  mkdirSync(dirname(listPath), { recursive: true });
  const files = [];
  const skillsDir = join(home, ".hermes", "skills");
  if (existsSync(skillsDir)) files.push(skillsDir);
  const soul = join(home, ".hermes", "SOUL.md");
  if (existsSync(soul)) files.push(soul);
  const projects = join(home, "Work", "projects");
  if (existsSync(projects)) {
    try {
      const out = execFileSync("find", [projects, "-maxdepth", "2", "-name", "AGENTS.md"], { encoding: "utf8" });
      for (const line of out.split("\n")) if (line.trim()) files.push(line.trim());
    } catch { /* find unavailable is not fatal */ }
  }
  writeFileSync(listPath, files.join("\n"));
  const out = join(DATA_DIR, "training-exports", `${sid}-pre-review.tar.gz`);
  execFileSync("tar", ["-czf", out, "-T", listPath], { stdio: "ignore" });
}

// ---- Worker (glm-5.3-flash, pinned) ---------------------------------------

function transcriptPath(sid) { return join(DATA_DIR, "training-exports", `${sid}.md`); }
function reviewPromptPath(sid) { return join(DATA_DIR, "training-exports", `${sid}.review-prompt.md`); }

function writeTranscriptExport(sid) {
  const database = openTrainingDb();
  const rows = database.prepare("SELECT * FROM messages WHERE sid = ? ORDER BY ts ASC, row_id ASC").all(sid);
  const sess = database.prepare("SELECT * FROM sessions WHERE sid = ?").get(sid);
  const out = [];
  out.push(`# Session ${sid}${sess && sess.title ? ` — ${sess.title}` : ""}\n`);
  out.push(`Exported ${new Date().toISOString()} · ${rows.length} raw rows\n`);
  for (const m of rows) {
    const t = m.ts ? new Date(m.ts < 1e12 ? m.ts * 1000 : m.ts).toISOString() : "?";
    out.push(`\n---\n[${m.role}] ${t} (row ${m.row_id})`);
    if (m.reasoning) out.push(`\n<reasoning>\n${m.reasoning}\n</reasoning>`);
    if (m.tool_calls) out.push(`\n<tool_calls>\n${m.tool_calls}\n</tool_calls>`);
    if (m.content) out.push(`\n${m.content}`);
  }
  const p = transcriptPath(sid);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, out.join("\n")); // sync: the worker reads it the moment it spawns
  return p;
}

// READ-ONLY inventory passed into the prompt so the reviewer knows what exists
// without listing directories itself.
function docInventory() {
  const home = process.env.HOME || "/home/notjitin";
  const roots = [
    ["skills", join(home, ".hermes", "skills")],
    ["agent-docs", join(home, ".hermes")],
    ["projects", join(home, "Work", "projects")],
  ];
  const lines = [];
  for (const [label, root] of roots) {
    try {
      const names = readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .slice(0, 200);
      lines.push(`${label} (${root}): ${names.join(", ")}`);
    } catch {
      lines.push(`${label}: unavailable`);
    }
  }
  return lines.join("\n");
}

export const REVIEW_PROMPT_TEMPLATE_VERSION = 1;
function buildReviewPrompt(sid, transcriptPath_) {
  return `PROMPT_TEMPLATE_VERSION: ${REVIEW_PROMPT_TEMPLATE_VERSION}
You are the session reviewer for Astra's end-of-session pipeline.

Session: ${sid}
Transcript (READ THIS ENTIRE FILE FIRST): ${transcriptPath_}

Current documentation inventory (names only — do NOT list directories yourself):
${docInventory()}

Maintain the documentation estate so this session's durable lessons survive:

1. SKILLS: for each existing skill under ~/.hermes/skills/ that this session touched (worked in, hit pitfalls in, corrected behavior of), update its SKILL.md lessons/references so the lesson is captured. Create a NEW skill only when this session clearly established a repeatable procedure with no existing home.
2. AGENT DOCS: update ~/.hermes/SOUL.md ONLY if the session revealed a durable owner preference or operating rule not already recorded. Be conservative.
3. PROJECT DOCS: for each project under ~/Work/projects/ that the session worked in, update its AGENTS.md / docs with durable facts (commands that work, pitfalls discovered, deploy steps proven). Never invent commands that were not proven in the session.

Rules:
- Edit real files directly. Keep edits surgical: lessons and facts, not rewrites.
- Only include what the transcript PROVES (commands actually run and their real outcomes). Never fabricate.
- If the session is trivial (no durable lessons), write nothing.

Output contract (last lines of your reply): one line per file you created or updated, prefixed "FILE: ". If none: "FILE: none".`;
}

function runReviewWorker(sid) {
  return new Promise((resolve) => {
    const database = openTrainingDb();
    const p = writeTranscriptExport(sid);
    const promptFile = reviewPromptPath(sid);
    mkdirSync(dirname(promptFile), { recursive: true });
    writeFileSync(promptFile, buildReviewPrompt(sid, p));

    // detached + process-group kill: `hermes chat` may leave grandchildren
    // (shell scripts, helper procs) holding stdio open — killing only the
    // direct child leaves `close` hanging on the orphaned pipe (proven
    // 2026-10-01: timeout path never fired because `sleep 30` outlived the
    // killed shell). Negative PID signals the whole group.
    const child = spawn(HERMES_BIN, [
      "chat", "--oneshot", "--query-file", promptFile,
      "-m", REVIEW_MODEL, "--provider", REVIEW_PROVIDER,
      "--in", process.env.HOME || "/home/notjitin",
    ], { env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: true });

    let out = "";
    let timedOut = false;
    const killTree = () => {
      try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* already dead */ } }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, REVIEW_TIMEOUT_MS);
    child.stdout.on("data", (c) => { out += c; if (out.length > 200_000) out = out.slice(-100_000); });
    child.stderr.on("data", (c) => { out += c; if (out.length > 200_000) out = out.slice(-100_000); });

    const fail = (errText) => {
      clearTimeout(timer);
      scheduleRetry(sid, errText, out.slice(-8000));
      resolve();
    };
    child.on("error", (e) => fail(`spawn: ${e.message}`));
    child.on("close", (code, signal) => {
      if (timedOut) return fail(`timeout after ${Math.round(REVIEW_TIMEOUT_MS / 60000)}min`);
      if (signal === "SIGKILL") return fail(`killed (${signal}) — likely timeout racing exit`);
      if (code !== 0) return fail(`exit ${code}`);
      if (!out.trim()) return fail("empty output");
      clearTimeout(timer);
      finishReview(sid, out.slice(-8000)).then(resolve).catch((e) => fail(`post-review: ${e.message}`));
    });
  });
}

// Review succeeded → delete the session through the gateway (R5). done only
// after the delete lands; a failed delete goes back to awaiting_retry and the
// sweeper retries ONLY the delete (review_status is already 'reviewed').
async function finishReview(sid, logTail) {
  const database = openTrainingDb();
  database.prepare("UPDATE sessions SET review_status='reviewed' WHERE sid=?").run(sid);
  database.prepare("UPDATE review_jobs SET worker_log=?, updated_at=? WHERE sid=?").run(logTail, Date.now(), sid);
  try {
    await deleteSessionViaGateway(sid);
    database.prepare("UPDATE sessions SET review_status='deleted' WHERE sid=?").run(sid);
    database.prepare("UPDATE review_jobs SET status='done', last_error=NULL, updated_at=? WHERE sid=?").run(Date.now(), sid);
    pushJob(jobRow(database, sid));
  } catch (e) {
    scheduleRetry(sid, `gateway delete: ${e.message}`, logTail);
  }
}

// ---- Backfill / ingest / dataset adapters ----------------------------------
//
// The backfill, ingest and dataset pipelines (their own modules) all borrow
// primitives from here. These exports are thin, AWAITABLE adapters over the
// dump+review machinery above — they deliberately do NOT re-implement paging,
// upserts or the worker.

export const isReviewRunning = () => running.size > 0;

export async function runReviewForSession(sid, title, source, opts = {}) {
  const database = openTrainingDb();
  if (running.has(sid)) return { skipped: "review in flight", sid };
  running.add(sid);
  const now = Date.now();
  database.prepare(`
    INSERT INTO review_jobs (sid, status, attempts, next_attempt_at, created_at, updated_at)
    VALUES (?, 'dumping', 0, NULL, ?, ?)
    ON CONFLICT(sid) DO UPDATE SET status='dumping', updated_at=excluded.updated_at, last_error=NULL
  `).run(sid, now, now);
  pushJob(jobRow(database, sid));
  try {
    // The dump is idempotent (upsert by sid,row_id) but the gateway may
    // already have DELETED a reviewed session — run against the archive when
    // messages exist, else pull them in.
    const have = Number(database.prepare("SELECT COUNT(*) n FROM messages WHERE sid=?").get(sid).n) > 0;
    if (have) {
      database.prepare("UPDATE review_jobs SET status='reviewing', updated_at=? WHERE sid=?").run(Date.now(), sid);
      pushJob(jobRow(database, sid));
    } else {
      const ins = database.prepare(`
        INSERT INTO messages (sid, row_id, ts, role, content, tool_calls, reasoning)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sid, row_id) DO UPDATE SET content=excluded.content, tool_calls=excluded.tool_calls, reasoning=excluded.reasoning, ts=excluded.ts
      `);
      let offset = 0, rows = 0, firstTs = null;
      for (;;) {
        const data = await historyPage(sid, offset);
        const msgs = data.messages || [];
        if (!msgs.length) break;
        database.exec("BEGIN");
        for (const m of msgs) {
          ins.run(sid, String(m.id), m.timestamp ?? null, m.role ?? "unknown",
            m.content ?? m.text ?? null,
            m.tool_calls ? JSON.stringify(m.tool_calls) : null,
            m.reasoning ?? null);
          const ts = m.timestamp == null ? null : (m.timestamp < 1e12 ? m.timestamp * 1000 : m.timestamp);
          if (firstTs === null && ts != null) firstTs = ts;
          rows++;
        }
        database.exec("COMMIT");
        offset += msgs.length;
        if (msgs.length < DUMP_PAGE) break;
      }
      if (rows === 0) throw new Error("session has no history rows (already deleted?)");
      const stats = statsFor(database.prepare("SELECT role, tool_calls, content, reasoning FROM messages WHERE sid = ?").all(sid));
      database.prepare(`
        INSERT INTO sessions (sid, title, source, created_at, ended_at, message_rows, token_stats, review_status, ingested_at, last_activity_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'dumped', ?, ?)
        ON CONFLICT(sid) DO UPDATE SET title=COALESCE(excluded.title, sessions.title),
          source=COALESCE(excluded.source, sessions.source),
          created_at=COALESCE(sessions.created_at, excluded.created_at),
          ended_at=excluded.ended_at, message_rows=excluded.message_rows, token_stats=excluded.token_stats,
          ingested_at=COALESCE(sessions.ingested_at, excluded.ingested_at),
          last_activity_at=COALESCE(excluded.last_activity_at, sessions.last_activity_at)
      `).run(sid, title, source, firstTs, Date.now(), rows, JSON.stringify(stats), Date.now(), firstTs);
      database.prepare("UPDATE review_jobs SET status='reviewing', updated_at=? WHERE sid=?").run(Date.now(), sid);
      pushJob(jobRow(database, sid));
    }
    try { snapshotDocEstate(sid); } catch (e) {
      console.error(`[training] ${sid}: snapshot failed (continuing):`, e && e.message);
    }
    // PARALLEL SLOTS: each backfill worker passes its own HERMES_HOME so
    // concurrent reviewers do not contend on the shared state.db. The reviewer
    // resolves skills/SOUL/AGENTS from HERMES_HOME rather than HOME when given
    // (its prompt inventory uses one HOME root otherwise).
    const analysis = await runReviewWorkerWithEnv(sid, opts);
    // The backfillUi reads analysis_status / analysis — mark them here so a
    // parallel reviewer's completion is as visible as the serial one's.
    database.prepare("UPDATE sessions SET analysis_status='done', analysis=COALESCE(?, analysis) WHERE sid=?")
      .run(JSON.stringify(analysis ?? { at: Date.now(), via: "review" }), sid);
    return analysis;
  } finally {
    running.delete(sid);
  }
}

/** Worker spawn with an overridable env (HERMES_HOME_FOR_REVIEW). */
function runReviewWorkerWithEnv(sid, opts) {
  return new Promise((resolve, reject) => {
    const database = openTrainingDb();
    const p = writeTranscriptExport(sid);
    const promptFile = reviewPromptPath(sid);
    mkdirSync(dirname(promptFile), { recursive: true });
    writeFileSync(promptFile, buildReviewPrompt(sid, p));

    const env = opts.hermesHome
      ? { ...process.env, HOME: opts.hermesHome }
      : process.env;
    const child = spawn(HERMES_BIN, [
      "chat", "--oneshot", "--query-file", promptFile,
      "-m", REVIEW_MODEL, "--provider", REVIEW_PROVIDER,
      "--in", opts.hermesHome || process.env.HOME || "/home/notjitin",
    ], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });

    let out = "";
    let timedOut = false;
    const killTree = () => {
      try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* dead */ } }
    };
    const timer = setTimeout(() => { timedOut = true; killTree(); }, REVIEW_TIMEOUT_MS);
    child.stdout.on("data", (c) => { out += c; if (out.length > 200_000) out = out.slice(-100_000); });
    child.stderr.on("data", (c) => { out += c; if (out.length > 200_000) out = out.slice(-100_000); });

    const bail = (errText) => {
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
      reject(new Error(errText));
    };
    child.on("error", (e) => bail(`spawn: ${e.message}`));
    child.on("close", (code, signal) => {
      if (timedOut) return bail(`timeout after ${Math.round(REVIEW_TIMEOUT_MS / 60000)}min`);
      if (signal === "SIGKILL") return bail(`killed (${signal}) — likely timeout racing exit`);
      if (code !== 0) return bail(`exit ${code}`);
      if (!out.trim()) return bail("empty output");
      clearTimeout(timer);
      // Unlike the fire-and-forget path, the backfill caller OWNS the result —
      // resolve with the review output; scheduleRetry is the CALLER's job.
      const analysis = { at: Date.now(), via: "backfill", gate: "hermes-oneshot", tail: out.slice(-4000) };
      database.prepare("UPDATE sessions SET review_status='reviewed' WHERE sid=?").run(sid);
      database.prepare("UPDATE review_jobs SET status='done', last_error=NULL, updated_at=? WHERE sid=?").run(Date.now(), sid);
      pushJob(jobRow(database, sid));
      resolve(analysis);
    });
  });
}

/** Generic gateway JSON GET/POST with the cookie + one 401 retry (ingest). */
export async function gatewayJson(method, path, body) {
  let cookie = await gatewayCookie();
  let res = await gatewayReq(method, path, cookie, body);
  if (res.status === 401) {
    clearHermesCookie();
    cookie = await gatewayCookie();
    res = await gatewayReq(method, path, cookie, body);
  }
  if (res.status !== 200) throw new Error(`gateway ${path} HTTP ${res.status}`);
  try { return JSON.parse(res.body); } catch { throw new Error(`gateway ${path} not JSON`); }
}

/**
 * Dump one session's transcript into the archive tables WITHOUT reviewing —
 * what the ingest sweeper wants (`status: "archived"` stamps review_status and
 * marks it ingested). Fails when the gateway says the history is gone.
 */
export async function dumpSession(sid, title, source, opts = {}) {
  const database = openTrainingDb();
  const ins = database.prepare(`
    INSERT INTO messages (sid, row_id, ts, role, content, tool_calls, reasoning)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sid, row_id) DO UPDATE SET content=excluded.content, tool_calls=excluded.tool_calls, reasoning=excluded.reasoning, ts=excluded.ts
  `);
  let offset = 0, rows = 0, firstTs = null;
  for (;;) {
    const data = await historyPage(sid, offset);
    const msgs = data.messages || [];
    if (!msgs.length) break;
    database.exec("BEGIN");
    for (const m of msgs) {
      ins.run(sid, String(m.id), m.timestamp ?? null, m.role ?? "unknown",
        m.content ?? m.text ?? null,
        m.tool_calls ? JSON.stringify(m.tool_calls) : null,
        m.reasoning ?? null);
      const ts = m.timestamp == null ? null : (m.timestamp < 1e12 ? m.timestamp * 1000 : m.timestamp);
      if (firstTs === null && ts != null) firstTs = ts;
      rows++;
    }
    database.exec("COMMIT");
    offset += msgs.length;
    if (msgs.length < DUMP_PAGE) break;
  }
  if (rows === 0) throw new Error("session has no history rows (already deleted?)");
  const stats = statsFor(database.prepare("SELECT role, tool_calls, content, reasoning FROM messages WHERE sid = ?").all(sid));
  const status = opts.status || "archived";
  database.prepare(`
    INSERT INTO sessions (sid, title, source, created_at, ended_at, message_rows, token_stats, review_status, ingested_at, last_activity_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sid) DO UPDATE SET title=COALESCE(excluded.title, sessions.title),
      source=COALESCE(excluded.source, sessions.source),
      created_at=COALESCE(sessions.created_at, excluded.created_at),
      ended_at=excluded.ended_at, message_rows=excluded.message_rows, token_stats=excluded.token_stats,
      review_status=excluded.review_status,
      ingested_at=COALESCE(sessions.ingested_at, excluded.ingested_at),
      last_activity_at=COALESCE(excluded.last_activity_at, sessions.last_activity_at)
  `).run(sid, title, source, firstTs, Date.now(), rows, JSON.stringify(stats), status, Date.now(), firstTs);
  return { sid, rows };
}

// ---- Retry queue ----------------------------------------------------------

function scheduleRetry(sid, errText, logTail) {
  const database = openTrainingDb();
  const job = jobRow(database, sid);
  const attempts = (job ? job.attempts : 0) + 1;
  const status = attempts >= MAX_RETRIES ? "failed" : "awaiting_retry";
  database.prepare(`
    UPDATE review_jobs SET status=?, attempts=?, next_attempt_at=?, last_error=?,
      worker_log=COALESCE(?, worker_log), updated_at=? WHERE sid=?
  `).run(
    status, attempts,
    status === "awaiting_retry" ? Date.now() + RETRY_DELAY_MS : null,
    errText, logTail, Date.now(), sid,
  );
  pushJob(jobRow(database, sid));
}

// Sweeper: on boot + every tick. Two duties:
//  1. due awaiting_retry jobs → review (or delete-only if already reviewed)
//  2. dumping/reviewing unchanged >STALE_MS (restart mid-job) → full rerun
export function startTrainingSweeper() {
  openTrainingDb();
  const tick = () => {
    let database;
    try { database = openTrainingDb(); } catch { return; }
    try {
      const now = Date.now();
      const stale = database.prepare(`
        SELECT sid FROM review_jobs WHERE status IN ('dumping','reviewing') AND updated_at < ?
      `).all(now - STALE_MS);
      for (const { sid } of stale) {
        if (running.has(sid)) continue;
        const sess = database.prepare("SELECT title, source FROM sessions WHERE sid = ?").get(sid);
        running.add(sid);
        void dumpAndReview(sid, sess ? sess.title : null, sess ? sess.source : null)
          .catch((e) => scheduleRetry(sid, `resume: ${e && e.message}`, null))
          .finally(() => running.delete(sid));
      }
      const due = database.prepare(`
        SELECT sid FROM review_jobs WHERE status='awaiting_retry' AND next_attempt_at <= ?
      `).all(now);
      for (const { sid } of due) {
        if (running.has(sid)) continue;
        const sess = database.prepare("SELECT review_status FROM sessions WHERE sid = ?").get(sid);
        running.add(sid);
        if (sess && sess.review_status === "reviewed") {
          // delete-only retry: docs already updated, gateway delete is all that's left
          database.prepare("UPDATE review_jobs SET status='reviewing', updated_at=? WHERE sid=?").run(now, sid);
          finishReview(sid, "delete-only retry")
            .catch((e) => scheduleRetry(sid, `delete retry: ${e.message}`, null))
            .finally(() => running.delete(sid));
        } else if (sess && sess.review_status === "dumped") {
          database.prepare("UPDATE review_jobs SET status='reviewing', updated_at=? WHERE sid=?").run(now, sid);
          pushJob(jobRow(database, sid));
          Promise.resolve(runReviewWorker(sid))
            .catch((e) => scheduleRetry(sid, `sweep: ${e && e.message}`, null))
            .finally(() => running.delete(sid));
        } else {
          // no sessions row (crash before dump finished) → full rerun
          void dumpAndReview(sid, null, null)
            .catch((e) => scheduleRetry(sid, `resume: ${e && e.message}`, null))
            .finally(() => running.delete(sid));
        }
      }
    } catch (e) {
      console.error("[training] sweeper tick:", e && e.message);
    }
  };
  tick();
  const t = setInterval(tick, SWEEP_INTERVAL_MS);
  if (typeof t.unref === "function") t.unref();
  return t;
}

// ---- Gateway session delete (R5) ------------------------------------------

async function deleteSessionViaGateway(sid) {
  let cookie = await gatewayCookie();
  let res = await gatewayReq("DELETE", `/api/sessions/${encodeURIComponent(sid)}`, cookie);
  if (res.status === 401) {
    clearHermesCookie();
    cookie = await gatewayCookie();
    res = await gatewayReq("DELETE", `/api/sessions/${encodeURIComponent(sid)}`, cookie);
  }
  if (res.status < 200 || res.status >= 300) throw new Error(`delete HTTP ${res.status}`);
}

// ---- Retrieval API (R6) ----------------------------------------------------

export function listTrainingSessions() {
  const database = openTrainingDb();
  return database.prepare(`
    SELECT s.sid, s.title, s.source, s.created_at, s.ended_at, s.message_rows, s.token_stats,
           s.review_status, j.status AS job_status, j.attempts, j.next_attempt_at, j.last_error
    FROM sessions s LEFT JOIN review_jobs j ON j.sid = s.sid
    ORDER BY s.ended_at DESC
  `).all();
}

export function getTrainingSession(sid) {
  const database = openTrainingDb();
  const sess = database.prepare("SELECT * FROM sessions WHERE sid = ?").get(sid);
  if (!sess) return null;
  const messages = database.prepare(`
    SELECT row_id, ts, role, content, tool_calls, reasoning
    FROM messages WHERE sid = ? ORDER BY ts ASC, row_id ASC
  `).all(sid);
  const job = jobRow(database, sid);
  return { session: sess, messages, job };
}

export function listReviewJobs(limit = 20) {
  const database = openTrainingDb();
  return database.prepare("SELECT * FROM review_jobs ORDER BY updated_at DESC LIMIT ?").all(limit);
}
