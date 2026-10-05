// Canvas diagram block — ONE SVG drawn from a pure layout (src/lib/diagram-layout.ts).
//
// This replaces the DOM-measured view: nodes are not flex columns and the edges
// are not derived from live getBoundingClientRect(), so the layout can be AUDITED
// (see diagram-layout.check.ts, RG-071) rather than nudged until it looks right.
//
// The division:
//   lib/diagram-layout.ts  rectangles + orthogonal polylines + label boxes, pure
//   this file                one <svg>, scroll + zoom, selection, reading panel
//
// The drawing is NEVER scaled to fit: the SVG is laid out at CSS-pixel size and a
// scroll wrapper handles the overflow, so a 40-node diagram grows in width AND
// height instead of shrinking its labels to nothing.
import { useEffect, useMemo, useRef, useState } from "react";
import { Scan, ZoomIn, ZoomOut } from "lucide-react";
import { Expandable } from "./canvas-fullscreen";
import type { DiagramBlock } from "../../lib/canvas-schema";
import {
  layoutDiagram, defaultMeasure, S,
  type DiagramLayout, type Dir, type Measure,
} from "../../lib/diagram-layout";

// ── text measurement ───────────────────────────────────────────────────────────
// ONE cached 2d canvas at the real body font. `defaultMeasure` is the
// deterministic table the audit uses; the browser gets the truth, and the layout
// maths is the same either way. SSR (no document) falls back to the table.
let ctx2d: CanvasRenderingContext2D | null | undefined;
function browserMeasure(): Measure {
  let ctx = ctx2d;
  if (ctx === undefined) {
    try {
      ctx = document.createElement("canvas").getContext("2d") ?? null;
    } catch { ctx = null; }
    ctx2d = ctx;
  }
  const c = ctx;
  if (!c) return defaultMeasure;
  let font = "";
  return (text, fontPx) => {
    const want = `600 ${fontPx}px ${getComputedStyle(document.body).fontFamily}`;
    if (want !== font) { font = want; c.font = want; }
    return c.measureText(text).width;
  };
}

const ZOOM_MIN = 0.4;    // the overview floor: below this nothing is legible and scrolling is better
const ZOOM_MAX = 2.5;
/** A diagram that fits within this fraction of the width is shown fitted; anything wider opens at TRUE size
 *  (12px labels) and scrolls, because shrinking a wide diagram to fit makes its text unreadable. */
const FIT_SNAP = 0.92;
const ZOOM_STEP = 1.25;
/** Below this the viewport wins over the agent's hint: a 3-column side-by-side
 *  flow is unreadable on a phone. */
const NARROW_PX = 560;
const clamp = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));

/** `route` renders the SAME routed points two ways: "orthogonal" (the default,
 *  right-angle segments — what the layout audit pins) or "smooth", a rounded
 *  corner at each bend. Only the PATH STRING differs; the geometry, the label
 *  boxes and the overlap audit are untouched, so `smooth` can never introduce an
 *  overlap the orthogonal audit proved absent. */
function routeD(pts: { x: number; y: number }[], smooth: boolean): string {
  if (pts.length === 0) return "";
  if (!smooth || pts.length < 3) return pts.map((p, k) => `${k === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    d += ` Q ${p.x} ${p.y} ${(p.x + pts[i + 1].x) / 2} ${(p.y + pts[i + 1].y) / 2}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

// ── circuit glyphs (0 new dependencies, pure SVG) ─────────────────────────────
// A standard component symbol inside the node box. Stroke only — every colour is
// a CSS class (.ast-cv-dg-glyph), never an inline hex.
function CircuitGlyph({ symbol, cx, cy }: { symbol: string; cx: number; cy: number }) {
  const R = 9;
  const d = {
    resistor: `M ${cx - R} ${cy} L ${cx - R + 3} ${cy} l 3 -4 l 3 8 l 3 -8 l 3 8 l 3 -8 l 3 4 L ${cx + R} ${cy}`,
    capacitor: `M ${cx - R} ${cy} L ${cx - 2} ${cy} M ${cx - 2} ${cy - R} L ${cx - 2} ${cy + R} M ${cx + 2} ${cy - R} L ${cx + 2} ${cy + R} M ${cx + 2} ${cy} L ${cx + R} ${cy}`,
    inductor: `M ${cx - R} ${cy} l 3 0 a 3 3 0 0 1 6 0 l 0 0 a 3 3 0 0 1 6 0 L ${cx + R} ${cy}`,
    diode: `M ${cx - R} ${cy} L ${cx - 1} ${cy - 6} L ${cx - 1} ${cy + 6} Z M ${cx + 1} ${cy - 6} L ${cx + 1} ${cy + 6} M ${cx + 1} ${cy - 6} L ${cx + R} ${cy - 6} M ${cx + 1} ${cy + 6} L ${cx + R} ${cy + 6} M ${cx + R} ${cy - 6} L ${cx + R} ${cy + 6}`,
    ground: `M ${cx} ${cy - R} L ${cx} ${cy + 2} M ${cx - 7} ${cy + 2} L ${cx + 7} ${cy + 2} M ${cx - 4} ${cy + 5} L ${cx + 4} ${cy + 5} M ${cx - 1} ${cy + 8} L ${cx + 1} ${cy + 8}`,
    battery: `M ${cx - R} ${cy - 6} L ${cx - 4} ${cy - 6} M ${cx - R} ${cy + 6} L ${cx - 4} ${cy + 6} M ${cx - 4} ${cy - 8} L ${cx - 4} ${cy + 8} M ${cx + 4} ${cy - 5} L ${cx + 4} ${cy + 5} M ${cx + R} ${cy} L ${cx + 4} ${cy}`,
    opamp: `M ${cx - R} ${cy - R} L ${cx + 2} ${cy - R} L ${cx + 2} ${cy + R} L ${cx - R} ${cy + R} Z M ${cx - R} ${cy - 3} L ${cx - R - 4} ${cy - 3} M ${cx - R} ${cy + 3} L ${cx - R - 4} ${cy + 3} M ${cx + 2} ${cy} L ${cx + R} ${cy}`,
    led: `M ${cx - 6} ${cy - 6} L ${cx - 1} ${cy - 6} L ${cx - 1} ${cy + 6} Z M ${cx + 1} ${cy - 6} L ${cx + 1} ${cy + 6} M ${cx + 1} ${cy - 6} L ${cx + 7} ${cy - 6} M ${cx + 1} ${cy + 6} L ${cx + 7} ${cy + 6} M ${cx + 1} ${cy - 10} l 3 -3 M ${cx + 5} ${cy - 11} l 4 1`,
  }[symbol];
  if (!d) return null;
  return <path className="ast-cv-dg-glyph" d={d} />;
}

/** Crow's-foot terminator for `edge.cardinality`, drawn at the path's far end
 *  (or near end for a reverse reading). `1` is a single tick, `0..1` a tick plus
 *  an optional bar, and a `*` end is the fork. */
function CardFoot({ at, from, to, cardinality }: { at: { x: number; y: number }; from: { x: number; y: number }; to: { x: number; y: number }; cardinality?: string }) {
  if (!cardinality) return null;
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;          // unit vector along the edge
  const px = -uy, py = ux;                     // perpendicular
  const many = cardinality.includes("*");
  const optional = cardinality.startsWith("0");
  const A = 11;                                // spread of the fork
  const F = 5;                                 // fork inset
  const parts: string[] = [];
  if (many) {
    parts.push(`M ${at.x} ${at.y} L ${at.x - ux * F + px * A} ${at.y - uy * F + py * A}`);
    parts.push(`M ${at.x} ${at.y} L ${at.x - ux * F - px * A} ${at.y - uy * F - py * A}`);
    parts.push(`M ${at.x} ${at.y} L ${at.x - ux * F} ${at.y - uy * F}`);
  } else {
    // a single tick across the edge
    parts.push(`M ${at.x - px * A} ${at.y - py * A} L ${at.x + px * A} ${at.y + py * A}`);
  }
  if (optional) {
    // the "zero" half of the cardinality: a bar one tick further back
    const bx = at.x - ux * (F + 3), by = at.y - uy * (F + 3);
    parts.push(`M ${bx - px * A} ${by - py * A} L ${bx + px * A} ${by + py * A}`);
  }
  return <path className="ast-cv-dg-glyph" d={parts.join(" ")} strokeWidth={1.2} />;
}

export function DiagramView({ block, id }: { block: DiagramBlock; id: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [bucket, setBucket] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [kindOff, setKindOff] = useState<Set<string>>(new Set());
  // Text is measured with the page's REAL font. `font-display: swap` means the first paint may use a fallback,
  // so every font load re-measures: a fallback narrower than the brand font would otherwise overflow the boxes.
  const [fontEpoch, setFontEpoch] = useState(0);
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return;
    let alive = true;
    const bump = () => { if (alive) setFontEpoch((e) => e + 1); };
    const fam = getComputedStyle(document.body).fontFamily;
    Promise.all(
      [`600 ${S.fsLabel}px ${fam}`, `400 ${S.fsDetail}px ${fam}`, `500 ${S.fsEdge}px ${fam}`].map((f) => document.fonts.load(f)),
    ).then(bump, () => {});
    document.fonts.addEventListener?.("loadingdone", bump);
    return () => { alive = false; document.fonts.removeEventListener?.("loadingdone", bump); };
  }, []);

  const measure = useMemo<Measure>(() => {
    if (typeof document === "undefined") return defaultMeasure;
    return browserMeasure();
  }, []);

  // Direction: the viewport wins on a phone, otherwise the agent's hint.
  const narrow = bucket != null && bucket <= NARROW_PX;
  const dir: Dir = narrow ? "tb" : (block.direction ?? "lr");

  const layout: DiagramLayout = useMemo(
    () => layoutDiagram(block, { dir, measure }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fontEpoch is a re-measure trigger, not a value
    [block, dir, measure, fontEpoch],
  );

  // ResizeObserver on the scroll wrapper, but state only moves when the DIRECTION
  // BUCKET changes — a per-pixel setState would relayout the diagram on every
  // frame of a resize animation.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const apply = (w: number) => setBucket((b) => {
      const next = w <= NARROW_PX ? NARROW_PX : NARROW_PX + 1;
      return b === next ? b : next;
    });
    apply(el.clientWidth);
    const ro = new ResizeObserver(() => apply(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { bounds } = layout;

  // Fit button: the whole width in view (never above true size, never below the overview floor).
  const fit = () => {
    const w = scrollRef.current?.clientWidth ?? bounds.w;
    return clamp(Math.min(1, w / bounds.w));
  };
  // Opening zoom: exact fit when the drawing is nearly the window's width, otherwise TRUE size and scroll.
  const opening = () => {
    const f = fit();
    return f >= FIT_SNAP ? f : 1;
  };
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || bucket == null) return;
    didInit.current = true;
    setZoom(opening());
  }, [bucket, bounds.w]);

  const applyZoom = (next: number) => {
    const z = clamp(next);
    setZoom(z);
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: 0, top: 0 });
  };

  // ── data the UI needs ────────────────────────────────────────────────────────
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  const labelOf = useMemo(() => {
    const m = new Map(block.nodes.map((n) => [n.id, n.label]));
    return (id: string) => m.get(id) ?? id;
  }, [block.nodes]);
  const kinds = useMemo(() => {
    const s = new Set<string>();
    for (const n of layout.nodes) if (n.kind) s.add(n.kind);
    return [...s];
  }, [layout.nodes]);

  const incident = useMemo(() => {
    if (!sel) return new Set<string>();
    const s = new Set<string>([sel]);
    for (const e of layout.edges) {
      if (e.e.from === sel) s.add(e.e.to);
      if (e.e.to === sel) s.add(e.e.from);
    }
    return s;
  }, [layout, sel]);

  // `dim` = selected-elsewhere OR filtered-out by the legend. A node with no kind
  // is never dimmed by the legend (it is not in any kind set).
  const kindOf = (id: string) => byId.get(id)?.kind ?? null;
  const dim = (id: string) =>
    (sel != null && !incident.has(id)) || (() => { const k = kindOf(id); return !!k && kindOff.has(k); })();

  const selNode = sel ? byId.get(sel) : null;
  const selRaw = sel ? block.nodes.find((n) => n.id === sel) : null;
  const neighbours = sel
    ? [...incident].filter((id) => id !== sel).map((id) => ({ id, label: labelOf(id) }))
    : [];

  // First Escape clears the selection; with nothing selected the key falls through to the fullscreen
  // handler (which closes the overlay). Focus may live outside this subtree (a panel neighbour click),
  // so this is a window listener, not a React onKeyDown.
  useEffect(() => {
    if (sel == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setSel(null); }
    };
    window.addEventListener("keydown", onKey, true);   // capture: beats the fullscreen bubble handler
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sel]);

  const summary = block.summary
    ?? `${block.layout === "flow" ? "Flow" : "Relationship"} diagram, ${block.nodes.length} node${block.nodes.length === 1 ? "" : "s"}, ${block.edges.length} connection${block.edges.length === 1 ? "" : "s"}.`;

  const pick = (id: string) => setSel((s) => (s === id ? null : id));

  const body = (
    <div className="ast-cv-dg">
      {/* Reading order: caption, then the summary the aria description points at. */}
      {block.caption && <p className="ast-cv-dg-caption">{block.caption}</p>}
      <div role="group" aria-label={block.caption || "Diagram"} aria-describedby={`${id}-sum`}>
        <p className="ast-cv-dg-summary" id={`${id}-sum`}>{summary}</p>
      </div>

      <div className="ast-cv-dg-stage">
        <div className="ast-cv-dg-scroll" ref={scrollRef}>
          {/* The SIZER carries the scaled extent, so the scroll bars are right. */}
          <div className="ast-cv-dg-sizer" style={{ width: bounds.w * zoom, height: bounds.h * zoom }}>
            <svg
              className="ast-cv-dg-svg"
              viewBox={`0 0 ${bounds.w} ${bounds.h}`}
              width={bounds.w}
              height={bounds.h}
              style={{ transform: `scale(${zoom})` }}
              role="img"
              aria-label={summary}
            >
              <defs>
                <marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-accent)" />
                </marker>
              </defs>

              {/* 1. edges, behind everything. Chips above them interrupt the line
                  exactly where its label reads, so a line can never cross its text. */}
              {layout.edges.map((e, i) => {
                const lit = sel != null && (e.e.from === sel || e.e.to === sel);
                const card = e.e.cardinality;
                // A crow's-foot terminator REPLACES the plain arrowhead: an ER
                // reader needs "many" vs "one", and an arrowhead under a fork
                // would claim direction where cardinality claims multiplicity.
                const src = e.pts[0], dst = e.pts[e.pts.length - 1];
                return (
                  <g key={i} className={dim(e.e.from) && dim(e.e.to) ? "ast-cv-dg-dim" : undefined}>
                    <path
                      className="ast-cv-dg-path"
                      d={routeD(e.pts, block.route === "smooth")}
                      markerEnd={e.self || card ? undefined : `url(#${id}-arrow)`}
                      style={lit ? { strokeWidth: 2.4 } : undefined}
                    />
                    {!e.self && card && (
                      <>
                        <CardFoot at={dst} from={src} to={dst} cardinality={card} />
                        <text className="ast-cv-dg-card" x={dst.x - 5} y={dst.y - 9} textAnchor="end">{card}</text>
                      </>
                    )}
                  </g>
                );
              })}

              {/* 2. node boxes + text. */}
              {layout.nodes.map((n) => (
                <g
                  key={n.id}
                  className={`ast-cv-dg-node${sel === n.id ? " is-sel" : ""}${dim(n.id) ? " ast-cv-dg-dim" : ""}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${n.label.join(" ")}${n.kind ? `. ${n.kind}` : ""}. Connected to ${block.edges.filter((e) => e.from === n.id || e.to === n.id).length}: ${block.edges.filter((e) => e.from === n.id || e.to === n.id).map((e) => (e.from === n.id ? labelOf(e.to) : labelOf(e.from))).join(", ")}.`}
                  onClick={() => pick(n.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(n.id); }
                  }}
                >
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={10} />
                  {/* ER / CIRCUIT: the header bar separates the table name from its
                      columns, and each field is one row. The glyph is text, not
                      hue — pk is a key, fk an arrow, nullable a dimmed type. */}
                  {n.fields && (
                    <>
                      <rect className="ast-cv-dg-entity-head" x={n.x + 1} y={n.y + 1} width={n.w - 2}
                        height={S.padY * 2 + n.label.length * S.lhLabel - 2} rx={9} />
                      <line className="ast-cv-dg-entity-sep" x1={n.x + 1} x2={n.x + n.w - 1}
                        y1={n.y + S.padY * 2 + n.label.length * S.lhLabel - 2}
                        y2={n.y + S.padY * 2 + n.label.length * S.lhLabel - 2} />
                      {n.fields.map((f, fi) => {
                        const raw = block.nodes.find((x) => x.id === n.id)?.fields?.[fi];
                        const top = n.y + S.padY * 2 + n.label.length * S.lhLabel + 4 + fi * S.lhField;
                        return (
                          <g key={f.name + fi}>
                            {raw?.pk && (
                              <text className="ast-cv-dg-field-key" x={n.x + S.padX} y={top + S.lhField - 4} aria-hidden="true">⚿</text>
                            )}
                            {raw?.fk && (
                              <text className="ast-cv-dg-field-key" x={n.x + S.padX + (raw.pk ? 10 : 0)} y={top + S.lhField - 4} aria-hidden="true">→</text>
                            )}
                            <text className="ast-cv-dg-field-name"
                              x={n.x + S.padX + (raw?.pk ? 11 : raw?.fk ? 11 : 0)}
                              y={top + S.lhField - 4}
                            >
                              {f.name}
                            </text>
                            {f.type && (
                              <text className="ast-cv-dg-field-type" x={n.x + n.w - S.padX} y={top + S.lhField - 4}
                                textAnchor="end" opacity={raw?.nullable ? 0.65 : 1}>
                                {f.type}
                                {raw?.nullable ? "?" : ""}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </>
                  )}
                  {n.symbol && <CircuitGlyph symbol={n.symbol} cx={n.x + n.w - 20} cy={n.y + n.h / 2} />}
                  {n.label.map((l, li) => (
                    <text key={li} className="ast-cv-dg-label" x={n.x + S.padX} y={n.y + S.padY + S.lhLabel * (li + 1) - 4}>
                      {l}
                    </text>
                  ))}
                  {n.detail && (
                    // line 1 sits at the TOP of the detail band; each next tspan steps one lhDetail down.
                    <text className="ast-cv-dg-detail" x={n.x + S.padX} y={n.y + S.padY + n.label.length * S.lhLabel + 2 + (S.lhDetail - S.fsDetail) / 2 + S.fsDetail - 2}>
                      {n.detail.map((d, di) => (
                        <tspan key={di} x={n.x + S.padX} dy={di === 0 ? 0 : S.lhDetail}>{d}</tspan>
                      ))}
                    </text>
                  )}
                </g>
              ))}

              {/* 3. edge-label CHIPS, above the lines — the label masks the line it
                  annotates, which is why a chip can sit on its own edge. */}
              {layout.labelBoxes.map((l) => (
                <g key={`${l.i}`} className={dim(l.id.from) && dim(l.id.to) ? "ast-cv-dg-dim" : undefined}>
                  <rect className="ast-cv-dg-chip" x={l.x} y={l.y} width={l.w} height={l.h} rx={6} />
                  {l.lines.map((t, ti) => (
                    <text key={ti} className="ast-cv-dg-elabel" x={l.x + l.w / 2} y={l.y + l.h / 2 + S.lhEdge * (ti - (l.lines.length - 1) / 2) - 1}>
                      {t}
                    </text>
                  ))}
                </g>
              ))}
            </svg>
          </div>
        </div>
      </div>

      {/* Zoom controls are a row BELOW the stage (never an overlay): content may never be covered — owner law. */}
      <div className="ast-cv-dg-controls">
        <button type="button" aria-label="Zoom out" onClick={() => applyZoom(zoom / ZOOM_STEP)}><ZoomOut className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" aria-label="Zoom in" onClick={() => applyZoom(zoom * ZOOM_STEP)}><ZoomIn className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" aria-label="Fit" onClick={() => applyZoom(fit())}><Scan className="h-4 w-4" aria-hidden="true" /></button>
      </div>

      {/* Legend: only with 2+ kinds. Toggle chips dim the non-matching nodes. */}
      {kinds.length > 1 && (
        <div className="ast-cv-dg-legend" role="group" aria-label="Filter by kind">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={!kindOff.has(k)}
              onClick={() => setKindOff((prev) => {
                const next = new Set(prev);
                if (next.has(k)) next.delete(k); else next.add(k);
                return next;
              })}
            >{k}</button>
          ))}
        </div>
      )}

      {/* The detail panel is a NORMAL div BELOW the stage — a sibling, never an
          overlay, so it cannot overlap the drawing however the layout grows. */}
      {selNode && selRaw && (
        <div className="ast-cv-dg-panel">
          <strong>{selRaw.label}</strong>
          {selRaw.kind && <span>{selRaw.kind}</span>}
          {(selRaw.note ?? selRaw.detail) && <span>{selRaw.note ?? selRaw.detail}</span>}
          <span>
            Connected to {neighbours.length}:{" "}
            {neighbours.map((n, i) => (
              <button key={n.id} type="button" className="ast-cv-dg-neighbour" onClick={() => setSel(n.id)}>
                {n.label}{i < neighbours.length - 1 ? ", " : ""}
              </button>
            ))}
          </span>
        </div>
      )}

      {/* Text twin: the same connections, readable with no eyes on the shapes. */}
      <details className="ast-cv-dg-twin">
        <summary>Connections as text</summary>
        <ul>
          {block.edges.map((e, i) => (
            <li key={i}>{labelOf(e.from)} → {labelOf(e.to)}{e.label ? ` (${e.label})` : ""}</li>
          ))}
        </ul>
      </details>
    </div>
  );

  return <Expandable id={id} title={block.caption ?? "Diagram"}>{body}</Expandable>;
}

export default DiagramView;