// Check: ingest.mjs sweeper + stats, against a temp training DB.
// Exercises: stats math, the ingested_at backfill, and fail-soft behaviour
// when no gateway is wired. Dataset hygiene lives in dataset.check.mjs.
// Run: node scripts/ingest.check.mjs
import assert from "node:assert";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "astra-ingest-check-"));
process.env.TRAINING_DB_PATH = join(dir, "t.db");
process.env.TRAINING_DATA_DIR = dir;

const { openTrainingDb } = await import("../server/training.mjs");
const { ingestStats, runIngestSweep } = await import("../server/ingest.mjs");

const db = openTrainingDb();
const insMsg = db.prepare(
  "INSERT INTO messages (sid,row_id,ts,role,content,tool_calls,reasoning) VALUES (?,?,?,?,?,?,?)",
);
const insSess = db.prepare(
  `INSERT INTO sessions (sid,title,source,created_at,ended_at,message_rows,token_stats,review_status,ingested_at,last_activity_at)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,
);

// s1 — ingested. s2 — legacy row with NULL ingested_at (pre-column).
insMsg.run("s1", "m1", 1, "user", "hi", null, null);
insMsg.run("s1", "m2", 2, "assistant", "hello", null, null);
insSess.run("s1", "a", "webui", 1, 100, 2, "{}", "archived", 100, 2);
insMsg.run("s2", "m1", 3, "user", "yo", null, null);
insMsg.run("s2", "m2", 4, "assistant", "sup", null, null);
insSess.run("s2", "b", "webui", 3, 200, 2, "{}", "dumped", null, 4);

// 1) Stats count everything; the legacy NULL row reads un-ingested pre-backfill.
const stats = ingestStats();
assert.equal(stats.total_sessions, 2, "counts all sessions");
assert.equal(stats.messages, 4, "counts all messages");
assert.equal(stats.uningested, 1, "legacy NULL row reads un-ingested before backfill");

// 2) Backfill stamps the legacy NULL row so uningested is honest.
db.prepare(
  "UPDATE sessions SET ingested_at = COALESCE(ended_at, ?) WHERE ingested_at IS NULL AND message_rows > 0",
).run(Date.now());
assert.equal(ingestStats().uningested, 0, "backfill leaves no false un-ingested rows");

// 3) A sweep with no gateway cookie provider wired must fail soft, never throw.
const sweep = await runIngestSweep();
assert.ok(sweep.error || sweep.skipped || sweep.pending !== undefined, "sweep degrades without a gateway");

console.log("ingest.check: 3/3 groups passed");
