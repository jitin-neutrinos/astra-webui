// canvas-alias.check.ts — RG (2026-10-08): the canvas report that rendered as
// raw code/text. Two live defects:
//   1. PRODUCER: the Android-app envelope {markdown, artifacts:{blocks}, spec}
//      was never aliased into the canonical {blocks} envelope by coerceToBlocks.
//   2. CONSUMER: the card sat UNFENCED in plain message text, so no fence scan
//      could ever claim it — it painted as raw JSON between prose.
// Guardrails: coerceToBlocks case F (envelope aliasing) + aliasSpecFromText
// (last-resort rescue, finalized-only). Every positive below is a byte-shape
// of a REAL failure; every negative is a shape that MUST still degrade.
import assert from "node:assert/strict";
import {
  parseCanvasSpec,
  splitCanvasBlocks,
  hasCanvas,
  aliasSpecFromText,
} from "./canvas-schema.ts";

// ── 1. Producer guardrail: envelope F (Android app shape) parses INSIDE a fence
const androidEnvelope = `{
  "markdown": "**Sidebar reverted** — accent styling removed.",
  "artifacts": {
    "blocks": [
      { "type": "terminal", "title": "revert(sidebar) 12bd08d", "command": "git commit",
        "lines": [
          { "text": "2 files changed, 14 insertions(+), 118 deletions(-)" },
          { "text": "npm run build — green", "tone": "success" }
        ], "exitCode": 0 },
      { "type": "checklist", "items": [
        { "text": "served CSS verified", "status": "done" },
        { "text": "CF purge ok", "status": "done" }
      ]}
    ]
  },
  "spec": { "page": "a4" }
}`;
const specF = parseCanvasSpec(androidEnvelope);
assert.ok(specF, "F1: Android envelope aliases into a canvas spec");
assert.equal(specF!.blocks.length, 3, "F1b: terminal + checklist + summary text");
assert.equal(specF!.blocks[0].type, "terminal");
assert.equal(specF!.blocks[1].type, "checklist");
assert.equal(specF!.blocks[2].type, "text", "F1c: markdown prose ships as summary");
assert.equal(specF!.page, "a4", "F1d: nested spec.page survives aliasing");

// markdown prose rides along as a text block (nothing silently dropped)
const specF2 = parseCanvasSpec(`{"markdown":"net -104 lines","artifacts":{"blocks":[{"type":"kpi","label":"done","value":1}]}}`);
assert.ok(specF2, "F2: alias with markdown prose");
assert.equal(specF2!.blocks.length, 2, "F2b: kpi + summary text block");
assert.equal(specF2!.blocks[1].type, "text");

// blocks carry their own type → inner type wins over the wrapper key
const specF3 = parseCanvasSpec(`{"artifacts":{"blocks":[{"type":"callout","tone":"info","body":"hi"}]}}`);
assert.ok(specF3, "F3: typed inner blocks pass through");
assert.equal(specF3!.blocks[0].type, "callout");

// ── 2. Consumer guardrail: the UNFENCED card is rescued from plain text
const unfenced =
  "Done and verified. Report:\n\n" + androidEnvelope + "\n\nPhone note: force-stop once.";
const parts = splitCanvasBlocks(unfenced);
assert.equal(parts.length, 2, "G1: prose + canvas parts");
assert.equal(parts[0].kind, "md");
assert.match((parts[0] as any).text, /Done and verified/);
assert.equal(parts[1].kind, "canvas");
const spec = (parts[1] as any).spec;
assert.equal(spec.blocks.length, 3, "G1b: blocks + summary render");
assert.equal(spec.page, "a4");
assert.ok(hasCanvas(unfenced), "G1c: mount gate fires for the unfenced card");

// ── 3. Negative controls — shapes that must STILL degrade to markdown
// a. a bare JSON code sample (no canvas meaning)
const codeSample = 'Use this config:\n\n```json\n{"server":{"port":3011}}\n```\n\ndone.';
assert.equal(aliasSpecFromText(codeSample), null, "N1: code sample not rescued");
assert.equal(splitCanvasBlocks(codeSample).filter((p) => p.kind === "canvas").length, 0, "N1b");

// b. a model's literal JSON example of a DIFFERENT wire format
const apiExample = 'Here is the payload shape:\n\n{"session_id":"abc","messages":[{"role":"user","content":"hi"}]}\n\nHope that helps.';
assert.equal(aliasSpecFromText(apiExample), null, "N2: non-canvas JSON not rescued");

// c. a mid-fence malformed canvas still degrades (tier 3 territory, not aliasing)
const brokenFence = "```astra-canvas\n{blocks: [}";
assert.equal(splitCanvasBlocks(brokenFence).filter((p) => p.kind === "canvas").length, 0, "N3: broken fence not aliased");

// d. prose-only text untouched
const prose = "Just a normal reply with no JSON at all.";
assert.equal(aliasSpecFromText(prose), null, "N4: prose untouched");
assert.equal(splitCanvasBlocks(prose).length, 1, "N4b: single md part");

// e. streaming never rescues (mid-stream `{` is a half-written fence)
assert.equal(splitCanvasBlocks(unfenced, true).filter((p) => p.kind === "canvas").length, 0, "N5: streaming=false rescue only");

// f. tiny JSON below the size gate
assert.equal(aliasSpecFromText('see {"a":1} here'), null, "N6: sub-24-char JSON ignored");

// ── 4. The REAL stored message from session 20261008_005547 (bytes, not a
// hand-built lookalike — the exact shape that failed in production)
const realTurn = `Router report follows:\n\n{"markdown":"**Sidebar reverted to the all-grey implementation**","artifacts":{"blocks":[{"type":"kpi","label":"files changed","value":2},{"type":"checklist","items":[{"text":"served CSS verified","status":"done"}]}]},"spec":{"page":"a4"}}\n\nPhone note: the Android app self-heals via the build-id check.`;
const realParts = splitCanvasBlocks(realTurn);
assert.equal(realParts.filter((p) => p.kind === "canvas").length, 1, "R1: real production shape rescues");
assert.ok(hasCanvas(realTurn), "R1b");

// ── 5. Existing good paths unchanged (regression sweep)
const fenced = "```astra-canvas\n{\"blocks\":[{\"type\":\"kpi\",\"label\":\"x\",\"value\":1}]}\n```";
const fenceParts = splitCanvasBlocks(fenced);
assert.equal(fenceParts.filter((p) => p.kind === "canvas").length, 1, "E1: canonical fence still parses");
assert.equal(fenceParts.length, 1, "E1b: no duplicate canvas");
// NDJSON body
const ndjsonSpec = parseCanvasSpec('{"type":"kpi","label":"a","value":1}\n{"type":"kpi","label":"b","value":2}');
assert.ok(ndjsonSpec && ndjsonSpec.blocks.length === 2, "E2: NDJSON body unchanged");
// block-type-keyed root (E shorthand) still wins
const keyed = parseCanvasSpec(`{"kpi":[{"label":"a","value":1}],"title":"t"}`);
assert.ok(keyed && keyed.blocks.length === 1, "E3: type-keyed root unchanged");

console.log("ok canvas-alias.check.ts — envelope aliasing + unfenced-card rescue, 6 negative controls");
