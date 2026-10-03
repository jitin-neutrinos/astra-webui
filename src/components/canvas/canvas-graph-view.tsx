// canvas-graph-view.tsx — the `graph` block renderer (lazy chunk).
//
// Hand-rolled SVG: deterministic layout from canvas-graph.ts, focus dimming,
// pan/zoom, kind filter chips and an accessible list twin. Every colour is a
// theme token and every node KIND separates by radius + opacity tier + shape —
// never by hue (owner law: one accent).
//
// The mobile law matters here: 44px touch targets on the chips/zoom controls,
// and a graph that fits the card rather than forcing the document to scroll.
import { useMemo, useRef, useState } from "react";
import { layout, buildAdjacency, truncate, components, type PlacedNode } from "../../lib/canvas-graph";
import type { GraphBlock } from "../../lib/canvas-schema";
import { cn } from "../../lib/utils";

const VB_W = 1000;
const VB_H = 660;
const KIND_OPACITY = [1, 0.72, 0.48];

export default function GraphView({ block }: { block: GraphBlock }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });

  const height = block.height ?? 460;
  const kinds = useMemo(() => [...new Set(block.nodes.map((n) => n.kind || "node"))], [block.nodes]);

  // Layout is computed on the FULL graph once, then filtered visually: a filter
  // must not re-settle the map under the reader's finger.
  const { nodes, edges } = useMemo(
    () => layout(block.nodes, block.edges, { width: VB_W, height: VB_H }),
    [block.nodes, block.edges],
  );
  const adj = useMemo(() => buildAdjacency(edges), [edges]);

  const lit = useMemo(() => {
    if (!focus) return null;
    const s = new Set([focus]);
    for (const nb of adj.get(focus) ?? []) s.add(nb);
    return s;
  }, [focus, adj]);

  const op = (n: PlacedNode) => {
    if (hidden.has(n.kind || "node")) return 0;
    if (!lit) return KIND_OPACITY[Math.min(n.tier, 2)];
    return lit.has(n.id) ? 1 : 0.16;
  };

  const toggleKind = (k: string) => {
    const next = new Set(hidden);
    if (next.has(k)) next.delete(k); else next.add(k);
    setHidden(next);
  };

  const zoom = (f: number) => setView((v) => ({ ...v, z: Math.max(0.6, Math.min(2.4, v.z * f)) }));
  const reset = () => setView({ x: 0, y: 0, z: 1 });
  const neighbours = focus ? [...(adj.get(focus) ?? [])].map((id) => nodes.find((n) => n.id === id)).filter(Boolean) as PlacedNode[] : [];
  const comps = components(nodes, edges);

  return (
    <figure className="ast-cv-graph" role="group" aria-label={`${block.title || "Knowledge graph"}: ${block.nodes.length} entities, ${block.edges.length} connections`}>
      {(block.title || kinds.length > 1) && (
        <figcaption className="ast-cv-graph-head">
          {block.title && <span className="ast-cv-graph-title">{block.title}</span>}
          <span className="ast-cv-graph-stats">
            {nodes.length} entities · {edges.length} connections
            {comps > 1 && ` · ${comps} clusters`}
          </span>
        </figcaption>
      )}

      {kinds.length > 1 && (
        <div className="ast-cv-graph-filters" role="group" aria-label="Filter by kind">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              className={cn("ast-cv-chip", hidden.has(k) ? "off" : "on")}
              aria-pressed={!hidden.has(k)}
              onClick={() => toggleKind(k)}
            >
              {k}
            </button>
          ))}
        </div>
      )}

      <div className="ast-cv-graph-stage" style={{ height }} ref={hostRef}>
        <svg
          viewBox={`${-VB_W / 2} ${-VB_H / 2} ${VB_W} ${VB_H}`}
          className="ast-cv-graph-svg"
          role="application"
          aria-label="Relationship map. Use the list below for keyboard access."
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
          onWheel={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1.08 : 0.93); } }}
        >
          <g className="ast-cv-graph-edges">
            {edges.map((e, i) => (
              <line
                key={i}
                x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                strokeWidth={e.width}
                strokeDasharray={e.kind === "asserted" ? "5 5" : undefined}
                opacity={lit ? (lit.has(e.source) && lit.has(e.target) ? 0.72 : 0.08) : 0.34}
              />
            ))}
          </g>
          <g className="ast-cv-graph-nodes">
            {nodes.map((n) => (
              <g
                key={n.id}
                transform={`translate(${n.x}, ${n.y})`}
                className={cn("ast-cv-gnode", focus === n.id && "focused")}
                opacity={op(n)}
                tabIndex={0}
                role="button"
                aria-label={`${n.label}${n.detail ? ` — ${n.detail}` : ""}`}
                onClick={() => setFocus(focus === n.id ? null : n.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFocus(focus === n.id ? null : n.id); } }}
              >
                {/* node shape encodes kind tier: circle → square → diamond */}
                {n.tier === 0 ? (
                  <circle r={n.r} className="ast-cv-gnode-dot" />
                ) : n.tier === 1 ? (
                  <rect x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2} rx={4} className="ast-cv-gnode-dot" />
                ) : (
                  <path d={`M 0 ${-n.r * 1.15} L ${n.r * 1.15} 0 L 0 ${n.r * 1.15} L ${-n.r * 1.15} 0 Z`} className="ast-cv-gnode-dot" />
                )}
                <text y={n.r + 13} className="ast-cv-gnode-label">{truncate(n.label, n.r > 16 ? 22 : 15)}</text>
              </g>
            ))}
          </g>
        </svg>

        <div className="ast-cv-graph-controls">
          <button type="button" aria-label="Zoom in" onClick={() => zoom(1.18)}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => zoom(0.85)}>−</button>
          <button type="button" aria-label="Reset view" onClick={reset}>⤾</button>
        </div>
      </div>

      {focus && (
        <div className="ast-cv-graph-detail">
          <p className="ast-cv-graph-detail-name">
            {nodes.find((n) => n.id === focus)?.label}
            {nodes.find((n) => n.id === focus)?.kind && <span className="ast-cv-graph-detail-kind">{nodes.find((n) => n.id === focus)?.kind}</span>}
          </p>
          {nodes.find((n) => n.id === focus)?.detail && (
            <p className="ast-cv-graph-detail-text">{nodes.find((n) => n.id === focus)?.detail}</p>
          )}
          {neighbours.length > 0 && (
            <p className="ast-cv-graph-detail-text">
              Connected to {neighbours.length}: {neighbours.slice(0, 6).map((n) => n.label).join(", ")}
              {neighbours.length > 6 && ` +${neighbours.length - 6} more`}
            </p>
          )}
          <button type="button" className="ast-cv-graph-clear" onClick={() => setFocus(null)}>Clear selection</button>
        </div>
      )}

      {/* accessible twin: every connection as text (the canvas is not tabbable per node) */}
      <details className="ast-cv-graph-a11y">
        <summary>{edges.length} connections (text list)</summary>
        <ol className="ast-cv-graph-a11y-list">
          {edges.slice(0, 40).map((e, i) => (
            <li key={i}>
              {nodes.find((n) => n.id === e.source)?.label ?? e.source} → {nodes.find((n) => n.id === e.target)?.label ?? e.target}
              {e.label && ` (${e.label})`}
            </li>
          ))}
        </ol>
      </details>
    </figure>
  );
}