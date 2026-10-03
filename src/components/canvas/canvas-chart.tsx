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
} from "recharts";
import type { ChartBlock } from "../../lib/canvas-schema";

export const SERIES_COLORS = ["var(--color-cyanx)", "var(--color-violetx)", "var(--color-fuchsiax)"];

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

export function ChartBlockView({ block }: { block: ChartBlock }) {
  const labels = block.labels || block.series[0]?.points.map((_, i) => String(i + 1)) || [];
  const data = useMemo(() => labels.map((l, i) => {
    const row: Record<string, string | number> = { name: l };
    for (const s of block.series) row[s.name] = s.points[i] ?? 0;
    return row;
  }), [labels, block]);

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

  const H = block.chart === "radial" || block.chart === "pie" || block.chart === "donut" ? 210 : 180;

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