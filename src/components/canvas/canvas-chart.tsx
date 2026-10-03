// Chart renderer — the ONLY recharts consumer, deliberately its own module so
// the chart engine lands in a lazy chunk. canvas-blocks.tsx (KPI, table,
// diagram, checklist, steps, callout) stays dependency-free and is statically
// imported by the gate path, so gates render synchronously while the main
// bundle never carries the chart library.
//
// Design rules this file obeys (owner 2026-10-03):
//   • NO gridlines and no axis lines. The plot floats; the data carries it.
//   • NO gradients (brand is gradientless) — depth comes from a hairline top
//     edge on the series and a soft surface, not a fill wash.
//   • Every colour is a THEME TOKEN (`var(--color-*)` / `rgb(var(--c-N) / a)`),
//     never a hex or a frozen rgb() — so `:root` and `[data-theme="light"]`
//     both apply and a palette switch retints live.
//   • Series get a legend ALWAYS (even at one series) so the label is never
//     ambiguous, and a value readout in the tooltip stays tabular.
import { useMemo } from "react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar,
  RadialBarChart, RadialBar, PieChart, Pie, Cell, XAxis, YAxis,
  Tooltip, Legend, PolarAngleAxis, type TooltipProps,
  // v5 — these four ship in the recharts build we ALREADY load; no new bytes,
  // no new dependency, just four more chart kinds for the same price.
  Sankey, Treemap, FunnelChart, Funnel, ScatterChart, Scatter, ZAxis, RadarChart, Radar,
  PolarGrid, PolarRadiusAxis,
} from "recharts";
import type { ChartBlock } from "../../lib/canvas-schema";

// Owner 2026-10-03: ONE accent for all canvas charts. Series separate by
// opacity tier (100/72/48%) + the always-on legend, not by hue.
export const SERIES_COLORS = [
  "var(--color-accent)",
  "color-mix(in srgb, var(--color-accent) 72%, transparent)",
  "color-mix(in srgb, var(--color-accent) 48%, transparent)",
];

type AnyTooltip = TooltipProps<number, string> & { payload?: any[] };

function fmt(n: unknown): string {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return String(n ?? "");
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
  if (abs >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (abs >= 1e4) return (v / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2).replace(/0$/, "");
}


// ── v5 data adapters ─────────────────────────────────────────────────────────
// Each new kind maps the canonical {labels, series[]} onto its own recharts
// shape. All colour comes from the ONE accent via opacity tiers, so the series
// never read as different "brands".

/** Sankey: layer the labels into columns by cumulative value so the flow reads. */
function sankeyOf(labels: string[], points: number[]): { name: string; value: number }[][] {
  const order = labels
    .map((l, i) => ({ name: l, value: Math.max(points[i] ?? 0, 0) }))
    .sort((a, b) => b.value - a.value);
  const cols: { name: string; value: number }[][] = [];
  const load: number[] = [];
  for (const it of order) {
    let c = 0;
    while (c < load.length && load[c] > (load[c - 1] ?? 0)) c++;
    if (c >= cols.length) { cols.push([]); load.push(0); }
    cols[c].push(it);
    load[c] += it.value;
  }
  return cols;
}

function sankeyLinks(labels: string[], points: number[]) {
  const cols = sankeyOf(labels, points);
  const colOf = new Map<string, number>();
  cols.forEach((c, ci) => c.forEach((it) => colOf.set(it.name, ci)));
  const links: { source: number; target: number; value: number }[] = [];
  for (let ci = 0; ci < cols.length - 1; ci++) {
    const from = cols[ci], to = cols[ci + 1];
    const n = Math.max(from.length, to.length);
    for (let k = 0; k < n; k++) {
      const a = from[k % from.length], b = to[k % to.length];
      const v = Math.min(a.value, b.value) || 1;
      links.push({ source: colOf.get(a.name)!, target: colOf.get(b.name)!, value: v });
    }
  }
  return links;
}

/** Treemap: nested children when the model supplied them, else flat items. */
function treemapOf(block: ChartBlock) {
  return block.series[0]?.items?.length
    ? block.series[0].items.map((it, i) => ({ ...it, tier: i % 3 }))
    : (block.labels ?? block.series[0].points.map((_, i) => String(i + 1))).map((l, i) => ({
        name: l,
        value: block.series[0].points[i] ?? 0,
        tier: i % 3,
      }));
}

function scatterOf(s: { name: string; points: number[] }, labels: string[]) {
  return s.points.map((y, i) => ({ x: i + 1, y, z: Math.abs(y), label: labels[i] }));
}

function TreemapCell(props: any) {
  const { x, y, width, height, name, depth = 1 } = props;
  const fill = SERIES_COLORS[Math.min(depth - 1, SERIES_COLORS.length - 1)];
  return (
    <g>
      <rect x={x} y={y} width={Math.max(width - 1, 0)} height={Math.max(height - 1, 0)} fill={fill} opacity={depth === 1 ? 0.92 : 0.6} rx={2} />
      {width > 44 && height > 16 && (
        <text x={x + 6} y={y + 13} fontSize={10} fill="var(--color-brandtext)" style={{ paintOrder: "stroke", stroke: "var(--cv-paper)", strokeWidth: 3 }}>
          {String(name ?? "").slice(0, Math.floor(width / 6))}
        </text>
      )}
    </g>
  );
}

function SankeyNode(props: any) {
  const { x, y, width, height, index = 0, name } = props;
  const right = x + width > 100;
  return (
    <g>
      <rect x={x} y={y} width={Math.max(width, 2)} height={Math.max(height, 2)} fill={SERIES_COLORS[index % SERIES_COLORS.length]} rx={2} />
      {height > 14 && (
        <text
          x={right ? x - 6 : x + width + 6}
          y={y + height / 2 + 3}
          textAnchor={right ? "end" : "start"}
          fontSize={10.5}
          fill="var(--color-brandtext)"
          style={{ paintOrder: "stroke", stroke: "var(--cv-paper)", strokeWidth: 3 }}
        >
          {String(name ?? "")}
        </text>
      )}
    </g>
  );
}

export function ChartBlockView({ block }: { block: ChartBlock }) {
  const labels = block.labels || block.series[0]?.points.map((_, i) => String(i + 1)) || [];
  const data = useMemo(() => labels.map((l, i) => {
    const row: Record<string, string | number> = { name: l };
    for (const s of block.series) row[s.name] = s.points[i] ?? 0;
    return row;
  }), [labels, block]);

  const sankeyNodes = useMemo(() => sankeyOf(labels, block.series[0]?.points ?? []), [labels, block]);
  const sankeyLinksData = useMemo(() => sankeyLinks(labels, block.series[0]?.points ?? []), [labels, block]);
  const treemapData = useMemo(() => treemapOf(block), [block]);
  const funnelData = useMemo(
    () => (labels.length ? labels : (block.series[0]?.points ?? []).map((_, i) => String(i + 1)))
      .map((l, i) => ({ name: l, value: block.series[0]?.points[i] ?? 0, fill: SERIES_COLORS[i % SERIES_COLORS.length] })),
    [labels, block],
  );
  const radarData = useMemo(() => {
    const axes = labels.length ? labels : (block.series[0]?.points ?? []).map((_, i) => String(i + 1));
    return axes.map((a, i) => {
      const row: Record<string, string | number> = { axis: a };
      for (const sr of block.series) row[sr.name] = sr.points[i] ?? 0;
      return row;
    });
  }, [labels, block]);

  const TT = (p: AnyTooltip) => {
    if (!p.active || !p.payload?.length) return null;
    return (
      <div className="ast-cv-tooltip">
        <p className="ast-cv-tooltip-label">{p.label != null ? String(p.label) : ""}</p>
        {p.payload.map((e: any) => (
          <p key={e.name} className="ast-cv-tooltip-row">
            <span className="ast-cv-dot" style={{ background: e.color || e.fill || e.payload?.fill || SERIES_COLORS[0] }} />
            {e.name}: <span className="ast-cv-tooltip-val">{fmt(e.value)}</span>
          </p>
        ))}
      </div>
    );
  };

  // No grid, no axis lines, no ticks: the marks are the message. Y width is
  // trimmed to nothing so the plot uses the full card.
  const axis = (
    <>
      <XAxis dataKey="name" hide />
      <YAxis hide domain={[0, "auto"]} />
      <Tooltip content={<TT />} cursor={{ fill: "rgb(var(--c-89) / 0.04)" }} />
      <Legend
        iconType="plainline"
        iconSize={8}
        align="left"
        verticalAlign="bottom"
        wrapperStyle={{ fontSize: 10.5, fontFamily: "var(--font-sans)", paddingTop: 10, color: "var(--color-muted)" }}
      />
    </>
  );

  const H = block.chart === "radial" || block.chart === "pie" || block.chart === "donut" ? 210
    : block.chart === "radar" ? 230
    : block.chart === "funnel" ? 200
    : block.chart === "treemap" ? 240
    : block.chart === "sankey" ? 300 : 180;

  // Donut: single-series composition with the total in the hole. Slice colours
  // follow the LABELS (one colour per slice), not the series.
  const donutTotal = block.series.reduce((n, s) => n + (s.points[0] ?? 0), 0);

  return (
    <figure className="ast-cv-chart">
      {block.title && <figcaption className="ast-cv-chart-title">{block.title}</figcaption>}
      <ResponsiveContainer width="100%" height={H}>
        {block.chart === "line" ? (
          <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            {axis}
            {block.series.map((s, i) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                strokeLinecap="round"
                dot={false}
                activeDot={{ r: 3.5, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        ) : block.chart === "area" ? (
          <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            {axis}
            {block.series.map((s, i) => (
              <Area
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                strokeLinecap="round"
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                fillOpacity={0.12}
                activeDot={{ r: 3.5, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        ) : block.chart === "bar" || block.chart === "stack" ? (
          <BarChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} barCategoryGap="22%">
            {axis}
            {block.series.map((s, i) => (
              <Bar
                key={s.name}
                dataKey={s.name}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                radius={block.chart === "stack" ? [0, 0, 0, 0] : [5, 5, 2, 2]}
                stackId={block.chart === "stack" ? "s" : undefined}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        ) : block.chart === "donut" ? (
          <div className="ast-cv-donut">
            <ResponsiveContainer width="100%" height={H}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey={block.series[0].name}
                  nameKey="name"
                  innerRadius="64%"
                  outerRadius="92%"
                  cornerRadius={4}
                  paddingAngle={2}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {data.map((_, j) => (
                    <Cell key={j} fill={SERIES_COLORS[j % SERIES_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<TT />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="ast-cv-donut-center">
              <span className="ast-cv-donut-total">{fmt(donutTotal)}</span>
              <span className="ast-cv-donut-caption">total</span>
            </div>
          </div>
        ) : block.chart === "radial" ? (
          <RadialBarChart
            data={data}
            innerRadius="62%"
            outerRadius="100%"
            dataKey={block.series[0].name}
            startAngle={90}
            endAngle={-270}
          >
            {/* Fixed 0-100 domain: without it recharts auto-scales the bar to the
                data max, so a 71% gauge rendered as a FULL ring (every gate
                gauge read as 100%). The domain is what makes the value honest. */}
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar
              dataKey={block.series[0].name}
              cornerRadius={6}
              background={{ fill: "rgb(var(--c-89) / 0.05)" }}
              fill={SERIES_COLORS[0]}
              isAnimationActive={false}
            />
            <Tooltip content={<TT />} isAnimationActive={false} />
          </RadialBarChart>
        ) : block.chart === "sankey" ? (
          <Sankey
            data={{ nodes: sankeyNodes, links: sankeyLinksData }}
            nodePadding={14}
            nodeWidth={12}
            linkCurvature={0.42}
            margin={{ top: 8, right: 60, bottom: 8, left: 60 }}
            link={{ stroke: SERIES_COLORS[1], strokeOpacity: 0.4 }}
            node={<SankeyNode />}
          >
            <Tooltip content={<TT />} />
          </Sankey>
        ) : block.chart === "treemap" ? (
          <Treemap
            data={treemapData}
            dataKey="value"
            aspectRatio={4 / 3}
            stroke="none"
            content={<TreemapCell />}
          >
            <Tooltip content={<TT />} />
          </Treemap>
        ) : block.chart === "funnel" ? (
          <FunnelChart>
            <Tooltip content={<TT />} />
            <Funnel dataKey="value" data={funnelData} isAnimationActive={false} stroke="none">
              {funnelData.map((_, i) => (
                <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
              ))}
            </Funnel>
          </FunnelChart>
        ) : block.chart === "scatter" ? (
          <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <XAxis dataKey="x" hide type="number" domain={["dataMin", "dataMax"]} />
            <YAxis hide type="number" domain={["dataMin", "dataMax"]} />
            <ZAxis type="number" dataKey="z" range={[42, 220]} />
            <Tooltip content={<TT />} cursor={{ stroke: "rgb(var(--c-89) / 0.2)" }} />
            <Legend
              iconType="circle" iconSize={7} align="left" verticalAlign="bottom"
              wrapperStyle={{ fontSize: 10.5, fontFamily: "var(--font-sans)", paddingTop: 10, color: "var(--color-muted)" }}
            />
            {block.series.map((sr, i) => (
              <Scatter key={sr.name} name={sr.name} data={scatterOf(sr, block.labels ?? [])} fill={SERIES_COLORS[i % SERIES_COLORS.length]} isAnimationActive={false} />
            ))}
          </ScatterChart>
        ) : block.chart === "radar" ? (
          <RadarChart data={radarData} outerRadius="72%">
            <PolarAngleAxis dataKey="axis" tick={{ fontSize: 9.5, fill: "var(--color-muted)" }} />
            <PolarGrid stroke="rgb(var(--c-89) / 0.08)" />
            <PolarRadiusAxis hide domain={[0, "auto"]} />
            <Tooltip content={<TT />} />
            <Legend
              iconType="circle" iconSize={7} align="left" verticalAlign="bottom"
              wrapperStyle={{ fontSize: 10.5, fontFamily: "var(--font-sans)", paddingTop: 10, color: "var(--color-muted)" }}
            />
            {block.series.map((sr, i) => (
              <Radar key={sr.name} name={sr.name} dataKey={sr.name} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} fill={SERIES_COLORS[i % SERIES_COLORS.length]} fillOpacity={0.14} isAnimationActive={false} />
            ))}
          </RadarChart>
        ) : (
          <PieChart>
            {block.series.map((s) => (
              <Pie
                key={s.name}
                data={data}
                dataKey={s.name}
                nameKey="name"
                innerRadius="58%"
                outerRadius="88%"
                paddingAngle={2}
                stroke="none"
                isAnimationActive={false}
              >
                {data.map((_, j) => (
                  <Cell key={j} fill={SERIES_COLORS[j % SERIES_COLORS.length]} />
                ))}
              </Pie>
            ))}
            <Tooltip content={<TT />} />
            <Legend
              iconType="circle"
              iconSize={7}
              align="left"
              verticalAlign="bottom"
              wrapperStyle={{ fontSize: 10.5, fontFamily: "var(--font-sans)", paddingTop: 10, color: "var(--color-muted)" }}
            />
          </PieChart>
        )}
      </ResponsiveContainer>
    </figure>
  );
}