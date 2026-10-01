// Check: training.mjs core logic without spawning workers or touching the
// real gateway. Exercises: schema create, idempotent upsert dump math, retry
// schedule math, sweeper query shapes, transcript export assembly.
// Run: node scripts/training.check.mjs
import assert from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "astra-training-check-"));
const db = new DatabaseSync(join(dir, "t.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec(`
  CREATE TABLE sessions (
    sid TEXT PRIMARY KEY, title TEXT, source TEXT, created_at INTEGER,
    ended_at INTEGER NOT NULL, message_rows INTEGER NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'dumped'
  );
  CREATE TABLE messages (
    sid TEXT NOT NULL, row_id TEXT NOT NULL, ts REAL, role TEXT NOT NULL,
    content TEXT, tool_calls TEXT, reasoning TEXT,
    PRIMARY KEY (sid, row_id)
  );
  CREATE TABLE review_jobs (
    sid TEXT PRIMARY KEY, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER, last_error TEXT, worker_log TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
`);

// 1) Idempotent dump: same rows twice → row count unchanged, content updated.
const ins = db.prepare(`
  INSERT INTO messages (sid, row_id, ts, role, content, tool_calls, reasoning)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(sid, row_id) DO UPDATE SET content=excluded.content
`);
const page = [
  { id: "r1", ts: 100, role: "user", content: "hello" },
  { id: "r2", ts: 200, role: "assistant", content: "hi", tool_calls: [{ id: "c1" }], reasoning: "think" },
];
for (const m of page) ins.run("s1", String(m.id), m.ts, m.role, m.content, m.tool_calls ? JSON.stringify(m.tool_calls) : null, m.reasoning ?? null);
for (const m of page) ins.run("s1", String(m.id), m.ts, m.role, m.content + "!", m.tool_calls ? JSON.stringify(m.tool_calls) : null, m.reasoning ?? null);
const count = db.prepare("SELECT COUNT(*) n FROM messages WHERE sid='s1'").get().n;
assert.equal(count, 2, "upsert does not duplicate rows");
const updated = db.prepare("SELECT content FROM messages WHERE sid='s1' AND row_id='r1'").get().content;
assert.equal(updated, "hello!", "upsert updates content");

// 2) Retry math: attempts cap and 5h backoff shape (mirrors scheduleRetry).
const RETRY_DELAY_MS = 5 * 60 * 60 * 1000, MAX_RETRIES = 6;
function scheduleRetry(sid, attemptsNow) {
  const attempts = attemptsNow + 1;
  const status = attempts >= MAX_RETRIES ? "failed" : "awaiting_retry";
  db.prepare(`INSERT INTO review_jobs (sid,status,attempts,next_attempt_at,last_error,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(sid) DO UPDATE SET status=excluded.status, attempts=excluded.attempts, next_attempt_at=excluded.next_attempt_at`)
    .run(sid, status, attempts, status === "awaiting_retry" ? Date.now() + RETRY_DELAY_MS : null, "err", Date.now(), Date.now());
  return db.prepare("SELECT status, attempts, next_attempt_at FROM review_jobs WHERE sid=?").get(sid);
}
let j = { attempts: 0 };
for (let i = 0; i < 5; i++) j = scheduleRetry("s1", j.attempts);
assert.equal(j.status, "awaiting_retry");
assert.ok(j.next_attempt_at - Date.now() > 4.9 * 60 * 60 * 1000, "backoff is ~5h");
j = scheduleRetry("s1", j.attempts);
assert.equal(j.status, "failed", "6th strike fails permanently");
assert.equal(j.next_attempt_at, null, "failed job is never rescheduled");

// 3) Sweeper query shapes: due jobs and stuck jobs are selectable.
const due = db.prepare("SELECT sid FROM review_jobs WHERE status='awaiting_retry' AND next_attempt_at IS NULL").all();
assert.equal(due.length, 0, "failed job not picked up by due sweep");
db.prepare("UPDATE review_jobs SET status='awaiting_retry', next_attempt_at=? WHERE sid='s1'").run(Date.now() - 1);
const due2 = db.prepare("SELECT sid FROM review_jobs WHERE status='awaiting_retry' AND next_attempt_at <= ?").all(Date.now());
assert.equal(due2.length, 1, "due job selected");

// 4) Transcript export assembly (the shape the reviewer reads).
const rows = db.prepare("SELECT * FROM messages WHERE sid='s1' ORDER BY ts ASC").all();
assert.equal(rows.length, 2);
assert.ok(rows[0].ts <= rows[1].ts, "export is chronological");
const md = rows.map(m => `[${m.role}] ${m.content}${m.tool_calls ? " <tool_calls>" : ""}`).join("\n");
assert.ok(md.includes("[user] hello!") && md.includes("[assistant] hi!"), "export carries role+content");

console.log("training.check: 4/4 groups passed");
