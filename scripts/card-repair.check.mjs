// Card-repair behavior check: dead-card detection, gate guards, prompt shape.
// Run: node scripts/card-repair.check.mjs
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FENCE_OPEN = "```astra-canvas\n";
const FENCE_CLOSE = "\n```\n";

const probe = `
import { findDeadCards, repairPromptFor, repairAllowed, markRepairAttempted, markRepairSettled, resetCardRepairForTests } from "${ROOT}/src/lib/card-repair.ts";
import { parseCanvasSpec } from "${ROOT}/src/lib/canvas-schema.ts";
const renders = (b) => { try { return !!parseCanvasSpec(b); } catch { return false; } };
let fails = 0;
const assert = (cond, msg) => { if (!cond) { console.log("FAIL", msg); fails++; } };

const OPEN = ${JSON.stringify(FENCE_OPEN)};
const CLOSE = ${JSON.stringify(FENCE_CLOSE)};
const cases = [
  ["healthy", '{"v":1,"blocks":[{"type":"callout","tone":"info","body":"hi"}]}', false],
  ["truly dead (no envelope, no known keys)", '{"totally":"not a card","nope":[1,2,3]}', true],
  ["not JSON", 'garbage {{{', true],
  ["RG-147 detail variant (renderer repairs)", '{"v":1,"blocks":[{"type":"callout","tone":"info","detail":"d"}]}', false],
  ["RG-148 type-keyed root (renderer repairs)", '{"title":"t","badges":{"items":[{"label":"a","tone":"info"}]},"kpi":[{"label":"x","value":1}]}', false],
];
for (const [name, body, expectDead] of cases) {
  const msg = "prose\\n\\n" + OPEN + body + CLOSE + "prose";
  const dead = findDeadCards(msg, renders);
  const got = dead.length > 0;
  assert(got === expectDead, name + ": expected " + (expectDead ? "dead" : "alive") + ", got " + (got ? "dead" : "alive"));
  if (got) assert(dead[0].issues.length > 0, name + ": no issues reported");
}

// gate: dedupe + cooldown
resetCardRepairForTests();
assert(repairAllowed("m1", false).allowed, "first repair must be allowed");
markRepairAttempted("m1");
assert(!repairAllowed("m1", false).allowed, "same id must be deduped");
assert(!repairAllowed("m2", false).allowed, "cooldown must block a second id immediately");

// prompt shape
resetCardRepairForTests();
const dead2 = findDeadCards(OPEN + '{"totally":"not a card"}' + CLOSE, renders);
const p = repairPromptFor(dead2);
assert(p.includes("Parse errors") && p.includes("blocks"), "prompt missing key parts");

console.log(fails ? fails + " failure(s)" : "card-repair check: all pass");
process.exit(fails ? 1 : 0);
`;

writeFileSync("/tmp/card-repair-probe.mjs", probe);
const out = execSync("node --experimental-strip-types /tmp/card-repair-probe.mjs", { encoding: "utf8" });
console.log(out);
if (/FAIL|failure/.test(out)) process.exit(1);
