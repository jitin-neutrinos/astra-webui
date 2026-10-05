import { parseCanvasSpec } from "./canvas-schema";
import assert from "node:assert";

// RG-08x: kpi composite blocks (one kpi carrying items/kpis tile arrays) must
// fan out into per-tile kpi blocks instead of failing validation and dropping
// silently (symptom: KPI cards displayed as raw JSON).

const fanout = parseCanvasSpec(
  JSON.stringify({ v: 1, blocks: [{ type: "kpi", items: [{ label: "speed", value: "147.5" }, { label: "ctx", value: "96K" }] }] }),
) as never as { blocks: { type: string; value: unknown }[] };
assert.ok(fanout, "kpi+items must parse");
assert.strictEqual(fanout.blocks.length, 2, "items fan out one tile → one kpi block");
assert.deepStrictEqual(fanout.blocks.map((b) => b.value), ["147.5", "96K"]);

// canonical single-tile still passes
const single = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "kpi", label: "a", value: 1 }] }));
assert.ok(single, "single kpi unchanged");

// m nondescript-tile junk skipped, good tiles kept
const mixed = parseCanvasSpec(
  JSON.stringify({ v: 1, blocks: [{ type: "kpi", items: [{ label: "a", value: 1 }, { value: "no-label" }, { foo: 3 }] }] }),
) as never as { blocks: unknown[] };
assert.strictEqual(mixed.blocks.length, 1, "only tiles with a label survive fan-out");

console.log("canvas-kpi-fanout.check: ALL PASS");
