// Check: backfill parallelism safety — the collision decision.
// The hazard is two concurrent reviewers editing one SKILL.md (a lost update).
// findCollisions() must flag EXACTLY the overlapping-and-same-file pairs: miss
// one and a real edit is silently lost; over-report and the job needlessly
// re-runs work.
// Run: node scripts/backfill.check.mjs
import assert from "node:assert";
import { findCollisions, backfillStatus, unanalysedSessions } from "../server/backfill.mjs";

const w = (sid, start, end, files) => ({ sid, start, end, files: new Set(files) });
const SKILL_A = "/home/u/.hermes/skills/x/SKILL.md";
const SKILL_B = "/home/u/.hermes/skills/y/SKILL.md";

// 1) Same file, overlapping windows → BOTH flagged.
let c = findCollisions([w("s1", 0, 100, [SKILL_A]), w("s2", 50, 150, [SKILL_A])]);
assert.deepEqual([...c].sort(), ["s1", "s2"], "overlapping + same file collides");

// 2) Same file, DISJOINT windows → no collision (they never ran at once).
c = findCollisions([w("s1", 0, 100, [SKILL_A]), w("s2", 100, 200, [SKILL_A])]);
assert.equal(c.size, 0, "sequential runs of the same file do not collide");

// 3) Overlapping windows, DIFFERENT files → no collision.
c = findCollisions([w("s1", 0, 100, [SKILL_A]), w("s2", 50, 150, [SKILL_B])]);
assert.equal(c.size, 0, "different files cannot collide");

// 4) One run that changed nothing never collides, even while others overlap.
c = findCollisions([w("s1", 0, 100, []), w("s2", 50, 150, [SKILL_A])]);
assert.equal(c.size, 0, "a no-op run cannot collide");

// 5) Three-way overlap on one file → all three flagged.
c = findCollisions([w("s1", 0, 100, [SKILL_A]), w("s2", 10, 110, [SKILL_A]), w("s3", 20, 120, [SKILL_A])]);
assert.deepEqual([...c].sort(), ["s1", "s2", "s3"], "three-way collision flags all");

// 6) A clean parallel batch: distinct files, overlapping windows → nothing.
c = findCollisions([
  w("s1", 0, 100, [SKILL_A]),
  w("s2", 0, 100, [SKILL_B]),
  w("s3", 0, 100, ["/home/u/.hermes/SOUL.md"]),
]);
assert.equal(c.size, 0, "the common case is collision-free");

// 7) Partial overlap in a mixed batch flags only the guilty pair.
c = findCollisions([
  w("s1", 0, 100, [SKILL_A]),
  w("s2", 0, 100, [SKILL_B]),
  w("s3", 50, 150, [SKILL_A]),   // collides with s1
  w("s4", 200, 300, [SKILL_A]),  // after everything → clean
]);
assert.deepEqual([...c].sort(), ["s1", "s3"], "only the overlapping same-file pair");

// 8) Status shape is stable (the UI reads these keys).
process.env.TRAINING_DB_PATH = "/tmp/astra-backfill-check-nonexistent.db";
const st = backfillStatus();
for (const k of ["running", "total", "analysed", "failed", "pending"]) {
  assert.ok(k in st, `status exposes ${k}`);
}
assert.ok(Array.isArray(unanalysedSessions(5)), "unanalysedSessions returns an array");

console.log("backfill.check: 8/8 groups passed");
