// Check: analysis.mjs estate diffing — the evidence behind the job drill-down.
// Exercises: created/edited/deleted classification, skill naming, the reviewer's
// FILE: claim parsing, and the claim-vs-truth verdict (undeclared work is
// surfaced, not hidden).
// Run: node scripts/analysis.check.mjs
import assert from "node:assert";
import { diffEstate, classifyPath, skillName, parseFileClaims, claimVsTruth } from "../server/analysis.mjs";

// 1) Classification + skill naming from real path shapes.
assert.equal(classifyPath("/home/u/.hermes/skills/dev/foo/SKILL.md"), "skill");
assert.equal(classifyPath("/home/u/.hermes/SOUL.md"), "agent-doc");
assert.equal(classifyPath("/home/u/Work/projects/x/AGENTS.md"), "project-doc");
assert.equal(skillName("/home/u/.hermes/skills/dev/foo/SKILL.md"), "foo");
assert.equal(skillName("/home/u/.hermes/skills/foo/SKILL.md"), "foo");
assert.equal(skillName("/home/u/.hermes/SOUL.md"), null);

// 2) Diff: created / edited / deleted are separated, unchanged ignored.
const before = new Map([
  ["/home/u/.hermes/skills/a/SKILL.md", "100:10"],
  ["/home/u/.hermes/skills/b/SKILL.md", "200:20"],
  ["/home/u/.hermes/skills/gone/SKILL.md", "300:30"],
]);
const after = new Map([
  ["/home/u/.hermes/skills/a/SKILL.md", "100:10"],   // unchanged
  ["/home/u/.hermes/skills/b/SKILL.md", "250:25"],   // edited (mtime+size moved)
  ["/home/u/.hermes/skills/new/SKILL.md", "400:40"], // created
]);
const diff = diffEstate(before, after);
assert.equal(diff.total, 3, "one edit + one create + one delete");
assert.deepEqual(diff.edited.map((c) => c.path), ["/home/u/.hermes/skills/b/SKILL.md"]);
assert.deepEqual(diff.created.map((c) => c.path), ["/home/u/.hermes/skills/new/SKILL.md"]);
assert.deepEqual(diff.deleted.map((c) => c.path), ["/home/u/.hermes/skills/gone/SKILL.md"]);
assert.equal(diff.edited[0].kind, "skill");
assert.equal(diff.edited[0].skill, "b", "skill name is derived, not the dir");

// 3) A same-size edit still counts (mtime changed) — a no-op must NOT.
const sameSize = diffEstate(new Map([["/home/u/.hermes/skills/x/SKILL.md", "1:5"]]), new Map([["/home/u/.hermes/skills/x/SKILL.md", "2:5"]]));
assert.equal(sameSize.edited.length, 1, "mtime-only change is an edit");
const noop = diffEstate(new Map([["/home/u/.hermes/skills/x/SKILL.md", "1:5"]]), new Map([["/home/u/.hermes/skills/x/SKILL.md", "1:5"]]));
assert.equal(noop.total, 0, "identical signature is not a change");

// 4) FILE: claim parsing — deduped, "none" dropped, prose ignored.
const log = [
  "some prose that mentions FILE: not-a-claim mid-line",
  "FILE: /a/SKILL.md",
  "FILE: /a/SKILL.md",
  "FILE: none",
  "FILE: /b/AGENTS.md",
].join("\n");
const claims = parseFileClaims(log);
assert.deepEqual(claims, ["/a/SKILL.md", "/b/AGENTS.md"], "deduped, none dropped, mid-line ignored");
assert.deepEqual(parseFileClaims(""), [], "no log → no claims");
assert.deepEqual(parseFileClaims("FILE: none"), [], "declared no-op → empty");

// 5) Claim vs truth: undeclared real work is surfaced.
const v = claimVsTruth(claims, diff);
assert.equal(v.claimed, 2);
assert.equal(v.matched, 0, "neither claim matches the measured diff");
assert.deepEqual(v.undeclared.sort(), ["/home/u/.hermes/skills/b/SKILL.md", "/home/u/.hermes/skills/new/SKILL.md"], "real work the agent did not report");
const v2 = claimVsTruth(["/home/u/.hermes/skills/b/SKILL.md"], diff);
assert.equal(v2.matched, 1, "a claim that matches the diff is verified");

console.log("analysis.check: 5/5 groups passed");
