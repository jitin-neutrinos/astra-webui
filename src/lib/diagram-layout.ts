// Diagram layout v6 — a PURE layered layout: no DOM, no React, deterministic.
//
// Port of the PM-measured reference (scratch/canvas-v6/ref/diagram-layout.ref.mjs)
// to TypeScript. Behaviour is unchanged; only types were added. Measured on 600
// seeded random graphs (6..24 nodes, tb+lr) and the 5 stress fixtures: 0
// node/label overlaps, 0 out-of-bounds, 0 edge-through-node,
// 0 edge-through-foreign-label, 0 diagonal segments. The audit that proves it
// lives in diagram-layout.check.ts (RG-071).
//
// Division of labour (why this is robust):
//   dagre  -> ranking, crossing-minimising order, node slots, a reserved slot for every edge label
//   us     -> text sizing (word-only wrapping), orthogonal routing that bends ONLY inside the free gap
//             between two ranks.
import dagre from "@dagrejs/dagre";

// ── text measurement ────────────────────────────────────────────────────────────
// In the browser pass opts.measure backed by one cached 2d canvas at the real font (see the work order).
// This table is the deterministic fallback used by tests: wide caps/digits are wide in real fonts too.
const NARROW = new Set([..."iljtfIr.,:;'!|()[]{}-/\\ "]);
const WIDE = new Set([..."MWmw@%"]);

export function defaultMeasure(text: string, fontPx: number): number {
  let em = 0;
  for (const ch of text) em += WIDE.has(ch) ? 0.72 : NARROW.has(ch) ? 0.34 : 0.55;
  return em * fontPx;
}

export const S = {
  padX: 10, padY: 8,
  nodeSep: 36, rankSep: 56, edgeSep: 14, margin: 14,
  maxNodeW: 260, minNodeW: 96, maxLabelW: 132,
  fsLabel: 12, lhLabel: 15, fsDetail: 11, lhDetail: 14, fsEdge: 11, lhEdge: 14,
  fsField: 10.5, lhField: 14,
  maxLinesLabel: 5, maxLinesDetail: 4,
} as const;

// Owner law: words are NEVER split. Only a raw hash/path-looking token may break by character.
export function isCodeish(token: string): boolean {
  return (token.match(/[/\\_.:\-#@]/g) || []).length >= 3 ||
    /^[0-9a-f]{16,}$/i.test(token) ||
    (/[0-9a-f]/i.test(token) && token.length >= 24 && !/[aeiou]/i.test(token.replace(/[0-9]/g, "")));
}

function breakToken(token: string, fontPx: number, maxW: number, M: Measure): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of token) {
    if (cur && M(cur + ch, fontPx) > maxW) { out.push(cur); cur = ch; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Greedy wrap on spaces. A plain word wider than maxW stays whole on its own line (the node grows);
 *  only a code-ish token is cut by character. Over maxLines -> last line ends with an ellipsis. */
export function wrapWords(
  text: string,
  fontPx: number,
  maxW: number,
  maxLines: number,
  M: Measure,
): { lines: string[]; truncated: boolean } {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  const push = () => { if (cur) { lines.push(cur); cur = ""; } };
  for (const w of words) {
    if (M(w, fontPx) > maxW && isCodeish(w)) {
      push();
      for (const piece of breakToken(w, fontPx, maxW, M)) {
        if (cur && M(cur + " " + piece, fontPx) > maxW) { push(); cur = piece; } else cur = cur ? cur + " " + piece : piece;
      }
      continue;
    }
    const cand = cur ? cur + " " + w : w;
    if (M(cand, fontPx) <= maxW || !cur) cur = cand; else { push(); cur = w; }
  }
  push();
  const out = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;
  if (truncated) {
    let last = out[maxLines - 1] ?? "";
    while (last && M(last + "…", fontPx) > maxW) last = last.slice(0, -1).trimEnd();
    out[maxLines - 1] = last + "…";
  }
  return { lines: out, truncated };
}

// ── types ───────────────────────────────────────────────────────────────────────

/** Text width in CSS px for a given font size. */
export type Measure = (text: string, fontPx: number) => number;

export type Dir = "tb" | "lr";

export interface DiagramSource {
  nodes: { id: string; label: string; detail?: string; note?: string; kind?: string; fields?: { name: string; type?: string }[] }[];
  edges: { from: string; to: string; label?: string; note?: string; cardinality?: string }[];
  direction?: Dir;
}

export interface LNode {
  id: string;
  x: number; y: number; w: number; h: number;
  label: string[];
  detail: string[] | null;
  note: string | null;
  truncated: boolean;
  kind?: string | null;
  /** ER/CIRCUIT fields, pre-wrapped. An entity node is a header bar + one row
   *  per field, so its height is driven by the field COUNT, not by the label. */
  fields: { name: string; type: string | null }[] | null;
  symbol?: string | null;
}

export interface LEdge {
  i: number;
  // `e` carries the SOURCE edge verbatim (DiagramSource edge, incl. the ER
  // `cardinality` the renderer draws crow's feet from) — narrowing it to
  // {from,to,label,note} made `edge.cardinality` unreachable in canvas-diagram.
  e: DiagramSource["edges"][number];
  pts: { x: number; y: number }[];
  self: boolean;
}

export interface LLabel {
  id: { from: string; to: string };
  i: number;
  x: number; y: number; w: number; h: number;
  lines: string[];
}

export interface DiagramLayout {
  direction: Dir;
  nodes: LNode[];
  edges: LEdge[];
  labelBoxes: LLabel[];
  bounds: { w: number; h: number };
}

interface SizedNode {
  id: string;
  w: number; h: number;
  label: string[];
  detail: string[] | null;
  note: string | null;
  truncated: boolean;
  kind?: string | null;
  fields: { name: string; type: string | null }[] | null;
  symbol?: string | null;
}

interface SizedEdge {
  w: number; h: number; lines: string[];
}

function sizeNode(n: DiagramSource["nodes"][number], budget: number, M: Measure): SizedNode {
  const innerMax = Math.min(S.maxNodeW, budget) - 2 * S.padX;
  const lab = wrapWords(n.label, S.fsLabel, innerMax, S.maxLinesLabel, M);
  const det = n.detail ? wrapWords(n.detail, S.fsDetail, innerMax, S.maxLinesDetail, M) : null;
  // An ENTITY box is a header bar + one row per field, so its height is driven by
  // the field COUNT. `name type` are measured on ONE line each and the row is
  // padded to the widest — an ER box that wrapped its columns would misalign
  // every type against its name, which is the one thing an ER box must not do.
  const rawFields = Array.isArray(n.fields) ? n.fields : [];
  const fields = rawFields.length > 0
    ? rawFields.slice(0, 24).map((f) => ({ name: f.name, type: f.type ?? null }))
    : null;
  const fw = fields ? Math.max(0, ...fields.map((f) => M(f.name, S.fsField) + (f.type ? M(f.type, S.fsField) + 18 : 0))) : 0;
  const widest = Math.max(
    ...lab.lines.map((l) => M(l, S.fsLabel)),
    ...(det ? det.lines.map((l) => M(l, S.fsDetail)) : [0]), fw, 0);
  const w = Math.max(S.minNodeW, Math.ceil(widest) + 2 * S.padX);
  const h = S.padY * 2 + lab.lines.length * S.lhLabel
    + (det ? 2 + det.lines.length * S.lhDetail : 0)
    + (fields ? fields.length * S.lhField + 6 : 0);
  return {
    id: n.id, w, h, label: lab.lines, detail: det ? det.lines : null,
    note: n.note ?? null, truncated: lab.truncated || !!(det && det.truncated),
    kind: n.kind ?? null, fields,
    symbol: (n as { symbol?: string }).symbol ?? null,
  };
}

function sizeEdge(e: DiagramSource["edges"][number], dir: Dir, M: Measure): SizedEdge | null {
  if (!e.label) return null;
  const r = wrapWords(e.label, S.fsEdge, S.maxLabelW, dir === "lr" ? 3 : 2, M);
  return { w: Math.ceil(Math.max(...r.lines.map((l) => M(l, S.fsEdge)), 0)) + 8, h: r.lines.length * S.lhEdge, lines: r.lines };
}

/**
 * Lay out a diagram block into rectangles + orthogonal polylines + label boxes.
 *
 * @param block  { nodes:[{id,label,detail?,note?,kind?}], edges:[{from,to,label?,note?}], direction? }
 * @param opts   { dir?: "tb"|"lr", measure?: (text,fontPx)=>px, nodeWidthBudget?: number }
 * @returns { direction, nodes:[{id,x,y,w,h,label:string[],detail:string[]|null,note}],
 *            edges:[{i,e,pts:{x,y}[],self}], labelBoxes:[{id:{from,to},i,x,y,w,h,lines}], bounds:{w,h} }
 */
export function layoutDiagram(
  block: DiagramSource,
  opts: { dir?: Dir; measure?: Measure; nodeWidthBudget?: number } = {},
  pass = 1,                       // internal: 2nd pass grows dagre's margin when a route overhangs
): DiagramLayout {
  const dir = (opts.dir ?? (block.direction === "lr" ? "lr" : "tb")) === "lr" ? "lr" : "tb";
  const LR = dir === "lr";
  const M = opts.measure ?? defaultMeasure;
  const budget = opts.nodeWidthBudget ?? (LR ? 240 : 200);

  const sized: SizedNode[] = block.nodes.map((n) => sizeNode(n, budget, M));
  const byId = new Map(sized.map((n) => [n.id, n]));

  // dagre's own typings are generic over its internal label types; the layout
  // only ever reads back x/y and `points`, so the three call sites stay loose.
  const g = new dagre.graphlib.Graph({ multigraph: true }) as any;
  const MARGIN = S.margin * pass;             // overhang pass: dagre's own box underestimates extreme routes
  g.setGraph({ rankdir: LR ? "LR" : "TB", nodesep: S.nodeSep, edgesep: S.edgeSep, ranksep: S.rankSep, marginx: MARGIN, marginy: MARGIN, acyclicer: "greedy", ranker: "network-simplex" });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of sized) g.setNode(n.id, { width: n.w, height: n.h });

  const seen = new Set<string>();
  const edges: { i: number; e: DiagramSource["edges"][number]; le: SizedEdge | null; name: string }[] = [];
  block.edges.forEach((e, i) => {
    if (!byId.has(e.from) || !byId.has(e.to)) return;            // dangling: dropped
    const k = e.from + ">" + e.to + "|" + (e.label || "");
    if (seen.has(k)) return; seen.add(k);                        // exact duplicate: dropped
    const le = sizeEdge(e, dir, M);
    const name = "e" + edges.length;
    g.setEdge(e.from, e.to, le ? { width: le.w, height: le.h, labelpos: "c" } : {}, name);
    edges.push({ i, e, le, name });
  });
  (dagre.layout as (g: unknown) => void)(g);

  const nodes: LNode[] = sized.map((n) => {
    const d = g.node(n.id) as { x: number; y: number };
    return { ...n, x: d.x - n.w / 2, y: d.y - n.h / 2 };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Rank bands on the MAIN axis: every node that shares a centre is one rank; a band is the union of their extents.
  const mainC = (n: LNode) => (LR ? n.x + n.w / 2 : n.y + n.h / 2);
  const bands = new Map<number, { lo: number; hi: number }>();
  for (const n of nodes) {
    const k = Math.round(mainC(n));
    const b = bands.get(k) || { lo: Infinity, hi: -Infinity };
    b.lo = Math.min(b.lo, LR ? n.x : n.y); b.hi = Math.max(b.hi, LR ? n.x + n.w : n.y + n.h); bands.set(k, b);
  }
  // Every node contributed its own band above, so this never misses.
  const bandOf = (n: LNode) => bands.get(Math.round(mainC(n)))!;

  const routed: LEdge[] = [], labelBoxes: LLabel[] = [];
  for (const { i, e, le, name } of edges) {
    const d = g.edge(e.from, e.to, name) as { points: { x: number; y: number }[]; x: number; y: number };
    const pts = (d.points || []).map((p) => ({ x: p.x, y: p.y }));
    const lbl = le && d.x != null ? { x: d.x - le.w / 2, y: d.y - le.h / 2, w: le.w, h: le.h } : null;
    const isLabelPt = (p: { x: number; y: number }) => !!lbl && Math.abs(p.x - d.x) < 1 && Math.abs(p.y - d.y) < 1;
    const src = nodeById.get(e.from)!, dst = nodeById.get(e.to)!;
    const main = (p: { x: number; y: number }) => (LR ? p.x : p.y), cross = (p: { x: number; y: number }) => (LR ? p.y : p.x);
    const mk = (m: number, c: number) => (LR ? { x: m, y: c } : { x: c, y: m });
    const bandAt = (p: { x: number; y: number }) => bands.get(Math.round(main(p)));
    // A back-edge (reversed by the acyclicer) travels AGAINST the main axis, so it leaves a node's LEADING side
    // and arrives at the target's TRAILING side. Treating every edge as forward put bends inside the wrong rank.
    const UP = main(pts[0]) > main(pts[pts.length - 1]);
    const half = lbl ? (LR ? lbl.w : lbl.h) / 2 : 0;
    const trail = (p: { x: number; y: number }, k: number) => {   // main-axis limit of the free gap AFTER point k
      if (k === 0) return UP ? bandOf(src).lo : bandOf(src).hi;
      const b = bandAt(p); if (b) return UP ? b.lo : b.hi;
      return main(p) + (isLabelPt(p) ? (UP ? -half : half) : 0);
    };
    const lead = (p: { x: number; y: number }, k: number) => {    // main-axis limit of the free gap BEFORE point k
      if (k === pts.length - 1) return UP ? bandOf(dst).hi : bandOf(dst).lo;
      const b = bandAt(p); if (b) return UP ? b.hi : b.lo;
      return main(p) - (isLabelPt(p) ? (UP ? -half : half) : 0);
    };
    const orth: { x: number; y: number }[] = [pts[0]];
    for (let k = 1; k < pts.length; k++) {
      const p = orth[orth.length - 1], q = pts[k];
      // dagre's own points can differ by a fraction of a pixel on a run that is meant to be straight;
      // snap it so every segment is EXACTLY axis-aligned (the audit, and the SVG, rely on that)
      if (Math.abs(cross(p) - cross(q)) < 0.75) { orth.push(mk(main(q), cross(p))); continue; }
      // bend INSIDE the free gap, never inside a rank
      const m = (trail(pts[k - 1], k - 1) + lead(q, k)) / 2;
      orth.push(mk(m, cross(p)), mk(m, cross(q)), q);
    }
    routed.push({ i, e, pts: orth, self: e.from === e.to });
    if (lbl && e.from !== e.to) labelBoxes.push({ id: { from: e.from, to: e.to }, i, ...lbl, lines: le!.lines });  // self loops get theirs from routeSelfLoops
  }
  const gw = g.graph() as { width: number; height: number };
  const bounds = { w: Math.ceil(gw.width), h: Math.ceil(gw.height) };
  routeSelfLoops(dir, nodeById, routed, labelBoxes, defaultMeasure);
  clearLabelBoxes(routed, labelBoxes, bounds);
  // the drawing must contain every route point. dagre's own margin box can UNDERestimate the extent of
  // a route that leaves and re-enters the same side (seen on 12/210 seeded random graphs): re-run the
  // whole layout once with a doubled margin; the bands, routes and chips are all recomputed there.
  const overhang = routed.some((r) => r.pts.some((pt) => pt.x < 0 || pt.y < 0));
  if (overhang && pass === 1) return layoutDiagram(block, opts, 2);
  // the drawing must contain EVERY route point on BOTH axes (a tb layout can still overhang cross-wise)
  const minx = Math.min(...routed.flatMap((r) => r.pts.map((pt) => pt.x)));
  const miny = Math.min(...routed.flatMap((r) => r.pts.map((pt) => pt.y)));
  if ((minx < 0 || miny < 0) && pass < 4) return layoutDiagram(block, opts, pass + 1);
  bounds.w = Math.max(bounds.w, Math.ceil(Math.max(...routed.flatMap((r) => r.pts.map((pt) => pt.x)))));
  bounds.h = Math.max(bounds.h, Math.ceil(Math.max(...routed.flatMap((r) => r.pts.map((pt) => pt.y)))));
  return { direction: dir, nodes, edges: routed, labelBoxes, bounds };
}

/** dagre's self-loop points cross the node interior and can leave the canvas. Replace them with a
 *  deterministic detour: exit the trailing border, swing clear outside on the cross axis, re-enter
 *  the leading border. Purely orthogonal; never through the node. */
const SELF_PAD = 18;
function routeSelfLoops(
  dir: Dir,
  nodeById: Map<string, LNode>,
  routed: LEdge[],
  labelBoxes: LLabel[],
  M: Measure,
) {
  for (const r of routed) {
    if (!r.self) continue;
    const n = nodeById.get(r.e.from)!;
    const pts: { x: number; y: number }[] = [];
    let w = 0, lines: string[] = [];
    if (r.e.label) {
      const wrapped = wrapWords(r.e.label, S.fsEdge, S.maxLabelW, dir === "lr" ? 3 : 2, M);
      w = Math.ceil(Math.max(...wrapped.lines.map((l) => M(l, S.fsEdge)), 0)) + 8;
      lines = wrapped.lines;
    }
    // loop on ONE side: both endpoints on the trailing border — a leg entering from the far side
    // would cross the node interior.
    if (dir === "lr") {
      pts.push({ x: n.x + n.w, y: n.y + n.h * 0.8 }, { x: n.x + n.w + SELF_PAD, y: n.y + n.h * 0.8 },
               { x: n.x + n.w + SELF_PAD, y: n.y + n.h * 0.2 }, { x: n.x + n.w, y: n.y + n.h * 0.2 });
      if (r.e.label) labelBoxes.push({ id: { from: r.e.from, to: r.e.to }, i: r.i, x: n.x + n.w + SELF_PAD + 4, y: n.y + n.h * 0.5 - lines.length * S.lhEdge / 2, w, h: lines.length * S.lhEdge, lines });
    } else {
      pts.push({ x: n.x + n.w * 0.8, y: n.y + n.h }, { x: n.x + n.w * 0.8, y: n.y + n.h + SELF_PAD },
               { x: n.x + n.w * 0.2, y: n.y + n.h + SELF_PAD }, { x: n.x + n.w * 0.2, y: n.y + n.h });
      if (r.e.label) labelBoxes.push({ id: { from: r.e.from, to: r.e.to }, i: r.i, x: n.x + n.w / 2 - w / 2, y: n.y + n.h + SELF_PAD - lines.length * S.lhEdge - 2, w, h: lines.length * S.lhEdge, lines });
    }
    r.pts = pts;
  }
}
function segHitsBox(p: { x: number; y: number }, q: { x: number; y: number }, b: { x: number; y: number; w: number; h: number }, pad = 0): boolean {
  const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x), y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
  return x0 < b.x + b.w + pad && b.x - pad < x1 && y0 < b.y + b.h + pad && b.y - pad < y1;
}

/** Foreign corridors may cross a chip (dagre reserves no corridor-free slot). After the routes are known,
 *  slide each chip along its OWN edge's dominant line to the nearest clear spot; a chip may mask its OWN
 *  line (by law) but never a foreign one. Bounded search: 9 offsets per axis. */
function clearLabelBoxes(
  routed: LEdge[],
  labelBoxes: LLabel[],
  bounds: { w: number; h: number },
) {
  const CLEAR = 3;
  for (const l of labelBoxes) {
    const own = routed.find((r) => r.i === l.i);
    if (!own) continue;
    const pts = own.pts;
    // the chip belongs at the midpoint; try offsets along the dominant axis of its own polyline
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    const home = { x: l.x, y: l.y };
    const dx = pts[pts.length - 1].x - pts[0].x, dy = pts[pts.length - 1].y - pts[0].y;
    const horiz = Math.abs(dx) >= Math.abs(dy);
    for (let t = -3; t <= 3; t++) {
      for (const perp of [-1, 0, 1]) {
        const c = horiz
          ? { x: l.x + t * 8, y: l.y + perp * (l.h + CLEAR + 1) }
          : { x: l.x + perp * (l.w + CLEAR + 1), y: l.y + t * 8 };
        if (c.x < 2 || c.y < 2 || c.x + l.w > bounds.w - 2 || c.y + l.h > bounds.h - 2) continue;
        let bad = false;
        for (const r of routed) {
          if (r.i === l.i) continue;                      // a chip may mask its OWN line
          for (let k = 0; k + 1 < r.pts.length; k++) {
            if (segHitsBox(r.pts[k], r.pts[k + 1], { x: c.x - CLEAR, y: c.y - CLEAR, w: l.w + 2 * CLEAR, h: l.h + 2 * CLEAR })) { bad = true; break; }
          }
          if (bad) break;
        }
        const dist = Math.abs(home.x - c.x) + Math.abs(home.y - c.y);
        if (!bad && dist < bestDist) { bestDist = dist; best = c; }
      }
    }
    if (best) { l.x = best.x; l.y = best.y; }
  }
}
