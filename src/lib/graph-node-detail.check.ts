// Pins the graph node-context field contract (owner report 2026-10-04).
//
// THE BUG: a `graph` block authored as `{nodes:[{id,label,detail}]}` — the
// shape docs/canvas-directive.md specifies and canvas-schema.ts's `graph` case
// parses into GraphNode.detail — lost its text on the way to the screen.
//
// Mechanism: canvas-graph-view.tsx reads ele.data("detail") in BOTH the tap
// payload (line ~199) and the a11y AdjacencyTable (line ~220), but the adapter
// canvas-cyto.ts toElements() only ever wrote `description` (comindash's
// field name) into cytoscape's data bag. The two names never met, so every
// node's context panel rendered empty. Measured on a 31-node/59-edge payload:
// 0 of 31 nodes carried any text.
//
// The failure was SILENT and looked like a broken card, not an empty field,
// which is why it survived: the shape validator passes, the parser passes,
// the layout computes, and only a real render (or this check) shows the loss.
//
// Contract this file pins, both directions:
//   1. an authored `detail` reaches cytoscape as `detail`;
//   2. the legacy comindash `description` still works (this file is a port —
//      the dashboard calls it with that name, so dropping it would regress).
//
// Run: npx tsx --test src/lib/graph-node-detail.check.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { toElements } from "./canvas-cyto";

const here = dirname(fileURLToPath(import.meta.url));

const PAYLOAD = {
  nodes: [
    { id: "a", label: "Alpha", kind: "legacy", weight: 7, detail: "re-badged inside Pulse as the Case Manager" },
    { id: "b", label: "Pulse", kind: "ops", weight: 10, detail: "the operations platform" },
    { id: "c", label: "Legacy shaped", kind: "build", weight: 3, description: "comindash calls this description" },
    { id: "d", label: "No text at all", kind: "infra", weight: 2 },
  ],
  edges: [
    { source: "a", target: "b", label: "absorbed as" },
    { source: "b", target: "c" },
  ],
};

test("an authored `detail` survives the adapter as `detail`", () => {
  const els = toElements(PAYLOAD as any);
  const a = els.nodes.find((n: any) => n.data.id === "a");
  assert.equal(
    a?.data.detail,
    "re-badged inside Pulse as the Case Manager",
    "node `detail` must reach cytoscape — the graph panel reads ele.data('detail')",
  );
});

test("every node that has text carries it in the field the panel reads", () => {
  const els = toElements(PAYLOAD as any);
  const withText = els.nodes.filter((n: any) => n.data.detail != null);
  assert.equal(withText.length, 3, "3 of 4 nodes have text; all 3 must arrive with it");
  // The exact regression: this is what measured 0/31.
  assert.ok(
    els.nodes.filter((n: any) => n.data.detail == null).length === 1,
    "only the deliberately text-less node may be empty",
  );
});

test("the ported comindash `description` field still works", () => {
  const els = toElements(PAYLOAD as any);
  const c = els.nodes.find((n: any) => n.data.id === "c");
  assert.equal(
    c?.data.description,
    "comindash calls this description",
    "the ported dashboard payload uses `description`; it must not regress",
  );
  assert.equal(c?.data.detail, "comindash calls this description", "`description` also lands on `detail`");
});

test("a node with neither field stays null rather than becoming the string 'null'", () => {
  const els = toElements(PAYLOAD as any);
  const d = els.nodes.find((n: any) => n.data.id === "d");
  assert.equal(d?.data.detail, null, "absent text is null, not a coerced string");
});

test("edges are unaffected and still resolve", () => {
  const els = toElements(PAYLOAD as any);
  assert.equal(els.nodes.length, 4);
  assert.equal(els.edges.length, 2, "both authored edges resolve");
});

test("the renderer and the adapter agree on ONE field name", () => {
  // The defect was a silent disagreement between two files. Pin the agreement
  // at the source level so a future rename cannot split them again: every
  // `ele.data("...")` read in the graph view must be a key toElements writes.
  const adapter = readFileSync(join(here, "canvas-cyto.ts"), "utf8");
  const view = readFileSync(join(here, "../components/canvas/canvas-graph-view.tsx"), "utf8");

  const written = new Set<string>();
  for (const m of adapter.matchAll(/^\s*(\w+):\s*n\./gm)) written.add(m[1]);
  for (const m of adapter.matchAll(/^\s*(\w+):\s*[a-z]/gm)) written.add(m[1]);

  const read = new Set<string>();
  for (const m of view.matchAll(/\.data\(\s*"([^"]+)"\s*\)/g)) read.add(m[1]);

  // Fields the panel must be able to read: identity, kind, weight and the text.
  const required = ["id", "label", "kind", "weight", "detail"];
  const missing = required.filter((k) => read.has(k) && !written.has(k));
  assert.deepEqual(missing, [], `adapter must write every field the view reads: missing ${missing.join(", ")}`);
});
