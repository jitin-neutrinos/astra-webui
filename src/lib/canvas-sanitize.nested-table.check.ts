// canvas-sanitize.nested-table.check.ts — the bound-table-rows hole, by hole.
//
// Why this file exists (2026-10-05, the FIFTH incident of the rebuild-a-block
// class): a reactive table — `{bind:{$from:"d"},columns:[…],rows:[]}` — could
// still lose its rows depending on the card shape, and every unit gate stayed
// green because each layer was tested in isolation:
//   1. RENDERER CTX: TabsView/AccordionView/LayoutView re-entered `Blocks`
//      WITHOUT ctx, and `isReactiveBlock` did not look inside containers — so a
//      bound table inside a tab resolved no rows and degraded to a bare header.
//      Even at TOP level a `data` carrier is invisible to a container-local
//      collectData, so inheriting the ROOT datasets is required, not optional.
//   2. COLUMNS OPTIONAL ON A BOUND TABLE: a model that omits columns (reasonable
//      — the data block defines them) lost the WHOLE table at parse.
//   3. The `from` shorthand: models reach for `{from:"d"}` — normalised to
//      `bind` at the parser.
// Run: npx tsx src/lib/canvas-sanitize.nested-table.check.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCanvasSpec, splitCanvasBlocks, parseStreamingCanvas } from "./canvas-schema.ts";
import { sanitizeCanvasSpec } from "./canvas-sanitize.ts";
import { collectData } from "./canvas-bind.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** The reported card: data carrier first, bound table nested in a tab. */
const NESTED_SPEC = {
  v: 1,
  title: "What-if: seats → price",
  state: { seats: 10 },
  blocks: [
    { type: "data", name: "lat", columns: ["svc", "ms"], rows: [["edge", 41], ["core", 9]] },
    {
      type: "tabs",
      items: [{
        label: "Latency",
        blocks: [{ type: "table", bind: { $from: "lat" }, columns: ["svc", "ms"], rows: [] }],
      }],
    },
  ],
};

type B = Record<string, unknown>;
function asRec(b: unknown): B { return b as B; }
function parse(s: unknown) { return parseCanvasSpec(JSON.stringify(s))!; }

test("parse+sanitize keep the bound table (top level and nested)", () => {
  const spec = parse(NESTED_SPEC);
  const safe = sanitizeCanvasSpec(spec)!;
  const types = safe.blocks.map((b) => b.type);
  assert.ok(types.includes("data"), "data carrier survives");
  assert.ok(types.includes("tabs"), "tabs card survives");
  const item = (asRec(safe.blocks[1]).items as { blocks: unknown[] }[])[0];
  const tbl = asRec(item.blocks[0]);
  assert.equal(tbl.type, "table");
  assert.deepEqual(asRec(tbl.bind).$from, "lat", "bind carried through nested sanitize");
});

test("the rendered datasets are the ROOT card's, collected over sanitized blocks", () => {
  // mirrors canvas-blocks Blocks(): root datasets from the FULL children list
  const safe = sanitizeCanvasSpec(parse(NESTED_SPEC))!;
  const ds = collectData(safe.blocks);
  assert.ok(ds.get("lat"), "dataset resolvable by name from the root block list");
  // and the nested entry gets it through props.ctx, not a local collectData
  const tabBlocks = (asRec(asRec(safe.blocks[1]).items as B).blocks as unknown[]) as unknown[][];
  void tabBlocks;
  const localOnly = collectData(((asRec(safe.blocks[1]).items as { blocks: unknown[] }[])[0].blocks) as never[]);
  assert.ok(!localOnly.get("lat"), "tab-local collection must NOT be the source (props.ctx contract)");
});

test("isReactiveBlock covers containers — a nested bound table still arms ctx", () => {
  // Structural pin over the shipped source: the recursion into blocks/items.
  const tsx = readFileSync(join(here, "../components/canvas/canvas-blocks.tsx"), "utf8");
  assert.ok(/it\?\.blocks/.test(tsx) && /kids\.some\(isReactiveBlock\)/.test(tsx),
    "isReactiveBlock must recurse into container items");
  // and the three container views must accept + forward a ctx prop
  for (const view of ["TabsView", "AccordionView", "LayoutView"]) {
    const sig = new RegExp(`function ${view}\\(\\{ block, ctx`);
    assert.ok(sig.test(tsx), `${view} takes ctx`);
  }
  assert.ok((tsx.match(/<Blocks[^>]*ctx=\{ctx\}/g) || []).length >= 3,
    "tabs + accordion + layout all forward ctx into their nested Blocks");
});

test("columns-optional bound table parses + survives when a sibling data block exists", () => {
  const spec = parse({
    v: 1,
    blocks: [
      { type: "data", name: "lat", columns: ["svc", "ms"], rows: [["edge", 41]] },
      { type: "table", bind: { $from: "lat" }, rows: [] }, // NO columns
    ],
  });
  assert.ok(spec, "bound table without columns parses (fields come from the dataset)");
  const safe = sanitizeCanvasSpec(spec)!;
  const tbl = asRec(safe.blocks[1]);
  assert.equal(tbl.type, "table", "not dropped by the sanitizer");
  assert.deepEqual(tbl.columns, ["svc", "ms"], "columns synthesised from the dataset");
});

test("from shorthand normalises to bind $from", () => {
  const spec = parse({
    v: 1,
    blocks: [
      { type: "data", name: "lat", columns: ["svc", "ms"], rows: [["edge", 41]] },
      { type: "table", from: "lat", columns: ["svc"], rows: [] },
    ],
  });
  assert.ok(spec, "from shorthand parses");
  const tbl = asRec(safeBlocks(spec)[1]);
  assert.deepEqual(asRec(tbl.bind)?.$from, "lat", "normalised to bind.$from");
});

function safeBlocks(spec: NonNullable<ReturnType<typeof parseCanvasSpec>>) {
  return sanitizeCanvasSpec(spec)!.blocks;
}

test("an UNRESOLVABLE $from (no data block, no columns) still degrades fail-soft", () => {
  const spec = parseCanvasSpec(JSON.stringify({
    v: 1,
    blocks: [{ type: "table", bind: { $from: "ghost" }, rows: [] }],
  }));
  assert.equal(spec, null, "no dataset to name columns from, no columns authored — unrenderable");
});

test("a STATIC empty table still degrades (the original mangled-header rule holds)", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "table", columns: ["a"], rows: [] }] }));
  assert.equal(spec, null, "empty non-bound table is not a table");
});

test("end-to-end: the exact reported fence round-trips through split + parse + sanitize", () => {
  const fence = "```astra-canvas\n" + JSON.stringify(NESTED_SPEC, null, 1) + "\n```";
  const parts = splitCanvasBlocks(`intro\n${fence}\ntrailing`, false);
  const cards = parts.filter((p) => p.kind === "canvas");
  assert.equal(cards.length, 1, "one card split out");
  const safe = sanitizeCanvasSpec(cards[0].spec!)!;
  const types = safe.blocks.map((b) => b.type);
  assert.deepEqual(types, ["data", "tabs"], "exact block order preserved through all three layers");
});

test("streaming reveal keeps the bound table paintable before the fence closes", () => {
  const body = `{"v":1,"title":"T","blocks":[\n${JSON.stringify({ type: "data", name: "lat", columns: ["svc", "ms"], rows: [["edge", 41]] })},\n${JSON.stringify({ type: "table", bind: { $from: "lat" }, columns: ["svc", "ms"], rows: [] })}\n]}`;
  const live = parseStreamingCanvas("```astra-canvas\n" + body);
  assert.ok(live, "partial card paints while streaming");
  assert.deepEqual(live.blocks.map((b) => b.type), ["data", "table"]);
});
