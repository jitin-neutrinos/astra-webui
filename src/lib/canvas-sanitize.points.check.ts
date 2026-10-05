import { sanitizeCanvasSpec } from "./canvas-sanitize";
import { parseCanvasSpec } from "./canvas-schema";
import assert from "node:assert";

// RG-08x: canvas chart series must survive sanitization with values intact.
// Regression: sanitizer read `so.data` only; the canonical parser emits `so.points`.
// Series arrived as {name, points:[…]} → sanitized to {name, data:[]} → recharts
// rendered zero-height bars and every chart card read "no data".

const spec = parseCanvasSpec(
  JSON.stringify({
    v: 1,
    blocks: [
      { type: "chart", chart: "bar", title: "Speed", labels: ["a", "b", "c"], series: [{ name: "tok/s", points: [167, 50, 55] }] },
    ],
  }),
);
assert.ok(spec, "chart spec must parse");
const safe = sanitizeCanvasSpec(spec as never) as never as { blocks: { type: string; series: { name: string; data: number[] }[] }[] };
const chart = safe.blocks.find((b) => b.type === "chart");
assert.ok(chart, "chart block must survive sanitization");
assert.deepStrictEqual(chart.series[0].data, [167, 50, 55], "points values must pass through the sanitizer");
assert.deepStrictEqual(
  (chart.series[0] as unknown as Record<string, unknown>).points,
  [167, 50, 55],
  "renderer contract: sanitized series must keep points (canvas-chart reads series[i].points)",
);

// float points (the real-world bench numbers that triggered the report)
const spec2 = parseCanvasSpec(
  JSON.stringify({
    v: 1,
    blocks: [{ type: "chart", chart: "line", labels: ["r1", "r2", "r3"], series: [{ name: "tok/s", points: [146.7, 138, 169.9] }] }],
  }),
);
const safe2 = sanitizeCanvasSpec(spec2 as never) as never as { blocks: { type: string; series: { name: string; data: number[] }[] }[] };
assert.deepStrictEqual(safe2.blocks[0].series[0].data, [146.7, 138, 169.9], "float points must pass through");

// legacy `data` authoring still works (no regression the other direction)
const legacy = sanitizeCanvasSpec({
  v: 1 as const,
  blocks: [{ type: "chart", chart: "bar", labels: ["x", "y"], series: [{ name: "s", data: [1, 2] }] } as never],
} as never) as never as { blocks: { type: string; series: { name: string; data: number[] }[] }[] };
assert.deepStrictEqual(legacy.blocks[0].series[0].data, [1, 2], "legacy data shape must still work");

// non-numeric junk is filtered, array length preserved by position NOT required (filter drops nulls)
const junk = sanitizeCanvasSpec({
  v: 1 as const,
  blocks: [{ type: "chart", chart: "bar", labels: ["x", "y", "z"], series: [{ name: "s", points: ["NaN" as never, 2, 3] as never }] }],
} as never) as never as { blocks: { type: string; series: { name: string; data: number[] }[] }[] };
assert.deepStrictEqual(junk.blocks[0].series[0].data, [2, 3], "non-numeric entries are dropped");

console.log("canvas-sanitize.points.check: ALL PASS");
