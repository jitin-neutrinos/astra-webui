// Canvas block renderers — the individual generative-UI surfaces. Pure
// presentational; data contracts live in canvas-schema.ts. Lazy-loaded as a
// chunk with CanvasView (recharts never enters the main bundle).
import { useEffect, useMemo, useRef, useState, lazy, Suspense, Fragment } from "react";
import { useReducedMotion, useSpring, motion } from "motion/react";
import { cn } from "../../lib/utils";
import { bindNumber, bindPoints, bindVisible, resolveFrom, type FromBinding, type DataRow } from "../../lib/canvas-bind";
import { useCanvasStateVersion, useCanvasScope } from "./canvas-state";

/** Per-canvas render context: the reactive scope + the card's datasets. */
export interface RenderCtx {
  scope: Record<string, unknown>;
  datasets: Map<string, DataRow[]>;
}

const isBinding = (v: unknown): boolean => v != null && typeof v === "object";

function formatKpi(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** A card is reactive if any block declares a binding or a `visible`. */
function isReactiveBlock(b: CanvasBlock): boolean {
  const o = b as unknown as Record<string, unknown>;
  return o.visible != null || isBinding(o.value) || isBinding(o.delta) || isBinding(o.bind) ||
    (b.type === "data") || isBinding(o.points) || isBinding(o.spark);
}

/** Collect the card's `data` carriers by name for `$from` readers. */
function collectData(blocks: CanvasBlock[]): Map<string, DataRow[]> {
  const out = new Map<string, DataRow[]>();
  for (const b of blocks) {
    if (b.type !== "data") continue;
    const d = b as unknown as { name: string; columns?: string[]; rows: (string | number | boolean | null)[][]; header?: boolean };
    const cols = d.columns?.length ? d.columns : inferCols(d.rows);
    const body = d.columns?.length ? d.rows : (d.header === false ? d.rows : d.rows.slice(1));
    out.set(d.name, body.map((r) => {
      const o: DataRow = {};
      cols.forEach((c, i) => {
        const v = r[i];
        o[c] = v == null ? null : typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : String(v);
      });
      return o;
    }));
  }
  return out;
}

function inferCols(rows: unknown[][]): string[] {
  const first = rows[0];
  return first && first.every((c) => typeof c === "string") ? (first as string[]) : [];
}

/** Resolve a reactive table's rows: `bind.$from` + filter/sort/top over a `data` block. */
function reactiveRows(bindVal: unknown, ctx?: RenderCtx): { columns: string[]; rows: string[][] } | null {
  if (!bindVal || typeof bindVal !== "object" || !ctx) return null;
  const fb = bindVal as FromBinding;
  if (typeof fb.$from !== "string") return null;
  const source = ctx.datasets.get(fb.$from);
  if (!source) return null;
  const cols = source.length ? Object.keys(source[0]) : [];
  if (!cols.length) return null;
  const rows = resolveFrom(fb, ctx.datasets, ctx.scope);
  return { columns: cols, rows: rows.map((r) => cols.map((c) => (r[c] == null ? "" : String(r[c])))) };
}

// recharts lives behind this boundary: chart blocks defer-load the engine, every
// other block type (and the whole gate path) stays sync and dependency-free.
const ChartBlockView = lazy(() => import("./canvas-chart").then((m) => ({ default: m.ChartBlockView })));
import type { CanvasBlock, KpiBlock, TableBlock, DiagramBlock, ChecklistBlock, StepsBlock, CalloutBlock, ProgressBlock, TimelineBlock, CompareBlock, TreeBlock, CodeBlock, ReferencesBlock, QuoteBlock, KeyValueBlock, DiffBlock, HeatmapBlock, TabsBlock, AccordionBlock, TerminalBlock, BadgesBlock, DividerBlock } from "../../lib/canvas-schema";


// ---- KPI ---------------------------------------------------------------------

function CountUp({ value }: { value: unknown }) {
  const reduce = useReducedMotion();
  // React error #31: an object rendered as a child kills the WHOLE card. A
  // reactive spec puts {"$expr": …} here, so resolve + coerce BEFORE JSX.
  if (isBinding(value)) return null;
  const num = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.\-]/g, ""));
  const parseable = typeof value === "number" || /^\s*[0-9][0-9.,\s]*\s*$/.test(String(value));
  if (reduce || !parseable || !Number.isFinite(num)) {
    return <span className="ast-cv-kpi-value">{String(value ?? "—")}</span>;
  }
  return <CountUpInner value={num} display={String(value)} />;
}

function CountUpInner({ value, display }: { value: number; display: string }) {
  const spring = useSpring(0, { stiffness: 90, damping: 24 });
  const [shown, setShown] = useState(display.replace(/[0-9]/g, "0"));
  useEffect(() => {
    const unsub = spring.on("change", (v: number) => {
      const digits = display.match(/[0-9]/g)?.length ?? 1;
      const cur = Math.round(v).toString().padStart(digits, "0");
      let i = 0;
      setShown(display.replace(/[0-9]/g, () => cur[i++] ?? "0"));
    });
    spring.set(value);
    return unsub;
  }, [value, display, spring]);
  return <span className="ast-cv-kpi-value">{shown}</span>;
}

// Hand-rolled SVG sparkline for KPI tiles. No library: three points, one path,
// an end dot for "where it ended". Tone follows the KPI trend when present.
function Sparkline({ points, trend }: { points: number[]; trend?: string }) {
  const W = 68;
  const H = 22;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = points.length > 1 ? W / (points.length - 1) : W;
  let d = "";
  points.forEach((p, i) => {
    const x = +(i * step).toFixed(1);
    const y = +(H - 2.5 - ((p - min) / span) * (H - 5)).toFixed(1);
    d += `${i === 0 ? "M" : " L"} ${x} ${y}`;
  });
  const lastX = +((points.length - 1) * step).toFixed(1);
  const lastY = +(H - 2.5 - ((points[points.length - 1] - min) / span) * (H - 5)).toFixed(1);
  return (
    <svg
      className={cn("ast-cv-spark", trend === "down" && "down")}
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r={2} fill="currentColor" />
    </svg>
  );
}

export function KpiTile({ block }: { block: KpiBlock }) {
  // A control write anywhere in this card re-renders, which is what makes a
  // derived KPI ("MRR = seats × price") actually live.
  useCanvasStateVersion();
  const scope = useCanvasScope();
  const raw = (block as unknown as { value: unknown }).value;
  const value = isBinding(raw) ? bindNumber(raw, scope) : raw;
  const dRaw = (block as unknown as { delta: unknown }).delta;
  const delta = isBinding(dRaw) ? bindNumber(dRaw, scope) : dRaw;
  const spRaw = (block as unknown as { spark: unknown }).spark;
  const spark = isBinding(spRaw) ? bindPoints(spRaw, scope) : Array.isArray(spRaw) ? (spRaw as number[]) : null;

  const glyph = block.trend === "up" ? "↑" : block.trend === "down" ? "↓" : "";
  const cls = block.trend === "up" ? "up" : block.trend === "down" ? "down" : "";
  return (
    <div className="ast-cv-kpi">
      <span className="ast-cv-kpi-label">{block.label}</span>
      <div className="ast-cv-kpi-row">
        <CountUp value={value} />
        {delta != null && (
          <span className={cn("ast-cv-kpi-delta", cls)} title={typeof delta === "number" ? formatKpi(delta) : String(delta)}>
            <span className="ast-cv-kpi-delta-glyph" aria-hidden="true">{glyph}</span>
            <span className="ast-cv-kpi-delta-text">{typeof delta === "number" ? formatKpi(delta) : String(delta)}</span>
          </span>
        )}
      </div>
      {spark && spark.length >= 3 && <Sparkline points={spark} trend={block.trend} />}
    </div>
  );
}

// ---- Table -------------------------------------------------------------------

// OWNER 2026-10-04: "the table gets mangled, only the headers are displayed with
// the table body missing". Root cause found by replaying the real corpus: the
// model emits `{"columns":[…], "rows":[]}` (2 of 51 real cards), which passed
// validation because `[].every(…)` is vacuously true — so the card rendered as a
// bare header row. Fixed at the schema (an empty table degrades) and hardened
// here so no future shape can produce a header with no body again.
export function TableBlockView({ block, ctx }: { block: TableBlock; ctx?: RenderCtx }) {
  const reactive = reactiveRows((block as unknown as { bind?: unknown }).bind, ctx);
  const cols = reactive ? reactive.columns : (block.columns ?? []);
  const rawRows = reactive ? reactive.rows : Array.isArray(block.rows) ? block.rows : [];
  // Pad/trim every row to the header width: a ragged row renders as blanks
  // rather than shifting every column after it.
  const rows = rawRows
    .filter((r) => Array.isArray(r) && r.length > 0)
    .map((r) => Array.from({ length: cols.length }, (_, j) => r[j] ?? ""));

  // Per-COLUMN numeric detection (design critique C10): the old per-CELL regex
  // mixed alignments inside one visual column ("n/a" beside "9").
  const numCols = useMemo(
    () =>
      cols.map(
        (_, j) =>
          rows.length > 0 &&
          rows.filter((r) => r[j] && r[j].trim() !== "").length >= Math.ceil(rows.length * 0.7) &&
          rows.every((r) => !r[j] || r[j].trim() === "" || /^[\d.,%+\-$€£₹¥\s]+$/.test(r[j].trim())),
      ),
    [cols, rows],
  );

  if (rows.length === 0) {
    return (
      <div className="ast-cv-table-wrap" role="status">
        <p className="ast-cv-table-empty">No rows — this table arrived with headers only.</p>
      </div>
    );
  }

  return (
    <div className="ast-cv-table-wrap">
      <table className="ast-cv-table">
        <thead>
          <tr>
            {cols.map((c, j) => (
              <th key={c} scope="col" className={numCols[j] ? "num" : undefined}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className={numCols[j] ? "num" : undefined}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Diagram -----------------------------------------------------------------

// Nodes layered into columns; edges drawn as an SVG overlay measured from live
// DOM rects. Relationship layout renders a single grid column-wrap.
export function DiagramBlockView({ block }: { block: DiagramBlock }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<{ d: string; label?: string; x: number; y: number }[]>([]);

  const layers = useMemo(() => {
    if (block.layout === "relationship") return [block.nodes];
    const idx = new Map(block.nodes.map((n, i) => [n.id, i]));
    const layer = new Array(block.nodes.length).fill(0);
    for (let pass = 0; pass < Math.min(block.nodes.length, 8); pass++) {
      let moved = false;
      for (const e of block.edges) {
        const a = idx.get(e.from);
        const b = idx.get(e.to);
        if (a == null || b == null) continue;
        if (layer[b] < layer[a] + 1) { layer[b] = layer[a] + 1; moved = true; }
      }
      if (!moved) break;
    }
    const byLayer = new Map<number, typeof block.nodes>();
    block.nodes.forEach((n, i) => {
      const l = layer[i];
      if (!byLayer.has(l)) byLayer.set(l, []);
      byLayer.get(l)!.push(n);
    });
    return [...byLayer.entries()].sort((a, b) => a[0] - b[0]).map(([, ns]) => ns);
  }, [block]);

  useEffect(() => {
    const measure = () => {
      const root = wrapRef.current;
      if (!root) return;
      const rects = new Map<string, DOMRect>();
      root.querySelectorAll<HTMLElement>("[data-node]").forEach((el) => {
        rects.set(el.dataset.node!, el.getBoundingClientRect());
      });
      const base = root.getBoundingClientRect();
      const out: { d: string; label?: string; x: number; y: number }[] = [];
      for (const e of block.edges) {
        const a = rects.get(e.from);
        const b = rects.get(e.to);
        if (!a || !b) continue;
        const horizontal = block.direction === "lr" && block.layout === "flow";
        let x1: number, y1: number, x2: number, y2: number;
        if (horizontal) {
          x1 = a.right - base.left; y1 = a.top + a.height / 2 - base.top;
          x2 = b.left - base.left; y2 = b.top + b.height / 2 - base.top;
        } else {
          x1 = a.left + a.width / 2 - base.left; y1 = a.bottom - base.top;
          x2 = b.left + b.width / 2 - base.left; y2 = b.top - base.top;
        }
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const k = horizontal ? Math.max(24, Math.abs(x2 - x1) / 2) : Math.max(20, Math.abs(y2 - y1) / 2);
        const cx1 = horizontal ? x1 + k : x1;
        const cy1 = horizontal ? y1 : y1 + k;
        const cx2 = horizontal ? x2 - k : x2;
        const cy2 = horizontal ? y2 : y2 - k;
        out.push({ d: `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`, label: e.label, x: mx, y: my });
      }
      setEdges(out);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [block]);

  // OWNER 2026-10-04: on mobile the edges and their labels rendered BEHIND the
  // node cards, so a flow diagram was a stack of boxes with invisible lines.
  // Three structural fixes, in order of impact:
  //   1. a scrollable canvas — the whole diagram is laid out at a MIN width, so
  //      a narrow phone pans the diagram instead of crushing it;
  //   2. the SVG edge layer sits UNDER the nodes (z-index) but the LABELS sit
  //      ABOVE them, with a paper-coloured halo so they read over a card edge;
  //   3. on a coarse pointer the layout flips to a single column (tb) because a
  //      3-column side-by-side flow is unreadable under 400px.
  const compact = typeof matchMedia === "function" && matchMedia("(max-width: 560px)").matches;

  return (
    <div className={cn("ast-cv-diagram-scroll", compact && "is-compact")}>
      <div className={cn("ast-cv-diagram", block.direction === "lr" && !compact && "lr")} ref={wrapRef}>
        {/* PATHS sit under the node cards… */}
        <svg className="ast-cv-edges" aria-hidden="true">
          {edges.map((e, i) => (
            <path key={i} d={e.d} fill="none" stroke="var(--color-accent)" strokeOpacity={0.62} strokeWidth={1.8} />
          ))}
        </svg>
        {/* …and LABELS above them, with a paper halo. One layer is why the
            labels vanished behind the cards on a phone. */}
        <svg className="ast-cv-edges ast-cv-edges-labels" aria-hidden="true">
          {edges.map((e, i) => (
            e.label ? <text key={i} x={e.x} y={e.y} className="ast-cv-edge-label">{e.label}</text> : null
          ))}
        </svg>
        <div className="ast-cv-node-columns">
          {layers.map((col, ci) => (
            <div key={ci} className="ast-cv-node-col">
              {col.map((n) => (
                <div key={n.id} data-node={n.id} className="ast-cv-node">
                  <span className="ast-cv-node-label">{n.label}</span>
                  {n.detail && <span className="ast-cv-node-detail">{n.detail}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- Checklist / Steps ---------------------------------------------------------

export function ChecklistView({ block }: { block: ChecklistBlock }) {
  return (
    <ul className="ast-cv-checklist">
      {block.items.map((it, i) => (
        <li key={i} className={cn("ast-cv-check", it.status)}>
          <span className="ast-cv-check-glyph" aria-hidden="true">
            {it.status === "done" ? "✓" : it.status === "fail" ? "✕" : ""}
          </span>
          <span className="ast-cv-check-text">{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function StepsView({ block }: { block: StepsBlock }) {
  return (
    <ol className="ast-cv-steps">
      {block.items.map((it, i) => (
        <li key={i} className={cn("ast-cv-step", it.status)}>
          <span className="ast-cv-step-marker" aria-hidden="true">{i + 1}</span>
          <div className="ast-cv-step-body">
            <span className="ast-cv-step-title">{it.title}</span>
            {it.detail && <span className="ast-cv-step-detail">{it.detail}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---- Callout -------------------------------------------------------------------

// Owner 2026-10-03: the 3px coloured left rail was removed from every canvas
// block. The border was the ONLY tone signal, so the tone now rides on a small
// leading dot — the callout still reads info/warn/danger at a glance.
const CALLOUT_TONE: Record<string, string> = {
  // Owner 2026-10-03: one accent everywhere — tone survives through the
  // leading dot + title weight, not through separate hues.
  info: "var(--color-accent)",
  success: "var(--color-accent)",
  warn: "var(--color-accent)",
  danger: "var(--color-accent)",
};

export function CalloutView({ block }: { block: CalloutBlock }) {
  return (
    <div className={cn("ast-cv-callout", block.tone)}>
      <span className="ast-cv-callout-dot" aria-hidden="true" style={{ background: CALLOUT_TONE[block.tone] || "var(--color-muted)" }} />
      <div className="ast-cv-callout-main">
        {block.title && <p className="ast-cv-callout-title">{block.title}</p>}
        <p className="ast-cv-callout-body">{block.body}</p>
      </div>
    </div>
  );
}

// ---- Progress ----------------------------------------------------------------

export function ProgressView({ block }: { block: ProgressBlock }) {
  const max = block.max ?? 100;
  const pct = Math.max(0, Math.min(100, (block.value / (max || 1)) * 100));
  const shown = `${round1(pct)}${block.unit || "%"}`;
  return (
    <div className={cn("ast-cv-progress", block.status)}>
      <div className="ast-cv-progress-head">
        <span className="ast-cv-progress-label">{block.label}</span>
        <span className="ast-cv-progress-value">{shown}</span>
      </div>
      <div
        className="ast-cv-progress-track"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={block.label}
      >
        <div className="ast-cv-progress-fill" style={{ ["--cv-pct" as string]: pct }} />
      </div>
      {block.detail && <span className="ast-cv-progress-detail">{block.detail}</span>}
    </div>
  );
}

function round1(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ---- Timeline ----------------------------------------------------------------

export function TimelineView({ block }: { block: TimelineBlock }) {
  return (
    <ol className="ast-cv-timeline">
      {block.items.map((it, i) => (
        <li key={i} className={cn("ast-cv-tl-item", it.status)}>
          <span className="ast-cv-tl-rail" aria-hidden="true">
            <span className="ast-cv-tl-dot" />
          </span>
          <div className="ast-cv-tl-body">
            <div className="ast-cv-tl-head">
              <span className="ast-cv-tl-title">{it.title}</span>
              {it.time && <span className="ast-cv-tl-time">{it.time}</span>}
            </div>
            {it.detail && <span className="ast-cv-tl-detail">{it.detail}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---- Compare -----------------------------------------------------------------

export function CompareView({ block }: { block: CompareBlock }) {
  return (
    <div className="ast-cv-compare" style={{ ["--cols" as any]: block.items.length }}>
      {block.items.map((it, i) => (
        <div key={i} className="ast-cv-cmp-card">
          <div className="ast-cv-cmp-head">
            <span className="ast-cv-cmp-name">{it.name}</span>
            {it.badge && <span className="ast-cv-cmp-badge">{it.badge}</span>}
          </div>
          {it.caption && <span className="ast-cv-cmp-caption">{it.caption}</span>}
          <ul className="ast-cv-cmp-points">
            {it.points.map((p, j) => (
              <li key={j} className={cn("ast-cv-cmp-point", p.tone)}>
                <span className="ast-cv-cmp-mark" aria-hidden="true">
                  {p.tone === "pro" ? "+" : p.tone === "con" ? "−" : "·"}
                </span>
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---- Tree --------------------------------------------------------------------

export function TreeView({ block }: { block: TreeBlock }) {
  const roots = block.nodes.filter((n) => !block.nodes.some((o) => (o.children || []).includes(n.id)));
  const byId = new Map(block.nodes.map((n) => [n.id, n]));
  const render = (n: (typeof block.nodes)[number], depth: number): React.ReactNode => (
    <li key={n.id} className="ast-cv-tree-node" style={{ ["--depth" as any]: depth }}>
      <div className="ast-cv-tree-row">
        <span className="ast-cv-tree-label">{n.label}</span>
        {n.detail && <span className="ast-cv-tree-detail">{n.detail}</span>}
      </div>
      {(n.children || []).length > 0 && (
        <ul className="ast-cv-tree-kids">{n.children!.map((cid) => { const c = byId.get(cid); return c ? render(c, depth + 1) : null; })}</ul>
      )}
    </li>
  );
  return <ul className="ast-cv-tree">{roots.map((n) => render(n, 0))}</ul>;
}

// ---- Code --------------------------------------------------------------------

export function CodeView({ block }: { block: CodeBlock }) {
  return (
    <figure className="ast-cv-code">
      <figcaption className="ast-cv-code-head">
        <span className="ast-cv-code-name">{block.filename || block.language || "code"}</span>
        {block.language && <span className="ast-cv-code-lang">{block.language}</span>}
      </figcaption>
      <pre className="ast-cv-code-body"><code>{block.code}</code></pre>
    </figure>
  );
}

// ---- References ---------------------------------------------------------------

// Owner 2026-10-03: canvas links must WORK over the internet — a local file
// path pasted as an href is dead in a browser. Map host paths to the site's
// own served download endpoint (authed, works on web + Android + any device
// signed in); http(s) hrefs pass through untouched.
function linkHref(href?: string): string | undefined {
  if (!href) return undefined;
  if (/^https?:\/\//i.test(href) || href.startsWith("/") && !href.startsWith("/home/")) {
    // absolute URL or a site-relative path — usable as-is
    if (/^https?:\/\//i.test(href)) return href;
  }
  // host file path (~/..., /home/..., or bare relative repo path) → served
  if (href.startsWith("~") || href.startsWith("/home/") || href.startsWith("/")) {
    const p = href.replace(/^~(?=\/)/, "");
    return `/api/hx/files/download?path=${encodeURIComponent(p)}`;
  }
  return href;
}

export function ReferencesView({ block }: { block: ReferencesBlock }) {
  return (
    <ol className="ast-cv-refs">
      {block.items.map((it, i) => {
        const href = linkHref(it.href);
        return (
          <li key={i} className="ast-cv-ref">
            <span className="ast-cv-ref-index">{i + 1}</span>
            <span className="ast-cv-ref-body">
              {href ? (
                <a className="ast-cv-ref-link" href={href} target="_blank" rel="noopener noreferrer">{it.title}</a>
              ) : (
                <span className="ast-cv-ref-link">{it.title}</span>
              )}
              {it.note && <span className="ast-cv-ref-note">{it.note}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// ---- Quote --------------------------------------------------------------------

export function QuoteView({ block }: { block: QuoteBlock }) {
  return (
    <figure className="ast-cv-quote">
      <blockquote className="ast-cv-quote-text">{block.text}</blockquote>
      {(block.attribution || block.role || block.context) && (
        <figcaption className="ast-cv-quote-cite">
          {block.attribution && <span className="ast-cv-quote-att">{block.attribution}</span>}
          {block.role && <span className="ast-cv-quote-role">{block.role}</span>}
          {block.context && <span className="ast-cv-quote-ctx">{block.context}</span>}
        </figcaption>
      )}
    </figure>
  );
}

// ---- Key/value ----------------------------------------------------------------

export function KeyValueView({ block }: { block: KeyValueBlock }) {
  return (
    <div className="ast-cv-kv">
      {block.title && <span className="ast-cv-kv-title">{block.title}</span>}
      <dl className="ast-cv-kv-list">
        {block.items.map((it, i) => (
          <div key={i} className="ast-cv-kv-row">
            <dt className="ast-cv-kv-key">{it.key}</dt>
            <dd className={cn("ast-cv-kv-val", it.mono && "mono")}>{String(it.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---- Diff ---------------------------------------------------------------------

const DIFF_MARK: Record<string, string> = { add: "+", del: "−", ctx: "" };

export function DiffView({ block }: { block: DiffBlock }) {
  const adds = block.hunks.reduce((n, h) => n + h.lines.filter((l) => l.op === "add").length, 0);
  const dels = block.hunks.reduce((n, h) => n + h.lines.filter((l) => l.op === "del").length, 0);
  return (
    <figure className="ast-cv-diff">
      <figcaption className="ast-cv-diff-head">
        <span className="ast-cv-diff-name">{block.filename || "changes"}</span>
        <span className="ast-cv-diff-stats">
          <span className="add">+{adds}</span>
          <span className="del">−{dels}</span>
        </span>
      </figcaption>
      <div className="ast-cv-diff-body">
        {block.hunks.map((h, i) => (
          <div key={i} className="ast-cv-diff-hunk">
            {h.header && <span className="ast-cv-diff-hdr">{h.header}</span>}
            {h.lines.map((l, j) => (
              <div key={j} className={cn("ast-cv-dl", l.op)}>
                <span className="ast-cv-dl-mark" aria-hidden="true">{DIFF_MARK[l.op]}</span>
                <span className="ast-cv-dl-text">{l.text || " "}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </figure>
  );
}

// ---- Heatmap ------------------------------------------------------------------

/** Compact number for heatmap cells (keeps cells from being cut off). */
function compactNum(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

export function HeatmapView({ block }: { block: HeatmapBlock }) {
  const flat = block.values.flat();
  const max = Math.max(...flat);
  const min = Math.min(...flat);
  const span = max - min || 1;
  // Normalise to the grid's own range so a flat grid is not all-max.
  const t = (v: number) => (max === min ? 0.5 : (v - min) / span);
  const pct = (v: number) => Math.round(t(v) * 78) + 5;
  const wide = block.cols.length > 10;
  return (
    <figure className="ast-cv-heat">
      {block.title && <figcaption className="ast-cv-heat-title">{block.title}</figcaption>}
      <div className="ast-cv-heat-grid" style={{ gridTemplateColumns: `auto repeat(${block.cols.length}, minmax(0, 1fr))` }}>
        <span className="ast-cv-heat-corner" aria-hidden="true" />
        {block.cols.map((c) => <span key={c} className="ast-cv-heat-col">{c}</span>)}
        {block.rows.map((r, ri) => (
          <Fragment key={r}>
            <span className="ast-cv-heat-row">{r}</span>
            {block.cols.map((c, ci) => {
              const v = block.values[ri][ci];
              return (
                <span
                  key={c + ci}
                  className="ast-cv-heat-cell"
                  style={{ background: `color-mix(in srgb, var(--color-accent) ${pct(v)}%, transparent)` }}
                  title={`${r} · ${c}: ${v}`}
                >
                  {!wide && <span className="ast-cv-heat-val">{compactNum(v)}</span>}
                </span>
              );
            })}
          </Fragment>
        ))}
      </div>
      <div className="ast-cv-heat-scale" aria-hidden="true">
        <span className="ast-cv-heat-scale-label">low</span>
        {[6, 25, 44, 63, 83].map((p) => (
          <span key={p} className="ast-cv-heat-step" style={{ background: `color-mix(in srgb, var(--color-accent) ${p}%, transparent)` }} />
        ))}
        <span className="ast-cv-heat-scale-label">high</span>
      </div>
    </figure>
  );
}

// ---- Tabs ---------------------------------------------------------------------

export function TabsView({ block }: { block: TabsBlock }) {
  const [active, setActive] = useState(0);
  const idx = Math.min(active, block.items.length - 1);
  const cur = block.items[idx];
  return (
    <div className="ast-cv-tabs">
      <div role="tablist" className="ast-cv-tablist" aria-label="Canvas tabs">
        {block.items.map((it, i) => (
          <button
            key={it.label + i}
            type="button"
            role="tab"
            aria-selected={i === idx}
            className={cn("ast-cv-tab", i === idx && "on")}
            onClick={() => setActive(i)}
          >
            {it.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="ast-cv-tabpanel">
        <Blocks blocks={cur.blocks} />
      </div>
    </div>
  );
}

// ---- Accordion ----------------------------------------------------------------

export function AccordionView({ block }: { block: AccordionBlock }) {
  const [open, setOpen] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    block.items.forEach((it, i) => { if (it.open) init[i] = true; });
    return init;
  });
  return (
    <div className="ast-cv-acc">
      {block.items.map((it, i) => (
        <div key={i} className={cn("ast-cv-acc-item", open[i] && "open")}>
          <button
            type="button"
            className="ast-cv-acc-trigger"
            aria-expanded={!!open[i]}
            onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}
          >
            <span className="ast-cv-acc-chev" aria-hidden="true">›</span>
            <span className="ast-cv-acc-title">{it.title}</span>
          </button>
          {open[i] && (
            <div className="ast-cv-acc-body">
              {it.body && <p className="ast-cv-acc-text">{it.body}</p>}
              {it.blocks && it.blocks.length > 0 && <Blocks blocks={it.blocks} animate={false} />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---- Terminal -----------------------------------------------------------------

const TERM_TONE: Record<string, string | undefined> = {
  stdout: undefined, info: "var(--color-accent)", success: "var(--color-accent)",
  stderr: "var(--color-accent)", dim: "var(--color-muted)",
};

export function TerminalView({ block }: { block: TerminalBlock }) {
  return (
    <figure className="ast-cv-term">
      {(block.title || block.command) && (
        <figcaption className="ast-cv-term-head">
          <span className="ast-cv-term-title">{block.title || "terminal"}</span>
          {block.command && <code className="ast-cv-term-cmd">$ {block.command}</code>}
        </figcaption>
      )}
      <pre className="ast-cv-term-body">
        {block.lines.map((l, i) => (
          <span key={i} className="ast-cv-term-line" style={{ color: TERM_TONE[l.tone || "stdout"] }}>{l.text || " "}</span>
        ))}
      </pre>
      {block.exitCode != null && (
        <span className={cn("ast-cv-term-exit", block.exitCode === 0 ? "ok" : "bad")}>exit {block.exitCode}</span>
      )}
    </figure>
  );
}

// ---- Badges -------------------------------------------------------------------

export function BadgesView({ block }: { block: BadgesBlock }) {
  return (
    <div className="ast-cv-badges">
      {block.items.map((it, i) => (
        <span key={i} className={cn("ast-cv-badge", it.tone || "neutral")}>{it.label}</span>
      ))}
    </div>
  );
}

// ---- Divider ------------------------------------------------------------------

export function DividerView({ block }: { block: DividerBlock }) {
  return block.label ? (
    <div className="ast-cv-divider" role="separator">
      <span className="ast-cv-div-line" aria-hidden="true" />
      <span className="ast-cv-div-label">{block.label}</span>
      <span className="ast-cv-div-line" aria-hidden="true" />
    </div>
  ) : (
    <hr className="ast-cv-divider bare" />
  );
}

// ---- Grouping (KPI rows + single blocks) ----------------------------------------

export function Blocks({
  blocks,
  animate = true,
  canvasId = "0",
}: {
  blocks: CanvasBlock[];
  animate?: boolean;
  /** Stable per-card prefix for fullscreen slot keys; unique within one canvas. */
  canvasId?: string;
}) {
  // The reactive context: current control values + this card's `data` datasets.
  // Built here (not per block) so every reader in the card sees one snapshot.
  const reactiveBlocks = useMemo(() => blocks.some(isReactiveBlock), [blocks]);
  const scope = useCanvasScope();
  const datasets = useMemo(() => collectData(blocks), [blocks]);
  const ctx: RenderCtx | undefined = reactiveBlocks ? { scope, datasets } : undefined;
  const groups: CanvasBlock[][] = [];
  let rowRun: CanvasBlock[] = [];
  const flush = () => { if (rowRun.length > 0) { groups.push(rowRun); rowRun = []; } };
  // KPI and progress blocks read as ROWS; everything else stands alone.
  const ROWY = new Set(["kpi", "progress"]);
  for (const b of blocks) {
    if (ROWY.has(b.type)) {
      rowRun.push(b);
      // a KPI row is 4 tiles; progress bars read best stacked 1-wide or 2-wide
      const cap = b.type === "kpi" ? 4 : 1;
      if (rowRun.filter((x) => x.type === "kpi").length >= 4 || (b.type === "progress" && rowRun.length >= 1)) flush();
      else if (cap === 1) flush();
    } else {
      flush();
      groups.push([b]);
    }
  }
  flush();

  return (
    <>
      {groups.map((g, gi) => {
        const rowKind = g[0].type;
        return (
          <div key={gi} className={cn("ast-cv-group", (rowKind === "kpi" || rowKind === "progress") && "rows")}>
            {g.map((b, bi) => {
              const inner = renderOne(b, `${canvasId}-${gi}`, bi, ctx);
              // --i drives the CSS stagger (no per-block JS timer) and keeps the
              // arrival index in the DOM for QA.
              const idx = { ["--i" as string]: bi } as React.CSSProperties;
              if (!animate) return <div key={bi} className="ast-cv-item" style={idx}>{inner}</div>;
              return (
                <motion.div key={bi}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: Math.min(bi * 0.05, 0.25) }}
                  className="ast-cv-item"
                  style={idx}>
                  {inner}
                </motion.div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

// v4 editable surfaces live in their own module, lazy so an ordinary chat never
// loads docx / pptxgenjs. Only canvas-docs pulls those; canvas-blocks stays
// dependency-free (the eager-path rule that keeps recharts out of the main bundle).
const SpreadsheetLazy = lazy(() => import("./canvas-docs").then((m) => ({ default: m.SpreadsheetView })));
const SlidesLazy = lazy(() => import("./canvas-docs").then((m) => ({ default: m.SlidesBlockView })));
const DocLazy = lazy(() => import("./canvas-docs").then((m) => ({ default: m.DocumentBlockView })));
const TextLazy = lazy(() => import("./canvas-docs").then((m) => ({ default: m.TextView })));

// v5 reactive + media blocks: another lazy chunk (canvas-reactive). Control
// blocks read/write the per-canvas state provided by CanvasStateProvider.
const ReactiveLazy = lazy(() => import("./canvas-reactive").then((m) => ({ default: m.ReactiveHub })));
// v5 knowledge graph — its own lazy chunk (layout maths + SVG renderer).
const GraphLazy = lazy(() => import("./canvas-graph-view"));

function DocSkeleton() {
  // No spinner: the owner reads a loader artifact as a broken card.
  return <div className="ast-cv-doc-skeleton" aria-busy="true" />;
}

function renderOne(b: CanvasBlock, id: string, bi: number, ctx?: RenderCtx): React.ReactNode {
  // `data` blocks are carriers for `$from` readers — never a surface.
  if (b.type === "data") return null;
  // `visible` gates a whole block (json-render semantics); unset ⇒ visible.
  const vis = (b as unknown as { visible?: unknown }).visible;
  if (vis != null && ctx && !bindVisible(vis, ctx.scope)) return null;
  switch (b.type) {
    case "kpi": return <KpiTile block={b} />;
    case "progress": return <ProgressView block={b} />;
    case "timeline": return <TimelineView block={b} />;
    case "compare": return <CompareView block={b} />;
    case "tree": return <TreeView block={b} />;
    case "code": return <CodeView block={b} />;
    case "references": return <ReferencesView block={b} />;
    case "quote": return <QuoteView block={b} />;
    case "keyvalue": return <KeyValueView block={b} />;
    case "diff": return <DiffView block={b} />;
    case "heatmap": return <HeatmapView block={b} />;
    case "tabs": return <TabsView block={b} />;
    case "accordion": return <AccordionView block={b} />;
    case "terminal": return <TerminalView block={b} />;
    case "badges": return <BadgesView block={b} />;
    case "divider": return <DividerView block={b} />;
    case "table": return <TableBlockView block={b} ctx={ctx} />;
    case "diagram": return <DiagramBlockView block={b} />;
    case "checklist": return <ChecklistView block={b} />;
    case "steps": return <StepsView block={b} />;
    case "chart":
      return (
        <Suspense fallback={<div className="ast-cv-chart ast-cv-chart-skeleton" aria-busy="true" />}>
          <ChartBlockView block={b} ctx={ctx} />
        </Suspense>
      );
    case "callout": return <CalloutView block={b} />;
    // v4 editable surfaces. The id keys the fullscreen slot: canvas index +
    // block index is stable and unique per card.
    case "spreadsheet": return <Suspense fallback={<DocSkeleton />}><SpreadsheetLazy block={b} id={`cv-sheet-${id}-${bi}`} /></Suspense>;
    case "slides": return <Suspense fallback={<DocSkeleton />}><SlidesLazy block={b} id={`cv-deck-${id}-${bi}`} /></Suspense>;
    case "document": return <Suspense fallback={<DocSkeleton />}><DocLazy block={b} id={`cv-doc-${id}-${bi}`} /></Suspense>;
    case "text": return <Suspense fallback={<DocSkeleton />}><TextLazy block={b} id={`cv-text-${id}-${bi}`} /></Suspense>;
    // v5 reactive + media (own lazy chunk)
    case "slider": case "select": case "multiselect": case "segmented":
    case "toggle": case "search": case "image": case "gallery": case "video":
      return <Suspense fallback={null}><ReactiveLazy block={b} /></Suspense>;
    // v5 knowledge graph
    case "graph": return <Suspense fallback={<div className="ast-cv-graph-skeleton" aria-busy="true" />}><GraphLazy block={b} /></Suspense>;
  }
}
