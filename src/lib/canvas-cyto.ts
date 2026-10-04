/**
 * PORTED VERBATIM (JS→TS, maths untouched) from the comindash dashboard:
 *   ~/Work/Neutrinos/community-insights-dashboard/app/frontend/src/components/graph/cytoGraph.js
 *
 * What this file is: the graph payload → Cytoscape element adapter. It runs the
 * PROVEN d3-force layout (canvas-force.ts, the same port) and stamps preset
 * positions onto Cytoscape elements. Two upstream lessons carried in comments
 * below, both of which cost a debugging round when they were missed:
 *   1. Cytoscape's constructor `elements:` option SILENTLY DROPS position fields
 *      in 3.34 — nodes land at 0,0. You must `cy.add()` after construction.
 *   2. fcose (the Cytoscape force layout) was REVERTED upstream on this corpus —
 *      it tiled/collapsed on sparse graphs and on narrow viewports. Preset d3
 *      positions are the supported path.
 *
 * Original self-check: node src/components/graph/cytoGraph.test.mjs
 */
import cytoscape from 'cytoscape'
import { layout as d3Layout } from './canvas-force'

export { cytoscape }

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** Virtual seed box — matches the old viewBox; fcose re-fits after settling. */
export const SEED_W = 1000
export const SEED_H = 660

/** Node radius from mention weight — sqrt so AREA tracks volume, not radius. */
export function nodeRadius(weight: number, maxWeight: number): number {
  const t = Math.sqrt(Math.max(weight, 1) / Math.max(maxWeight, 1))
  return 7 + 17 * Math.min(t, 1)
}

/** Edge stroke width (log scale — one huge pair cannot blow out the range). */
export function edgeWidth(weight: number, maxWeight: number): number {
  const t = Math.log1p(Math.max(weight, 0)) / Math.log1p(Math.max(maxWeight, 1))
  return 0.8 + 3.4 * Math.min(Math.max(t, 0), 1)
}

/** Golden-angle spiral start — deterministic, well-spread, no Math.random. */
export function seedPosition(index: number, total: number, width = SEED_W, height = SEED_H) {
  const r = (Math.min(width, height) / 2.3) * Math.sqrt((index + 0.5) / Math.max(total, 1))
  const a = index * GOLDEN_ANGLE
  return { x: width / 2 + r * Math.cos(a), y: height / 2 + r * Math.sin(a) }
}

/** Nodes at/below this radius hide their label unless lit (same rule as before). */
export const SMALL_R = 13

/** relation key -> display text ("correlates_with" -> "correlates with"). */
export const relLabel = (relation: any) => String(relation ?? '').replace(/_/g, ' ')

/**
 * Graph payload -> Cytoscape elements. Node/edge data carries every field
 * the InsightPanel reads from a selection payload, so the tap handler can
 * hand React the exact same object shape the SVG version produced.
 */
export function toElements(graph: any): { nodes: any[]; edges: any[] } {
  const nodesIn = graph?.nodes ?? []
  const edgesIn = graph?.edges ?? []
  if (!nodesIn.length) return { nodes: [], edges: [] }

  // d3-force settles on the fixed virtual canvas — deterministic and
  // container-independent (the reason fcose was reverted).
  const placed = d3Layout(nodesIn, edgesIn, { width: SEED_W, height: SEED_H })
  const posById = new Map<string, any>(placed.nodes.map((n: any) => [n.id, n]));
  const maxWeight = Math.max(...nodesIn.map((n: any) => n.weight ?? 1), 1)
  const maxEdge = Math.max(...edgesIn.map((e: any) => e.weight ?? 1), 1)
  const idSet = new Set<any>(nodesIn.map((n: any) => n.id));

  const nodes = nodesIn.map((n: any, _i: number) => {
    const r = nodeRadius(n.weight ?? 1, maxWeight)
    return {
      data: {
        id: n.id,
        label: n.label,
        kind: n.kind,
        weight: n.weight ?? 1,
        degree: n.degree ?? 0,
        // The canvas graph block's own field is `detail` (see the `graph` case
        // in canvas-schema.ts and every read in canvas-graph-view.tsx, which
        // asks for ele.data("detail")). This adapter only forwarded
        // `description` — comindash's field name — so every node arrived with
        // an EMPTY panel: measured 0/31 nodes carrying any context text, and a
        // card that looked broken rather than empty. Forward BOTH: `detail` is
        // canonical, `description` stays for the comindash-shaped payload this
        // file was ported from, so neither caller can silently lose the text.
        detail: n.detail ?? n.description ?? null,
        description: n.detail ?? n.description ?? null,
        meta: n.meta ?? null,
        size: r * 2,
        fsize: r > 15 ? 12 : 11,
      },
      position: { x: Number((posById.get(n.id) as any)?.x ?? 0), y: Number((posById.get(n.id) as any)?.y ?? 0) },
      classes: [`k-${n.kind ?? 'product'}`, r <= SMALL_R ? 'sm' : ''].filter(Boolean),
    }
  })

  const edges = edgesIn
    .filter((e: any) => idSet.has(e.source) && idSet.has(e.target))
    .map((e: any) => ({
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        kind: e.kind,
        relation: e.relation ?? null,
        relLabel: relLabel(e.relation),
        weight: e.weight ?? 1,
        posts: e.posts ?? 0,
        insightId: e.insight_id ?? e.insightId ?? null,
        sourceLabel: e.sourceLabel ?? e.source,
        targetLabel: e.targetLabel ?? e.target,
        width: edgeWidth(e.weight ?? 1, maxEdge),
      },
      classes: [e.kind === 'asserted' ? 'k-as' : 'k-co'],
    }))

  return { nodes, edges }
}

/**
 * Layout descriptor for the component: preset positions from d3-force,
 * already stamped onto the elements by toElements(). The component runs
 * this then fits to the viewport; the fit is the entrance motion.
 */
export function layoutOptions(): { name: string } {
  return { name: 'preset' }
}

/**
 * Run the layout headless; resolves id -> {x, y}. Used by the self-check
 * (determinism) — same d3 positions the live component uses.
 */
export function runLayout(graph: any) {
  const pos: Record<string, any> = {};
  const els = toElements(graph);
  for (const n of els.nodes) pos[String((n.data as any).id)] = { x: (n.position as any).x, y: (n.position as any).y }
  return Promise.resolve(pos)
}
