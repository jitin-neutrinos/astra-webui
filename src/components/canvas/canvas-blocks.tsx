// Canvas block renderers — the individual generative-UI surfaces. Pure
// presentational; data contracts live in canvas-schema.ts. Lazy-loaded as a
// chunk with CanvasView (recharts never enters the main bundle).
import { useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { useReducedMotion, useSpring, motion } from "motion/react";
import { cn } from "../../lib/utils";

// recharts lives behind this boundary: chart blocks defer-load the engine, every
// other block type (and the whole gate path) stays sync and dependency-free.
const ChartBlockView = lazy(() => import("./canvas-chart").then((m) => ({ default: m.ChartBlockView })));
import type { CanvasBlock, KpiBlock, TableBlock, DiagramBlock, ChecklistBlock, StepsBlock, CalloutBlock } from "../../lib/canvas-schema";


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

export function CalloutView({ block }: { block: CalloutBlock }) {
  return (
    <div className={cn("ast-cv-callout", block.tone)}>
      {block.title && <p className="ast-cv-callout-title">{block.title}</p>}
      <p className="ast-cv-callout-body">{block.body}</p>
    </div>
  );
}

// ---- Grouping (KPI rows + single blocks) ----------------------------------------

export function Blocks({ blocks, animate = true }: { blocks: CanvasBlock[]; animate?: boolean }) {
  const groups: CanvasBlock[][] = [];
  let kpiRun: CanvasBlock[] = [];
  const flush = () => { if (kpiRun.length > 0) { groups.push(kpiRun); kpiRun = []; } };
  for (const b of blocks) {
    if (b.type === "kpi") {
      kpiRun.push(b);
      if (kpiRun.length === 4) flush();
    } else {
      flush();
      groups.push([b]);
    }
  }
  flush();

  return (
    <>
      {groups.map((g, gi) => {
        const isKpi = g[0].type === "kpi";
        return (
          <div key={gi} className={cn("ast-cv-group", isKpi && "kpis")}>
            {g.map((b, bi) => {
              const inner =
                b.type === "kpi" ? <KpiTile block={b} /> :
                b.type === "chart" ? (
                  <Suspense fallback={<div className="ast-cv-chart ast-cv-chart-skeleton" aria-busy="true" />}>
                    <ChartBlockView block={b} />
                  </Suspense>
                ) :
                b.type === "table" ? <TableBlockView block={b} /> :
                b.type === "diagram" ? <DiagramBlockView block={b} /> :
                b.type === "checklist" ? <ChecklistView block={b} /> :
                b.type === "steps" ? <StepsView block={b} /> :
                <CalloutView block={b as CalloutBlock} />;
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
