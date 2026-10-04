// Self-check for the graph block's layout maths (node-safe: no React, no DOM).
// Run: npx tsx --test src/lib/canvas-graph.check.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { layout, buildAdjacency, nodeRadius, edgeWidth, seedPosition, truncate } from "./canvas-force.ts";
import { toElements } from "./canvas-cyto.ts";
import { parseCanvasSpec } from "./canvas-schema.ts";

const G: any = {
  nodes: [
    { id: "a", label: "Alpha", kind: "product", weight: 90 },
    { id: "b", label: "Beta", kind: "person", weight: 40 },
    { id: "c", label: "Gamma", kind: "person", weight: 10 },
    { id: "d", label: "Delta", kind: "concept", weight: 25 },
    { id: "e", label: "Epsilon", weight: 5 },
  ],
  edges: [
    { source: "a", target: "b", weight: 9 },
    { source: "b", target: "c", weight: 4 },
    { source: "a", target: "d", kind: "asserted", weight: 0.9 },
    { source: "c", target: "e", weight: 2 },
  ],
};

test("layout is deterministic (same graph → same picture)", () => {
  const a = layout(G.nodes as any, G.edges as any);
  const b = layout(G.nodes as any, G.edges as any);
  assert.deepEqual(a.nodes.map((n: any) => [n.x, n.y]), b.nodes.map((n: any) => [n.x, n.y]));
  assert.deepEqual(a.edges.map((e: any) => [e.x1, e.y1, e.x2, e.y2]), b.edges.map((e: any) => [e.x1, e.y1, e.x2, e.y2]));
});

test("layout is seedless-stable: no NaN, inside the frame, non-degenerate", () => {
  const { nodes } = layout(G.nodes as any, G.edges as any);
  for (const n of nodes) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), `${n.id} has finite coords`);
    assert.ok(n.x >= -1 && n.x <= 1001 && n.y >= -1 && n.y <= 661, `${n.id} inside the frame`);
    assert.ok(n.r >= 9 && n.r <= 24.1, `${n.id} radius in range`);
  }
  const spanX = Math.max(...nodes.map((n: any) => n.x)) - Math.min(...nodes.map((n: any) => n.x));
  assert.ok(spanX > 100, `nodes spread out (spanX=${spanX.toFixed(0)})`);
});

test("radius tracks AREA (sqrt) and edge width is log-scaled (ported scales)", () => {
  assert.ok(nodeRadius(1, 100) < nodeRadius(25, 100) && nodeRadius(25, 100) < nodeRadius(100, 100));
  // quadrupling weight must NOT double the radius (that would square the area)
  assert.ok(nodeRadius(4, 100) < nodeRadius(1, 100) * 2.01);
  // upstream's exact scale: radius 8.70 → 24.00, edge width 1.14 → 4.20
  assert.ok(Math.abs(nodeRadius(1, 100) - 8.7) < 0.01 && Math.abs(nodeRadius(100, 100) - 24) < 0.01);
  assert.ok(edgeWidth(1, 1000) >= 1.1 && edgeWidth(1000, 1000) <= 4.25);
});

test("the ported element adapter drops a dangling edge and stamps positions", () => {
  const els = toElements({ nodes: G.nodes, edges: [...G.edges, { source: "a", target: "ghost" }] } as any);
  assert.equal(els.nodes.length, 5);
  assert.equal(els.edges.length, 4, "the edge to a missing node is dropped, not fatal");
  for (const n of els.nodes) {
    assert.ok(Number.isFinite(n.position.x) && Number.isFinite(n.position.y), `${n.data.id} got a preset position`);
  }
  // kinds are carried through for the renderer's shape/tier split
  assert.ok(els.nodes.every((n: any) => typeof n.data.kind === "string" || n.data.kind === undefined));
});



test("dangling edges are dropped, not fatal", () => {
  const { edges, nodes } = layout(G.nodes as any, [...G.edges, { source: "a", target: "ghost" } as any]);
  assert.equal(nodes.length, 5);
  assert.equal(edges.length, 4, "the edge to a missing node is dropped");
});

test("adjacency + component counting", () => {
  const { edges } = layout(G.nodes as any, G.edges as any);
  const adj = buildAdjacency(edges);
  assert.ok(adj.get("a")!.has("b"));
  assert.ok(adj.get("b")!.has("c"));
});

test("empty and single-node graphs are safe", () => {
  assert.deepEqual(layout([], [] as any), { nodes: [], edges: [], maxWeight: 1, maxEdge: 1 });
  const one = layout([{ id: "solo", label: "Solo" }] as any, [] as any);
  assert.equal(one.nodes.length, 1);
  assert.ok(Number.isFinite(one.nodes[0].x));
  // …and the element adapter agrees (a lone node renders, it does not throw)
  assert.equal(toElements({ nodes: [{ id: "solo", label: "Solo" }], edges: [] } as any).nodes.length, 1);
});

test("seed spread is deterministic and covers the frame", () => {
  const pts = Array.from({ length: 12 }, (_, i) => seedPosition(i, 12, 1000, 660));
  const again = Array.from({ length: 12 }, (_, i) => seedPosition(i, 12, 1000, 660));
  assert.deepEqual(pts, again);
  assert.ok(pts.every((p: any) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.equal(truncate("abcdefghij", 5), "abcd…");
  assert.equal(truncate("abc", 5), "abc");
});

test("schema accepts a graph block and rejects a malformed one", () => {
  const ok = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "graph", nodes: G.nodes, edges: G.edges }] }));
  assert.ok(ok, "valid graph parses");
  assert.equal(ok!.blocks[0].type, "graph");
  // dangling edge inside the payload is dropped, block survives
  const withDangling = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "graph", nodes: G.nodes, edges: [{ source: "a", target: "zz" }] }] }));
  assert.ok(withDangling, "block survives a dangling edge");
  assert.equal((withDangling!.blocks[0] as { edges: unknown[] }).edges.length, 0);
  // no nodes → invalid block → whole canvas degrades
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "graph", nodes: [], edges: [] }] })), null);
  // near-miss alias resolves
  assert.ok(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "knowledge-graph", nodes: G.nodes, edges: [] }] })));
});
// ── v5 chart kinds ────────────────────────────────────────────────────────────
// The four new kinds ride the already-installed recharts. These pin the DATA
// contract: the natural per-chart vocabulary (sankey nodes/links, treemap items,
// funnel stages) must normalize to the canonical {labels, series[]} shape, and a
// genuinely broken one must still degrade rather than render garbage.

test("new chart kinds accept their natural vocabulary", () => {
  const funnel = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "funnel", stages: [{ label: "Visits", value: 1000 }, { label: "Signup", value: 120 }] }] }));
  assert.ok(funnel, "funnel with `stages` parses");
  const fb = funnel!.blocks[0] as { labels?: string[]; series: { points: number[]; items?: unknown[] }[] };
  assert.deepEqual(fb.labels, ["Visits", "Signup"]);
  assert.deepEqual(fb.series[0].points, [1000, 120]);
  assert.equal(fb.series[0].items?.length, 2, "items carried for the cell renderer");

  const treemap = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "treemap", items: [{ name: "src", value: 50 }, { name: "docs", value: 30 }] }] }));
  assert.ok(treemap, "treemap with `items` parses");

  const sankey = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "sankey", nodes: [{ id: "a" }, { id: "b" }], links: [{ source: "a", target: "b", value: 5 }] }] }));
  assert.ok(sankey, "sankey with nodes+links parses");
  const sb = sankey!.blocks[0] as { labels?: string[]; series: { points: number[] }[] };
  assert.deepEqual(sb.labels, ["a", "b"]);

  const scatter = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "scatter", labels: ["x", "y"], series: [{ name: "s", points: [1, 4] }] }] }));
  assert.ok(scatter, "scatter parses on the canonical shape");
  const radar = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "radar", labels: ["a", "b"], series: [{ name: "s", points: [3, 5] }] }] }));
  assert.ok(radar, "radar parses");
});

test("new chart kinds still fail-soft on garbage", () => {
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "funnel", stages: [{ label: "x" }] }] })), null, "a stage with no value rejects");
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "sankey" }] })), null, "sankey with nothing rejects");
  // canonical series + a NEW kind still works (the common emission shape)
  assert.ok(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "scatter", labels: ["a"], series: [{ name: "s", points: [1] }] }] })));
});

test("new chart kinds alias their near-miss names", () => {
  const conv = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "conversion", stages: [{ label: "a", value: 1 }] }] }));
  assert.equal((conv!.blocks[0] as { chart: string }).chart, "funnel");
  const bub = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "bubble", labels: ["a"], series: [{ name: "s", points: [1] }] }] }));
  assert.equal((bub!.blocks[0] as { chart: string }).chart, "scatter");
  const flow = parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "flow", stages: [{ label: "a", value: 1 }] }] }));
  assert.equal((flow!.blocks[0] as { chart: string }).chart, "sankey");
});

// ── renderer contracts (owner 2026-10-04) ───────────────────────────────────
// Two bugs blanked an ENTIRE card from a single malformed block, and one made
// the graph render with no connections at all. Each is pinned here because the
// symptom ("funnel shows no chart", "no connecting lines") is far from the cause.

// A chart with no series must DEGRADE to a message, not throw inside render:
// every adapter in canvas-chart reads series[0], so one empty block took the
// whole canvas down (React error #31 / a TypeError in the parser fallback).
test("a chart with no series degrades instead of vanishing the card", () => {
  assert.equal(parseCanvasSpec(JSON.stringify({ v: 1, blocks: [{ type: "chart", chart: "line" }] })), null,
    "a chart with no series is invalid and must not reach the renderer");
  // …and a sankey keeps its LINKS (nivo needs nodes+links, not a column sort)
  const sk = parseCanvasSpec(JSON.stringify({
    v: 1,
    blocks: [{ type: "chart", chart: "sankey", nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
      links: [{ source: "a", target: "b", value: 10 }, { source: "b", target: "c", value: 6 }] }],
  }));
  assert.ok(sk, "sankey parses");
  const series = (sk!.blocks[0] as { series: { points: number[]; links?: unknown[] }[] }).series[0];
  assert.equal(series.points.length, 3, "one point per node");
  assert.equal(series.links?.length, 2, "the authored connections survive normalization");
});

// The graph renderer must add nodes AND edges in ONE collection: cytoscape's
// add() silently ignores a second argument, which rendered 9 isolated nodes and
// NO connecting lines (the owner's "relationship needs connecting lines" report).
test("graph elements carry BOTH nodes and edges into cytoscape", () => {
  const els = toElements({ nodes: G.nodes, edges: G.edges } as any);
  assert.equal(els.nodes.length, 5);
  assert.equal(els.edges.length, 4, "edges survive toElements — a dropped edge here is an invisible connection");
  const one = [...els.nodes, ...els.edges] as { data: { source?: string } }[];
  assert.equal(one.filter((e) => e.data.source !== undefined).length, 4,
    "every edge is addressable as a source/target pair");
});
