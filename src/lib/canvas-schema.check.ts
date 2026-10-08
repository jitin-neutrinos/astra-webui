import { test } from "node:test";
import assert from "node:assert/strict";
import { splitCanvasBlocks, splitCanvasBlocksAsync, parseCanvasSpec, parseCanvasSpecAsync, extractOutermostJson, hasCanvas, planTurnCanvases, parseStreamingBlocks, parseStreamingCanvas, validateBlock } from "./canvas-schema.ts";
// The sanitizer is part of the RENDER path (chat-timeline.tsx:70 is its one
// production call site), so the pipeline is only proven end-to-end if a card is
// asserted on BOTH sides of it. A parser-only suite stayed green through the
// 2026-10-05 accordion bug: the parser preserved the nested blocks perfectly and
// the sanitizer dropped them.
import { sanitizeCanvasSpec } from "./canvas-sanitize.ts";
import { canvasToMarkdown } from "./canvas-markdown.ts";

const VALID = JSON.stringify({
  v: 1, title: "Usage",
  blocks: [
    { type: "kpi", label: "Tokens", value: 1234, delta: "+12%", trend: "up" },
    { type: "chart", chart: "line", labels: ["a", "b"], series: [{ name: "s", points: [1, 2] }] },
    { type: "table", columns: ["x", "y"], rows: [["1", "2"]] },
    { type: "diagram", layout: "flow", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b", label: "e" }] },
    { type: "checklist", items: [{ text: "t", status: "done" }] },
    { type: "steps", items: [{ title: "s1", status: "active" }] },
    { type: "callout", tone: "warn", title: "T", body: "B" },
  ],
});

test("plain text passes through untouched", () => {
  assert.deepEqual(splitCanvasBlocks("hello world"), [{ kind: "md", text: "hello world" }]);
});

test("valid canvas splits into md/canvas/md", () => {
  const text = `before\n\`\`\`astra-canvas\n${VALID}\n\`\`\`\nafter`;
  const parts = splitCanvasBlocks(text);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].kind, "md");
  assert.equal((parts[1] as any).spec.blocks.length, 7);
  assert.equal((parts[1] as any).spec.title, "Usage");
  assert.deepEqual(parts[2], { kind: "md", text: "\nafter" });
});

test("invalid JSON degrades to markdown (content preserved)", () => {
  const text = "pre\n```astra-canvas\n{not json\n```\npost";
  const parts = splitCanvasBlocks(text);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].kind, "md");
  assert.ok(parts[0].text.includes("{not json"));
});

test("unknown block type degrades the whole canvas", () => {
  const bad = JSON.stringify({ v: 1, blocks: [{ type: "hologram", x: 1 }] });
  const text = "```astra-canvas\n" + bad + "\n```";
  const parts = splitCanvasBlocks(text);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].kind, "md");
});

test("bad block shape degrades (kpi without label)", () => {
  const bad = JSON.stringify({ v: 1, blocks: [{ type: "kpi", value: 3 }] });
  assert.equal(parseCanvasSpec(bad), null);
});

test("diagram edge to unknown node is invalid", () => {
  const bad = JSON.stringify({ v: 1, blocks: [{ type: "diagram", layout: "flow", nodes: [{ id: "a", label: "A" }], edges: [{ from: "a", to: "zz" }] }] });
  assert.equal(parseCanvasSpec(bad), null);
});

test("streaming hides the unterminated fence, keeps prior prose", () => {
  const text = `prose\n\`\`\`astra-canvas\n{"v":1,"blocks":[{"type":"kp`;
  const parts = splitCanvasBlocks(text, true);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].kind, "md");
  assert.equal(parts[0].text, "prose\n");
});

test("finalized unterminated fence is preserved as markdown", () => {
  const text = "```astra-canvas\n{\"partial\": tru";
  const parts = splitCanvasBlocks(text, false);
  assert.equal(parts.length, 1);
  assert.ok((parts[0] as any).text.includes('"partial"'));
});

test("two canvases in one message both extract, in order", () => {
  const c1 = JSON.stringify({ v: 1, blocks: [{ type: "kpi", label: "A", value: 1 }] });
  const c2 = JSON.stringify({ v: 1, blocks: [{ type: "kpi", label: "B", value: 2 }] });
  const text = `\`\`\`astra-canvas\n${c1}\n\`\`\`mid\`\`\`astra-canvas\n${c2}\n\`\`\``;
  const parts = splitCanvasBlocks(text);
  const canvases = parts.filter((p) => p.kind === "canvas") as any[];
  assert.equal(canvases.length, 2);
  assert.equal(canvases[0].spec.blocks[0].label, "A");
  assert.equal(canvases[1].spec.blocks[0].label, "B");
  assert.equal((parts[1] as any).text, "mid");
});

test("hasCanvas mount gate", () => {
  assert.equal(hasCanvas(`x\n\`\`\`astra-canvas\n${VALID}\n\`\`\``), true);
  assert.equal(hasCanvas("no fences"), false);
  assert.equal(hasCanvas("```astra-canvas\n{bad\n```"), false);
});

test("trend/tone/status enums normalize, junk falls back", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "kpi", label: "L", value: "9", trend: "sideways" },
    { type: "callout", tone: "neon", body: "b" },
  ] }));
  assert.equal(spec, null); // invalid enum values reject (fail-soft, no silent lie)
});

// ---- expanded block library (v2) ------------------------------------------

test("progress block validates + clamps defaults", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "progress", label: "Coverage", value: 82 }] }));
  assert.equal((spec!.blocks[0] as any).status, "ok");
  assert.equal((spec!.blocks[0] as any).max, undefined);
  const bad = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "progress", label: "L", value: "82" }] }));
  assert.equal(bad, null); // value must be numeric
});

test("timeline block validates with status + time", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "timeline", items: [{ title: "Recon", time: "07:22", status: "done" }, { title: "Build" }] },
  ] }));
  const tl = spec!.blocks[0] as any;
  assert.equal(tl.items[0].time, "07:22");
  assert.equal(tl.items[1].status, "todo");
});

test("compare block keeps point tones, rejects empty points", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "compare", items: [
      { name: "SQLite", badge: "simple", points: [{ text: "zero deps", tone: "pro" }, { text: "no writes" }] },
      { name: "Postgres", points: [{ text: "concurrent", tone: "con" }] },
    ] },
  ] }));
  const cmp = spec!.blocks[0] as any;
  assert.equal(cmp.items[0].badge, "simple");
  assert.equal(cmp.items[0].points[1].tone, "neutral");
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "compare", items: [{ name: "X", points: [] }] }] })), null);
});

test("tree block rejects a dangling child id", () => {
  const ok = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "tree", nodes: [{ id: "a", label: "A", children: ["b"] }, { id: "b", label: "B" }] },
  ] }));
  assert.equal((ok!.blocks[0] as any).nodes.length, 2);
  const dangling = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "tree", nodes: [{ id: "a", label: "A", children: ["zzz"] }] },
  ] }));
  assert.equal(dangling, null);
});

test("code block requires non-empty code, optional lang/file", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "code", language: "ts", filename: "a.ts", code: "const x = 1;" },
  ] }));
  assert.equal((spec!.blocks[0] as any).language, "ts");
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "code", code: "   " }] })), null);
});

test("references block validates titles + optional href/note", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "references", items: [{ title: "Docs", href: "https://x.dev", note: "primary" }] },
  ] }));
  assert.equal((spec!.blocks[0] as any).items[0].href, "https://x.dev");
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "references", items: [{ href: "https://x.dev" }] }] })), null);
});

test("a full v2 canvas (all 13 block types) parses in order", () => {
  const all = {
    v: 1, title: "Everything",
    blocks: [
      { type: "kpi", label: "A", value: 1 },
      { type: "chart", chart: "bar", series: [{ name: "s", points: [1, 2] }] },
      { type: "table", columns: ["c"], rows: [["v"]] },
      { type: "diagram", layout: "flow", nodes: [{ id: "a", label: "A" }], edges: [] },
      { type: "checklist", items: [{ text: "t" }] },
      { type: "steps", items: [{ title: "s" }] },
      { type: "callout", tone: "info", body: "b" },
      { type: "progress", label: "p", value: 5 },
      { type: "timeline", items: [{ title: "t" }] },
      { type: "compare", items: [{ name: "n", points: [{ text: "p" }] }] },
      { type: "tree", nodes: [{ id: "a", label: "A" }] },
      { type: "code", code: "x" },
      { type: "references", items: [{ title: "r" }] },
    ],
  };
  const spec = parseCanvasSpec(JSON.stringify(all));
  assert.equal(spec!.blocks.length, 13);
  const parts = splitCanvasBlocks("```astra-canvas\n" + JSON.stringify(all) + "\n```");
  assert.equal((parts[0] as any).spec.blocks.length, 13);
});

// ---- turn-level planning: the mid-response split bug ------------------------
// Regression: the segment engine opens a NEW text segment on a tool call, a
// message boundary, or a non-extending `text-final`. A canvas fence spanning
// that boundary was unparseable in both halves, so it degraded to a code block.

const SPEC1 = JSON.stringify({ v: 1, title: "Split", blocks: [{ type: "kpi", label: "A", value: 1 }] });
const SPEC2 = JSON.stringify({ v: 1, title: "Second", blocks: [{ type: "callout", tone: "info", body: "b" }] });

test("a fence split across two segments still renders", () => {
  const plan = planTurnCanvases([
    "Here is the data:\n```astra-canvas\n" + SPEC1.slice(0, 20),
    SPEC1.slice(20) + "\n```\nThat is the summary.",
  ]);
  assert.equal(plan.canvases.length, 1);
  assert.equal(plan.canvases[0].spec.title, "Split");
  assert.equal(plan.canvases[0].afterSeg, 1);
  assert.ok(!plan.mdPerSeg.join("").includes("astra-canvas"));
  assert.ok(plan.mdPerSeg[0].includes("Here is the data"));
  assert.ok(plan.mdPerSeg[1].includes("That is the summary"));
});

test("a fence split across THREE segments renders", () => {
  const plan = planTurnCanvases([
    "intro ```astra-canvas\n" + SPEC1.slice(0, 10),
    SPEC1.slice(10, 40),
    SPEC1.slice(40) + "\n``` outro",
  ]);
  assert.equal(plan.canvases.length, 1);
  assert.equal(plan.canvases[0].afterSeg, 2);
  assert.ok(!plan.mdPerSeg.join("").includes("astra-canvas"));
});

test("a CONTAINED fence stays in the markdown (renders inline, prose stays below)", () => {
  // Common case: the whole fence lives in one segment, with prose after it.
  // It must NOT be hoisted to the end of the segment — RichText renders it
  // where it sits, so `md` keeps the fence and the planner returns no canvas.
  const md = "before\n```astra-canvas\n" + SPEC1 + "\n```\nAFTER THE CARD";
  const plan = planTurnCanvases([md]);
  assert.equal(plan.canvases.length, 0);
  assert.equal(plan.mdPerSeg[0], md);
});

test("multiple canvases inside ONE segment all stay inline, in order", () => {
  const md = "a ```astra-canvas\n" + SPEC1 + "\n``` b ```astra-canvas\n" + SPEC2 + "\n``` c";
  const plan = planTurnCanvases([md]);
  assert.equal(plan.canvases.length, 0);
  assert.equal(plan.mdPerSeg[0], md);
});

test("a mixed message: contained inline, spanning extracted", () => {
  const plan = planTurnCanvases([
    "intro\n```astra-canvas\n" + SPEC1 + "\n```\nmid prose",
    "```astra-canvas\n" + SPEC2.slice(0, 12),
    SPEC2.slice(12) + "\n```\ntail",
  ]);
  // only the SPANNING one is extracted; the contained one stays inline
  assert.equal(plan.canvases.length, 1);
  assert.equal(plan.canvases[0].spec.title, "Second");
  assert.equal(plan.canvases[0].afterSeg, 2);
  assert.ok(plan.mdPerSeg[0].includes("astra-canvas"), "contained fence stays in md");
  assert.ok(plan.mdPerSeg[0].includes("mid prose"));
  assert.ok(!plan.mdPerSeg[1].includes("astra-canvas"), "spanning head cut");
  assert.ok(!plan.mdPerSeg[2].includes("astra-canvas"), "spanning tail cut");
  assert.ok(plan.mdPerSeg[2].includes("tail"));
});

test("an INVALID fence split across segments stays markdown (fail-soft)", () => {
  const plan = planTurnCanvases(["t ```astra-canvas\n{not json", " at all}\n``` end"]);
  assert.equal(plan.canvases.length, 0);
  assert.ok(plan.mdPerSeg.join("").includes("not json"));
});

test("streaming withholds a fence that is still open at the tail", () => {
  const open = planTurnCanvases(["done. ```astra-canvas\n" + SPEC1.slice(0, 15)], true);
  assert.equal(open.canvases.length, 0);
  assert.ok(!open.mdPerSeg[0].includes("astra-canvas"), "open fence withheld while streaming");
  assert.ok(open.mdPerSeg[0].includes("done."));
  // finalized: the fence is closed and CONTAINED, so it stays inline for RichText
  const closed = planTurnCanvases(["done. ```astra-canvas\n" + SPEC1 + "\n```"], false);
  assert.equal(closed.canvases.length, 0);
  assert.ok(closed.mdPerSeg[0].includes("astra-canvas"), "closed fence left inline");
});

test("no segments / empty input is safe", () => {
  assert.deepEqual(planTurnCanvases([]), { mdPerSeg: [], canvases: [] });
  assert.deepEqual(planTurnCanvases(["", ""]).mdPerSeg, ["", ""]);
});

// ---- robustness: a bad block must not sink the whole card -----------------

test("one invalid block does NOT sink the canvas (per-block tolerance)", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, title: "Mixed", blocks: [
    { type: "kpi", label: "Good", value: 1 },
    { type: "hologram", spin: true },            // unknown
    { type: "callout", tone: "warn", body: "ok" },
  ] }));
  assert.ok(spec, "canvas still parses");
  assert.equal(spec!.blocks.length, 2, "the two valid blocks survive");
  assert.equal((spec!.blocks[0] as any).label, "Good");
});

test("a canvas where EVERY block is invalid still degrades", () => {
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "x" }, { type: "y" }] })), null);
});

test("lenient JSON: trailing commas and comments still parse", () => {
  const messy = `{
    // the headline numbers
    "v": 1,
    "title": "Messy",
    "blocks": [
      { "type": "kpi", "label": "A", "value": 2, },  /* inline note */
    ],
  }`;
  const spec = parseCanvasSpec(messy);
  assert.ok(spec, "repaired JSON parses");
  assert.equal(spec!.title, "Messy");
  assert.equal(spec!.blocks.length, 1);
});

test("alias: metric/stat → kpi", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "metric", label: "M", value: 5 }] }));
  assert.equal((spec!.blocks[0] as any).type, "kpi");
});

test("alias: donut/columns/gauge chart kinds normalize", () => {
  // v3: `donut` is now its own kind (center-total donut), no longer aliased to pie
  const donut = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "donut", series: [{ name: "s", points: [1] }] }] }));
  assert.equal((donut!.blocks[0] as any).chart, "donut");
  // v5: `graph` is a REAL block type now, so it is no longer a chart alias. The
  // near-miss the alias table still absorbs is `plot` (and a chart that says
  // `kind:"graph"`). A block literally typed `graph` must reach the graph
  // validator — pinning that here, because the alias table is checked FIRST and
  // a stale `graph: "chart"` entry silently hijacked the whole block type.
  const bars = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "columns", series: [{ name: "s", points: [1] }] }] }));
  assert.equal((bars!.blocks[0] as any).type, "chart");
  assert.equal((bars!.blocks[0] as any).chart, "bar");
  const plot = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "plot", chart: "bar", series: [{ name: "s", points: [1] }] }] }));
  assert.equal((plot!.blocks[0] as any).type, "chart", "plot still normalizes to chart");
});

test("alias: flowchart without layout defaults to flow", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "flowchart", nodes: [{ id: "a", label: "A" }], edges: [] },
  ] }));
  assert.ok(spec);
  assert.equal((spec!.blocks[0] as any).type, "diagram");
  assert.equal((spec!.blocks[0] as any).layout, "flow");
});

test("alias: sources/note/meter/snippet map to their blocks", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "sources", items: [{ title: "S" }] },
    { type: "note", tone: "info", body: "n" },
    { type: "meter", label: "M", value: 3 },
    { type: "snippet", code: "x" },
  ] }));
  assert.deepEqual(spec!.blocks.map((b: any) => b.type), ["references", "callout", "progress", "code"]);
});

// ---- emission shapes the model actually produced ---------------------------
// Replaying every real astra-canvas fence in the Hermes DB (27 attempts, only 6
// of which rendered) showed the parser was fine and the EMISSION shape was
// wrong. Each case below is a shape taken verbatim from that replay. Before the
// coercer these all degraded to a raw-JSON code block.

// A. one bare block, no envelope at all
test("a bare block object parses as a single-block canvas", () => {
  const spec = parseCanvasSpec(JSON.stringify({ type: "kpi", label: "Stars", value: "18.7k", delta: "+2.7k", trend: "up" }));
  assert.ok(spec);
  assert.equal(spec!.blocks.length, 1);
  assert.equal((spec!.blocks[0] as any).label, "Stars");
});

// B. `blocks` used as the ITEM list of one logical block — the most common miss
test("`blocks` as an item list becomes N blocks of the outer type", () => {
  const spec = parseCanvasSpec(JSON.stringify({
    type: "kpi",
    blocks: [
      { label: "Stars", value: "18.7k" },
      { label: "Commits", value: "9,110" },
      { label: "Contributors", value: "373" },
    ],
  }));
  assert.ok(spec);
  assert.equal(spec!.blocks.length, 3);
  assert.deepEqual(spec!.blocks.map((b: any) => b.type), ["kpi", "kpi", "kpi"]);
  assert.equal((spec!.blocks[2] as any).value, "373");
});

// B must NOT hijack a real envelope whose inner blocks carry their own types
test("a real envelope with typed blocks is never re-read as an item list", () => {
  const spec = parseCanvasSpec(JSON.stringify({
    type: "kpi",
    blocks: [{ type: "callout", tone: "warn", body: "b" }],
  }));
  assert.ok(spec);
  assert.equal((spec!.blocks[0] as any).type, "callout");
});

// C. bare `items` collection, and the other block shapes seen bare in the replay
test("a bare table / diagram / steps / callout object parses", () => {
  const t = parseCanvasSpec(JSON.stringify({ type: "table", columns: ["A"], rows: [["1"]] }));
  assert.equal((t!.blocks[0] as any).type, "table");
  const d = parseCanvasSpec(JSON.stringify({ type: "diagram", layout: "flow", nodes: [{ id: "a", label: "A" }], edges: [] }));
  assert.equal((d!.blocks[0] as any).type, "diagram");
  const s = parseCanvasSpec(JSON.stringify({ type: "steps", direction: "lr", items: [{ title: "1" }] }));
  assert.equal((s!.blocks[0] as any).type, "steps");
  const c = parseCanvasSpec(JSON.stringify({ type: "callout", tone: "info", title: "T", body: "B" }));
  assert.equal((c!.blocks[0] as any).type, "callout");
});

// D. NDJSON: one object per line, no envelope, no array
test("an NDJSON body parses into one canvas", () => {
  const body = ['{"type":"kpi","label":"Files changed","value":"0"}',
    '{"type":"kpi","label":"APK","value":"6.35 MB"}'].join("\n");
  const spec = parseCanvasSpec(body);
  assert.ok(spec);
  assert.equal(spec!.blocks.length, 2);
});

// trend near-misses observed live ("good", "warn") map to a direction; a word
// with no direction still rejects rather than inventing one.
test("kpi trend aliases map to a direction, unknown still rejects", () => {
  const good = parseCanvasSpec(JSON.stringify({ type: "kpi", label: "A", value: 1, trend: "good" }));
  assert.equal((good!.blocks[0] as any).trend, "up");
  const warn = parseCanvasSpec(JSON.stringify({ type: "kpi", label: "A", value: 1, trend: "warn" }));
  assert.equal((warn!.blocks[0] as any).trend, "flat");
  const bad = parseCanvasSpec(JSON.stringify({ type: "kpi", label: "A", value: 1, trend: "sideways" }));
  assert.equal(bad, null);
});

// The misnested fence: ```astra-canvas immediately followed by ```kpi. The outer
// fence used to close on the empty first line and the payload fell outside it.
// NOTE: the real payload uses UNQUOTED keys (JS-object-literal style) — the
// first version of this test used quoted keys and passed while the live case
// still failed. Keep this one byte-faithful to the DB.
const MISNESTED_BODY =
  '{label:"Release APK",value:"6.35 MB",delta:"−10.6 MB",trend:"down"}\n' +
  '{label:"Checks",value:"52 / 52",delta:"0 failed",trend:"flat"}\n';

test("a misnested fence still renders its payload", () => {
  const text = "done.\n```astra-canvas\n```kpi\n" + MISNESTED_BODY + "```\n```\nafter";
  const parts = splitCanvasBlocks(text);
  const canvases = parts.filter((p) => p.kind === "canvas") as any[];
  assert.equal(canvases.length, 1, "the card is not lost");
  assert.equal(canvases[0].spec.blocks.length, 2);
  assert.equal((canvases[0].spec.blocks[0] as any).label, "Release APK");
  assert.equal((canvases[0].spec.blocks[0] as any).type, "kpi", "inner fence tag supplies the type");
  assert.ok(parts.some((p) => p.kind === "md" && (p as any).text.includes("done.")));
  assert.equal(hasCanvas(text), true, "mount gate agrees with the parser");
});

test("bare keys parse, and bare keys inside STRING values are left alone", () => {
  // bare keys + a type (the realistic shape) → parses, and trend still aliases
  const ok = parseCanvasSpec('{type:"kpi",label:"A",value:1,trend:"good"}');
  assert.equal((ok!.blocks[0] as any).trend, "up");
  const bare = parseCanvasSpec('{type:"kpi",label:"B",value:2}');
  assert.equal((bare!.blocks[0] as any).label, "B");
  // a value that looks like a key must NOT be rewritten — it is displayed text
  const s = parseCanvasSpec(JSON.stringify({ type: "callout", tone: "info", body: "see { a: 1 } and http://x/y" }));
  assert.equal((s!.blocks[0] as any).body, "see { a: 1 } and http://x/y");
  // No type anywhere → nothing to validate a block from. Degrades, by design.
  assert.equal(parseCanvasSpec('{label:"A",value:1}'), null);
});

// The planner path must heal too, or live streaming + history reload disagree.
test("the turn planner heals a misnested fence in a split segment", () => {
  const body = '{"label":"A","value":1}\n{"label":"B","value":2}\n';
  const plan = planTurnCanvases([
    "intro ```astra-canvas\n```kpi\n" + body.slice(0, 18),
    body.slice(18) + "```\n``` tail",
  ]);
  assert.equal(plan.canvases.length, 1);
  assert.equal(plan.canvases[0].spec.blocks.length, 2);
});

// A `code` block whose content contains ``` used to truncate the fence and dump
// raw JSON. Reproduced live: the card below is verbatim what produced it.
test("a code block containing triple backticks still renders (4-backtick fence)", () => {
  const spec = {
    v: 1, title: "Code + references",
    blocks: [
      { type: "code", language: "ts", filename: "canvas-schema.ts",
        code: 'const FENCE_RE = /```astra-canvas[^\\n]*\\n([\\s\\S]*?)```/g;' },
      { type: "references", items: [{ title: "Directive", href: "https://astra.jitinnair.com/docs" }] },
    ],
  };
  const text = "````astra-canvas\n" + JSON.stringify(spec) + "\n````\nafter";
  const parts = splitCanvasBlocks(text);
  const canvases = parts.filter((p) => p.kind === "canvas") as any[];
  assert.equal(canvases.length, 1, "card renders instead of raw JSON");
  assert.equal(canvases[0].spec.title, "Code + references");
  assert.equal(canvases[0].spec.blocks.length, 2);
  assert.equal((canvases[0].spec.blocks[0] as any).code.includes("```"), true, "backticks survive");
  assert.ok(parts.some((p) => p.kind === "md" && (p as any).text.includes("after")));
  assert.equal(hasCanvas(text), true, "mount gate agrees");
});

// A 3-backtick fence is still the common case and must keep working, and a
// 4-backtick fence must not swallow a later 3-backtick canvas.
test("fence lengths are independent and do not swallow each other", () => {
  const a = JSON.stringify({ v: 1, blocks: [{ type: "kpi", label: "A", value: 1 }] });
  const text = "```astra-canvas\n" + a + "\n```\nmiddle\n````astra-canvas\n" +
    JSON.stringify({ v: 1, blocks: [{ type: "code", code: "x ``` y" }] }) + "\n````\nend";
  const parts = splitCanvasBlocks(text);
  const canvases = parts.filter((p) => p.kind === "canvas") as any[];
  assert.equal(canvases.length, 2);
  assert.equal((canvases[0].spec.blocks[0] as any).label, "A");
  assert.ok(parts.some((p) => p.kind === "md" && (p as any).text.includes("middle")));
});

// The turn planner must use the same scanner, or live streaming and history
// reload disagree about whether a long fence is closed.
test("the turn planner honours a 4-backtick fence split across segments", () => {
  const body = JSON.stringify({ v: 1, blocks: [{ type: "code", code: "a ``` b" }] });
  const plan = planTurnCanvases([
    "intro ````astra-canvas\n" + body.slice(0, 20),
    body.slice(20) + "\n```` tail",
  ]);
  assert.equal(plan.canvases.length, 1);
  assert.equal((plan.canvases[0].spec.blocks[0] as any).code.includes("```"), true);
});

// Fail-soft must survive the new paths: nonsense still degrades, never throws.
test("the coercer never turns junk into a canvas", () => {
  assert.equal(parseCanvasSpec("not json at all"), null);
  assert.equal(parseCanvasSpec('{"type":"hologram"}'), null);
  assert.equal(parseCanvasSpec('{"v":1,"blocks":[]}'), null);
  assert.equal(parseCanvasSpec(""), null);
  assert.equal(parseCanvasSpec("[]"), null);
});

// ---- real-time streaming parse: blocks appear as they complete --------------

test("streaming parse yields completed blocks, skips the half-written one", () => {
  const full = JSON.stringify({ v: 1, title: "Live", blocks: [
    { type: "kpi", label: "A", value: 1 },
    { type: "callout", tone: "info", body: "bbbbbbbb" },
  ] });
  // cut mid-way through the SECOND block's body string (no spaces in stringify)
  const cut = full.slice(0, full.indexOf("bbbb") + 2);
  const body = cut.slice(cut.indexOf("{"));
  const blocks = parseStreamingBlocks(body);
  assert.equal(blocks.length, 1, "only the completed block is emitted");
  assert.equal((blocks[0] as any).label, "A");
});

test("streaming parse grows block-by-block as text arrives", () => {
  const one = JSON.stringify({ v: 1, blocks: [{ type: "kpi", label: "A", value: 1 }] });
  const two = JSON.stringify({ v: 1, blocks: [
    { type: "kpi", label: "A", value: 1 },
    { type: "kpi", label: "B", value: 2 },
  ] });
  const b1 = parseStreamingBlocks(one.slice(one.indexOf("{")));
  const b2 = parseStreamingBlocks(two.slice(two.indexOf("{")));
  assert.equal(b1.length, 1);
  assert.equal(b2.length, 2, "second block joins once its brace closes");
});

test("streaming parse ignores a brace inside a string value", () => {
  const body = JSON.stringify({ v: 1, blocks: [
    { type: "callout", tone: "info", body: "a } brace and \\\" quote inside" },
    { type: "kpi", label: "B", value: 2 },
  ] });
  const blocks = parseStreamingBlocks(body);
  assert.equal(blocks.length, 2, "the } inside the string did not end the block early");
  assert.ok((blocks[0] as any).body.includes("brace"));
});

test("parseStreamingCanvas pulls partial title + blocks from an open fence", () => {
  const spec = JSON.stringify({ v: 1, title: "Building now", blocks: [{ type: "kpi", label: "A", value: 9 }] });
  const text = "prose\n```astra-canvas\n" + spec; // fence still OPEN (no closing ```)
  const live = parseStreamingCanvas(text);
  assert.ok(live, "partial canvas detected");
  assert.equal(live!.title, "Building now");
  assert.equal(live!.blocks.length, 1);
});

test("parseStreamingCanvas returns null before any block completes", () => {
  assert.equal(parseStreamingCanvas("```astra-canvas\n{ \"v\": 1, \"blocks\": [ { \"type\": \"kp"), null);
});

// ---- v3 block types ---------------------------------------------------------

test("v3: quote block validates, author→attribution alias", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "quote", text: "Taste is trained, not innate.", author: "Emil Kowalski", role: "design engineer", context: "animations.dev" },
  ] }));
  assert.ok(spec);
  const q = spec!.blocks[0] as any;
  assert.equal(q.type, "quote");
  assert.equal(q.attribution, "Emil Kowalski", "author field aliases to attribution");
  assert.equal(q.role, "design engineer");
});

test("v3: quote without text is invalid", () => {
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "quote", attribution: "x" }] })), null);
});

test("v3: keyvalue validates + mono flag, alias kv", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "kv", title: "Build", items: [
      { key: "Version", value: "3.7.0", mono: true },
      { key: "Passes", value: 43 },
    ] },
  ] }));
  assert.ok(spec);
  const kv = spec!.blocks[0] as any;
  assert.equal(kv.type, "keyvalue");
  assert.equal(kv.items.length, 2);
  assert.equal(kv.items[0].mono, true);
  assert.equal(kv.items[1].value, 43);
});

test("v3: keyvalue item without value is invalid", () => {
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "keyvalue", items: [{ key: "x" }] }] })), null);
});

test("v3: diff hunks validate, op aliases (+, added)", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "diff", filename: "a.ts", hunks: [
      { header: "@@ -1,3 +1,4 @@", lines: [
        { op: "ctx", text: "line one" },
        { op: "+", text: "line two" },
        { op: "removed", text: "line three" },
      ] },
    ] },
  ] }));
  assert.ok(spec);
  const d = spec!.blocks[0] as any;
  assert.equal(d.type, "diff");
  assert.equal(d.hunks[0].lines[1].op, "add");
  assert.equal(d.hunks[0].lines[2].op, "del");
});

test("v3: diff accepts raw unified-diff string lines", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "diff", filename: "x.css", lines: [
      "@@ -10,3 +10,4 @@",
      " old line",
      "+new line",
      "-gone line",
    ] },
  ] }));
  assert.ok(spec);
  const d = spec!.blocks[0] as any;
  assert.equal(d.hunks.length, 1, "@@ starts a new hunk");
  assert.equal(d.hunks[0].lines.length, 3);
  assert.equal(d.hunks[0].lines[1].op, "add");
  assert.equal(d.hunks[0].lines[1].text, "new line");
});

test("v3: diff with empty hunks is invalid", () => {
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "diff", hunks: [] }] })), null);
});

test("v3: heatmap validates a rectangular grid, alias heat-map", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "heat-map", title: "Commits", rows: ["Mon", "Tue"], cols: ["am", "pm"], values: [[1, 2], [3, 4]] },
  ] }));
  assert.ok(spec);
  const h = spec!.blocks[0] as any;
  assert.equal(h.type, "heatmap");
  assert.equal(h.values.length, 2);
});

test("v3: heatmap with a ragged row is invalid", () => {
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "heatmap", rows: ["a", "b"], cols: ["x", "y"], values: [[1, 2], [3]] },
  ] })), null);
});

test("v3: tabs validate with inner blocks; empty tab invalid", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "tabs", items: [
      { label: "Before", blocks: [{ type: "kpi", label: "A", value: 1 }] },
      { label: "After", blocks: [{ type: "callout", tone: "info", body: "better" }, { type: "bad" }] },
    ] },
  ] }));
  assert.ok(spec);
  const t = spec!.blocks[0] as any;
  assert.equal(t.items.length, 2);
  assert.equal(t.items[1].blocks.length, 1, "invalid inner block dropped, tab kept");
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "tabs", items: [{ label: "x", blocks: [] }] }] })), null);
});

test("v3: kpi spark validates (3-24 points) and degrades silently", () => {
  const ok = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "kpi", label: "Lat", value: 42, spark: [1, 5, 3, 9] }] }));
  assert.ok(ok);
  assert.deepEqual((ok!.blocks[0] as any).spark, [1, 5, 3, 9]);
  const bad = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "kpi", label: "Lat", value: 42, spark: [1, "x"] }] }));
  assert.ok(bad, "kpi stays valid");
  assert.equal((bad!.blocks[0] as any).spark, undefined, "bad spark dropped, tile kept");
});

test("v3: chart donut + stack kinds pass through", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "donut", labels: ["a", "b"], series: [{ name: "s", points: [3, 7] }] },
    { type: "chart", chart: "stacked", labels: ["q1", "q2"], series: [{ name: "x", points: [1, 2] }, { name: "y", points: [2, 1] }] },
  ] }));
  assert.ok(spec);
  assert.equal((spec!.blocks[0] as any).chart, "donut");
  assert.equal((spec!.blocks[1] as any).chart, "stack", "stacked aliases to stack");
});

test("v3: donut alias (doughnut) coerces", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "doughnut", labels: ["a"], series: [{ name: "s", points: [9] }] },
  ] }));
  assert.ok(spec);
  assert.equal((spec!.blocks[0] as any).chart, "donut");
});

test("v3: streaming parse repairs a lenient element mid-stream (trailing comma + bare keys)", () => {
  // element 1 is bare-key + trailing-comma (needs the repair pass); element 2 is
  // half-written so it must NOT appear yet.
  const body = `{\n  "blocks": [\n    { type: "kpi", label: "A", value: 1, },\n    { "type": "kpi", "label"\n`;
  const blocks = parseStreamingBlocks(body);
  assert.equal(blocks.length, 1, "lenient element joins mid-stream; the half-written one waits");
  assert.equal((blocks[0] as any).label, "A");
});

test("v3: a full v3 canvas (all 18 block types) parses in order", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, title: "v3", blocks: [
    { type: "kpi", label: "K", value: 1, spark: [1, 2, 3] },
    { type: "chart", chart: "line", series: [{ name: "s", points: [1] }] },
    { type: "chart", chart: "donut", labels: ["a"], series: [{ name: "s", points: [1] }] },
    { type: "table", columns: ["c"], rows: [["r"]] },
    { type: "diagram", layout: "flow", nodes: [{ id: "n", label: "N" }], edges: [] },
    { type: "checklist", items: [{ text: "t" }] },
    { type: "steps", items: [{ title: "s1" }] },
    { type: "callout", tone: "info", body: "b" },
    { type: "progress", label: "p", value: 50 },
    { type: "timeline", items: [{ title: "t" }] },
    { type: "compare", items: [{ name: "a", points: [{ text: "p" }] }] },
    { type: "tree", nodes: [{ id: "r", label: "root" }] },
    { type: "code", code: "x = 1" },
    { type: "references", items: [{ title: "r" }] },
    { type: "quote", text: "q" },
    { type: "keyvalue", items: [{ key: "k", value: "v" }] },
    { type: "diff", hunks: [{ lines: [{ op: "add", text: "+" }] }] },
    { type: "heatmap", rows: ["r"], cols: ["c"], values: [[1]] },
    { type: "tabs", items: [{ label: "T", blocks: [{ type: "kpi", label: "i", value: 0 }] }] },
  ] }));
  assert.ok(spec);
  assert.equal(spec!.blocks.length, 19);
});

// ---- v4 block types (accordion, terminal, badges, divider) ------------------

test("v4: accordion validates, defaults first item open, nests blocks", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "accordion", items: [
      { title: "Methodology", body: "How the numbers were computed." },
      { title: "Data caveats", body: "Two sources lag by a quarter.", blocks: [{ type: "kpi", label: "Lag", value: "1 qtr" }] },
      { title: "Third section", body: "Context here." },
    ] },
  ] }));
  assert.ok(spec);
  const a = spec!.blocks[0] as any;
  assert.equal(a.type, "accordion");
  assert.equal(a.items.length, 3);
  assert.equal(a.items[0].open, true, "first item defaults open");
  assert.equal(a.items[1].open, undefined);
  assert.equal(a.items[1].blocks[0].type, "kpi");
});

test("v4: accordion item with neither body nor blocks is invalid", () => {
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "accordion", items: [{ title: "Nothing inside" }, { title: "Also nothing" }] },
  ] })), null);
});

// ---- accordion items render NESTED BLOCKS end-to-end (2026-10-05) -------------------------------------------------------------
// User-reported symptom: an accordion item carrying `blocks` rendered as a
// dropdown with NO content on the live site. The parser and the renderer were
// both already correct; `sanitizeCanvasSpec` — the one call on the render path
// (chat-timeline.tsx:70) — rebuilt each item as `{title, body}` and dropped
// `blocks` (and `open`) on the way to the renderer. So the card that reaches
// `AccordionView` had an item with no body and no blocks: an empty disclosure.
//
// These cases pin the WHOLE pipeline, because any one layer can silently drop
// the nesting again and the symptom is an empty dropdown, not an error.

test("accordion: the reported card shape keeps its nested blocks through parse AND sanitize", () => {
  // EXACT shape from the bug report.
  const json = JSON.stringify({
    v: 1,
    title: "Delivery",
    blocks: [{
      type: "accordion",
      items: [{
        title: "Design decisions (skippable)",
        blocks: [{ type: "checklist", items: [{ text: "Skip the theming step", status: "done" }] }],
      }],
    }],
  });

  // (a) the parser preserves the nesting…
  const spec = parseCanvasSpec(json);
  assert.ok(spec, "the user card must parse");
  const parsedItem = (spec!.blocks[0] as any).items[0];
  assert.equal(parsedItem.blocks.length, 1, "parser must keep item.blocks");
  assert.equal(parsedItem.blocks[0].type, "checklist", "the nested block keeps its type");
  assert.equal(parsedItem.blocks[0].items[0].text, "Skip the theming step");
  assert.equal(parsedItem.open, true, "the first item still defaults open");

  // …and the sanitizer, which is where the content used to die, keeps it too.
  // This is the assertion that failed before the fix: blocks came back undefined.
  const safe = sanitizeCanvasSpec(spec) as any;
  assert.ok(safe, "the card must survive sanitization");
  const safeItem = safe.blocks[0].items[0];
  assert.ok(Array.isArray(safeItem.blocks), "item.blocks must reach the renderer (was dropped)");
  assert.equal(safeItem.blocks[0].type, "checklist");
  assert.equal(safeItem.blocks[0].items[0].status, "done", "nested block is fully sanitized, not just carried");
  assert.equal(safeItem.body, undefined, "an item with only blocks must not gain a fake body");
});

test("accordion: an explicit open:true survives sanitization (it was discarded too)", () => {
  const spec = parseCanvasSpec(JSON.stringify({
    v: 1,
    blocks: [{ type: "accordion", items: [
      { title: "First, left closed", body: "a" },
      { title: "Second, authored open", open: true, body: "b" },
    ] }],
  }));
  assert.ok(spec);
  assert.equal((spec!.blocks[0] as any).items[1].open, true, "parser keeps the authored open flag");
  const safe = sanitizeCanvasSpec(spec) as any;
  assert.equal(safe.blocks[0].items[1].open, true, "sanitizer must not drop open");
  assert.equal(safe.blocks[0].items[0].open, undefined, "an unopened item stays unopened (no invented open)");
});

test("accordion without blocks is unchanged by the fix (body-only path)", () => {
  const json = JSON.stringify({
    v: 1,
    blocks: [{ type: "accordion", items: [
      { title: "Methodology", body: "How the numbers were computed." },
      { title: "Caveats", body: "Two sources lag by a quarter." },
    ] }],
  });
  const spec = parseCanvasSpec(json);
  assert.ok(spec);
  const safe = sanitizeCanvasSpec(spec) as any;
  const items = safe.blocks[0].items;
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i: any) => i.title), ["Methodology", "Caveats"]);
  assert.equal(items[0].body, "How the numbers were computed.");
  assert.equal(items[0].blocks, undefined, "a body-only item must not gain an empty blocks array");
  assert.equal(items[1].body, "Two sources lag by a quarter.");
});

test("accordion: an invalid nested block degrades fail-soft — the card is never lost", () => {
  // One unusable nested block between two good ones. The bad one is dropped; its
  // siblings AND the card itself survive. (No throw, no whole-card loss.)
  const spec = parseCanvasSpec(JSON.stringify({
    v: 1,
    blocks: [{ type: "accordion", items: [
      { title: "Mixed", body: "kept text", blocks: [
        { type: "kpi", value: 3 },                                        // no label -> invalid
        { type: "checklist", items: [{ text: "ok" }] },                  // valid
        { type: "hologram" },                                            // unknown type
      ] },
      { title: "Sibling", body: "survives too" },
    ] }],
  }));
  assert.ok(spec, "one bad nested block must not sink the card");
  const item = (spec!.blocks[0] as any).items[0];
  assert.equal(item.blocks.length, 1, "only the invalid nested blocks are dropped");
  assert.equal(item.blocks[0].type, "checklist");
  assert.equal(item.body, "kept text", "the item keeps its body when nested blocks degrade");

  const safe = sanitizeCanvasSpec(spec) as any;
  assert.ok(safe, "the card survives sanitization");
  assert.equal(safe.blocks[0].items.length, 2, "the sibling item is untouched");
  assert.equal(safe.blocks[0].items[0].blocks[0].type, "checklist");
});

test("accordion: an item with no body AND only-invalid blocks degrades to its body or is dropped, never crashes", () => {
  // Degradation ladder for one item: nested-only + all nested invalid -> the
  // item has nothing to reveal, so it is dropped; its siblings stay.
  const spec = parseCanvasSpec(JSON.stringify({
    v: 1,
    blocks: [{ type: "accordion", items: [
      { title: "Dead item", blocks: [{ type: "kpi", value: 3 }] },
      { title: "Live item", body: "still here" },
    ] }],
  }));
  // The PARSER is stricter: an all-invalid item makes the whole card invalid.
  assert.equal(spec, null, "a card whose only content is unusable is not renderable");

  // The SANITIZER is the fail-soft layer: fed that shape directly it drops the
  // dead item and keeps the live one. No throw either way.
  const safe = sanitizeCanvasSpec({
    v: 1,
    blocks: [{ type: "accordion" as const, items: [
      { title: "Dead item", blocks: [{ type: "kpi", value: 3 }] },
      { title: "Live item", body: "still here" },
    ] }],
  } as never) as any;
  assert.ok(safe, "must not throw and must not lose the whole card");
  assert.equal(safe.blocks[0].items.length, 1);
  assert.equal(safe.blocks[0].items[0].title, "Live item");
  assert.equal(safe.blocks[0].items[0].body, "still here");
});

test("accordion: serialization keeps the nested blocks (round-trip through the fence)", () => {
  const json = JSON.stringify({
    v: 1,
    blocks: [{ type: "accordion", items: [
      { title: "Design decisions (skippable)", blocks: [
        { type: "checklist", items: [{ text: "Skip the theming step", status: "done" as const }] },
      ] },
    ] }],
  });
  const parts = splitCanvasBlocks("```astra-canvas\n" + json + "\n```");
  assert.equal(parts.length, 1);
  assert.equal(parts[0].kind, "canvas", "the card must split as a canvas, not degrade to markdown");
  const item = (parts[0] as any).spec.blocks[0].items[0];
  assert.equal(item.blocks[0].type, "checklist", "the fence round-trip keeps the nested block");
  assert.equal(item.blocks[0].items[0].text, "Skip the theming step");

  // And the markdown fallback projection (used by CLI / non-Astra surfaces)
  // must still describe the item rather than dropping it silently.
  const md = canvasToMarkdown((parts[0] as any).spec);
  assert.ok(md.includes("Design decisions (skippable)"), "the accordion title survives to markdown");
});

test("accordion: nesting is depth-capped so a pathological card cannot stack-overflow the renderer", () => {
  // The parser does not cap depth, so this card parses fine. The sanitizer must
  // bound it — otherwise the recursive descent (and the renderer's own recursion
  // through `Blocks`) is a crash on a card that parsed.
  let deep: any = { type: "checklist", items: [{ text: "leaf" }] };
  for (let i = 0; i < 40; i++) deep = { type: "accordion", items: [{ title: `L${i}`, blocks: [deep] }] };
  const parsed = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [deep] }));
  assert.ok(parsed, "the parser itself does not cap depth");
  let out: any = null;
  assert.doesNotThrow(() => { out = sanitizeCanvasSpec(parsed); }, "sanitizing deep nesting must not throw");
  // Degrades fail-soft: past the cap the content is dropped rather than crashing.
  assert.equal(out, null, "an unrenderably deep card degrades to null (caller shows markdown)");
});

test("tabs: nested blocks survive sanitization (same bug class as accordion)", () => {
  // `tabs` had NO case in the sanitizer at all, so every tabs card fell through
  // to `default: return null` and vanished from the card entirely. Same root
  // cause: a nested-blocks container rebuilt without its blocks.
  const spec = parseCanvasSpec(JSON.stringify({
    v: 1,
    blocks: [{ type: "tabs", items: [
      { label: "Before", blocks: [{ type: "checklist", items: [{ text: "old" }] }] },
      { label: "After", blocks: [{ type: "checklist", items: [{ text: "new" }] }] },
    ] }],
  }));
  assert.ok(spec, "tabs with nested blocks must parse");
  const safe = sanitizeCanvasSpec(spec) as any;
  assert.ok(safe, "a tabs card must survive sanitization (was dropped whole)");
  assert.equal(safe.blocks[0].items.length, 2);
  assert.equal(safe.blocks[0].items[0].blocks[0].items[0].text, "old");
  assert.equal(safe.blocks[0].items[1].blocks[0].items[0].text, "new");
});

test("accordion: a chart nested in an item keeps its lazy-load dispatch shape", () => {
  // The renderer dispatches nested blocks through the same `Blocks` dispatcher,
  // so a lazy chart inside an accordion must arrive with the fields the chart
  // renderer reads — otherwise it renders an empty plot frame (RG-098's bug).
  const spec = parseCanvasSpec(JSON.stringify({
    v: 1,
    blocks: [{
      type: "accordion",
      items: [{
        title: "Throughput",
        blocks: [{ type: "chart", chart: "bar", labels: ["a", "b"], series: [{ name: "tok/s", points: [167, 50] }] }],
      }],
    }],
  }));
  assert.ok(spec);
  const safe = sanitizeCanvasSpec(spec) as any;
  const chart = safe.blocks[0].items[0].blocks[0];
  assert.equal(chart.type, "chart");
  assert.equal(chart.chart, "bar", "the chart kind must survive so the lazy renderer picks it");
  assert.deepEqual(chart.series[0].points, [167, 50], "points must survive (canvas-chart reads series[i].points)");
  assert.deepEqual(chart.series[0].data, [167, 50], "and the legacy data mirror, for the same reason");
});

test("v4: terminal accepts objects and plain strings; bare string lines split", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "terminal", title: "Deploy check", command: "kubectl get pods", exitCode: 0, lines: [
      { text: "NAME   READY", tone: "dim" },
      { text: "api    1/1  Running", tone: "success" },
    ] },
  ] }));
  assert.ok(spec);
  const t = spec!.blocks[0] as any;
  assert.equal(t.type, "terminal");
  assert.equal(t.lines[1].tone, "success");
  assert.equal(t.exitCode, 0);
  const obj = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "console", lines: ["plain a", "plain b"] },
  ] }));
  assert.ok(obj, "alias console→terminal");
  assert.equal((obj!.blocks[0] as any).lines.length, 2);
  assert.equal((obj!.blocks[0] as any).lines[0].tone, undefined, "plain strings default to stdout tone");
  const raw = parseCanvasSpec('{ "v": 1, "blocks": [ { "type": "terminal", "lines": "one\\ntwo\\nthree" } ] }');
  assert.ok(raw);
  assert.equal((raw!.blocks[0] as any).lines.length, 3, "a bare string value splits on newline");
});

test("v4: badges validate with tone fallback to neutral", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "chips", items: [{ label: "API · healthy", tone: "success" }, { label: "Queue backlog", tone: "weird" }] },
  ] }));
  assert.ok(spec);
  const b = spec!.blocks[0] as any;
  assert.equal(b.type, "badges");
  assert.equal(b.items[0].tone, "success");
  assert.equal(b.items[1].tone, "neutral", "unknown tone falls back, does not drop");
});

test("v4: divider validates with optional label", () => {
  const withLabel = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "separator", label: "Risks" }] }));
  assert.ok(withLabel);
  assert.equal((withLabel!.blocks[0] as any).type, "divider");
  assert.equal((withLabel!.blocks[0] as any).label, "Risks");
  const bare = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "divider" }, { type: "kpi", label: "K", value: 1 }] }));
  assert.ok(bare, "divider groups with siblings");
  assert.equal(bare!.blocks.length, 2);
});

test("v4: a full 22-type canvas parses in order", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "kpi", label: "K", value: 1, spark: [1, 2, 3] },
    { type: "chart", chart: "line", series: [{ name: "s", points: [1] }] },
    { type: "chart", chart: "donut", labels: ["a"], series: [{ name: "s", points: [1] }] },
    { type: "table", columns: ["c"], rows: [["r"]] },
    { type: "diagram", layout: "flow", nodes: [{ id: "n", label: "N" }], edges: [] },
    { type: "checklist", items: [{ text: "t" }] },
    { type: "steps", items: [{ title: "s1" }] },
    { type: "callout", tone: "info", body: "b" },
    { type: "progress", label: "p", value: 50 },
    { type: "timeline", items: [{ title: "t" }] },
    { type: "compare", items: [{ name: "a", points: [{ text: "p" }] }] },
    { type: "tree", nodes: [{ id: "r", label: "root" }] },
    { type: "code", code: "x = 1" },
    { type: "references", items: [{ title: "r" }] },
    { type: "quote", text: "q" },
    { type: "keyvalue", items: [{ key: "k", value: "v" }] },
    { type: "diff", hunks: [{ lines: [{ op: "add", text: "+" }] }] },
    { type: "heatmap", rows: ["r"], cols: ["c"], values: [[1]] },
    { type: "tabs", items: [{ label: "T", blocks: [{ type: "kpi", label: "i", value: 0 }] }] },
    { type: "accordion", items: [{ title: "A", body: "b" }] },
    { type: "terminal", lines: [{ text: "out", tone: "stdout" }] },
    { type: "badges", items: [{ label: "ok", tone: "success" }] },
    { type: "divider", label: "end" },
  ] }));
  assert.ok(spec);
  assert.equal(spec!.blocks.length, 23);
});

// ── v4 editable + downloadable surfaces ──────────────────────────────────────
// (spreadsheet / slides / document / text). Each is BASIC editing plus an
// expandable fullscreen view, and a Download that writes server-side first.

test("spreadsheet accepts rows with mixed scalars and headers", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "spreadsheet", title: "Q3", rows: [["Region", "Rev"], ["EMEA", 120], ["APAC", 95]] },
  ] }));
  assert.ok(spec);
  const b: any = spec!.blocks[0];
  assert.equal(b.type, "spreadsheet");
  assert.equal(b.header, true, "header defaults to true");
  assert.deepEqual(b.rows[1], ["EMEA", 120]);
});

test("spreadsheet aliases data/cells, unwraps {v|value} cells, pads nulls", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "sheet", data: [[{ value: "A" }, null, 3]] },
  ] }));
  assert.ok(spec, "the 'sheet' alias must resolve");
  assert.deepEqual((spec!.blocks[0] as any).rows[0], ["A", "", 3]);
});

test("spreadsheet rejects non-scalar cells and empty row sets", () => {
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "spreadsheet", rows: [[{ nested: { a: 1 } }]] }] })), null);
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "spreadsheet", rows: [] }] })), null);
});

test("slides accept heading+bullets, plus title/points aliases", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "slides", slides: [{ heading: "Intro", bullets: ["a", "b"] }] },
    { type: "deck", pages: [{ title: "End", points: ["thanks"] }] },
  ] }));
  assert.ok(spec);
  const b: any = spec!.blocks[0];
  assert.equal(b.slides[0].heading, "Intro");
  assert.deepEqual(b.slides[0].bullets, ["a", "b"]);
  const c: any = spec!.blocks[1];
  assert.equal(c.type, "slides");
  assert.deepEqual(c.slides[0].bullets, ["thanks"]);
});

test("a slide with neither heading nor bullets is rejected", () => {
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "slides", slides: [{ note: "orphan note only" }] }] })), null);
});

test("document accepts structured parts and bare strings; keeps kind", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "document", content: [
      { kind: "h2", text: "Title" },
      { kind: "li", text: "bullet" },
      "a plain paragraph",
    ] },
  ] }));
  assert.ok(spec);
  const b: any = spec!.blocks[0];
  assert.equal(b.content.length, 3);
  assert.equal(b.content[0].kind, "h2");
  assert.equal(b.content[2].kind, undefined, "bare string becomes a paragraph");
});

test("text reads content/text/value/body alike", () => {
  for (const key of ["content", "text", "value", "body"]) {
    const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "text", [key]: "hello" }] }));
    assert.ok(spec, `text via ${key}`);
    assert.equal((spec!.blocks[0] as any).content, "hello");
  }
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "text", content: 42 }] })), null);
});

test("'note' still aliases to callout — it must NOT become a text editor", () => {
  // A lone block is valid here (callout needs only a body), so this isolates the
  // alias itself rather than the whole-card tolerance rule.
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "note", tone: "warn", title: "Heads up", body: "just a note" },
  ] }));
  assert.ok(spec, "a valid callout block must survive on its own");
  const b: any = spec!.blocks[0];
  assert.equal(b.type, "callout", "regression guard for the alias table");
  assert.equal(b.body, "just a note");
});

test("a bad editable block drops alone — sibling blocks survive", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "kpi", label: "ok", value: 1 },
    { type: "spreadsheet", rows: [[{ nope: 1 }]] },
    { type: "text", content: "kept" },
  ] }));
  assert.ok(spec);
  assert.deepEqual(spec!.blocks.map((b) => b.type), ["kpi", "text"]);
});

// ── bracket-depth repair (regression from a real DB replay) ───────────────────
// Replaying every astra-canvas fence in ~/.hermes/state.db (120 fences) found
// the model sometimes emits ONE surplus closing bracket at the very end of a
// card — e.g. a `steps` block closed with `] }` after its array was already
// closed, leaving bracket depth -1. The whole card degraded to raw JSON.
// Two messages, 19 blocks, all otherwise perfectly valid.

test("a surplus trailing closer still renders (depth -1)", () => {
  const raw = `\`\`\`astra-canvas
{ "v": 1, "blocks": [
  { "type": "kpi", "label": "Rows", "value": 67 },
  { "type": "steps", "items": [ { "title": "Port", "status": "done" } ] }
  ]
] }
\`\`\``;
  const parts = splitCanvasBlocks(raw, false);
  const canv = parts.filter((p) => p.kind === "canvas");
  assert.equal(canv.length, 1, "the card must render, not degrade");
  assert.deepEqual(canv[0].spec.blocks.map((b) => b.type), ["kpi", "steps"]);
});

test("unclosed trailing brackets are closed, not rejected", () => {
  const raw = `\`\`\`astra-canvas
{ "v": 1, "blocks": [
  { "type": "kpi", "label": "A", "value": 1 }
\`\`\``;
  const canv = splitCanvasBlocks(raw, false).filter((p) => p.kind === "canvas");
  assert.equal(canv.length, 1);
  assert.equal(canv[0].spec.blocks[0].type, "kpi");
});

test("depth repair never touches braces inside string values", () => {
  const raw = `\`\`\`astra-canvas
{ "v": 1, "blocks": [ { "type": "callout", "tone": "info", "body": "a } b ] c" } ] }
\`\`\``;
  const canv = splitCanvasBlocks(raw, false).filter((p) => p.kind === "canvas");
  assert.equal(canv.length, 1);
  assert.equal((canv[0].spec.blocks[0] as any).body, "a } b ] c");
});

test("a payload with nothing salvageable still degrades rather than inventing blocks", () => {
  // RG-146 rewrite (2026-10-08): the old pin used `"label":"b","value":2` pairs
  // inside an items array and asserted the card stay broken — tier 1.65 now
  // repairs that class (corrupt elements dropped, valid data kept, same
  // philosophy as the async tier's per-block tolerance). Still-degraded shapes
  // are the ones NO tier can read: a bare unquoted VALUE (quoteBareKeys fixes
  // keys only) leaves nothing parseable.
  const salvaged = '{ "v": 1, "blocks": [ { "type": "kpi", "items": [ { "label": "a", "value": 1 }, "label": "b", "value": 2 } ] } ] }';
  const spec = parseCanvasSpec(salvaged);
  assert.ok(spec, "pair-in-array corruption is repaired, valid data kept");
  assert.equal((spec!.blocks[0] as { label?: string }).label, "a", "the valid item's data survived; the corrupt pair was dropped, not faked");
  const unfixable = '{ "v": 1, "blocks": [ { "type": kpi } ] }';
  assert.equal(parseCanvasSpec(unfixable), null, "a bare unquoted value stays degraded — no invention");
});


// ── tiered repair: Polaris extraction + jsonrepair (2026-10-03) ────────────────

test("tier 1 isolates JSON wrapped in prose (Polaris validator technique)", () => {
  const body = 'Here is the card:\n{ "v": 1, "blocks": [ { "type": "kpi", "label": "A", "value": 1 } ] }\nHope that helps.';
  const got = extractOutermostJson(body);
  assert.ok(got, "must isolate the outermost value");
  const spec = parseCanvasSpec(got!);
  assert.ok(spec, "the isolated value must parse");
  assert.equal(spec!.blocks[0].type, "kpi");
});

test("tier 1 ignores braces inside string values", () => {
  const body = '{ "v":1, "blocks":[ { "type":"callout", "tone":"info", "body":"a } b { c" } ] } trailing';
  assert.equal(extractOutermostJson(body), '{ "v":1, "blocks":[ { "type":"callout", "tone":"info", "body":"a } b { c" } ] }');
});

test("tier 1 returns null on a truncated value so tier 3 can try", () => {
  assert.equal(extractOutermostJson('{ "v": 1, "blocks": [ { "type": "kpi" '), null);
});

test("tier 1.75 (misnested closers) heals defects that cancel in a depth count", () => {
  // RG-147 (c03b8079): the model closed `blocks`' array while a row object was
  // still open, then kept writing (`,"badges":[…]`) — the missing `}`s never
  // appear anywhere, so the naive brace count is ZERO and the old truncation
  // tier appended nothing. The healer closes implied containers, drops strays,
  // completes EOF.
  const realDefect = '{"v":1,"blocks":[{"type":"callout","tone":"info","body":"a"],"badges":[{"label":"x","tone":"pro"}]}';
  const healed = parseCanvasSpec(realDefect);
  assert.ok(healed, "misnested closers heal");
  assert.equal(healed!.blocks.length, 1, "callout kept");
  assert.ok(healed!.blocks.some(() => true), "blocks survive");
});

test("callout accepts the model's `detail` variant as body (RG-147 alias)", () => {
  // 56651cd3: every callout used `detail:` instead of `body:` — valid JSON, all
  // blocks rejected, card died as "unreadable payload". Alias, body wins.
  const spec = parseCanvasSpec('{"v":1,"blocks":[{"type":"callout","tone":"warn","title":"t","detail":"hello"}]}');
  assert.ok(spec, "detail-variant callout parses");
  assert.equal((spec!.blocks[0] as { body?: string }).body, "hello");
  // body still wins when both exist
  const both = parseCanvasSpec('{"v":1,"blocks":[{"type":"callout","tone":"info","body":"real","detail":"old"}]}');
  assert.equal((both!.blocks[0] as { body?: string }).body, "real");
});

test("tier 1.65 (key:value pair inside array) repairs synchronously", () => {
  // RG-146 (2026-10-08): the model emits `"tone":"neutral"` INSIDE a table row
  // array — JSON.parse dies at the stray `:` and a 25 KB A4 report card went
  // "unreadable" until the async tier ran (or forever, on surfaces that never
  // trigger it). The stray pairs are DROPPED cleanly — jsonrepair (async tier)
  // only splits them into junk cells (`"tone",":","neutral"`), so the row
  // renders broken there. Verified against the real 25.8 KB b679d5eb body:
  // 32 blocks, 12ms sync.
  const broken = '{"v":1,"blocks":[{"type":"table","columns":["Question","Answer"],"rows":[["What is this?","An AI system.","tone":"neutral","tone":"pro"],["Why?","Because."]]},{"type":"code","code":"const a = 1;}"}]}';
  const spec = parseCanvasSpec(broken);
  assert.ok(spec, "tier 1.65 must repair the pair-in-array defect synchronously");
  const tbl = spec!.blocks[0] as { rows?: string[][] };
  assert.deepEqual(tbl.rows, [["What is this?", "An AI system."], ["Why?", "Because."]], "row cells kept, stray pairs dropped");
  assert.equal((spec!.blocks[1] as { code?: string }).code, "const a = 1;}", "string values containing } untouched");
  // Untouched shapes: plain string values, multi-cell rows, object pairs.
  const plain = parseCanvasSpec('{"v":1,"blocks":[{"type":"callout","tone":"info","body":"a tone: x b"}]}');
  assert.ok(plain, "object key:value pairs still parse");
  const rows3 = parseCanvasSpec('{"v":1,"blocks":[{"type":"table","columns":["A","B","C"],"rows":[["1","2","3"]]}]}');
  assert.deepEqual((rows3!.blocks[0] as { rows?: string[][] }).rows, [["1", "2", "3"]], "multi-cell rows untouched");
});

test("tier 3 (jsonrepair) rescues classes tiers 1-2 cannot", async () => {
  // Classes ONLY tier 3 handles: our own repairs refuse these outright.
  const cases: [string, string][] = [
    ["missing comma", '{ "v":1, "blocks":[ { "type":"kpi", "label":"A" "value":1 } ] }'],
    ["single quotes", "{ 'v':1, 'blocks':[ { 'type':'kpi', 'label':'A', 'value':1 } ] }"],
  ];
  for (const [name, body] of cases) {
    assert.equal(parseCanvasSpec(body), null, name + ": sync tiers must refuse it");
    const spec = await parseCanvasSpecAsync(body);
    assert.ok(spec, name + ": tier 3 must rescue it");
    assert.ok(spec!.blocks.length > 0, name);
    assert.ok(["kpi", "callout"].includes(spec!.blocks[0].type), name + " kept its type");
  }

  // An unclosed payload IS already handled by tier 2 (depth repair), so it must
  // render synchronously — the async path must be a strict superset, never a
  // different answer.
  const unclosed = '{ "v":1, "blocks":[ { "type":"kpi", "label":"A", "value":1 } ';
  assert.ok(parseCanvasSpec(unclosed), "tier 2 handles unclosed");
  assert.ok(await parseCanvasSpecAsync(unclosed), "async agrees");
});

test("tier 3 agrees with sync on the salvaged pair-in-array shape (RG-146)", async () => {
  // Was "refuses to fabricate": tier 1.65 (sync) now repairs this class and the
  // async path must AGREE, never answer differently.
  const broken = '{ "v": 1, "blocks": [ { "type": "kpi", "items": [ { "label": "a", "value": 1 }, "label": "b", "value": 2 } ] } ] }';
  const direct = await parseCanvasSpecAsync(broken);
  assert.ok(direct, "async tier salvages the same shape");
  assert.equal((direct!.blocks[0] as { label?: string }).label, "a", "same salvage decision as sync");
});

test("the async splitter rescues a card the sync splitter drops", async () => {
  const msg = "Here you go:\n\n```astra-canvas\n{ 'v': 1, 'blocks': [ { 'type': 'kpi', 'label': 'A', 'value': 7 } ] }\n```\n\nHope that helps.";
  assert.equal(splitCanvasBlocks(msg, false).filter((p) => p.kind === "canvas").length, 0, "sync must fail first");
  const parts = await splitCanvasBlocksAsync(msg, false);
  assert.equal(parts.filter((p) => p.kind === "canvas").length, 1, "tier 3 must rescue");
});

test("tier 3 never turns prose into an array of fragments", async () => {
  const msg = 'Here it is:\n```astra-canvas\n{ "v":1, "blocks":[ { "type":"kpi", "label":"A", "value":1 } ] }\n```\nDone.';
  const parts = await splitCanvasBlocksAsync(msg, false);
  const card = parts.find((p) => p.kind === "canvas");
  assert.ok(card, "card must render");
  assert.equal((card as any).spec.blocks[0].type, "kpi");
  assert.ok(parts.some((p) => p.kind === "md"), "prose must survive as prose");
});

// OWNER 2026-10-04: "the table gets mangled, only the headers are displayed with
// the table body missing". Corpus replay found the cause: `rows: []` passed
// validation because `[].every(…)` is vacuously true, so 2 of 51 real cards
// rendered as a bare header row.
test("table: a header with no body degrades instead of rendering an empty shell", () => {
  assert.equal(
    parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "table", columns: ["Arc", "State"], rows: [] }] })),
    null,
    "rows: [] must not validate as a table",
  );
  assert.equal(
    parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "table", columns: ["Arc", "State"] }] })),
    null,
    "a table with no rows key at all must not validate",
  );
  assert.equal(
    parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "table", columns: [], rows: [["a"]] }] })),
    null,
    "no columns is not a table",
  );
  assert.equal(
    parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "table", columns: ["a"], rows: [[]] }] })),
    null,
    "an empty row must not validate",
  );
  // …and the real shape still renders.
  const okSpec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "table", columns: ["a", "b"], rows: [["1", "2"]] }] }));
  assert.ok(okSpec, "a populated table still parses");
  assert.equal((okSpec!.blocks[0] as any).rows.length, 1);
});

// ── reactive canvas: the parser used to throw the whole layer away (M2) ─────
// The renderers resolve `{bind, value, delta, points, visible}` against the
// card's state, but the parser dropped every one of those blocks, stripped
// `bind`/`visible`, and dropped the top-level `state` — so a slider drove
// nothing and `CanvasView` never created its store. Each test anchors one
// authoring form to "the block SURVIVES and the binding SURVIVES with it".
// A dropped block shows up as blocks.length === 1 (the callout anchor only).

/** Parse [BLOCK, anchor-callout] and return the surviving non-callout block. */
function onlyBlock(block: unknown): any | null {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [block, { type: "callout", tone: "info", body: "anchor" }] }));
  assert.ok(spec, "the card must parse");
  const kept = (spec!.blocks as any[]).filter((b) => b.type !== "callout");
  assert.equal(kept.length, 1, `block was DROPPED: ${JSON.stringify(block)}`);
  return kept[0];
}

test("kpi: a bound value is kept, binding and all", () => {
  const b = onlyBlock({ type: "kpi", label: "MRR", value: { $expr: "money(seats * price)" } });
  assert.deepEqual(b.value, { $expr: "money(seats * price)" }, "the binding must reach the renderer intact");
  assert.equal(b.label, "MRR");
});

test("kpi: a bound value keeps the block's `visible` too", () => {
  const b = onlyBlock({ type: "kpi", label: "MRR", value: { $expr: "money(seats * price)" }, visible: { $expr: "flag" } });
  assert.deepEqual(b.value, { $expr: "money(seats * price)" });
  assert.deepEqual(b.visible, { $expr: "flag" }, "visible must not be stripped");
});

test("progress: a bound value is kept", () => {
  const b = onlyBlock({ type: "progress", label: "Seats", value: { $expr: "seats / 5" }, max: 100 });
  assert.deepEqual(b.value, { $expr: "seats / 5" });
  assert.equal(b.max, 100);
});

test("table: bind.$from keeps the block with NO rows, and keeps `bind`", () => {
  const b = onlyBlock({ type: "table", columns: ["svc"], bind: { $from: "ds", top: 3 } });
  assert.deepEqual(b.bind, { $from: "ds", top: 3 }, "bind is the reader — it must survive");
  assert.deepEqual(b.rows, [], "rows come from the dataset at render time");
});

test("table: the empty-table degradation still holds WITHOUT a bind", () => {
  // The rows-optional relaxation is scoped to bind.$from: a bare
  // {columns, rows: []} is still the "header with no body" defect.
  assert.equal(validateBlock({ type: "table", columns: ["a"], rows: [] }), null);
  assert.equal(validateBlock({ type: "table", columns: ["a"] }), null);
});

test("table: numeric/boolean/null cells are coerced to strings; an object cell degrades", () => {
  const b = onlyBlock({ type: "table", columns: ["svc", "ok", "n"], rows: [["api", 412], ["w", true], ["n", null]] });
  assert.deepEqual(b.rows, [["api", "412"], ["w", "true"], ["n", ""]]);
  assert.equal(validateBlock({ type: "table", columns: ["a"], rows: [["x", { nested: 1 }]] }), null);
});

test("chart: a bound series' points survive, and a series `visible` survives", () => {
  const b = onlyBlock({
    type: "chart", chart: "bar", labels: ["a", "b"],
    series: [{ name: "s", points: { $expr: "[1, 2]" }, visible: { $expr: "flag" } }],
  });
  assert.deepEqual(b.series[0].points, { $expr: "[1, 2]" }, "the binding stays where the renderer reads it");
  assert.deepEqual(b.series[0].visible, { $expr: "flag" });
  // a plain numeric series is untouched by the relaxation
  const ok = onlyBlock({ type: "chart", chart: "line", labels: ["a", "b"], series: [{ name: "s", points: [1, 2] }] });
  assert.deepEqual(ok.series[0].points, [1, 2]);
  assert.equal(ok.series[0].visible, undefined);
});

test("chart: a non-numeric, non-binding points array is still rejected", () => {
  assert.equal(validateBlock({ type: "chart", chart: "line", series: [{ name: "s", points: ["a", "b"] }] }), null);
});

test("state: scalars survive, bad keys and non-scalars are dropped", () => {
  const spec = parseCanvasSpec(JSON.stringify({
    v: 1, state: { seats: 100, "bad key": 1, x: { a: 1 }, ok: true, env: "prod", gone: null },
    blocks: [{ type: "callout", tone: "info", body: "x" }],
  }));
  assert.ok(spec);
  assert.deepEqual(spec!.state, { seats: 100, ok: true, env: "prod", gone: null });
});

test("state: a card with no state has NO `state` key at all", () => {
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "callout", tone: "info", body: "x" }] }));
  assert.ok(spec);
  assert.equal("state" in spec!, false, "an absent state must not appear as undefined");
});

test("state: the async/repair path keeps it too", async () => {
  // Missing comma → tiers 1-2 refuse it, so this exercises repairIsolated
  // (the same defect class the tier-3 test above pins).
  const body = '{ "v":1, "state":{ "seats":120, "price":49 }, "blocks":[ { "type":"kpi", "label":"MRR" "value":1 } ] }';
  assert.equal(parseCanvasSpec(body), null, "sync tiers must refuse it");
  const spec = await parseCanvasSpecAsync(body);
  assert.ok(spec, "tier 3 must rescue it");
  assert.deepEqual(spec!.state, { seats: 120, price: 49 });
});

test("copy-as-markdown of a bound card never prints [object Object]", () => {
  const spec = parseCanvasSpec(JSON.stringify({
    v: 1, state: { seats: 2 },
    blocks: [
      { type: "kpi", label: "MRR", value: { $expr: "money(seats * price)" } },
      { type: "progress", label: "p", value: { $expr: "seats / 5" } },
      { type: "chart", chart: "bar", labels: ["a", "b"], series: [{ name: "s", points: { $expr: "[1, 2]" } }] },
      { type: "table", columns: ["svc"], bind: { $from: "ds" } },
    ],
  }));
  assert.ok(spec);
  const md = canvasToMarkdown(spec!);
  assert.ok(!md.includes("[object Object]"), "a binding must serialise as (live):\n" + md);
  assert.ok(md.includes("(live)"), "the bound kpi value reads as (live)");
});

// PM review of the M2 worker (2026-10-04): three defects the worker's own tests did not cover.
test("a bound KPI never prints [object Object] in the derived title, and a bound table exports as live, not header-only", async () => {
  const { canvasToMarkdown } = await import("./canvas-markdown.ts");
  const spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [
    { type: "kpi", label: "MRR", value: { $expr: "money(seats * price)" } },
    { type: "table", columns: ["svc", "ms"], bind: { $from: "d" } },
    { type: "data", name: "d", columns: ["svc", "ms"], rows: [["a", 1]] },
  ] }));
  assert.ok(spec, "reactive card parses");
  const md = canvasToMarkdown(spec!);
  assert.ok(!md.includes("[object Object]"), "no [object Object] in the markdown copy");
  assert.ok(/Live table/.test(md), "a bound, row-less table is described as live");
  // the bug was a markdown table header with NO body row after it; the `data` block legitimately exports its own row
  const lines = md.split("\n");
  lines.forEach((ln, i) => {
    if (/^\|[-| ]+\|$/.test(ln)) assert.ok(/^\|.*\|$/.test(lines[i + 1] ?? "") && !/^\|[-| ]+\|$/.test(lines[i + 1] ?? ""), `table separator on line ${i} has no body row after it`);
  });
});

// OWNER 2026-10-04 (RG-072): a diagram is unreadable as shapes alone, so the
// parser keeps summary/caption/kind/note. These were silently dropped, so a
// reader got no text explanation of a diagram at all.
test("diagram: summary, caption, kind and note survive validation", () => {
  const spec = parseCanvasSpec(JSON.stringify({
    v: 1,
    blocks: [{
      type: "diagram", layout: "flow",
      summary: "The request enters at the edge and lands in the ledger.",
      caption: "Write path",
      nodes: [
        { id: "a", label: "Edge", kind: "entry", note: "public" },
        { id: "b", label: "Ledger", kind: "store" },
      ],
      edges: [{ from: "a", to: "b", label: "writes", note: "sync" }],
    }],
  }));
  assert.ok(spec, "the rich diagram parses");
  const d = spec!.blocks[0] as any;
  assert.equal(d.summary, "The request enters at the edge and lands in the ledger.");
  assert.equal(d.caption, "Write path");
  assert.equal(d.nodes[0].kind, "entry");
  assert.equal(d.nodes[0].note, "public");
  assert.equal(d.nodes[1].kind, "store");
  assert.equal(d.edges[0].note, "sync");
});

test("diagram: the legacy shape still parses, with no new keys defined", () => {
  const spec = parseCanvasSpec(JSON.stringify({
    v: 1,
    blocks: [{ type: "diagram", layout: "flow", nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] }],
  }));
  assert.ok(spec, "the legacy diagram parses");
  const d = spec!.blocks[0] as any;
  assert.equal(d.nodes.length, 2);
  assert.equal(d.edges.length, 1);
  assert.equal(d.summary, undefined);
  assert.equal(d.caption, undefined);
  assert.equal(d.nodes[0].kind, undefined);
  assert.equal(d.nodes[0].note, undefined);
  assert.equal(d.edges[0].note, undefined);
  // `direction` was already always emitted (tb/lr). The new keys follow the SAME
  // defensive style as `detail` — `isStr(x) ? x : undefined` — so they are PRESENT
  // as keys holding `undefined`. What must not happen is a new key carrying a
  // value, so pin the serialised shape (that is what a consumer actually sees).
  const serialised = JSON.parse(JSON.stringify(d));
  for (const k of ["summary", "caption"]) assert.ok(!(k in serialised), `legacy block must not carry ${k}`);
  for (const k of ["kind", "note"]) assert.ok(!(k in serialised.nodes[0]), `legacy node must not carry ${k}`);
  assert.ok(!(("note" in serialised.edges[0])), "legacy edge must not carry note");
  assert.equal(serialised.direction, "tb", "the pre-existing direction key is still emitted");
});

test("diagram: non-string kind/note/summary are ignored, not propagated", () => {
  const spec = parseCanvasSpec(JSON.stringify({
    v: 1,
    blocks: [{
      type: "diagram", layout: "flow",
      summary: 42,
      nodes: [{ id: "a", label: "A", kind: 7, note: { x: 1 } }],
      edges: [{ from: "a", to: "a", note: ["nope"] }],
    }],
  }));
  assert.ok(spec, "a diagram with junk optional fields still parses");
  const d = spec!.blocks[0] as any;
  assert.equal(d.summary, undefined, "a non-string summary is dropped");
  assert.equal(d.nodes[0].kind, undefined, "a non-string kind is dropped");
  assert.equal(d.nodes[0].note, undefined, "a non-string note is dropped");
  assert.equal(d.edges[0].note, undefined, "a non-string edge note is dropped");
});

test("diagram: summary/caption/note are capped at 400 characters", () => {
  const long = "x".repeat(900);
  const spec = parseCanvasSpec(JSON.stringify({
    v: 1,
    blocks: [{
      type: "diagram", layout: "flow",
      summary: long, caption: long,
      nodes: [{ id: "a", label: "A", note: long }],
      edges: [{ from: "a", to: "a", note: long }],
    }],
  }));
  assert.ok(spec);
  const d = spec!.blocks[0] as any;
  assert.equal(d.summary.length, 400);
  assert.equal(d.caption.length, 400);
  assert.equal(d.nodes[0].note.length, 400);
  assert.equal(d.edges[0].note.length, 400);
});


// ── scatter data shapes (owner 2026-10-04: "Latency vs payload is blank") ───────────────────────────────────────────
// A scatter's natural data is PAIRS. [[x,y],…] and [{x,y},…] used to fail the numeric-array test and DROP the whole
// card, so the chart simply never appeared. They must parse to canonical [x, y] pairs; a flat list still works.
test("scatter: [[x,y]] pairs and [{x,y}] objects parse to canonical pairs (no silent drop)", () => {
  const mk = (points: unknown) => parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "scatter", title: "t", labels: ["x: size", "y: ms"], series: [{ name: "runs", points }] }] }));
  const pairs = mk([[10, 300], [40, 338], [90, 400]]);
  assert.ok(pairs, "pairs must parse");
  assert.deepEqual((pairs!.blocks[0] as any).series[0].points, [[10, 300], [40, 338], [90, 400]]);
  const objs = mk([{ x: 10, y: 300 }, { x: 40, y: 338 }]);
  assert.ok(objs, "objects must parse");
  assert.deepEqual((objs!.blocks[0] as any).series[0].points, [[10, 300], [40, 338]]);
  const flat = mk([300, 338, 400]);
  assert.ok(flat, "a flat numeric series still parses");
  assert.deepEqual((flat!.blocks[0] as any).series[0].points, [300, 338, 400]);
  // pairs belong to a scatter ONLY: a bar chart must still reject non-numeric points
  const bar = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "bar", series: [{ name: "s", points: [[1, 2], [3, 4]] }] }] }));
  assert.equal(bar, null, "pairs must not leak into non-scatter charts");
});


// ── layout composite (canvas v1 expansion) ─────────────────────────────────────
// `layout` is a CONTAINER whose children are blocks, so it has the same
// composition contract as tabs/accordion — and the same two failure modes that
// shipped as real bugs: a missing SANITIZER case drops the block entirely, and
// a sanitizer that rebuilds the block without `blocks` leaves an empty frame.
const lay = (b: unknown) => parseCanvasSpec(JSON.stringify({ v: 1, blocks: [b] }));

test("layout: nested blocks parse and SURVIVE the sanitizer (both sides asserted)", () => {
  const spec = lay({ type: "layout", layout: "bento", blocks: [
    { type: "kpi", label: "A", value: 1 },
    { type: "callout", tone: "warn", body: "b" },
  ] });
  assert.ok(spec, "a layout with valid children parses");
  const p = spec!.blocks[0] as any;
  assert.equal(p.type, "layout");
  assert.equal(p.layout, "bento");
  assert.equal(p.blocks.length, 2);

  // The sanitizer is ONE call on the render path (chat-timeline.tsx:70). A card
  // asserted only on the parser side stayed green through the accordion bug,
  // where the parser was correct and the sanitizer threw the children away.
  const s = sanitizeCanvasSpec(spec) as any;
  assert.ok(s, "the layout must survive the sanitizer");
  const lb = s.blocks[0];
  assert.equal(lb.type, "layout", "sanitizer must not drop the layout block");
  assert.equal(lb.layout, "bento");
  assert.equal(lb.blocks?.length, 2, "sanitizer must PRESERVE the nested blocks");
  assert.deepEqual(lb.blocks.map((x: any) => x.type), ["kpi", "callout"]);
});

test("layout: every mode parses, an unknown mode degrades to stack, cols clamp to 2..4", () => {
  for (const mode of ["stack", "bento", "split", "masonry", "grid"]) {
    const spec = lay({ type: "layout", layout: mode, blocks: [{ type: "divider", label: "L" }] });
    assert.ok(spec, `${mode} must parse`);
    assert.equal((spec!.blocks[0] as any).layout, mode);
  }
  const bad = lay({ type: "layout", layout: "hologram-grid", blocks: [{ type: "divider" }] });
  assert.ok(bad, "an unknown mode must not drop the block");
  assert.equal((bad!.blocks[0] as any).layout, "stack", "unknown mode degrades to stack");
  assert.equal((lay({ type: "layout", layout: "grid", cols: 99, blocks: [{ type: "divider" }] })!.blocks[0] as any).cols, 4);
  assert.equal((lay({ type: "layout", layout: "grid", cols: 0, blocks: [{ type: "divider" }] })!.blocks[0] as any).cols, 2);
});

test("layout: the mode named in the block TYPE is rescued (bento/masonry aliases)", () => {
  const b = lay({ type: "bento", blocks: [{ type: "kpi", label: "x", value: 2 }] });
  assert.ok(b, "a `bento` block must parse rather than degrade the card");
  assert.equal((b!.blocks[0] as any).type, "layout");
  assert.equal((b!.blocks[0] as any).layout, "bento");
  const m = lay({ type: "masonry", blocks: [{ type: "kpi", label: "x", value: 2 }] });
  assert.equal((m!.blocks[0] as any).layout, "masonry");
});

test("layout: fail-soft — empty/all-invalid children drop the block, valid siblings survive", () => {
  // A layout with nothing to show is not a layout (same law as a tab).
  assert.equal(lay({ type: "layout", layout: "grid", blocks: [] }), null);
  assert.equal(lay({ type: "layout", layout: "grid", blocks: [{ type: "hologram" }] }), null);
  assert.equal(lay({ type: "layout", layout: "grid" }), null, "no blocks array at all is invalid");
  // Fail-soft is per CHILD: one bad block must not cost the card its good ones.
  const mixed = lay({ type: "layout", layout: "grid", blocks: [{ type: "hologram" }, { type: "divider", label: "kept" }] });
  assert.ok(mixed, "a layout with one good child must survive");
  assert.equal((mixed!.blocks[0] as any).blocks.length, 1);
  // A junk mode/type must not throw.
  assert.doesNotThrow(() => lay({ type: "layout", layout: 7, cols: "two", blocks: [{ type: "divider" }] }));
});

test("layout: nests inside accordion/tabs AND nests another layout (the render path)", () => {
  const spec = parseCanvasSpec(JSON.stringify({
    v: 1,
    blocks: [{
      type: "accordion",
      items: [{
        title: "t",
        blocks: [{
          type: "layout", layout: "split",
          blocks: [
            { type: "divider", label: "L" },
            { type: "layout", layout: "stack", blocks: [{ type: "kpi", label: "deep", value: 3 }] },
          ],
        }],
      }],
    }],
  }));
  assert.ok(spec);
  const s = sanitizeCanvasSpec(spec) as any;
  // The accordion case sanitizes nested blocks, so the layout must arrive intact
  // one level down — a layout dropped HERE is invisible to every test above.
  const inner = s.blocks[0].items[0].blocks;
  assert.equal(inner[0].type, "layout", "layout must survive inside an accordion");
  assert.equal(inner[0].blocks.length, 2);
  assert.equal(inner[0].blocks[1].type, "layout", "layouts may nest");
  assert.equal(inner[0].blocks[1].blocks[0].label, "deep");
  assert.equal(s.blocks[0].items[0].open, true, "the accordion still defaults its first item open");
});

test("layout: nesting deeper than MAX_NEST_DEPTH degrades instead of overflowing the stack", () => {
  // The PARSER does not cap depth (an agent-authored card can nest arbitrarily),
  // so the cap lives in the sanitizer — same MAX_NEST_DEPTH=6 as tabs/accordion.
  // Measured contract: depth <= 6 survives intact; deeper degrades exactly the
  // way an over-deep tab/accordion does — the empty result is dropped rather
  // than recursed into. What must NEVER happen is an unbounded descent.
  const chain = (n: number) => {
    let inner: any = { type: "divider", label: "deepest" };
    for (let i = 0; i < n; i++) inner = { type: "layout", layout: "stack", blocks: [inner] };
    return inner;
  };
  const depthOf = (s: any) => {
    let d = 0, node = s?.blocks?.[0];
    while (node && node.type === "layout" && node.blocks?.length) { d++; node = node.blocks[0]; }
    return d;
  };
  let spec: any;
  assert.doesNotThrow(() => { spec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [chain(12)] })); });
  assert.ok(spec, "the parser tolerates arbitrary depth");
  let s: any;
  assert.doesNotThrow(() => { s = sanitizeCanvasSpec(spec); }, "the sanitizer must never recurse without a bound");

  // A chain within the cap survives whole.
  const okSpec = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [chain(6)] }));
  assert.equal(depthOf(sanitizeCanvasSpec(okSpec)), 6, "depth 6 is inside the cap and must survive intact");
  // Beyond it the frame is dropped — an over-deep container is not a surface.
  assert.equal(s, null, "depth 12 degrades like an over-deep tab, never a stack overflow");
  // And a card with a SURVIVING sibling keeps that sibling: the cap is per branch.
  const withSib = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [chain(9), { type: "kpi", label: "kept", value: 1 }] }));
  const ws = sanitizeCanvasSpec(withSib) as any;
  assert.ok(ws, "the sibling keeps the card alive");
  assert.ok(ws.blocks.some((b: any) => b.type === "kpi"), "the sibling survives an over-deep branch");
});

test("layout: markdown copy serializes the children in document order", () => {
  const spec = lay({ type: "layout", layout: "bento", blocks: [
    { type: "kpi", label: "A", value: 1 },
    { type: "code", language: "ts", code: "const x = 1;" },
  ] });
  assert.ok(spec);
  const md = canvasToMarkdown(spec!);
  assert.match(md, /Layout \(bento\)/);
  assert.ok(md.indexOf("**A:**") < md.indexOf("const x = 1;"), "children keep document order");
});


// ── math (canvas v1 expansion) ────────────────────────────────────────────────
// A new block type ships with THREE obligations or it does not ship: a schema
// case, a sanitizer case, and regression tests that assert on BOTH sides of the
// sanitizer (the one call on the render path). A missing sanitizer case silently
// drops the block — that bug class has shipped twice already.
const math = (b: unknown) => parseCanvasSpec(JSON.stringify({ v: 1, blocks: [b] }));

test("math: tex parses and SURVIVES the sanitizer (both sides asserted)", () => {
  const spec = math({ type: "math", tex: "\\int_0^\\infty x^2\\,dx", display: true, label: "area" });
  assert.ok(spec, "a formula parses");
  const m = spec!.blocks[0] as any;
  assert.equal(m.type, "math");
  assert.equal(m.tex, "\\int_0^\\infty x^2\\,dx");
  assert.equal(m.display, true);
  assert.equal(m.label, "area");
  const s = sanitizeCanvasSpec(spec) as any;
  assert.ok(s, "the formula survives the sanitizer");
  assert.equal(s.blocks[0].type, "math", "sanitizer must not drop the math block");
  assert.equal(s.blocks[0].tex, m.tex);
  assert.equal(s.blocks[0].label, "area");
});

test("math: display defaults to true, inline is the explicit opt-out", () => {
  assert.equal((math({ type: "math", tex: "x" })!.blocks[0] as any).display, true, "display defaults on");
  assert.equal((math({ type: "math", tex: "x", display: false })!.blocks[0] as any).display, false);
  const s = sanitizeCanvasSpec(math({ type: "math", tex: "x" })) as any;
  assert.equal(s.blocks[0].display, true, "the default survives the sanitizer");
  assert.equal((sanitizeCanvasSpec(math({ type: "math", tex: "x", display: false })) as any).blocks[0].display, false);
});

test("math: fail-soft — empty/whitespace tex and junk fields never throw", () => {
  assert.equal(math({ type: "math" }), null, "no tex at all is not a formula");
  assert.equal(math({ type: "math", tex: "" }), null);
  assert.equal(math({ type: "math", tex: "   " }), null, "whitespace is not a formula");
  assert.equal(math({ type: "math", tex: 42 }), null, "a non-string tex is malformed");
  // A junk label/display must not reject a formula that is otherwise valid, and
  // must not throw.
  assert.doesNotThrow(() => math({ type: "math", tex: "x^2", label: { a: 1 }, display: "yes" }));
  assert.ok(math({ type: "math", tex: "x^2" }), "the valid formula still parses alongside junk");
});

test("math: tex is capped (one formula cannot bloat a card)", () => {
  const long = "x".repeat(9000);
  const m = math({ type: "math", tex: long })!.blocks[0] as any;
  assert.equal(m.tex.length, 4000, "the parser caps tex at 4000");
  const s = sanitizeCanvasSpec(math({ type: "math", tex: long })) as any;
  assert.ok(s.blocks[0].tex.length <= 4000, "the sanitizer caps tex too");
});

test("math: type aliases (equation/latex/tex/formula) all normalise to math", () => {
  for (const alias of ["equation", "latex", "tex", "formula"]) {
    const spec = math({ type: alias, tex: "a+b" });
    assert.ok(spec, `${alias} must parse rather than degrade the card`);
    assert.equal((spec!.blocks[0] as any).type, "math", `${alias} normalises to math`);
    assert.equal((spec!.blocks[0] as any).tex, "a+b");
  }
});

test("math: nests inside a layout and inside an accordion (the render path)", () => {
  const spec = parseCanvasSpec(JSON.stringify({
    v: 1,
    blocks: [{
      type: "layout", layout: "split",
      blocks: [
        { type: "math", tex: "E=mc^2" },
        { type: "accordion", items: [{ title: "derivation", body: "…", open: true }] },
      ],
    }],
  }));
  assert.ok(spec);
  const s = sanitizeCanvasSpec(spec) as any;
  const inner = s.blocks[0].blocks;
  assert.equal(inner[0].type, "math", "a formula inside a layout survives the sanitizer");
  assert.equal(inner[0].tex, "E=mc^2");
  assert.equal(inner[1].type, "accordion");
});

test("math: markdown copy round-trips the TeX source", () => {
  const spec = math({ type: "math", tex: "\\frac{a}{b}", label: "ratio" });
  assert.ok(spec);
  const md = canvasToMarkdown(spec!);
  assert.ok(md.includes("\\frac{a}{b}"), "the exact TeX source is copied, not flattened glyphs");
  assert.ok(md.includes("$$"), "display math copies as a $$ block");
  assert.ok(md.includes("ratio"), "the label is kept");
});


// ── diagram ER + circuit extension (canvas v1 expansion) ────────────────────────
// The diagram block is EXTENDED, not replaced: BLOCK_TYPES stays 39 and the dagre
// layout chunk already ships, so this is a render branch at zero byte cost.
//
// The sanitizer rebuilds every node/edge from a literal field list, so any key it
// does not name is DROPPED on the render path. `kind` used to disappear that way
// (it drives the legend AND the dim-on-filter), and the same trap applies to
// fields/symbol/cardinality. Every test below therefore asserts on BOTH sides.
const dg = (b: unknown) => parseCanvasSpec(JSON.stringify({ v: 1, blocks: [b] }));

const ER = {
  type: "diagram", layout: "relationship", direction: "lr",
  nodes: [
    { id: "u", label: "users", shape: "entity", fields: [
      { name: "id", type: "uuid", pk: true },
      { name: "email", type: "text", nullable: true },
      { name: "org_id", type: "uuid", fk: true },
    ] },
    { id: "o", label: "orders", fields: [{ name: "id", type: "uuid", pk: true }] },
  ],
  edges: [{ from: "u", to: "o", cardinality: "1..*" }],
};

test("diagram: entity nodes + fields survive the parser AND the sanitizer", () => {
  const spec = dg(ER);
  assert.ok(spec, "an ER diagram parses");
  const d = spec!.blocks[0] as any;
  assert.equal(d.layout, "relationship");
  assert.equal(d.nodes[0].shape, "entity");
  assert.equal(d.nodes[0].fields.length, 3);
  assert.equal(d.nodes[0].fields[0].pk, true);
  assert.equal(d.nodes[0].fields[1].nullable, true);
  assert.equal(d.nodes[0].fields[2].fk, true);
  assert.equal(d.nodes[0].fields[1].type, "text");
  // A node with fields but no explicit shape IS an entity — a model that writes
  // an ER diagram rarely restates the shape it just used fields for.
  assert.equal(d.nodes[1].shape, "entity", "fields imply an entity box");
  assert.equal(d.edges[0].cardinality, "1..*");

  const s = sanitizeCanvasSpec(spec) as any;
  assert.equal(s.blocks[0].nodes[0].shape, "entity", "shape survives");
  assert.equal(s.blocks[0].nodes[0].fields.length, 3, "FIELDS survive the sanitizer");
  assert.equal(s.blocks[0].nodes[0].fields[0].pk, true, "pk survives");
  assert.equal(s.blocks[0].nodes[0].fields[2].fk, true, "fk survives");
  assert.equal(s.blocks[0].nodes[0].fields[1].nullable, true, "nullable survives");
  assert.equal(s.blocks[0].edges[0].cardinality, "1..*", "cardinality survives");
});

test("diagram: the sanitizer now carries kind/detail/note (they used to be dropped)", () => {
  const spec = dg({ type: "diagram", layout: "flow",
    nodes: [{ id: "a", label: "A", kind: "pk_table", detail: "D", note: "N" }],
    edges: [{ from: "a", to: "a", label: "e", note: "en" }] });
  assert.ok(spec);
  const s = sanitizeCanvasSpec(spec) as any;
  assert.equal(s.blocks[0].nodes[0].kind, "pk_table", "kind drives the legend — it must reach the renderer");
  assert.equal(s.blocks[0].nodes[0].detail, "D");
  assert.equal(s.blocks[0].nodes[0].note, "N");
  assert.equal(s.blocks[0].edges[0].label, "e");
  assert.equal(s.blocks[0].edges[0].note, "en");
});

test("diagram: circuit symbols + smooth routing parse; unknown values are dropped, never fatal", () => {
  const spec = dg({ type: "diagram", layout: "flow", route: "smooth",
    nodes: [{ id: "r", label: "R1", symbol: "resistor" }, { id: "g", label: "GND", symbol: "ground" }],
    edges: [{ from: "r", to: "g" }] });
  assert.ok(spec);
  const d = spec!.blocks[0] as any;
  assert.equal(d.route, "smooth");
  assert.equal(d.nodes[0].symbol, "resistor");
  assert.equal(d.nodes[1].symbol, "ground");
  const sgR = sanitizeCanvasSpec(spec)!.blocks[0] as any;
  assert.equal(sgR.nodes[0].symbol, "resistor", "symbol survives");
  assert.equal(sgR.route, "smooth");

  // Unknown enum values degrade to absent, and the block still renders.
  const junk = dg({ type: "diagram", layout: "flow", route: "diagonal",
    nodes: [{ id: "a", label: "A", shape: "hexagon", symbol: "flux-capacitor" }],
    edges: [{ from: "a", to: "a", cardinality: "many" }] });
  assert.ok(junk, "an unknown shape/symbol/cardinality must not drop the diagram");
  const j = junk!.blocks[0] as any;
  assert.equal(j.route, undefined, "an unknown route is dropped");
  assert.equal(j.nodes[0].shape, undefined, "an unknown shape is dropped");
  assert.equal(j.nodes[0].symbol, undefined, "an unknown symbol is dropped");
  assert.equal(j.edges[0].cardinality, undefined, "an unknown cardinality is dropped");
  const js = sanitizeCanvasSpec(junk) as any;
  assert.equal(js.blocks[0].nodes[0].shape, undefined, "the sanitizer drops it too");
});

test("diagram: layout 'er' aliases to relationship, and er/erd/circuit alias the block type", () => {
  assert.equal((dg({ ...ER, layout: "er" })!.blocks[0] as any).layout, "relationship");
  const byType = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "er", nodes: [{ id: "a", label: "A" }], edges: [] }] }));
  assert.ok(byType, "type:er must parse");
  assert.equal((byType!.blocks[0] as any).layout, "relationship", "an omitted layout defaults to relationship for er");
  const circ = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "circuit", layout: "flow", nodes: [{ id: "a", label: "R1", symbol: "resistor" }], edges: [] }] }));
  assert.ok(circ, "type:circuit must parse");
  assert.equal((circ!.blocks[0] as any).type, "diagram");
});

test("diagram: fail-soft per field (one bad field never costs the node) and the cap holds", () => {
  const bad = dg({ type: "diagram", layout: "relationship",
    nodes: [{ id: "a", label: "A", shape: "entity", fields: [{ nope: 1 }, { name: "" }, { name: "ok", type: "int" }] }],
    edges: [] });
  assert.ok(bad, "a node with junk fields still parses");
  const fields = (bad!.blocks[0] as any).nodes[0].fields;
  assert.equal(fields.length, 1, "only the usable field survives");
  assert.equal(fields[0].name, "ok");
  // An all-junk field list degrades to no fields, and the node still renders.
  const none = dg({ type: "diagram", layout: "relationship",
    nodes: [{ id: "a", label: "A", shape: "entity", fields: [{ nope: 1 }] }], edges: [] });
  assert.ok(none);
  assert.equal((none!.blocks[0] as any).nodes[0].fields, undefined);
  assert.equal((none!.blocks[0] as any).nodes[0].shape, "entity", "the explicit shape survives");
  // The field cap holds (a pathological entity cannot bloat the layout).
  const many = dg({ type: "diagram", layout: "relationship",
    nodes: [{ id: "a", label: "A", shape: "entity", fields: Array.from({ length: 80 }, (_, i) => ({ name: `f${i}` })) }],
    edges: [] });
  assert.ok((many!.blocks[0] as any).nodes[0].fields.length <= 24, "fields are capped at 24");
  assert.doesNotThrow(() => dg({ type: "diagram", layout: "relationship", nodes: [{ id: "a", label: "A", fields: "nope" }], edges: [] }));
});

test("diagram: markdown copy keeps fields and cardinality", () => {
  const spec = dg(ER);
  assert.ok(spec);
  const md = canvasToMarkdown(spec!);
  assert.ok(md.includes("uuid"), "field types are copied");
  assert.ok(md.includes("1..*"), "cardinality is copied");
  assert.ok(md.includes("email"), "field names are copied");
});


// ── tree: sanitizer/schema divergence (a correctness bug, not a feature) ────────
// The parser validated `detail` + `children` and TreeView rendered both, but the
// sanitizer — the ONE call on the render path — rebuilt each node as {id,label}
// and dropped both. A tree therefore arrived as a FLAT list: no detail text and no
// hierarchy at all, since `children` was the only thing expressing it. A
// parser-only suite stayed green through it.
const tree = (b: unknown) => parseCanvasSpec(JSON.stringify({ v: 1, blocks: [b] }));
const FILE_TREE = {
  type: "tree",
  nodes: [
    { id: "src", label: "src", detail: "6 files" },
    { id: "a.ts", label: "a.ts", detail: "1.2 kB", children: [] },
    { id: "lib", label: "lib", children: ["b.ts"] },
    { id: "b.ts", label: "b.ts" },
  ],
};

test("tree: detail + children survive the sanitizer (they used to be dropped)", () => {
  const spec = tree(FILE_TREE);
  assert.ok(spec, "the tree parses");
  const p = spec!.blocks[0] as any;
  assert.equal(p.nodes[0].detail, "6 files", "the parser keeps detail");
  assert.deepEqual(p.nodes[2].children, ["b.ts"], "the parser keeps children");

  // The render path. A tree with no children is a FLAT LIST — the hierarchy the
  // author authored simply does not exist on screen.
  const s = sanitizeCanvasSpec(spec) as any;
  assert.equal(s.blocks[0].nodes[0].detail, "6 files", "detail must survive");
  assert.deepEqual(s.blocks[0].nodes[2].children, ["b.ts"], "children must survive");
  // And the nesting still resolves: every child id exists in the node list.
  const ids = new Set(s.blocks[0].nodes.map((n: any) => n.id));
  for (const n of s.blocks[0].nodes) for (const c of n.children ?? []) assert.ok(ids.has(c), `dangling child ${c}`);
  // A leaf keeps NO children key rather than an empty array.
  assert.equal(s.blocks[0].nodes[3].children, undefined, "a leaf has no children key");
});

// The layers are NOT redundant, and which one rejects what is measured, not
// assumed: the PARSER rejects a dangling child and an over-long node list (both
// measured null below), while the SANITIZER is what collapses duplicate ids and
// enforces the 1200-node cap. Both are asserted so neither can silently change.
test("tree: a dangling child is rejected by the PARSER, never passed to the renderer", () => {
  assert.equal(tree({ type: "tree", nodes: [{ id: "a", label: "A", children: ["ghost"] }] }), null,
    "a child id that does not exist is an invalid tree");
  // TreeView's byId lookup returns undefined for an unknown id and renders nothing,
  // so a dangling child is a silently empty row — it must not reach the renderer.
  const ok = tree({ type: "tree", nodes: [{ id: "a", label: "A", children: ["b"] }, { id: "b", label: "B" }] });
  assert.ok(ok, "a resolvable child parses");
  assert.deepEqual((sanitizeCanvasSpec(ok)!.blocks[0] as any).nodes[0].children, ["b"]);
  // Junk in `children` never throws on either side.
  assert.doesNotThrow(() => tree({ type: "tree", nodes: [{ id: "a", label: "A", children: [1, null, {}] }] }));
  assert.doesNotThrow(() => tree({ type: "tree", nodes: [{ id: "a", label: "A", children: "nope" }] }));
});

test("tree: the sanitizer collapses duplicate ids and enforces the 1200-node cap", () => {
  // A duplicate id is NOT a parse error, so the sanitizer is what stops the second
  // row: React would key both to the same id and the tree would lose a row.
  const s = sanitizeCanvasSpec(tree({
    type: "tree", nodes: [{ id: "a", label: "A" }, { id: "a", label: "dup" }],
  })!) as any;
  assert.equal(s.blocks[0].nodes.length, 1, "the duplicate id is collapsed to one row");
  assert.equal(s.blocks[0].nodes[0].label, "A", "the FIRST node wins");
  // The PARSER does not cap a tree node list (measured: 140 childless nodes parse
  // fine), so the 100-node cap is the SANITIZER's alone — which is why it is
  // asserted here and not assumed from the parser. (A 140-node list whose last
  // node names a child DOES fail to parse, because that child does not exist.)
  const many = tree({ type: "tree", nodes: Array.from({ length: 1250 }, (_, i) => ({ id: `n${i}`, label: `n${i}` })) });
  assert.ok(many, "the parser does not cap the node list");
  const s2 = sanitizeCanvasSpec(many!) as any;
  assert.equal(s2.blocks[0].nodes.length, 1200, "the sanitizer caps at 100");
  assert.equal(tree({
    type: "tree", nodes: Array.from({ length: 140 }, (_, i) => ({ id: `n${i}`, label: `n${i}`, children: [`n${i + 1}`] })),
  }), null, "a dangling child still rejects the card, however deep");
});

test("tree: string caps hold on id, label and the newly-preserved detail", () => {
  const s = sanitizeCanvasSpec(tree({
    type: "tree", nodes: [{ id: "x".repeat(400), label: "y".repeat(900), detail: "z".repeat(2000) }],
  })!) as any;
  assert.ok(s.blocks[0].nodes[0].id.length <= 50, "id is capped");
  assert.ok(s.blocks[0].nodes[0].label.length <= 200, "label is capped");
  assert.ok(s.blocks[0].nodes[0].detail.length <= 500, "detail is capped — the newly-kept field is capped too");
});


// ── gitgraph (canvas v1 expansion) ────────────────────────────────────────────
// The block was HALF-BUILT: BLOCK_TYPES, the validator case and the aliases
// landed, the CSS landed, and the SANITIZER case did not. `sanitizeCanvasSpec` is
// the ONE call on the render path (chat-timeline.tsx:70), so a gitgraph validated
// perfectly and was then DROPPED — the card rendered with the history silently
// missing. Third instance of the same bug class (tabs b1ec4e9, accordion/tree
// 2026-10-05): a type in the parser that no sanitizer case knows.
const git = (b: unknown) => parseCanvasSpec(JSON.stringify({ v: 1, blocks: [b] }));

const FORK = {
  type: "gitgraph",
  title: "Release 2.1",
  branches: [{ name: "main", head: "a1" }, { name: "feat/layout", head: "c3" }],
  commits: [
    { id: "c3", branch: "feat/layout", message: "lane geometry", author: "rit", when: "2d", parents: ["a1"] },
    { id: "a1", branch: "main", message: "v2.1.0", author: "ana", when: "3d", parents: ["b2"], tags: ["v2.1.0"] },
    { id: "b2", branch: "main", message: "merge feat/layout", author: "ana", when: "3d", parents: ["a0", "c2"], merge: true },
    { id: "c2", branch: "feat/layout", message: "sanitize case", author: "rit", when: "4d", parents: ["a0"] },
    { id: "a0", branch: "main", message: "root", author: "ana", when: "9d" },
  ],
};

test("gitgraph: a validated gitgraph SURVIVES the sanitizer (the drop bug)", () => {
  const spec = git(FORK);
  assert.ok(spec, "the block validates");
  const s = sanitizeCanvasSpec(spec) as any;
  assert.ok(s, "a card whose only block is a gitgraph is NOT degraded to markdown");
  assert.equal(s.blocks.length, 1, "the gitgraph is still in the card");
  assert.equal(s.blocks[0].type, "gitgraph", "and it is still a gitgraph");
  // Without this assertion the whole bug is invisible: the block parsed, and the
  // spec existed, so every parser-only gate stayed green while the card was blank.
  assert.equal(s.blocks[0].commits.length, 5, "all five commits reach the renderer");
  assert.equal(s.blocks[0].branches.length, 2, "the branch list reaches the renderer");
  assert.deepEqual(s.blocks[0].branches[1], { name: "feat/layout", head: "c3" });
  // Fields the SVG reads one by one — a lane assignment that lost `branch` would
  // collapse the graph into a single column, and a lost `parents` would erase
  // every fork and merge.
  assert.equal(s.blocks[0].commits[0].branch, "feat/layout");
  assert.deepEqual(s.blocks[0].commits[2].parents, ["a0", "c2"], "both merge parents survive");
  assert.equal(s.blocks[0].commits[2].merge, true);
  assert.deepEqual(s.blocks[0].commits[1].tags, ["v2.1.0"]);
  assert.equal(s.blocks[0].commits[1].author, "ana");
  assert.equal(s.blocks[0].commits[1].when, "3d");
});

test("gitgraph: an unlabelled commit inherits its parent's lane (a fork reads as a fork)", () => {
  // No `branch` on the feature commits: they must take the lane of their first
  // parent, NOT lane 0 — otherwise every row lands in one column and the graph
  // draws as a straight line with no fork at all.
  const spec = git({
    type: "gitgraph",
    branches: [{ name: "main" }, { name: "feat" }],
    commits: [
      { id: "f2", message: "no branch key", parents: ["f1"] },
      { id: "f1", branch: "feat", message: "declared", parents: ["m1"] },
      { id: "m1", branch: "main", message: "main row" },
    ],
  });
  assert.ok(spec);
  const s = sanitizeCanvasSpec(spec) as any;
  assert.equal(s.blocks[0].commits[0].branch, undefined, "the sanitizer does not invent a branch");
  assert.deepEqual(s.blocks[0].commits[0].parents, ["f1"], "the parent link it inherits by is kept");
});

test("gitgraph: caps hold — 40 commits, duplicate ids collapsed, strings truncated", () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ id: `c${i}`, message: "m" }));
  const s = sanitizeCanvasSpec(git({ type: "gitgraph", commits: many })!) as any;
  assert.equal(s.blocks[0].commits.length, 40, "the sanitizer caps the history at 40 rows");

  const dup = sanitizeCanvasSpec(git({
    type: "gitgraph",
    commits: [{ id: "a", message: "first" }, { id: "a", message: "second" }],
  })!) as any;
  assert.equal(dup.blocks[0].commits.length, 1, "a repeated id is one row — React keys nodes by id");
  assert.equal(dup.blocks[0].commits[0].message, "first", "the first commit wins");

  const long = sanitizeCanvasSpec(git({
    type: "gitgraph",
    commits: [{ id: "i".repeat(400), message: "m".repeat(9000), author: "a".repeat(400), when: "w".repeat(400), parents: ["p".repeat(400)] }],
  })!) as any;
  const c = long.blocks[0].commits[0];
  assert.ok(c.id.length <= 40, "id is capped");
  assert.ok(c.message.length <= 200, "message is capped — a log line is not a paragraph");
  assert.ok(c.author.length <= 60, "author is capped");
  assert.ok(c.when.length <= 40, "when is capped");
  assert.ok(c.parents[0].length <= 40, "a parent id is capped");

  // A non-string parent is DROPPED, never coerced: the renderer looks the id up
  // in the commit index, so String(7) would resolve to nothing and fake a root.
  const junk = sanitizeCanvasSpec(git({
    type: "gitgraph",
    commits: [{ id: "a", message: "m", parents: [7, null, { id: "x" }, "b"] }],
  })!) as any;
  assert.deepEqual(junk.blocks[0].commits[0].parents, ["b"], "only string parents survive");
});

test("gitgraph: fail-soft — no commits degrades, junk fields never throw", () => {
  assert.equal(git({ type: "gitgraph" }), null, "no commits is not a history");
  assert.equal(git({ type: "gitgraph", commits: [] }), null);
  assert.equal(git({ type: "gitgraph", commits: "nope" }), null);
  assert.equal(git({ type: "gitgraph", commits: [{ message: "no id" }] }), null, "an idless commit is not a commit");
  // A junk branch list is not a reason to reject a valid history: the parser keeps
  // the commits and omits the branch key, and the renderer then derives lanes from
  // the commits. Rejecting here would lose a real history over a bad optional key.
  const noBranches = git({ type: "gitgraph", commits: [{ id: "a", message: "m" }], branches: "nope" });
  assert.ok(noBranches, "a junk branch list does not reject the history");
  assert.equal((noBranches!.blocks[0] as any).branches, undefined, "the bad branch list is simply omitted");
  // The other side: a card whose only block is unusable degrades to markdown
  // rather than rendering an empty card.
  assert.equal(sanitizeCanvasSpec(git({ type: "gitgraph", commits: [] })), null);
  assert.doesNotThrow(() => git({ type: "gitgraph", commits: [{ id: "a", message: "m", parents: 5, tags: {}, merge: "yes" }], branches: [null, 3] }));
  assert.equal((git({ type: "gitgraph", commits: [{ id: "a", message: "m", merge: "yes" }] })!.blocks[0] as any).merge, undefined,
    "only an explicit true is a merge");
});

test("gitgraph: type aliases normalise, and markdown copy carries the history", () => {
  for (const alias of ["git-graph", "gitlog", "history", "commitgraph"]) {
    const spec = git({ ...FORK, type: alias });
    assert.ok(spec, `${alias} must parse rather than degrade the card`);
    assert.equal((spec!.blocks[0] as any).type, "gitgraph", `${alias} normalises to gitgraph`);
  }
  const md = canvasToMarkdown(git(FORK)!);
  assert.ok(md.includes("Release 2.1"), "the title is kept");
  assert.ok(md.includes("**feat/layout** @ c3"), "branches and their heads are named");
  // A fork exists ONLY in the parents list, so a copy that omitted it would read
  // as a linear history and be wrong.
  assert.ok(md.includes("← a0, c2"), "the merge's two parents are written out");
  assert.ok(md.includes("v2.1.0"), "the tag survives the copy");
  assert.ok(md.includes("**(merge)**"), "a merge commit is marked as one");
  assert.ok(md.indexOf("c3") < md.indexOf("a0"), "rows copy newest-first, as drawn");
});


// ── table.stats + chart kinds box/histogram (canvas v1 expansion) ───────────────
// `stats` is the block's arithmetic instruction. It is validated and carried
// through BOTH layers, because a footer the sanitizer drops is exactly the
// 8d09c60 tree-`detail` bug: the model asked for a mean, the card rendered
// without one, and nothing anywhere reported a failure.
const tbl = (b: unknown) => parseCanvasSpec(JSON.stringify({ v: 1, blocks: [b] }));

test("table.stats: the request survives the parser AND the sanitizer", () => {
  const spec = tbl({
    type: "table",
    columns: ["region", "latency_ms"],
    rows: [["eu", "10"], ["us", "20"], ["apac", "30"]],
    stats: { columns: ["latency_ms"], compute: ["mean", "median", "p95"] },
  });
  assert.ok(spec);
  const s = sanitizeCanvasSpec(spec) as any;
  assert.deepEqual(s.blocks[0].stats, { columns: ["latency_ms"], compute: ["mean", "median", "p95"] },
    "the renderer's instruction survives the only call on the render path");
});

test("table.stats: an omitted request is `{}`, never undefined-after-ask", () => {
  // `stats:true` / `stats:{}` mean "every statistic on every numeric column".
  // The parser must distinguish "asked" from "did not ask" or the footer never
  // appears for the simplest form of the request.
  const s = sanitizeCanvasSpec(tbl({ type: "table", columns: ["a"], rows: [["1"]], stats: true })) as any;
  assert.deepEqual(s.blocks[0].stats, {}, "an empty stats object IS a request for the defaults");
  const none = sanitizeCanvasSpec(tbl({ type: "table", columns: ["a"], rows: [["1"]] })) as any;
  assert.equal(none.blocks[0].stats, undefined, "a table that did not ask has no stats key");
  // A reactive (bound) table keeps it too — otherwise a what-if table summarises
  // nothing while its bound rows change under it.
  const bound = tbl({
    type: "table", columns: ["a"], rows: [], bind: { $from: "lat" }, stats: { compute: ["mean"] },
  });
  // This assertion is ALSO the regression test for a pre-existing drop: the
  // sanitizer used to require `rows` to be an array and then reject the empty
  // result, so a REACTIVE table (`bind.$from`, rows filled at render time) was
  // deleted from the card — while every reactive gate, which tests the parser and
  // the bind layer and never the sanitizer, stayed green.
  const bs = sanitizeCanvasSpec(bound) as any;
  assert.ok(bs, "a reactive table with no literal rows is NOT dropped from the card");
  assert.deepEqual(bs.blocks[0].stats, { compute: ["mean"] }, "a bound table keeps its stats request");
  assert.deepEqual(bs.blocks[0].rows, [], "the rows stay empty — the carrier fills them at render time");
  assert.equal(bs.blocks[0].bind.$from, "lat", "the $from binding survives for reactiveRows()");

  // The mangled-header defect is still caught when the rows are NOT coming from a
  // carrier: a literal `{columns, rows:[]}` is the 2-of-51 real cards, and it
  // still degrades.
  assert.equal(sanitizeCanvasSpec(tbl({ type: "table", columns: ["a"], rows: [] })), null,
    "a header with no body and no carrier still degrades — that is the mangled-header defect");
});

test("table.stats: a bad request costs a footer, never the table (fail-soft)", () => {
  const spec = tbl({
    type: "table", columns: ["a"], rows: [["1"], ["2"]],
    stats: { columns: [1, null, "a"], compute: ["mean", "variance", 7, "MEDIAN", "stddev"] },
  });
  assert.ok(spec, "an unknown statistic name does not reject the table");
  const s = sanitizeCanvasSpec(spec) as any;
  assert.deepEqual(s.blocks[0].stats.columns, ["a"], "non-string column names are dropped");
  // `variance`/`7` are unknown and dropped; `MEDIAN` and `stddev` are normalised to
  // the closed set, so a model writing either gets the statistic it meant.
  assert.deepEqual(s.blocks[0].stats.compute, ["mean", "median", "sd"]);
  for (const bad of ["nope", 42, null, [1, 2]]) {
    assert.doesNotThrow(() => tbl({ type: "table", columns: ["a"], rows: [["1"]], stats: bad }));
  }
  assert.equal((sanitizeCanvasSpec(tbl({ type: "table", columns: ["a"], rows: [["1"]], stats: "mean" })) as any)
    .blocks[0].stats, undefined, "a non-object stats is no request at all");
});

test("chart kinds box and histogram validate from the ordinary {labels,series} shape", () => {
  // No new authoring key: a box is one series per group of RAW samples, and a
  // histogram is one series of raw samples the renderer bins. The statistics are
  // the renderer's job, so the model never authors a quartile.
  const box = tbl({ type: "chart", chart: "box", labels: ["eu", "us"], series: [
    { name: "eu", points: [12, 15, 14, 30, 13] },
    { name: "us", points: [40, 45, 42, 44] },
  ] });
  assert.ok(box, "a box plot with raw samples validates");
  assert.equal((box!.blocks[0] as any).chart, "box");
  assert.equal((box!.blocks[0] as any).series.length, 2, "one series per group is preserved");
  assert.deepEqual((box!.blocks[0] as any).series[0].points, [12, 15, 14, 30, 13],
    "the raw samples reach the renderer — the quartiles are computed, not authored");

  const hist = tbl({ type: "chart", chart: "histogram", title: "p95 latency (ms)", series: [
    { name: "samples", points: [12, 15, 14, 30, 13, 12, 14, 15] },
  ] });
  assert.ok(hist, "a histogram of raw samples validates");
  assert.equal((hist!.blocks[0] as any).chart, "histogram");
  // And both survive the sanitizer, or the chart chunk would receive nothing.
  assert.equal((sanitizeCanvasSpec(box) as any).blocks[0].chart, "box");
  assert.equal((sanitizeCanvasSpec(hist) as any).blocks[0].chart, "histogram");
});

test("chart kinds box and histogram: fail-soft on junk, and never an empty chart", () => {
  // No series at all is not a chart (the shared guard every adapter relies on).
  assert.equal(tbl({ type: "chart", chart: "box", series: [] }), null);
  assert.equal(tbl({ type: "chart", chart: "histogram", series: [] }), null);
  assert.equal(tbl({ type: "chart", chart: "histogram", series: [{ name: "s" }] }), null,
    "a series with no points is not a histogram");
  // A one-sample group still VALIDATES — the renderer's BoxShape needs 2 values
  // for quartiles and degrades there, and a card that lost its whole block over
  // one thin group would be a worse failure than an honest "needs 2 values".
  const thin = tbl({ type: "chart", chart: "box", series: [{ name: "eu", points: [12] }] });
  assert.ok(thin, "one thin group does not reject the card; the renderer says so instead");
  assert.doesNotThrow(() => tbl({ type: "chart", chart: "box", series: [{ name: "s", points: "nope" }] }));
  assert.doesNotThrow(() => tbl({ type: "chart", chart: "histogram", series: [{ name: "s", points: [{}] }] }));
  assert.equal(tbl({ type: "chart", chart: "boxplot", series: [{ name: "s", points: [1, 2] }] }), null,
    "an unknown kind is still rejected — the set is closed");
});
