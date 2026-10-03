// Chart renderer — the ONLY recharts consumer, deliberately its own module so
// the chart engine lands in a lazy chunk. canvas-blocks.tsx (KPI, table,
// diagram, checklist, steps, callout) stays dependency-free and is statically
// imported by the gate path, so gates render synchronously while the main
// bundle never carries the chart library.
import { useMemo } from "react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar,
  RadialBarChart, RadialBar, PieChart, Pie, Cell, CartesianGrid, XAxis, YAxis,
  Tooltip, Legend, type TooltipProps,
} from "recharts";
import type { ChartBlock } from "../../lib/canvas-schema";

export const SERIES_COLORS = ["var(--color-cyanx)", "var(--color-violetx)", "var(--color-fuchsiax)"];

type AnyTooltip = TooltipProps<number, string> & { payload?: any[] };

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
            <span className="ast-cv-dot" style={{ background: e.color || SERIES_COLORS[0] }} />
            {e.name}: <span className="ast-cv-tooltip-val">{String(e.value)}</span>
          </p>
        ))}
      </div>
    );
  };

  const axis = (
    <>
      <CartesianGrid stroke="rgb(var(--c-89) / 0.08)" vertical={false} />
      <XAxis dataKey="name" tick={{ fill: "var(--color-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} />
      <YAxis width={34} tick={{ fill: "var(--color-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }} axisLine={false} tickLine={false} />
      <Tooltip content={<TT />} cursor={{ fill: "rgb(var(--c-89) / 0.05)" }} />
      {block.series.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 10.5, fontFamily: "var(--font-sans)" }} />}
    </>
  );

  return (
    <figure className="ast-cv-chart">
      {block.title && <figcaption className="ast-cv-chart-title">{block.title}</figcaption>}
      <ResponsiveContainer width="100%" height={190}>
        {block.chart === "line" ? (
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {axis}
            {block.series.map((s, i) => (
              <Line key={s.name} type="monotone" dataKey={s.name} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
            ))}
          </LineChart>
        ) : block.chart === "area" ? (
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {axis}
            {block.series.map((s, i) => (
              <Area key={s.name} type="monotone" dataKey={s.name} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2} fill={SERIES_COLORS[i % SERIES_COLORS.length]} fillOpacity={0.14} />
            ))}
          </AreaChart>
        ) : block.chart === "bar" ? (
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            {axis}
            {block.series.map((s, i) => (
              <Bar key={s.name} dataKey={s.name} fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={[4, 4, 0, 0]} />
            ))}
          </BarChart>
        ) : block.chart === "radial" ? (
          <RadialBarChart data={data} innerRadius="30%" outerRadius="100%" dataKey={block.series[0].name} startAngle={90} endAngle={-270}>
            <RadialBar dataKey={block.series[0].name} cornerRadius={8} background={{ fill: "rgb(var(--c-89) / 0.06)" }} fill={SERIES_COLORS[0]} />
            <Tooltip content={<TT />} />
          </RadialBarChart>
        ) : (
          <PieChart>
            {block.series.map((s) => (
              <Pie key={s.name} data={data} dataKey={s.name} nameKey="name" innerRadius="52%" outerRadius="82%" paddingAngle={3} stroke="none">
                {data.map((_, j) => (
                  <Cell key={j} fill={SERIES_COLORS[j % SERIES_COLORS.length]} />
                ))}
              </Pie>
            ))}
            <Tooltip content={<TT />} />
          </PieChart>
        )}
      </ResponsiveContainer>
    </figure>
  );
}