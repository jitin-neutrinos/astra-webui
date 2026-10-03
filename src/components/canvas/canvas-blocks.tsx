// Canvas block renderers — the individual generative-UI surfaces. Pure
// presentational; data contracts live in canvas-schema.ts. Lazy-loaded as a
// chunk with CanvasView (recharts never enters the main bundle).
import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { useReducedMotion, useSpring, motion } from "motion/react";
import { cn } from "../../lib/utils";

// recharts lives behind this boundary: chart blocks defer-load the engine, every
// other block type (and the whole gate path) stays sync and dependency-free.
const ChartBlockView = lazy(() => import("./canvas-chart").then((m) => ({ default: m.ChartBlockView })));
import type { CanvasBlock, KpiBlock, TableBlock, DiagramBlock, ChecklistBlock, StepsBlock, CalloutBlock, ProgressBlock, TimelineBlock, CompareBlock, TreeBlock, CodeBlock, ReferencesBlock } from "../../lib/canvas-schema";


// ---- KPI ---------------------------------------------------------------------

function CountUp({ value }: { value: string | number }) {
  const reduce = useReducedMotion();
  const num = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.\-]/g, ""));
  const parseable = typeof value === "number" || /^\s*[0-9][0-9.,\s]*\s*$/.test(String(value));
  if (reduce || !parseable || !Number.isFinite(num)) {
    return <span className="ast-cv-kpi-value">{value}</span>;
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

export function KpiTile({ block }: { block: KpiBlock }) {
  const glyph = block.trend === "up" ? "↑" : block.trend === "down" ? "↓" : "";
  const cls = block.trend === "up" ? "up" : block.trend === "down" ? "down" : "";
  return (
    <div className="ast-cv-kpi">
      <span className="ast-cv-kpi-label">{block.label}</span>
      <div className="ast-cv-kpi-row">
        <CountUp value={block.value} />
        {block.delta != null && (
          <span className={cn("ast-cv-kpi-delta", cls)}>{glyph} {block.delta}</span>
        )}
      </div>
    </div>
  );
}

// ---- Table -------------------------------------------------------------------

export function TableBlockView({ block }: { block: TableBlock }) {
  return (
    <div className="ast-cv-table-wrap">
      <table className="ast-cv-table">
        <thead>
          <tr>{block.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr>
        </thead>
        <tbody>
          {block.rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className={/^[\d.,%\s\-+]+$/.test(cell) ? "num" : undefined}>{cell}</td>
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

  return (
    <div className={cn("ast-cv-diagram", block.direction === "lr" && "lr")} ref={wrapRef}>
      <svg className="ast-cv-edges" aria-hidden="true">
        {edges.map((e, i) => (
          <g key={i}>
            <path d={e.d} fill="none" stroke="var(--color-cyanx)" strokeOpacity={0.5} strokeWidth={1.6} />
            {e.label && <text x={e.x} y={e.y} className="ast-cv-edge-label">{e.label}</text>}
          </g>
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
  info: "var(--color-cyanx)",
  success: "#34d399",
  warn: "#fbbf24",
  danger: "#f87171",
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
        <div className="ast-cv-progress-fill" style={{ width: `${pct}%` }} />
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

export function ReferencesView({ block }: { block: ReferencesBlock }) {
  return (
    <ol className="ast-cv-refs">
      {block.items.map((it, i) => (
        <li key={i} className="ast-cv-ref">
          <span className="ast-cv-ref-index">{i + 1}</span>
          <span className="ast-cv-ref-body">
            {it.href ? (
              <a className="ast-cv-ref-link" href={it.href} target="_blank" rel="noopener noreferrer">{it.title}</a>
            ) : (
              <span className="ast-cv-ref-link">{it.title}</span>
            )}
            {it.note && <span className="ast-cv-ref-note">{it.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---- Grouping (KPI rows + single blocks) ----------------------------------------

export function Blocks({ blocks, animate = true }: { blocks: CanvasBlock[]; animate?: boolean }) {
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
              const inner = renderOne(b);
              if (!animate) return <div key={bi} className="ast-cv-item">{inner}</div>;
              return (
                <motion.div key={bi}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: Math.min(bi * 0.05, 0.25) }}
                  className="ast-cv-item">
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

function renderOne(b: CanvasBlock) {
  switch (b.type) {
    case "kpi": return <KpiTile block={b} />;
    case "progress": return <ProgressView block={b} />;
    case "timeline": return <TimelineView block={b} />;
    case "compare": return <CompareView block={b} />;
    case "tree": return <TreeView block={b} />;
    case "code": return <CodeView block={b} />;
    case "references": return <ReferencesView block={b} />;
    case "table": return <TableBlockView block={b} />;
    case "diagram": return <DiagramBlockView block={b} />;
    case "checklist": return <ChecklistView block={b} />;
    case "steps": return <StepsView block={b} />;
    case "chart":
      return (
        <Suspense fallback={<div className="ast-cv-chart ast-cv-chart-skeleton" aria-busy="true" />}>
          <ChartBlockView block={b} />
        </Suspense>
      );
    case "callout": return <CalloutView block={b} />;
  }
}
