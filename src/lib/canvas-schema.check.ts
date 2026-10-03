import { test } from "node:test";
import assert from "node:assert/strict";
import { splitCanvasBlocks, parseCanvasSpec, hasCanvas } from "./canvas-schema";

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
