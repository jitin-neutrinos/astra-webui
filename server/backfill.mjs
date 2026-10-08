// backfill.mjs — Analyse every ingested chat that was never reviewed.
//
// The auto-ingest sweeper archives chats without reviewing them (only the
// End-session button runs a review). That leaves a backlog: transcripts that
// never had their durable lessons written back to skills / agent docs / project
// docs. This job walks that backlog with the SAME reviewer the end-session
// flow uses, so the work is identical and idempotent.
//
// It is sequential by design: each review edits shared files (skills, SOUL.md),
// and two reviewers editing the same SKILL.md at once is a lost-update race.
//
// Env: BACKFILL_INTERVAL_MS (0 = off), BACKFILL_BATCH (chats per tick).
import { openTrainingDb, runReviewForSession, isReviewRunning } from "./training.mjs";
import { estateSnapshot, diffEstate } from "./analysis.mjs";
import { broadcastFrame } from "./hermes-proxy.mjs";
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

// ---- per-worker HERMES_HOME isolation --------------------------------------
// Concurrent `hermes chat` processes SHARE ~/.hermes/state.db and the session
// registry. Under load they contend: the process exits 0 having produced no
// output at all (observed as ~67% empty reviews at concurrency 6-8, while the
// same command run alone always succeeded). Each worker therefore gets its own
// HERMES_HOME — the pattern proven by the Taal worker protocol — holding only
// the provider key. Measured: 6/6 clean at concurrency 6 with private homes.
const HOME_ROOT = process.env.TRAINING_WORKER_HOME_ROOT
  || join(process.env.HOME || "/home/notjitin", ".hermes", "cache", "scratch", "review-homes");

function providerEnvKeys() {
  // The private home needs the provider credential the reviewer runs on, and
  // nothing else. Read from the host .env; the value is never logged.
  const out = {};
  try {
    const envPath = join(process.env.HOME || "/home/notjitin", ".hermes", ".env");
    if (!existsSync(envPath)) return out;
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+_API_KEY)\s*=\s*(.+)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch { /* no key → the worker falls back to the shared home */ }
  return out;
}

/** Create (once) and return a private HERMES_HOME for worker `n`. */
export function workerHome(n) {
  try {
    const dir = join(HOME_ROOT, `w${n}`);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const envPath = join(dir, ".env");
    if (!existsSync(envPath)) {
      const keys = providerEnvKeys();
      const body = Object.entries(keys).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
      writeFileSync(envPath, body, { mode: 0o600 });
    }
    return dir;
  } catch {
    return null; // fall back to the shared home rather than fail the review
  }
}

export function cleanupWorkerHomes() {
  try { rmSync(HOME_ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
}

// ---- cross-process lock ----------------------------------------------------
// The in-process `running` guard cannot see a separate runner process. A pid
// file lets the service's timer and a detached runner agree on who owns the
// backlog, so a long run is never double-worked.
const DATA_DIR = process.env.TRAINING_DATA_DIR || join(process.cwd(), "data");
const LOCK_FILE = join(DATA_DIR, "backfill.lock");

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Take the backlog lock. Returns true when we own it. */
export function acquireLock() {
  try {
    if (existsSync(LOCK_FILE)) {
      const held = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
      if (pidAlive(held?.pid) && held.pid !== process.pid) return false;
    }
    mkdirSync(dirname(LOCK_FILE), { recursive: true });
    writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, at: Date.now() }));
    return true;
  } catch { return true; } // a lock failure must not block the work
}

export function releaseLock() {
  try {
    if (existsSync(LOCK_FILE)) {
      const held = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
      if (held?.pid === process.pid) unlinkSync(LOCK_FILE);
    }
  } catch { /* best effort */ }
}

export function lockHolder() {
  try {
    if (!existsSync(LOCK_FILE)) return null;
    const held = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
    return pidAlive(held?.pid) ? held : null;
  } catch { return null; }
}

const INTERVAL_MS = Number(process.env.BACKFILL_INTERVAL_MS ?? 30 * 60 * 1000);
const BATCH = Math.max(1, Number(process.env.BACKFILL_BATCH || 1));

let running = false;
let lastRun = null;

function push() {
  try {
    broadcastFrame(JSON.stringify({
      method: "event",
      params: { type: "analysis.updated", payload: backfillStatus() },
    }));
  } catch { /* no ws clients is fine */ }
}

/** Sessions ingested but never analysed, oldest first. */
export function unanalysedSessions(limit = 50) {
  const database = openTrainingDb();
  return database.prepare(`
    SELECT sid, title, message_rows, ingested_at, source
    FROM sessions
    WHERE analysis_status IS NULL OR analysis_status = ''
    ORDER BY ingested_at ASC
    LIMIT ?
  `).all(limit);
}

export function backfillStatus() {
  const database = openTrainingDb();
  const row = (sql) => database.prepare(sql).get().n;
  return {
    running,
    last_run: lastRun,
    total: row("SELECT COUNT(*) n FROM sessions"),
    analysed: row("SELECT COUNT(*) n FROM sessions WHERE analysis_status='done'"),
    failed: row("SELECT COUNT(*) n FROM sessions WHERE analysis_status='failed'"),
    pending: row("SELECT COUNT(*) n FROM sessions WHERE analysis_status IS NULL OR analysis_status=''"),
  };
}

/**
 * Run up to BATCH unreviewed sessions through the reviewer, one at a time.
 * Returns a summary; never throws (a bad transcript must not kill the job).
 */
export async function runBackfill(opts = {}) {
  if (running) return { skipped: "backfill in progress", ...backfillStatus() };
  if (isReviewRunning()) return { skipped: "a review is already in flight", ...backfillStatus() };
  running = true;
  const batch = Math.max(1, Number(opts.batch || BATCH));
  const startedAt = Date.now();
  const results = [];
  try {
    const queue = unanalysedSessions(batch);
    for (const row of queue) {
      const sid = String(row.sid);
      try {
        await runReviewForSession(sid, row.title ?? null, row.source ?? null);
        results.push({ sid, ok: true });
      } catch (e) {
        results.push({ sid, ok: false, error: e && e.message });
      }
      push();
    }
    lastRun = { at: startedAt, ms: Date.now() - startedAt, processed: results.length, results };
    return { ...lastRun, ...backfillStatus() };
  } finally {
    running = false;
    push();
  }
}

/**
 * Which runs collided: two runs whose wall-clock windows OVERLAP and whose
 * changed-file sets INTERSECT. Pure + exported so the check can pin it — this
 * is the load-bearing decision behind safe parallelism.
 */
export function findCollisions(windows) {
  const collided = new Set();
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const a = windows[i], b = windows[j];
      // Windows that only TOUCH (a.end === b.start) are sequential, not
      // concurrent — a run that ended the instant the next began cannot have
      // raced it. Only a real overlap can collide.
      if (a.end <= b.start || b.end <= a.start) continue;
      for (const f of a.files) {
        if (b.files.has(f)) { collided.add(a.sid); collided.add(b.sid); break; }
      }
    }
  }
  return collided;
}

/**
 * PARALLEL backfill with optimistic concurrency.
 *
 * The hazard: every review edits the same shared doc estate (skills, SOUL.md,
 * AGENTS.md). Two reviewers writing one SKILL.md at once = a silently lost edit.
 * The estate is not a git repo, so there is no branch to merge from.
 *
 * The approach: run N reviews at once, record for each the wall-clock window it
 * ran in and the exact files it changed (fingerprint diff). Afterwards, any two
 * runs whose windows OVERLAP and whose changed-file sets INTERSECT collided —
 * those chats are re-run serially so the survivor is a clean, complete edit.
 * Non-overlapping runs can never collide, so this is conservative and exact.
 *
 * `onProgress` is called after every completion for live reporting.
 */
export async function runParallelBackfill(opts = {}) {
  const concurrency = Math.max(1, Number(opts.concurrency || 6));
  const limit = Number(opts.limit || 0); // 0 = the whole backlog
  const startedAt = Date.now();
  const summary = {
    started_at: startedAt, concurrency, attempted: 0, ok: 0, failed: 0,
    collisions: 0, retried: 0, skipped: 0, errors: [],
  };

  const queue = unanalysedSessions(limit || 100000);
  if (!queue.length) return { ...summary, done: true, note: "nothing pending" };

  // Refuse to churn the whole backlog when the reviewer's provider is dead: a
  // fallback model produces empty reviews that would be recorded as successes.
  if (opts.preflight !== false) {
    const health = providerHealth();
    if (!health.ok) {
      return { ...summary, aborted: true, reason: "provider unavailable", provider: health };
    }
  }

  const windows = []; // {sid, start, end, files:Set}
  const claimed = new Set();
  let cursor = 0;
  let requeue = [];

  const takeNext = () => {
    while (cursor < queue.length) {
      const row = queue[cursor++];
      if (claimed.has(String(row.sid))) continue;
      return row;
    }
    return null;
  };

  const runOne = async (row, slot) => {
    const sid = String(row.sid);
    claimed.add(sid);
    const start = Date.now();
    let files = new Set();
    let ok = false;
    let error = null;
    try {
      const before = estateSnapshot();
      // Each parallel slot gets its own HERMES_HOME so concurrent reviewers do
      // not contend on the shared state.db (the empty-output failure mode).
      await runReviewForSession(sid, row.title ?? null, row.source ?? null, { hermesHome: workerHome(slot) });
      const diff = diffEstate(before, estateSnapshot());
      files = new Set([...diff.created, ...diff.edited].map((c) => c.path));
      ok = true;
    } catch (e) {
      error = e && e.message;
    }
    const end = Date.now();
    windows.push({ sid, start, end, files });
    summary.attempted++;
    if (ok) summary.ok++; else { summary.failed++; if (error) summary.errors.push({ sid, error }); }
    return { sid, ok, error, ms: end - start, files: files.size };
  };

  const worker = async (slot) => {
    for (;;) {
      const row = takeNext();
      if (!row) return;
      const r = await runOne(row, slot);
      if (typeof opts.onProgress === "function") opts.onProgress({ ...r, summary: { ...summary } });
      else push();
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, (_, i) => worker(i)));

  // Collision pass: overlapping windows that touched the same file.
  const collided = findCollisions(windows);
  summary.collisions = collided.size;

  // Serial re-run of the collided chats: now one at a time, so the final state
  // is a complete edit rather than whichever write landed last.
  requeue = queue.filter((r) => collided.has(String(r.sid)));
  for (const row of requeue) {
    const sid = String(row.sid);
    try {
      await runReviewForSession(sid, row.title ?? null, row.source ?? null);
      summary.retried++;
    } catch (e) {
      summary.errors.push({ sid, error: `retry: ${e && e.message}` });
    }
    if (typeof opts.onProgress === "function") opts.onProgress({ sid, retry: true, summary: { ...summary } });
  }

  summary.ms = Date.now() - startedAt;
  lastRun = { at: startedAt, ms: summary.ms, processed: summary.attempted, parallel: true, collisions: summary.collisions };
  push();
  return summary;
}

// ---- Provider preflight ----------------------------------------------------

// The preflight only guards the DEFAULT (z.ai) provider: it reads the agent log
// for quota/429 lines, which is where z.ai exhaustion lands. When the reviewer
// is deliberately pointed at another provider (TRAINING_REVIEW_PROVIDER), that
// log is irrelevant — the per-run empty-output check is the real guard there.
const AGENT_LOG = process.env.TRAINING_AGENT_LOG
  || join(process.env.HOME || "/home/notjitin", ".hermes", "logs", "errors.log");

export function providerHealth() {
  const provider = process.env.TRAINING_REVIEW_PROVIDER || "zai";
  if (provider !== "zai") {
    return { ok: true, note: `reviewer pinned to ${provider} — z.ai quota not in play` };
  }
  try {
    if (!existsSync(AGENT_LOG)) return { ok: true, note: "no log" };
    // Only the tail matters; the file is multi-MB.
    const raw = readFileSync(AGENT_LOG, "utf8").slice(-60_000);
    const lines = raw.split("\n").filter((l) => /RateLimitError|429|quota|Exhausted/i.test(l));
    const last = lines[lines.length - 1] || "";
    if (!last) return { ok: true };
    const at = Date.parse((last.match(/^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/) || [])[1] || "");
    const ageMin = at ? (Date.now() - at) / 60000 : Infinity;
    const resets = (raw.match(/resets? at ([\d-]+ [\d:]+)/i) || [])[1] || null;
    // Fresh exhaustion (within the last 10 min) is a live blocker.
    return { ok: ageMin > 10, age_min: Math.round(ageMin), resets, last: last.slice(0, 200) };
  } catch {
    return { ok: true }; // a health check must never block the work
  }
}

export function startBackfillSweeper() {
  if (!INTERVAL_MS) return null;
  // Sessions with a completed review job were already analysed — they predate
  // the analysis_status column, so mark them rather than re-reviewing (and
  // re-editing the same docs) for no gain.
  try {
    const database = openTrainingDb();
    database.prepare(`
      UPDATE sessions SET analysis_status='done', analysis=COALESCE(analysis, ?)
      WHERE analysis_status IS NULL
        AND sid IN (SELECT sid FROM review_jobs WHERE status='done')
    `).run(JSON.stringify({ at: Date.now(), note: "reviewed before change-evidence capture" }));
  } catch (e) {
    console.error("[backfill] analysis backfill:", e && e.message);
  }
  const tick = () => {
    // Cheap gate: only pay for a batch when there is work and nothing is busy.
    try {
      if (lockHolder()) return;      // a detached runner owns the backlog
      if (isReviewRunning()) return;
      if (!unanalysedSessions(1).length) return;
    } catch { return; }
    void runBackfill().catch((e) => console.error("[backfill]", e && e.message));
  };
  const t = setInterval(tick, INTERVAL_MS);
  if (typeof t.unref === "function") t.unref();
  return t;
}
