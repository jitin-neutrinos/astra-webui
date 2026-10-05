// Canvas block renderers — the individual generative-UI surfaces. Pure
// presentational; data contracts live in canvas-schema.ts. Lazy-loaded as a
// chunk with CanvasView (recharts never enters the main bundle).
import { useEffect, useMemo, useState, lazy, Suspense, Fragment } from "react";
import { useReducedMotion, useSpring, motion } from "motion/react";
import { cn } from "../../lib/utils";
import { AREAS, bentoLayout } from "../../lib/bento";
import { bindNumber, bindPoints, bindVisible, resolveBinding, resolveFrom, type FromBinding, type DataRow } from "../../lib/canvas-bind";
import { useCanvasStateVersion, useCanvasScope, useCanvasSeeder, type StateValue } from "./canvas-state";

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
    (b.type === "data") || isBinding(o.points) || isBinding(o.spark) ||
    // a chart whose ONLY reactive part is a per-series binding still needs ctx
    (Array.isArray(o.series) && (o.series as { points?: unknown; visible?: unknown }[]).some((s) => isBinding(s.points) || s.visible != null));
}

/** Write a control's authored default into the card scope. A control that
 *  only shows its fallback in the UI would leave every `{$expr: "n*2"}` reader
 *  at "—" until the user touched the control; the default IS the first value.
 *  (Controls nested in tabs/accordion are out of scope — no recursion here.) */
function seedControlDefault(b: CanvasBlock, seed: (k: string, v: StateValue | StateValue[]) => void) {
  switch (b.type) {
    case "slider": seed(b.bind, b.value ?? b.min); break;
    case "select": case "segmented": seed(b.bind, b.value ?? b.options[0]?.value ?? ""); break;
    case "multiselect": seed(b.bind, (b.value ?? []) as unknown as StateValue); break;
    case "toggle": seed(b.bind, b.value ?? false); break;
    case "search": seed(b.bind, ""); break;
  }
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
import type { CanvasBlock, KpiBlock, TableBlock, ChecklistBlock, StepsBlock, CalloutBlock, ProgressBlock, TimelineBlock, CompareBlock, TreeBlock, CodeBlock, ReferencesBlock, QuoteBlock, KeyValueBlock, DiffBlock, HeatmapBlock, TabsBlock, AccordionBlock, TerminalBlock, BadgesBlock, DividerBlock, LayoutBlock } from "../../lib/canvas-schema";


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
  // resolveBinding, NOT bindNumber: `money(seats*price)` resolves to the STRING
  // "$5,000" and bindNumber would strip the $ and render a bare 5000. The value
  // is shown as the expression produced it; only `delta` wants a number.
  const resolved = isBinding(raw) ? resolveBinding(raw, scope) : { value: raw, unset: false };
  const value: string | number | null = resolved.unset || resolved.value == null ? null
    : typeof resolved.value === "number" ? (Number.isFinite(resolved.value) ? resolved.value : null)
    : typeof resolved.value === "boolean" ? String(resolved.value)
    : String(resolved.value);
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
// The diagram surface moved to ./canvas-diagram (its own lazy chunk): one SVG
// drawn from the PURE layout in lib/diagram-layout.ts, so node/label overlap is
// audited rather than nudged. See DiagramLazy below.

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
  // Owner 2026-10-05: semantic tone colours — success/warn/danger render green/
  // amber/red from the active theme roles. Still NO edge rails (law 3): the tone
  // rides the leading dot + title colour only.
  info: "var(--color-accent)",
  success: "var(--color-emerald)",
  warn: "var(--color-amber)",
  danger: "var(--color-redx)",
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
  // `value` may be a binding (a bar driven by card state), so resolve it here.
  useCanvasStateVersion();
  const scope = useCanvasScope();
  const v: number | null = isBinding(block.value) ? bindNumber(block.value, scope) : (block.value as number);
  const max = block.max ?? 100;
  const pct = Math.max(0, Math.min(100, ((v ?? 0) / (max || 1)) * 100));
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
    return `/api/hx/files/download?path=${encodeURIComponent(href)}`;
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
      <div className="ast-cv-heat-grid" style={{ gridTemplateColumns: `auto repeat(${block.cols.length}, minmax(min-content, 1fr))` }}>
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

// ---- Layout composite --------------------------------------------------------
// A container whose children are blocks. Composition only — no data logic — so
// it delegates straight back to <Blocks> and every child keeps its own lazy
// dispatch (chart, diagram, docs) and grouping (KPI rows).
//
// LAYOUT LAW: the modes REUSE the .mg-* grid templates the media grid already
// ships (src/lib/bento.ts picks one; index.css defines them with a <=639px
// reflow), so the chat media grid and the canvas cannot drift apart. `masonry`
// is CSS multi-column — no JS measurement on a streaming surface, which is what
// makes a card paint correctly while it is still arriving.
function LayoutView({ block }: { block: LayoutBlock }) {
  const { layout, cols, blocks } = block;
  // The bento templates address five NAMED grid areas (a..e — src/lib/bento.ts
  // AREAS); each cell claims its own area name, so the grid is deterministic,
  // print-safe and needs no JS measurement.
  const { cls } = bentoLayout(blocks.length);
  const items = blocks.map((b, i) => (
    <div key={i} className="ast-cv-layout-cell" style={{ "gridArea": AREAS[i] ?? "auto" } as React.CSSProperties}>
      <Blocks blocks={[b]} animate={false} canvasId={`lay-${i}`} />
    </div>
  ));
  if (layout === "stack") return <div className="ast-cv-layout stack">{items}</div>;
  if (layout === "masonry") return <div className="ast-cv-layout masonry">{items}</div>;
  if (layout === "bento") return <div className={cn("ast-cv-layout bento", cls)}>{items}</div>;
  // split / grid: an explicit column count, defaulting to a side-by-side pair.
  const n = cols ?? 2;
  return (
    <div className={cn("ast-cv-layout", layout)} style={{ "--layout-cols": n } as React.CSSProperties}>
      {items}
    </div>
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
  stdout: undefined, info: "var(--color-accent)", success: "var(--color-emerald)",
  stderr: "var(--color-redx)", dim: "var(--color-muted)",
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
  // A control's authored default is seeded BEFORE the scope is read: seeding
  // deliberately does not notify, so anything read earlier would be stale.
  const seedStore = useCanvasSeeder();
  for (const b of blocks) seedControlDefault(b, seedStore);
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
// v6 diagram — one SVG from the pure layout. dagre (~17 kB gz) lives HERE, so
// it must never enter the main chunk; same eager-path rule as GraphLazy.
const DiagramLazy = lazy(() => import("./canvas-diagram").then((m) => ({ default: m.DiagramView })));

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
    case "layout": return <LayoutView block={b} />;
    case "accordion": return <AccordionView block={b} />;
    case "terminal": return <TerminalView block={b} />;
    case "badges": return <BadgesView block={b} />;
    case "divider": return <DividerView block={b} />;
    case "table": return <TableBlockView block={b} ctx={ctx} />;
    case "diagram":
      return (
        <Suspense fallback={<div className="ast-cv-chart ast-cv-chart-skeleton" aria-busy="true" />}>
          <DiagramLazy block={b} id={`cv-dg-${id}-${bi}`} />
        </Suspense>
      );
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
