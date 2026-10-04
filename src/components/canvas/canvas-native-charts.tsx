// canvas-native-charts.tsx — the three chart kinds recharts 2.15 sizes ITSELF.
//
// WHY THIS IS A SEPARATE MODULE: recharts self-sizes Sankey / Treemap / Funnel, so
// inside a `ResponsiveContainer` they measure 0×0 and paint NOTHING — measured in
// the browser as `surfaces: 0, inner: 0` for exactly those three, which is the
// owner's "line up funnel, lines by area show no charts at all" report. They are
// rendered here with real, MEASURED pixel dimensions instead.
//
// WHY SANKEY IS NOT RECHARTS': recharts 2.15's Sankey delegates to d3-sankey
// internally and throws on a payload this app's own schema produces
// ("e.split is not iterable"), which took the entire card down. @nivo/sankey
// (MIT, React 19 in its peer range) consumes the authored nodes+links directly —
// which is also why the flow finally READS as a flow instead of a column sort.
//
// Lazy: imported by canvas-chart, so a card with no such chart never loads it.
import { useEffect, useMemo, useRef, useState } from "react";
import { ResponsiveSankey } from "@nivo/sankey";
import { Treemap, FunnelChart, Funnel, Cell, Tooltip } from "recharts";
import type { ChartBlock } from "../../lib/canvas-schema";
import { SERIES_COLORS } from "./canvas-chart";

export type NativeKind = "sankey" | "treemap" | "funnel";

/** Measure the card so a self-sizing chart gets real pixels. */
function useMeasuredWidth(fallback = 600): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.max(280, Math.round(el.getBoundingClientRect().width) || fallback));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w];
}

const fmt = (n: unknown): string => {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return String(n ?? "");
  const a = Math.abs(v);
  const t = (x: number, s: string) => (x.toFixed(1).replace(/\.0$/, "") + s);
  if (a >= 1e9) return t(v / 1e9, "B");
  if (a >= 1e6) return t(v / 1e6, "M");
  if (a >= 1e4) return t(v / 1e3, "k");
  return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const Legend = ({ rows, total }: { rows: { label: string; value: number }[]; total?: number }) => (
  <div className="ast-cv-chart-legend ast-cv-chart-legend-block">
    {rows.map((r, i) => (
      <span key={i} className="ast-cv-legend-item">
        <span className="ast-cv-dot" style={{ background: SERIES_COLORS[0] }} />
        {r.label} · {fmt(r.value)}
      </span>
    ))}
    {total !== undefined && <span className="ast-cv-legend-total">total {fmt(total)}</span>}
  </div>
);

/** recharts 2.15 gives {x,y,width,height,name,value,depth,index}; every one is
 *  optional on a degenerate layout — an undefined here blanked the card. */
function TreemapCell(props: any) {
  const { x = 0, y = 0, width = 0, height = 0, name, depth = 1 } = props ?? {};
  return (
    <g>
      <rect
        x={x} y={y}
        width={Math.max(width - 1, 0)} height={Math.max(height - 1, 0)}
        fill={SERIES_COLORS[Math.min(depth - 1, SERIES_COLORS.length - 1)]}
        opacity={depth === 1 ? 0.92 : 0.6}
        rx={2}
      />
      {width > 46 && height > 18 && (
        <text
          x={x + 6} y={y + 13} fontSize={10.5} fill="var(--color-brandtext)"
          style={{ paintOrder: "stroke", stroke: "var(--cv-paper)", strokeWidth: 3, strokeLinejoin: "round" }}
        >
          {String(name ?? "")}
        </text>
      )}
    </g>
  );
}

export default function NativeChart({
  block,
  labels,
  H,
}: {
  block: ChartBlock;
  labels: string[];
  H: number;
}) {
  const [ref, w] = useMeasuredWidth();
  const first = block.series?.[0];
  const points = Array.isArray(first?.points) ? first!.points : [];

  // ── sankey ───────────────────────────────────────────────────────────────
  const links = useMemo(
    () =>
      Array.isArray(first?.links)
        ? (first!.links as { source: string; target: string; value: number }[])
            .filter((l) => l && typeof l.source === "string" && typeof l.target === "string")
            .map((l) => ({ source: l.source, target: l.target, value: Number(l.value) || 0 }))
        : [],
    [first],
  );

  if (block.chart === "sankey") {
    if (labels.length === 0 || links.length === 0) {
      return (
        <div className="ast-cv-chart-native" ref={ref}>
          <p className="ast-cv-table-empty">No data — this flow needs at least one stage and one connection.</p>
        </div>
      );
    }
    const total = points.reduce((n, x) => n + (x ?? 0), 0);
    const narrow = w < 520;
    const pad = narrow ? 74 : 132;
    return (
      <div className="ast-cv-chart-native ast-cv-sankey" ref={ref} style={{ height: H }}>
        <ResponsiveSankey
          data={{
            nodes: labels.map((id: string) => ({ id })),
            links: links.map((l) => ({ ...l })),
          }}
          margin={{ top: 10, right: pad, bottom: 10, left: pad }}
          align="justify"
          colors={() => SERIES_COLORS[0]}
          nodeOpacity={1}
          nodeHoverOpacity={1}
          nodeThickness={11}
          nodeSpacing={14}
          nodeBorderWidth={0}
          linkOpacity={0.4}
          linkHoverOpacity={0.62}
          labelPosition="outside"
          labelPadding={11}
          animate={false}
          isInteractive
          theme={{
            text: { fontSize: 10.5, fontFamily: "var(--font-sans)", fill: "var(--color-brandtext)" },
            labels: { text: { fontSize: 10.5, fontWeight: 500 } },
            tooltip: { container: { background: "var(--cv-paper)", color: "var(--color-brandtext)" } },
          }}
        />
        <Legend rows={labels.map((l, i) => ({ label: l, value: points[i] ?? 0 }))} total={total} />
      </div>
    );
  }

  // ── treemap ──────────────────────────────────────────────────────────────
  if (block.chart === "treemap") {
    const items =
      first?.items?.length
        ? first.items
        : labels.map((l, i) => ({ name: l, value: points[i] ?? 0 }));
    const total = items.reduce((n: number, d: any) => n + (Number(d?.value) || 0), 0);
    if (!items.length) {
      return (
        <div className="ast-cv-chart-native" ref={ref}>
          <p className="ast-cv-table-empty">No data — this treemap arrived with no items.</p>
        </div>
      );
    }
    return (
      <div className="ast-cv-chart-native" ref={ref}>
        <Treemap
          width={w}
          height={H}
          data={items as any[]}
          dataKey="value"
          aspectRatio={16 / 9}
          stroke="none"
          content={<TreemapCell />}
        >
          <Tooltip />
        </Treemap>
        <Legend rows={items.slice(0, 8).map((d: any) => ({ label: String(d.name), value: Number(d.value) || 0 }))} total={total} />
      </div>
    );
  }

  // ── funnel ───────────────────────────────────────────────────────────────
  const stages =
    first?.items?.length
      ? first.items
      : labels.map((l, i) => ({ name: l, value: points[i] ?? 0 }));
  if (!stages.length) {
    return (
      <div className="ast-cv-chart-native" ref={ref}>
        <p className="ast-cv-table-empty">No data — this funnel arrived with no stages.</p>
      </div>
    );
  }
  return (
    <div className="ast-cv-chart-native" ref={ref}>
      <FunnelChart width={w} height={H} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
        <Tooltip />
        <Funnel dataKey="value" data={stages as any[]} nameKey="name" isAnimationActive={false} stroke="none" lastShapeType="rectangle">
          {stages.map((st: any, i: number) => (
            <Cell key={st?.name ?? i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
          ))}
        </Funnel>
      </FunnelChart>
      {/* Stage-to-stage conversion — the number a funnel exists to show. */}
      <div className="ast-cv-chart-legend ast-cv-chart-legend-block">
        {stages.map((st: any, i: number) => {
          const prev = i === 0 ? Number(st?.value) || 0 : Number((stages[i - 1] as any)?.value) || 0;
          const pct = prev > 0 ? (((Number(st?.value) || 0) / prev) * 100) : 0;
          return (
            <span key={i} className="ast-cv-legend-item">
              <span className="ast-cv-dot" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
              {String(st?.name ?? "")} · {fmt(st?.value)}
              {i > 0 && <em className="ast-cv-funnel-pct">{pct.toFixed(1)}%</em>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
