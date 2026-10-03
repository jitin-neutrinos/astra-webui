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
