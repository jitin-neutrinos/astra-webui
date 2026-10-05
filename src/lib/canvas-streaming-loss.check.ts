// Two CRITICAL streaming/parser defects, pinned (2026-10-05).
//
// 1. A CLOSED canvas fence plus ALL prose after it were deleted during
//    streaming. planTurnCanvases used OPEN_FENCE_RE (which captures to end of
//    string regardless of a closer) and cut unconditionally, so the card AND
//    every following word vanished for the whole duration of the reply.
//    Measured before the fix: "intro\n```astra-canvas\n{...}\n```\nAFTER" ->
//    mdPerSeg ["intro\n"], canvases [].
//
// 2. quoteBareKeys was O(n^2): it re-scanned the whole accumulator for the
//    previous non-whitespace character once per input character. Measured 82 KB
//    = 1.1 s, 334 KB = 17.3 s, a realistic 342 KB bare-key payload = 21 s —
//    on the SYNCHRONOUS path, i.e. once per streaming delta.
//
// The shipped suite passed 111/111 with both live, because it had no case for
// "closed fence followed by prose", and no case big enough to show the curve.
//
// Run: npx tsx src/lib/canvas-streaming-loss.check.ts
import assert from "node:assert";
import { test } from "node:test";
import { planTurnCanvases, parseCanvasSpec } from "./canvas-schema";

const CARD = JSON.stringify({ v: 1, blocks: [{ type: "kpi", label: "A", value: 1 }] });
const md = (segs: string[], streaming: boolean) =>
  (planTurnCanvases(segs, streaming).mdPerSeg ?? []).join("\n");

test("CRITICAL 1: prose after a CLOSED canvas fence survives streaming", () => {
  const out = md(["intro prose\n```astra-canvas\n" + CARD + "\n```\nAFTER THE CARD"], true);
  assert.ok(out.includes("AFTER THE CARD"), `prose lost: ${JSON.stringify(out)}`);
});

test("CRITICAL 1: with TWO closed fences, the tail survives", () => {
  const out = md(
    ["s\n```astra-canvas\n" + CARD + "\n```\nMID\n```astra-canvas\n" + CARD + "\n```\nEND"],
    true,
  );
  assert.ok(out.includes("END"), `tail lost: ${JSON.stringify(out)}`);
});

test("CRITICAL 1: an INVALID fence keeps its fail-soft prose", () => {
  const out = md(["A\n```astra-canvas\n{bad json\n```\nB\nmore prose"], true);
  assert.ok(out.includes("more prose"), `fallback prose lost: ${JSON.stringify(out)}`);
});

test("REGRESSION GUARD: a genuinely OPEN fence is still withheld", () => {
  const out = md(["intro\n```astra-canvas\n" + CARD + "\nSTILL ARRIVING"], true);
  assert.ok(!out.includes("STILL ARRIVING"), "an unterminated fence must not flash raw JSON");
  assert.ok(out.includes("intro"), "prior prose must survive");
});

test("finalized results are byte-identical to the streaming ones", () => {
  const t = ["intro prose\n```astra-canvas\n" + CARD + "\n```\nAFTER"];
  assert.equal(md(t, false), md(t, true));
});

test("HIGH 2: a large bare-key payload parses and is linear", () => {
  const parts: string[] = [];
  for (let k = 0; k < 4000; k++) parts.push(`{type:"kpi",label:"L${k}",value:${k}}`);
  const payload = `{v:1,blocks:[${parts.join(",")}]}`;
  assert.ok(payload.length > 100_000, `probe too small to show the curve: ${payload.length}`);
  const t0 = performance.now();
  const out = parseCanvasSpec(payload);
  const ms = performance.now() - t0;
  assert.equal((out as { blocks?: unknown[] } | null)?.blocks?.length, 4000, "bare keys not parsed");
  // Was 21 s for a 342 KB payload; 4 000 blocks is ~146 KB here.
  assert.ok(ms < 2_000, `still quadratic-ish: ${ms.toFixed(0)}ms`);
});

test("HIGH 2: bare keys at EVERY nesting depth still parse", () => {
  for (const p of [
    '{v:1,blocks:[{type:"kpi",label:"A",value:1}]}',
    '{"v":1,"blocks":[{"type":"kpi","label":"A","value":1}]}',
    // spaces around every structural char — the tier must be whitespace-agnostic
    '{ v : 1 , blocks : [ { type : "kpi" , label : "A" , value : 1 } ] }',
  ]) {
    assert.ok(parseCanvasSpec(p), `bare-key form stopped parsing: ${p}`);
  }
});