// Golden-shape agreement check: the strict validator (canvas-validate.ts) must
// ACCEPT every card the renderer accepts AND REJECT every card the renderer
// rejects-as-unreadable. Run: node scripts/canvas-validate.check.mjs
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TSCACHE = "/tmp/canvas-validate-probe.mjs";

// Build a probe that imports BOTH the strict validator and the real parser.
const probe = `
import { readFileSync } from "node:fs";
import { validateCanvasSpec } from "${ROOT}/src/lib/canvas-validate.ts";
import { parseCanvasSpec } from "${ROOT}/src/lib/canvas-schema.ts";
const cards = JSON.parse(readFileSync("/home/notjitin/.hermes/cache/scratch/copy-debug/golden-cards.json", "utf8"));
for (const [name, body] of Object.entries(cards)) {
  let strict = [];
  try { strict = validateCanvasSpec(body); } catch (e) { strict = [{ path: "(throw)", message: e.message }]; }
  let renders = false;
  try { renders = !!parseCanvasSpec(body); } catch {}
  console.log(JSON.stringify({ name, strict: strict.length === 0, renders }));
}
`;
execSync(`cp ${join(ROOT, "src", "lib", "canvas-validate.ts")} /tmp/ 2>/dev/null || true`, { stdio: "ignore" });

const GOLDEN = {
  // strict=PASS + renders=PASS — the healthy population
  "envelope minimal": '{"v":1,"blocks":[{"type":"callout","tone":"info","body":"hi"}]}',
  "rich card": '{"v":1,"title":"t","blocks":[{"type":"badges","items":[{"label":"a","tone":"info"}]},{"type":"kpi","label":"n","value":6},{"type":"table","columns":["A"],"rows":[["1"]]},{"type":"checklist","items":[{"text":"t","status":"done"}]}]}',
  "a4 page": '{"v":1,"page":"a4","blocks":[{"type":"callout","tone":"warn","body":"b"}]}',
  // strict=FAIL but renders=PASS — lenient repairs (documented divergence, must be the ONLY such class)
  "type-keyed root (RG-148)": '{"title":"t","badges":{"items":[{"label":"a","tone":"info"}]},"kpi":[{"label":"x","value":1}]}',
  "callout detail variant (RG-147)": '{"v":1,"blocks":[{"type":"callout","tone":"info","detail":"d"}]}',
  "android envelope alias (RG-152)": '{"markdown":"m","artifacts":{"blocks":[{"type":"kpi","label":"x","value":1}]},"spec":{"page":"a4"}}',
  // strict=FAIL + renders=FAIL — true garbage
  "no blocks": '{"v":1,"title":"t"}',
  "bad type": '{"v":1,"blocks":[{"type":"nonsense"}]}',
  "not json": 'garbage {{{',
};

import { writeFileSync } from "node:fs";
writeFileSync("/home/notjitin/.hermes/cache/scratch/copy-debug/golden-cards.json", JSON.stringify(GOLDEN, null, 1));
writeFileSync(TSCACHE, probe);

const out = execSync(`node --experimental-strip-types ${TSCACHE}`, { encoding: "utf8" });
let fail = 0;
for (const line of out.trim().split("\n")) {
  const r = JSON.parse(line);
  const strictAllows = r.strict, rendererRenders = r.renders;
  // invariants:
  //  1. renderer renders  => strict MUST allow OR the name is in the documented-lenient set
  const lenient = /RG-147|RG-148|RG-152/.test(r.name);
  if (rendererRenders && !strictAllows && !lenient) { console.log(`FAIL ${r.name}: renderer accepts but strict rejects (undocumented divergence)`); fail++; continue; }
  if (!rendererRenders && strictAllows) { console.log(`FAIL ${r.name}: strict accepts but renderer rejects — strict must be a SUBSET`); fail++; continue; }
  console.log(`ok   ${r.name} (strict=${strictAllows ? "pass" : "reject"}, renderer=${rendererRenders ? "render" : "reject"})`);
}
console.log(fail ? `${fail} agreement failure(s)` : "strict validator agrees with the renderer on all golden shapes");
process.exit(fail ? 1 : 0);
