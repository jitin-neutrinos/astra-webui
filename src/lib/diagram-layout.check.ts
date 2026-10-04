// The no-overlap audit for the pure diagram layout (RG-071).
//
// The bug this pins: the v5 diagram laid nodes out in DOM flex columns and drew
// edges from live getBoundingClientRect(), then NUDGED labels out of the way —
// a search, not a guarantee, and it capped layering at 8 passes, so a deep flow
// collapsed. Measured over 600 seeded random graphs that approach cannot be made
// airtight.
//
// The audit below is INDEPENDENT of the layout code: it only reads the output
// rectangles / polylines / label boxes and counts violations of every class.
// Ported verbatim from scratch/canvas-v6/ref/diagram-audit.ref.mjs.
//
// Run: node --import ./scripts/ts-resolve.mjs src/lib/diagram-layout.check.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { layoutDiagram, type DiagramLayout } from "./diagram-layout.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, "diagram-fixtures");

// ── audit (verbatim from the reference; do not "simplify") ─────────────────────

const EPS = 0.5;
const ov = (a: Box, b: Box) =>
  !(a.x + a.w <= b.x + EPS || b.x + b.w <= a.x + EPS || a.y + a.h <= b.y + EPS || b.y + b.h <= a.y + EPS);

interface Box { x: number; y: number; w: number; h: number }
interface Pt { x: number; y: number }

/** true if the AXIS-ALIGNED segment p→q passes through the open interior of r; "diag" if it is not axis-aligned. */
export function segHits(p: Pt, q: Pt, r: Box): boolean | "diag" {
  const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x), y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
  if (Math.abs(p.x - q.x) < 1e-6) return p.x > r.x + EPS && p.x < r.x + r.w - EPS && y1 > r.y + EPS && y0 < r.y + r.h - EPS;
  if (Math.abs(p.y - q.y) < 1e-6) return p.y > r.y + EPS && p.y < r.y + r.h - EPS && x1 > r.x + EPS && x0 < r.x + r.w - EPS;
  return "diag";
}

export interface Violations {
  nodeNode: number; labelNode: number; labelLabel: number; outOfBounds: number;
  edgeThroughNode: number; edgeThroughForeignLabel: number; diagonal: number; endpointOffBorder: number;
}

/** Every violation class, counted. All must be 0. */
export function auditLayout(out: DiagramLayout): Violations {
  const { nodes, labelBoxes: labels, bounds } = out;
  const v: Violations = {
    nodeNode: 0, labelNode: 0, labelLabel: 0, outOfBounds: 0,
    edgeThroughNode: 0, edgeThroughForeignLabel: 0, diagonal: 0, endpointOffBorder: 0,
  };
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (ov(nodes[i], nodes[j])) v.nodeNode++;
  for (const l of labels) {
    for (const n of nodes) if (ov(l, n)) v.labelNode++;
    for (const o of labels) if (o !== l && ov(l, o)) v.labelLabel++;
    if (l.x < -EPS || l.y < -EPS || l.x + l.w > bounds.w + EPS || l.y + l.h > bounds.h + EPS) v.outOfBounds++;
  }
  for (const n of nodes) if (n.x < -EPS || n.y < -EPS || n.x + n.w > bounds.w + EPS || n.y + n.h > bounds.h + EPS) v.outOfBounds++;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const onBorder = (p: Pt, n: Box) =>
    Math.abs(p.x - n.x) < 0.6 || Math.abs(p.x - (n.x + n.w)) < 0.6 || Math.abs(p.y - n.y) < 0.6 || Math.abs(p.y - (n.y + n.h)) < 0.6;
  for (const r of out.edges) {
    const seenN = new Set<string>(), seenL = new Set<number>();
    for (let k = 0; k + 1 < r.pts.length; k++) {
      for (const n of nodes) {
        // An edge may TOUCH its own endpoint nodes (it starts/ends on their border) but must never run through
        // their interior. This used to `continue` for endpoints, which hid a self-loop drawn through its own node.
        const h = segHits(r.pts[k], r.pts[k + 1], n);
        if (h === "diag") v.diagonal++; else if (h) seenN.add(n.id);
      }
      for (const l of labels) {
        if (l.i === r.i) continue;                      // its OWN label: masked by its chip, by design
        if (segHits(r.pts[k], r.pts[k + 1], l) === true) seenL.add(l.i);
      }
    }
    v.edgeThroughNode += seenN.size; v.edgeThroughForeignLabel += seenL.size;
    // every vertex of the route must lie inside the canvas, or the SVG clips the connector
    for (const p of r.pts) if (p.x < -EPS || p.y < -EPS || p.x > bounds.w + EPS || p.y > bounds.h + EPS) { v.outOfBounds++; break; }
    // a self-loop must start and end on its own node's border
    if (r.self) {
      const n = byId.get(r.e.from)!;
      if (!onBorder(r.pts[0], n)) v.endpointOffBorder++;
      if (!onBorder(r.pts[r.pts.length - 1], n)) v.endpointOffBorder++;
    }
    if (!r.self) {
      if (!onBorder(r.pts[0], byId.get(r.e.from)!)) v.endpointOffBorder++;
      if (!onBorder(r.pts[r.pts.length - 1], byId.get(r.e.to)!)) v.endpointOffBorder++;
    }
  }
  return v;
}

export const total = (v: Violations) => Object.values(v).reduce((a, b) => a + b, 0);
const ZERO: Violations = {
  nodeNode: 0, labelNode: 0, labelLabel: 0, outOfBounds: 0,
  edgeThroughNode: 0, edgeThroughForeignLabel: 0, diagonal: 0, endpointOffBorder: 0,
};

// ── seeded random graphs (deterministic, verbatim) ─────────────────────────────

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const WORDS = ["Gateway", "Auth", "Billing", "Search", "Queue", "Worker", "Cache", "Store", "Router", "Parser", "Planner", "Gate", "Canvas", "Notify", "Index", "Ledger", "Export", "Audit", "Scheduler", "Fetcher", "Ranker", "Mailer", "Sync", "Edge"];
const ELBL = ["reads", "writes", "calls", "emits", "retry", "ok", "fail", "async", "sync", "cache", "auth", "events"];

export function randomGraph(n: number, density: number, labelP: number, backP: number, seed: number) {
  const R = rng(seed);
  const nodes = Array.from({ length: n }, (_, i) => ({
    id: "n" + i,
    label: WORDS[i % WORDS.length] + (i >= WORDS.length ? " " + Math.floor(i / WORDS.length) : ""),
    ...(R() < 0.5 ? { detail: ["p95 120ms", "3 replicas", "owner: infra", "beta"][Math.floor(R() * 4)] } : {}),
  }));
  const edges: { from: string; to: string; label?: string }[] = [];
  const m = Math.round(n * density);
  for (let k = 0; k < m; k++) {
    let a = Math.floor(R() * n), b = Math.floor(R() * n);
    if (a === b) continue;
    if (a > b && R() > backP) [a, b] = [b, a];
    const e: { from: string; to: string; label?: string } = { from: "n" + a, to: "n" + b };
    if (R() < labelP) e.label = ELBL[Math.floor(R() * ELBL.length)];
    edges.push(e);
  }
  return { type: "diagram", layout: "flow", nodes, edges } as const;
}

const FIXTURES = readdirSync(FIX).filter((f) => f.endsWith(".json")).sort();
const DIRS = ["tb", "lr"] as const;

// ── tests ──────────────────────────────────────────────────────────────────────

test("the 5 stress fixtures audit to zero violations in both directions", () => {
  assert.equal(FIXTURES.length, 5, "all five fixtures ship with the repo");
  for (const f of FIXTURES) {
    const block = JSON.parse(readFileSync(join(FIX, f), "utf8"));
    for (const dir of DIRS) {
      const v = auditLayout(layoutDiagram(block, { dir }));
      // deepEqual, not `total(v) === 0`: a failure must NAME the class.
      assert.deepEqual(v, ZERO, `${f} ${dir}`);
    }
  }
});

test("200 seeded random graphs audit to zero violations", () => {
  for (const n of [6, 10, 14, 20, 24]) for (const dir of DIRS) for (let s = 1; s <= 20; s++) {
    const g = randomGraph(n, 1.3, 0.4, 0.15, s * 7919 + n);
    const v = auditLayout(layoutDiagram(g, { dir }));
    assert.deepEqual(v, ZERO, `random n=${n} ${dir} seed=${s}`);
  }
});

test("determinism: the same input produces byte-identical output", () => {
  const g = randomGraph(14, 1.3, 0.4, 0.15, 99);
  assert.equal(
    JSON.stringify(layoutDiagram(g, { dir: "tb" })),
    JSON.stringify(layoutDiagram(g, { dir: "tb" })),
  );
});

test("words are never split: a plain long word grows its node, a hex hash may break", () => {
  const word = "Pneumonoultramicroscopicsilicovolcanoconiosis"; // 45 chars, no separators
  const hash = "a3f9c2e18b7d4f60a9c5e2b1f0d8a47c";           // 34-char hex
  const out = layoutDiagram({
    nodes: [{ id: "w", label: word }, { id: "h", label: hash }],
    edges: [{ from: "w", to: "h" }],
  }, { dir: "tb", nodeWidthBudget: 96 });

  const wNode = out.nodes.find((n) => n.id === "w")!;
  assert.ok(wNode.label.join(" ").includes(word), "the plain word survives whole");
  assert.equal(wNode.label.length, 1, "the plain word is not split across lines");
  // The node simply grows rather than breaking the word.
  assert.ok(wNode.w > 96, `the node grew to fit the word, got ${wNode.w}`);

  const hNode = out.nodes.find((n) => n.id === "h")!;
  assert.equal(hNode.label.join(""), hash, "the hash characters are all still there, just re-flowed");
  assert.ok(hNode.label.length > 1, "a code-ish token MAY break by character");
});

test("exact-duplicate edges are dropped and a self-loop is flagged", () => {
  const out = layoutDiagram({
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    edges: [
      { from: "a", to: "b", label: "x" },
      { from: "a", to: "b", label: "x" },   // exact duplicate -> dropped
      { from: "a", to: "a" },              // self loop
    ],
  }, { dir: "tb" });

  assert.equal(out.edges.length, 2, "3 declared edges -> 2 after dropping the duplicate");
  const self = out.edges.find((e) => e.self);
  assert.ok(self, "the self-loop survives");
  assert.equal(self!.e.from, "a");
  assert.equal(self!.e.to, "a");
  // Dangling edges to unknown nodes are dropped rather than fatal.
  const withDangling = layoutDiagram({
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    edges: [{ from: "a", to: "b" }, { from: "a", to: "zz" }],
  }, { dir: "tb" });
  assert.equal(withDangling.edges.length, 1, "a dangling edge is dropped");
});

test("empty edges and a single node lay out without throwing, with positive bounds", () => {
  for (const dir of DIRS) {
    const solo = layoutDiagram({ nodes: [{ id: "a", label: "Only" }], edges: [] }, { dir });
    assert.equal(solo.nodes.length, 1);
    assert.equal(solo.edges.length, 0);
    assert.ok(solo.bounds.w > 0 && solo.bounds.h > 0, `${dir}: single-node bounds positive`);
    assert.deepEqual(auditLayout(solo), ZERO, `${dir}: single node audits clean`);

    const flat = layoutDiagram({
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
      edges: [],
    }, { dir });
    assert.equal(flat.nodes.length, 3);
    assert.ok(flat.bounds.w > 0 && flat.bounds.h > 0, `${dir}: no-edge bounds positive`);
    assert.deepEqual(auditLayout(flat), ZERO, `${dir}: no-edge graph audits clean`);
  }
});