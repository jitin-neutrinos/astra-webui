// Reactive bindings must SURVIVE the sanitizer.
//
// Why this file exists (2026-10-05): sanitizeCanvasSpec rebuilt every block
// from a literal per-type field list, so the reactive layer was deleted before
// anything rendered — the only call site is chat-timeline.tsx:70. Measured then:
//   kpi value {$expr:"seats*price"}  -> {"type":"kpi","label":"MRR"}  (no value)
//   progress value {$expr:"pct"}     -> value: 0   (binding -> literal 0)
//   table bind {$from:"latency"}     -> WHOLE BLOCK DROPPED
//   data name "latency"              -> gone, so $from can never resolve
// Every unit gate stayed green because they all test the PARSER and the BIND
// layer, never the sanitizer. This gate closes that hole.
//
// Run: npx tsx src/lib/canvas-sanitize.reactive.check.ts
import assert from "node:assert";
import { test } from "node:test";
import { sanitizeCanvasSpec } from "./canvas-sanitize";

const spec = {
  v: 1,
  title: "T",
  state: { seats: 10, price: 5, pct: 0.5 },
  blocks: [
    { type: "kpi", label: "MRR", value: { $expr: "seats*price" }, delta: { $expr: "seats" } },
    { type: "kpi", label: "Plain", value: 42, delta: "-3", trend: "up" },
    { type: "progress", label: "P", value: { $expr: "pct" }, max: 100 },
    {
      type: "table",
      bind: { $from: "latency", filter: [{ col: "ms", op: ">", value: 1 }], sort: { col: "ms", dir: "desc" }, top: 5 },
      columns: ["svc", "ms"],
      rows: [["a", 1]],
    },
    { type: "data", name: "latency", columns: ["svc", "ms"], rows: [["a", 1]] },
    { type: "kpi", label: "Hidden", value: 5, visible: { $expr: "seats>1" } },
    { type: "slider", label: "Seats", bind: "seats", min: 0, max: 100, format: "pct" },
    { type: "toggle", label: "On", bind: "on", value: true },
  ],
} as never;

const out = sanitizeCanvasSpec(spec) as never as Record<string, never>;
type B = Record<string, unknown>;
const blocks = (out as unknown as { blocks: B[] }).blocks;
const find = (t: string) => blocks.find((b) => b.type === t)!;

test("a $expr on kpi.value survives", () => {
  assert.deepEqual(blocks[0].value, { $expr: "seats*price" });
});
test("a $expr on kpi.delta survives", () => {
  assert.deepEqual(blocks[0].delta, { $expr: "seats" });
});
test("a $expr on progress.value stays a binding, never a literal 0", () => {
  assert.deepEqual(find("progress").value, { $expr: "pct" });
});
test("a bound table is NOT dropped", () => {
  const t = find("table");
  assert.ok(t, "bound table was dropped entirely");
  assert.equal((t.bind as { $from: string }).$from, "latency");
  assert.equal((t.bind as { top: number }).top, 5);
});
test("data.name survives so $from can resolve", () => {
  assert.equal(find("data").name, "latency");
});
test("slider bind + format survive", () => {
  const s = find("slider");
  assert.equal(s.bind, "seats");
  assert.equal(s.format, "pct");
});
test("toggle default value survives", () => {
  assert.equal(find("toggle").value, true);
});
test("visible binding survives", () => {
  // the conditional kpi is the one carrying `visible` (label "Hidden")
  const cond = blocks.find((b) => b.label === "Hidden")!;
  assert.deepEqual(cond.visible, { $expr: "seats>1" });
});
test("authored state survives", () => {
  assert.equal((out as unknown as { state: { seats: number } }).state.seats, 10);
});

test("PLAIN values are untouched by the reactive path", () => {
  const p = blocks[1];
  assert.equal(p.value, 42);
  assert.equal(p.delta, "-3");
  assert.equal(p.trend, "up");
});

test("caps still apply INSIDE a binding", () => {
  const huge = sanitizeCanvasSpec({
    v: 1,
    blocks: [{ type: "kpi", label: "L", value: { $expr: "x".repeat(99_999) } }],
  } as never) as never as { blocks: { value: { $expr: string } }[] };
  const expr = huge.blocks[0].value.$expr;
  assert.ok(expr.length <= 10_000, `expr not capped: ${expr.length}`);
});

test("an object that is NOT a binding is still not smuggled through", () => {
  const r = sanitizeCanvasSpec({
    v: 1,
    blocks: [{ type: "kpi", label: "L", value: { evil: "payload" } }],
  } as never) as never as { blocks: Record<string, unknown>[] };
  // `value` is not a binding shape: either absent or a scalar — never the object
  const v = r.blocks[0].value;
  assert.ok(v === undefined || typeof v !== "object", `object leaked: ${JSON.stringify(v)}`);
});