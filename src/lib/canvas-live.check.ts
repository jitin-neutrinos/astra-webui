// The LIVE incremental canvas path (2026-10-05) — must actually fire.
//
// It was dead: chat-timeline.tsx read `mdFor.get(tailIdx)`, the planner's OUTPUT,
// and planTurnCanvases already cuts an open tail fence away — so the search found
// nothing and the whole feature (the "card builds as it streams" mode you asked
// for) was unreachable. Measured before the fix: parse(mdFor) -> null while
// parse(raw segment) -> 3 blocks.
//
// The contract this pins:
//   1. a half-streamed fence yields a provisional card from the RAW text
//   2. the fence is then stripped from the markdown, so the payload is never
//      painted while the provisional card shows it
//   3. a CLOSED fence is NOT treated as live (the planner owns it) — otherwise
//      the card would render twice
//
// Run: npx tsx src/lib/canvas-live.check.ts
import assert from "node:assert";
import { test } from "node:test";
import { planTurnCanvases, parseStreamingCanvas } from "./canvas-schema";
import { openCanvasFence } from "./canvas-reveal.ts";

const CARD = JSON.stringify({
  v: 1,
  blocks: [
    { type: "kpi", label: "Requests", value: 1200 },
    { type: "kpi", label: "Errors", value: 3 },
    { type: "table", columns: ["svc", "ms"], rows: [["auth", 96], ["search", 184]] },
  ],
});
const open = "Here is the answer.\n\n```astra-canvas\n" + CARD + "\n"; // no closer
const closed = open + "```\n\nThat is the card.";

type Live = { title?: string; blocks: unknown[] } | null;

/** The fixed algorithm, transcribed from chat-timeline.tsx. */
function liveFor(segText: string, streaming: boolean) {
  const plan = planTurnCanvases([segText], streaming);
  const mdPerSeg = new Map<number, string>([[0, plan.mdPerSeg[0] ?? ""]]);
  const bySeg = new Set(plan.canvases.map((c) => c.afterSeg));
  let liveCanvas: Live = null;
  if (streaming && !bySeg.has(0)) {
    const rawTail = segText;
        const live = openCanvasFence(rawTail);
        if (live.open && !live.closed) {
      liveCanvas = parseStreamingCanvas(rawTail);
      if (liveCanvas) {
        const mdTail = mdPerSeg.get(0) ?? rawTail;
        const at = mdTail.lastIndexOf("```astra-canvas");
        if (at !== -1) mdPerSeg.set(0, mdTail.slice(0, at));
      }
    }
  }
  return { liveCanvas, md: mdPerSeg.get(0) ?? "", planCanvases: plan.canvases.length };
}

test("1. an OPEN fence yields a provisional card from the raw text", () => {
  const { liveCanvas } = liveFor(open, true);
  assert.ok(liveCanvas, "live card is null — the feature is still dead");
  assert.equal(liveCanvas.blocks.length, 3, "expected all 3 completed blocks");
});

test("2. the payload is stripped from the markdown it was extracted from", () => {
  const { md } = liveFor(open, true);
  assert.ok(!md.includes("```astra-canvas"), `raw fence left in markdown: ${JSON.stringify(md)}`);
  assert.ok(!md.includes('"kpi"'), "raw JSON left in markdown");
  // the prose BEFORE the fence must survive — this is the regression this
  // replaced: the old unconditional cut could take prose with it.
  assert.ok(md.includes("Here is the answer."), `prose lost: ${JSON.stringify(md)}`);
});

test("3. a CLOSED fence is NOT also treated as live", () => {
  const r = liveFor(closed, true);
  // The planner leaves a CONTAINED fence inline on purpose (canvas-schema.ts:2141,
  // so prose after the card stays below it) and RichText is what splits it — so
  // planner canvases === 0 is the CORRECT state here, and the only thing that
  // matters is that the live path does not ALSO claim it.
  assert.equal(r.planCanvases, 0, "contained fence should stay inline for RichText");
  assert.equal(r.liveCanvas, null, "a closed fence must not paint a provisional card");
  // and the markdown must still carry it, or the card would vanish entirely
  assert.ok(r.md.includes("```astra-canvas"), "the closed fence must stay in the markdown");
});

test("3b. openCanvasFence tells open from closed (4-tick aware)", () => {
  assert.equal(openCanvasFence(open).closed, false, "an open fence must read as open");
  assert.equal(openCanvasFence(closed).closed, true, "a closed fence must read as closed");
  const c4 = "p\n\n````astra-canvas\n" + CARD + "\n````\n\nafter";
  assert.equal(openCanvasFence(c4).closed, true, "4-tick closed fence");
  const o4 = "p\n\n````astra-canvas\n" + CARD + "\n";
  assert.equal(openCanvasFence(o4).closed, false, "4-tick open fence");
  // a ``` INSIDE the json body must not be read as the closer
  const inner = 'p\n\n```astra-canvas\n' + JSON.stringify({ v: 1, blocks: [{ type: "code", code: "x\n```\ny", language: "sh" }] });
  assert.equal(openCanvasFence(inner).closed, false, "inner ``` must not close the fence");
  assert.equal(openCanvasFence("no fence here").open, false);
});

test("4. the provisional card grows as blocks arrive", () => {
  const prefix = (n: number) => {
    const parts = JSON.stringify({ v: 1, blocks: [
      { type: "kpi", label: "A", value: 1 },
      { type: "kpi", label: "B", value: 2 },
      { type: "table", columns: ["a"], rows: [["x"]] },
    ].slice(0, n) });
    return "Prose.\n\n```astra-canvas\n" + parts + "\n";
  };
  const counts = [1, 2, 3].map((n) => liveFor(prefix(n), true).liveCanvas?.blocks.length ?? 0);
  assert.deepEqual(counts, [1, 2, 3], `card did not build incrementally: ${counts.join(",")}`);
});

test("5. nothing is live once the turn is not streaming", () => {
  assert.equal(liveFor(open, false).liveCanvas, null);
});

test("6. a segment with no fence produces no provisional card", () => {
  assert.equal(liveFor("Just prose, no card here.", true).liveCanvas, null);
});