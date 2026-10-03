import { test } from "node:test";
import assert from "node:assert/strict";
import { splitCanvasBlocks, parseCanvasSpec, hasCanvas, planTurnCanvases } from "./canvas-schema.ts";

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
  const donut = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "donut", series: [{ name: "s", points: [1] }] }] }));
  assert.equal((donut!.blocks[0] as any).chart, "pie");
  const bars = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "graph", chart: "columns", series: [{ name: "s", points: [1] }] }] }));
  assert.equal((bars!.blocks[0] as any).type, "chart");
  assert.equal((bars!.blocks[0] as any).chart, "bar");
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

// Fail-soft must survive the new paths: nonsense still degrades, never throws.
test("the coercer never turns junk into a canvas", () => {
  assert.equal(parseCanvasSpec("not json at all"), null);
  assert.equal(parseCanvasSpec('{"type":"hologram"}'), null);
  assert.equal(parseCanvasSpec('{"v":1,"blocks":[]}'), null);
  assert.equal(parseCanvasSpec(""), null);
  assert.equal(parseCanvasSpec("[]"), null);
});
