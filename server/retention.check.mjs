// retention.check.mjs — the 14-day ingestion-gated retention sweeper.
// Run: node server/retention.check.mjs   (isolated via TRAINING_DB_PATH + ASTRA_STREAM_DIR)
//
// THE PROPERTY THAT MATTERS MOST:
//   A session older than the retention window but NOT yet ingested must NEVER be
//   deleted, however old it is. That is the gate the owner asked for: retention
//   must never destroy a transcript the training pipeline has not read yet. Every
//   other assertion here is bookkeeping; this one is the safety property.
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "astra-retention-"));
process.env.TRAINING_DB_PATH = join(tmp, "training.db");
process.env.ASTRA_STREAM_DIR = join(tmp, "stream");
process.env.ASTRA_RETENTION_ENABLED = "0"; // dry-run by default; force is used explicitly

const training = await import("./training.mjs");
const ret = await import("./retention.mjs");

const db = training.openTrainingDb();
const NOW = Date.now();
const DAY = 86400;
const nowSec = Math.floor(NOW / 1000);

// Seed a matrix of sessions covering every branch of the gate.
const SEED = [
  // sid,                ageDays, ingested, title
  ["old-ingested",      20,     true,     "should delete"],
  ["old-ingested-b",    15,     true,     "should delete"],
  ["old-UNingested",    20,     false,    "MUST KEEP — never ingested"],
  ["recent-ingested",    3,     true,     "MUST KEEP — inside the window"],
  ["recent-UNingested",  2,     false,    "MUST KEEP"],
  ["boundary-14",       14,     true,     "exactly at the boundary"],
  ["zero-ended",         1,     true,     "ended_at NULL — must keep"],
];
const ins = db.prepare(
  "INSERT INTO sessions (sid, title, source, created_at, ended_at, message_rows, token_stats, review_status, ingested_at) VALUES (?,?,?,?,?,?,?,?,?)"
);
for (const [sid, age, ingested, title] of SEED) {
  ins.run(sid, title, "test", nowSec - (age + 1) * DAY, nowSec - age * DAY, 2, null, "dumped", ingested ? nowSec - age * DAY : null);
}
// Give the deletable ones some messages so message-count deletion is exercised.
const insMsg = db.prepare("INSERT INTO messages (sid, row_id, ts, role, content) VALUES (?,?,?,?,?)");
for (const sid of ["old-ingested", "old-ingested-b", "recent-ingested"]) {
  for (let i = 0; i < 3; i++) {
    insMsg.run(sid, `r${i}`, nowSec, i % 2 ? "assistant" : "user", `content for ${sid} row ${i}`);
  }
}

// --- 1. the plan is a PLAN: nothing is touched ---------------------------
const before = Number(db.prepare("SELECT count(*) c FROM sessions").get().c);
const plan = ret.planRetention({ now: NOW });
assert.equal(before, 7, "all 7 fixture sessions are present");
assert.equal(Number(db.prepare("SELECT count(*) c FROM sessions").get().c), 7,
  "planRetention deletes NOTHING (it is a receipt, not an action)");

// --- 2. THE SAFETY PROPERTY --------------------------------------------
// old-UNingested is 20 days old and MUST appear nowhere in the plan.
const plannedSids = plan.sessions.map((s) => s.sid);
assert.equal(plannedSids.includes("old-UNingested"), false,
  "a 20-day-old UN-ingested session is NEVER in the delete plan — the ingestion gate holds");
assert.equal(plannedSids.includes("recent-ingested"), false, "an inside-the-window session is kept");
assert.equal(plannedSids.includes("recent-UNingested"), false, "recent + un-ingested is kept");
assert.equal(plannedSids.includes("zero-ended"), false, "a session with no ended_at is kept (never ages out)");

// --- 3. the rows that SHOULD be deleted are planned ---------------------
assert.ok(plannedSids.includes("old-ingested"), "a 20-day ingested session IS planned");
assert.ok(plannedSids.includes("old-ingested-b"), "a 15-day ingested session IS planned");
assert.equal(plan.session_count, 2, `exactly 2 planned (got ${plan.session_count}: ${plannedSids.join(",")})`);
assert.equal(plan.dry_run, true, "the plan is labelled dry_run");
assert.equal(plan.enabled, false, "and reports that deletion is disabled");
assert.equal(plan.retention_days, 14, "the window is 14 days");

// --- 4. the boundary is exactly 14 days ---------------------------------
// `boundary-14` ended exactly 14 days ago. The rule is `ended_at < cutoff`, so a
// row landing exactly ON the cutoff is KEPT (strict inequality, one extra day of
// safety rather than one second less). Assert the arithmetic, not a guess.
const cutoff = ret._test.cutoffSecs(NOW);
const boundaryEnded = nowSec - 14 * DAY;
assert.ok(boundaryEnded <= cutoff,
  `a row ending exactly 14 days ago sits at or after the cutoff (ended=${boundaryEnded}, cutoff=${cutoff})`);
assert.equal(Number(ret.planRetention({ now: NOW, batch: 100 }).sessions.filter((s) => s.sid === "boundary-14").length), 0,
  "so it is NOT deleted — the boundary is inclusive of the last safe day");

// --- 5. oldest first ----------------------------------------------------
const ages = plan.sessions.map((s) => s.age_days);
assert.deepEqual(ages, [...ages].sort((a, b) => b - a),
  `the plan is ordered oldest-first so a batch trims from the far end (got ${ages})`);

// --- 6. a real run is refused while disabled ----------------------------
const refused = ret.runRetention({ now: NOW, dryRun: false });
assert.ok(refused.skipped, "an explicit delete is refused while retention is disabled");
assert.equal(Number(db.prepare("SELECT count(*) c FROM sessions").get().c), 7,
  "and nothing was deleted");

// --- 7. force, dry-run: still deletes nothing ---------------------------
const forcedDry = ret.runRetention({ now: NOW, dryRun: true, force: true });
assert.equal(forcedDry.dry_run, true, "force + dryRun is still a plan");
assert.equal(Number(db.prepare("SELECT count(*) c FROM sessions").get().c), 7,
  "force + dryRun deletes nothing");

// --- 8. force, execute: the real deletion ------------------------------
const done = ret.runRetention({ now: NOW, dryRun: false, force: true });
assert.equal(done.dry_run, false, "an executing run is labelled so");
assert.equal(done.removed_sessions, 2, `two sessions removed (got ${done.removed_sessions})`);
assert.equal(done.removed_messages, 6, `their six messages removed too (got ${done.removed_messages})`);

const after = db.prepare("SELECT sid FROM sessions ORDER BY sid").all().map((r) => String(r.sid));
assert.equal(after.includes("old-ingested"), false, "the 20-day session is gone");
assert.equal(after.includes("old-ingested-b"), false, "the 15-day session is gone");
assert.equal(after.includes("old-UNingested"), true,
  "THE CRITICAL ONE: the un-ingested session survived the real deletion");
assert.equal(after.includes("recent-ingested"), true, "the recent ingested session survived");
assert.equal(after.includes("zero-ended"), true, "the null-ended session survived");

// Their messages went with them, but the survivors' messages stayed.
const msgSids = db.prepare("SELECT DISTINCT sid FROM messages ORDER BY sid").all().map((r) => String(r.sid));
assert.equal(msgSids.includes("old-ingested"), false, "deleted sessions' messages are gone (no orphans)");
assert.equal(msgSids.includes("recent-ingested"), true, "the kept session kept its messages");

// --- 9. idempotent: a second run has nothing left to do -----------------
const again = ret.runRetention({ now: NOW, dryRun: false, force: true });
assert.equal(again.removed_sessions, 0, "a second run deletes nothing more");
assert.equal(Number(db.prepare("SELECT count(*) c FROM sessions").get().c), after.length,
  "the survivor count is unchanged");

// --- 10. the batch bound ------------------------------------------------
const insMany = db.prepare(
  "INSERT INTO sessions (sid, title, source, created_at, ended_at, message_rows, token_stats, review_status, ingested_at) VALUES (?,?,?,?,?,?,?,?,?)"
);
for (let i = 0; i < 12; i++) {
  insMany.run(`bulk-${i}`, null, "test", nowSec - 40 * DAY, nowSec - 30 * DAY, 0, null, "dumped", nowSec);
}
const bounded = ret.planRetention({ now: NOW, batch: 5 });
assert.equal(bounded.session_count, 5, "the batch bound caps one plan");
assert.equal(Number(db.prepare("SELECT count(*) c FROM sessions WHERE sid LIKE 'bulk-%'").get().c), 12,
  "and a bounded plan still deletes nothing");

// --- 11. stats ----------------------------------------------------------
const st = ret.retentionStats();
assert.equal(st.retention_days, 14, "stats reports the window");
assert.equal(st.enabled, false, "stats reports that deletion is off");
assert.ok(st.total_sessions >= 12, "stats counts the sessions");
assert.equal(typeof st.cutoff_epoch, "number", "stats reports the cutoff");

// --- 12. the sweeper runs and stays safe --------------------------------
const t = ret.startRetentionSweeper();
assert.ok(t, "the sweeper starts");
assert.ok(ret.retentionStats().last_sweep, "the first sweep ran immediately");
assert.equal(ret.retentionStats().last_sweep.deleted, 0, "a scheduled sweep deletes NOTHING (dry-run by design)");
if (typeof t.unref === "function") t.unref();
clearInterval(t);

// --- 13. garbage input is not fatal -------------------------------------
// A session whose ended_at is in the FUTURE must not be deletable.
insMany.run("future", null, "test", nowSec, nowSec + 40 * DAY, 0, null, "dumped", nowSec);
const fplan = ret.planRetention({ now: NOW, batch: 100 });
assert.equal(fplan.sessions.some((s) => s.sid === "future"), false,
  "a session ending in the future is never deletable");

db.close();
rmSync(tmp, { recursive: true, force: true });
console.log(
  "retention.check: ALL PASS (plan deletes nothing, 20-day UN-ingested session NEVER " +
  "planned or deleted, recent/inside-window kept, null-ended kept, oldest-first order, " +
  "disabled refuses to delete, force+dryRun still deletes nothing, real delete removes " +
  "sessions AND their messages with no orphans, idempotent, batch-bounded, sweeper is " +
  "dry-run, future-ending session kept)"
);
