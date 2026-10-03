// canvas-graph.ts — deterministic force layout for the `graph` block.
//
// PORTED from the comindash dashboard (`~/Work/Neutrinos/community-insights-dashboard/
// app/frontend/src/components/graph/forceGraph.js`), which ships the same physics
// against cytoscape. Three of its lessons are kept, one dependency is dropped:
//
// KEPT
//   • Deterministic seeding (golden-angle spiral, no Math.random) + synchronous
//     settle (sim.stop() then tick N) — a map that settles while you read it is a
//     worse map, and the same graph must always look the same so people build a
//     mental model of where things live.
//   • Node radius tracks AREA (sqrt of weight), edge width is log-scaled so one
//     huge pair cannot blow out the range.
//   • Focus dimming never removes anything: everything stays visible, at low
//     opacity, so a focused node never makes the rest of the graph vanish.
//
// DROPPED / CHANGED
//   • d3-force (5.7 kB) — ~90 lines of the same springs inline, so the block
//     costs zero bytes and no dependency.
//   • cytoscape (137 kB) — the renderer is hand-rolled SVG (see canvas-graph.tsx);
//     pan/zoom/focus are ~60 lines and the payload is tiny, which matters more
//     than the pinch gesture on a graph that fits in a chat card.
//
// Self-check: npx tsx --test src/lib/canvas-graph.check.ts
import type { GraphNode, GraphEdge } from "./canvas-schema";

export interface PlacedNode extends GraphNode {
  x: number;
  y: number;
  r: number;
  /** 0..1 normalised weight — drives size + opacity tier, never hue. */
  mass: number;
  tier: number;
}

export interface PlacedEdge extends GraphEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Radius from weight, sqrt so AREA tracks volume rather than radius. */
export function nodeRadius(weight: number, maxWeight: number): number {
  const t = Math.sqrt(Math.max(weight, 0) / Math.max(maxWeight, 1));
  return 9 + 15 * Math.min(t, 1);
}

/** Edge width, log-scaled: one huge pair cannot dominate the range. */
export function edgeWidth(weight: number, maxWeight: number): number {
  const t = Math.log1p(Math.max(weight, 0)) / Math.log1p(Math.max(maxWeight, 1));
  return 0.9 + 2.6 * Math.min(Math.max(t, 0), 1);
}

/** Golden-angle spiral seed — deterministic, well spread, zero RNG. */
export function seedPosition(index: number, total: number, w: number, h: number): { x: number; y: number } {
  const r = (Math.min(w, h) / 2.2) * Math.sqrt((index + 0.5) / Math.max(total, 1));
  const a = index * GOLDEN_ANGLE;
  return { x: w / 2 + r * Math.cos(a), y: h / 2 + r * Math.sin(a) };
}

interface Body extends GraphNode {
  fx: number;
  fy: number;
  vx: number;
  vy: number;
  r: number;
  mass: number;
}

/**
 * Run the layout to a settled state. Returns plain data — the caller never holds
 * mutable simulation objects in React state.
 */
export function layout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts: { width?: number; height?: number; ticks?: number } = {},
): { nodes: PlacedNode[]; edges: PlacedEdge[] } {
  const W = opts.width ?? 1000;
  const H = opts.height ?? 660;
  const TICKS = Math.min(Math.max(opts.ticks ?? 220, 40), 600);
  if (nodes.length === 0) return { nodes: [], edges: [] };

  const maxWeight = Math.max(...nodes.map((n) => n.weight ?? 1), 1);
  const maxEdge = Math.max(...edges.map((e) => e.weight ?? 1), 1);
  const byId = new Map<string, Body>();
  nodes.forEach((n, i) => {
    const seed = seedPosition(i, nodes.length, W, H);
    byId.set(n.id, { ...n, fx: seed.x, fy: seed.y, vx: 0, vy: 0, mass: 1, r: nodeRadius(n.weight ?? 1, maxWeight) });
  });

  const links = edges
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .map((e) => ({ e, s: byId.get(e.source)!, t: byId.get(e.target)! }));
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const l of links) { link(l.s.id, l.t.id); link(l.t.id, l.s.id); }

  // Springs: strong pairs pull tighter; asserted (analyst) edges keep a readable
  // gap so their dashed relation line has room to sit apart.
  const dist = links.map((l) =>
    l.e.kind === "asserted" ? 130 : 190 - 110 * Math.min((l.e.weight ?? 1) / maxEdge, 1));
  const strength = links.map((l) =>
    l.e.kind === "asserted" ? 0.2 : 0.04 + 0.34 * Math.min((l.e.weight ?? 1) / maxEdge, 1));

  const bodies = [...byId.values()];
  const charge = bodies.map((b) => -260 - 20 * b.r);
  const alpha = (tick: number) => 1 - tick / TICKS; // cooling schedule

  for (let tick = 0; tick < TICKS; tick++) {
    const a = alpha(tick);
    const fx = new Map<string, number>();
    const fy = new Map<string, number>();
    for (const b of bodies) { fx.set(b.id, 0); fy.set(b.id, 0); }

    // pairwise repulsion (n is bounded at 400 by the validator → 80k pairs max,
    // and only once per tick over a synchronous loop)
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const p = bodies[i], q = bodies[j];
        let dx = p.fx - q.fx, dy = p.fy - q.fy;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-4) { dx = (i % 7) - 3; dy = (j % 5) - 2; d2 = dx * dx + dy * dy; }
        const d = Math.sqrt(d2);
        void d;
        const rep = ((charge[i] + charge[j]) / 2) / d; // 1/d, d3's many-body falloff
        fx.set(p.id, fx.get(p.id)! + dx * rep);
        fy.set(p.id, fy.get(p.id)! + dy * rep);
        fx.set(q.id, fx.get(q.id)! - dx * rep);
        fy.set(q.id, fy.get(q.id)! - dy * rep);
      }
    }
    // springs
    links.forEach((l, i) => {
      const dx = l.t.fx - l.s.fx, dy = l.t.fy - l.s.fy;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const f = ((d - dist[i]) / d) * strength[i];
      fx.set(l.s.id, fx.get(l.s.id)! + dx * f);
      fy.set(l.s.id, fy.get(l.s.id)! + dy * f);
      fx.set(l.t.id, fx.get(l.t.id)! - dx * f);
      fy.set(l.t.id, fy.get(l.t.id)! - dy * f);
    });
    // Integrate. Velocity decay (0.6/tick) is what makes a force simulation
    // SETTLE; without it the nodes ring forever around the fixed point and the
    // spread stays tiny. Step is clamped for stability, not for style.
    const decay = 0.62;
    const step = 0.55 * (0.25 + a);
    for (const b of bodies) {
      b.vx = b.vx * decay + Math.max(-60, Math.min(60, fx.get(b.id)!)) * step;
      b.vy = b.vy * decay + Math.max(-60, Math.min(60, fy.get(b.id)!)) * step;
      b.fx += b.vx;
      b.fy += b.vy;
    }
    // ALL-PAIRS separation as a positional CONSTRAINT (d3 forceCollide's trick):
    // applied after integration, twice, over every pair — not just linked ones.
    // A force-based collide let unlinked nodes pile up and stack their labels.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const p = bodies[i], q = bodies[j];
          let dx = q.fx - p.fx, dy = q.fy - p.fy;
          let d = Math.sqrt(dx * dx + dy * dy);
          const min = p.r + q.r + 22;
          if (d >= min) continue;
          if (d < 1e-3) { dx = 1; dy = 0; d = 1; }
          const push = ((min - d) / d) * 0.5;
          p.fx -= dx * push; p.fy -= dy * push;
          q.fx += dx * push; q.fy += dy * push;
        }
      }
    }
  }

  // Normalise into the frame with a margin, aspect preserved.
  const pad = 54;
  const xs = bodies.map((b) => b.fx);
  const ys = bodies.map((b) => b.fy);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY, 1.5);
  const offX = (W - spanX * scale) / 2;
  const offY = (H - spanY * scale) / 2;

  // Kinds get an opacity tier (100/72/48%), NOT a hue — owner law.
  const kinds = [...new Set(bodies.map((b) => b.kind || "node"))];
  const placed: PlacedNode[] = bodies.map((b) => ({
    id: b.id,
    label: b.label,
    kind: b.kind,
    weight: b.weight ?? 1,
    detail: b.detail,
    x: (b.fx - minX) * scale + offX,
    y: (b.fy - minY) * scale + offY,
    r: b.r,
    mass: (b.weight ?? 1) / maxWeight,
    tier: b.kind ? Math.max(0, kinds.indexOf(b.kind || "node")) : 0,
  }));
  const pos = new Map(placed.map((n) => [n.id, n]));
  const drawn: PlacedEdge[] = [];
  for (const l of links) {
    const s = pos.get(l.s.id), t = pos.get(l.t.id);
    if (!s || !t) continue;
    drawn.push({
      source: l.s.id, target: l.t.id, kind: l.e.kind, label: l.e.label, weight: l.e.weight ?? 1,
      x1: s.x, y1: s.y, x2: t.x, y2: t.y, width: edgeWidth(l.e.weight ?? 1, maxEdge),
    });
  }
  return { nodes: placed, edges: drawn };
}

/** Adjacency: node id → neighbour ids (focus dimming + the a11y list). */
export function buildAdjacency(edges: PlacedEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const e of edges) { add(e.source, e.target); add(e.target, e.source); }
  return adj;
}

export function truncate(s: string, n: number): string {
  return s && s.length > n ? `${s.slice(0, n - 1)}…` : (s ?? "");
}

/**
 * Component count — the one stat worth showing next to a graph.
 *
 * Takes the NODES too, not just the edges: a graph of one node with no edges has
 * ONE component, and an adjacency built from edges alone reports ZERO (every
 * isolated node is invisible in it). That is the bug this signature prevents —
 * "3 entities · 1 connection · 3 clusters" is a lie the owner would have to
 * explain to a reader.
 */
export function components(nodes: { id: string }[], edges: PlacedEdge[]): number {
  const adj = buildAdjacency(edges);
  const seen = new Set<string>();
  let n = 0;
  for (const { id } of nodes) {
    if (seen.has(id)) continue;
    n++;
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const nb of adj.get(cur) ?? []) {
        if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
      }
    }
  }
  return n;
}