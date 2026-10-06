// Chart renderer — the ONLY recharts consumer, deliberately its own module so
// the chart engine lands in a lazy chunk. canvas-blocks.tsx (KPI, table,
// diagram, checklist, steps, callout) stays dependency-free and is statically
// imported by the gate path, so gates render synchronously while the main
// bundle never carries the chart library.
//
// Design rules this file obeys:
//   • AXES + LEGEND ON EVERY CHART (owner 2026-10-04 — this SUPERSEDES the
//     2026-10-03 "no axis lines" law). Both axes carry labels and tick values;
//     the legend names every series. They are drawn as hairlines in the theme's
//     muted ink so they read as chrome, not as data.
//   • NO gradients (brand is gradientless) — depth comes from a hairline top
//     edge on the series and a soft surface, not a fill wash.
//   • Every colour is a THEME TOKEN (`var(--color-*)` / `rgb(var(--c-N) / a)`),
//     never a hex or a frozen rgb() — so `:root` and `[data-theme="light"]`
//     both apply and a palette switch retints live.
//   • Series get a legend ALWAYS (even at one series) so the label is never
//     ambiguous, and a value readout in the tooltip stays tabular.
import { lazy, Suspense, useMemo } from "react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar,
  RadialBarChart, RadialBar, PieChart, Pie, Cell, XAxis, YAxis,
  Tooltip, PolarAngleAxis, ReferenceLine, type TooltipProps,
  // v5 — these four ship in the recharts build we ALREADY load; no new bytes,
  // no new dependency, just four more chart kinds for the same price.
  ScatterChart, Scatter, ZAxis, RadarChart, Radar,
  PolarGrid, PolarRadiusAxis,
  // canvas v1 expansion — `box` is a Bar plus its ErrorBar; recharts 2.15 already
  // ships both, so the shape costs no new dependency. The quartiles themselves come
  // from d3-array (quantileSorted) in the data adapter below.
  ErrorBar,
} from "recharts";
import type { ChartBlock } from "../../lib/canvas-schema";
import type { RenderCtx } from "./canvas-blocks";
import { bindPoints } from "../../lib/canvas-bind";
import { evaluate } from "../../lib/canvas-expr";
// d3-array is IMPORTED WHOLE but used for two functions (quantileSorted, bin):
// it is a tree of small ES modules, so the bundler keeps only what the adapters
// reach. Both live in the SAME lazy chunk as recharts — nothing here touches the
// eager path.
import { quantileSorted, bin } from "d3-array";

// Owner 2026-10-05: series separate by HUE — accent/emerald/amber/fuchsiax/redx
// (theme roles, so every palette + mode inherits). Pre-2026-10-05 the series
// ladder was one accent at 100/72/48% opacity, which read as one blue line.
const NATIVE = new Set(["sankey", "treemap", "funnel"]);
const NativeLazy = lazy(() => import("./canvas-native-charts"));

export const SERIES_COLORS = [
  "var(--color-accent)",
  "var(--color-emerald)",
  "var(--color-amber)",
  "var(--color-fuchsiax)",
  "var(--color-redx)",
];

type AnyTooltip = TooltipProps<number, string> & { payload?: any[] };

// ── axis/legend chrome (owner 2026-10-04) ────────────────────────────────────
//
// THE FONT FLOOR (owner 2026-10-05: no painted text under 11px on a phone).
// Measured at 360/390/412px (scripts/mobile-canvas-audit.mjs): axis ticks
// painted at 10px on 468 tspans per sweep — the single largest block of
// sub-11px text in the whole card set, and it is unreadable at arm's length on
// a phone. 11px is the floor everywhere, desktop included, because a value that
// is legible on a 27" monitor is not legible on a 6" screen and the tick is
// chrome either way: a hairline label is not worth its own illegibility.
//
// The plot heights are phone-sized for the same reason — a taller plot buys
// nothing once the tick is legible, and the space is better spent on the next
// block in the card.
const AXIS_MIN_PX = 11;
/** The font the ticks actually get, given how much room the card has. */
function axisFont(width: number, base = AXIS_MIN_PX): number {
  return width >= 640 ? Math.max(base, 11.5) : base;
}
const AXIS_LINE = "rgb(var(--c-89) / 0.16)";
const AXIS_TICKS = "rgb(var(--c-89) / 0.28)";
// ── legend: rendered OUTSIDE the plot, in normal flow (owner 2026-10-04) ───
//
// WHY NOT recharts' own <Legend>: recharts 2.15.4 renders the legend wrapper with
// a hardcoded `position: 'absolute'` (node_modules/recharts/lib/component/
// Legend.js:171, spread into outerStyle before wrapperStyle can override it), so
// the legend is positioned INSIDE the chart surface no matter what we pass. Every
// chart here also passes `margin={{ top: 6, right: 6, bottom: 0, left: 0 }}`, so
// the absolutely-positioned row landed on the bottom edge of the plot box, ON TOP
// of the x-axis tick labels. Measured in chromium at 360/768/1280
// (scratch/canvas-v6/defects-e2e.mjs, getComputedStyle(legend).position ===
// "absolute", legend.top < plot.bottom on EVERY recharts kind): before the fix
// the 2-series line reported plot 250-430 vs legend 400-430, i.e. a 30px
// overlap; bar 493-673 vs 643-673, 30px. Only `verticalAlign` moved it WITHIN the
// absolutely-positioned box — on short viewports the box collapsed upward and the
// row read as if it sat at the TOP of the plot.
//
// So the legend is ordinary DOM beneath the <ResponsiveContainer>, using the
// block-legend presentation the native charts already use (`.ast-cv-chart-legend
// -block` / `.ast-cv-legend-item` / `.ast-cv-dot`). That is the same rule the
// diagram and graph surfaces follow: never overlay the drawing.
//
// A ONE-series chart still gets a legend — an explicit series name beats an
// ambiguous chart (the 2026-10-04 design law in the header of this file).
function ChartLegend({ series }: { series: { name: string }[] }) {
  if (!series.length) return null;
  return (
    <div className="ast-cv-chart-legend ast-cv-chart-legend-block ast-cv-chart-legend-below">
      {series.map((s, i) => (
        <span key={s.name} className="ast-cv-legend-item">
          <span className="ast-cv-dot" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
          <span className="ast-cv-legend-name">{s.name}</span>
        </span>
      ))}
    </div>
  );
}

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




function scatterOf(s: { name: string; points: unknown[] }, labels: string[]) {
  const lit = Array.isArray(s.points) ? s.points : [];
  // A scatter is the one chart whose natural data is PAIRS. Accept [x, y] and {x, y}; a flat number list
  // falls back to (index, value) so the older shape keeps working.
  return lit.map((p, i) => {
    if (Array.isArray(p) && p.length >= 2) { const x = Number(p[0]), y = Number(p[1]); return { x, y, z: Math.abs(y), label: labels[i] }; }
    if (p && typeof p === "object") { const o = p as { x?: unknown; y?: unknown }; const x = Number(o.x), y = Number(o.y); return { x: Number.isFinite(x) ? x : i + 1, y, z: Math.abs(y), label: labels[i] }; }
    const y = Number(p);
    return { x: i + 1, y, z: Math.abs(y), label: labels[i] };
  }).filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
}

/** Scatter axis titles: "x: batch size" / "y: p95 ms" in `labels`, else the series name for Y and nothing for X. */
function scatterAxisTitles(labels: string[] | undefined, seriesName: string): { x: string; y: string } {
  const pick = (re: RegExp) => labels?.find((l) => re.test(l))?.replace(re, "").trim();
  return { x: pick(/^\s*x\s*[:=]\s*/i) || "", y: pick(/^\s*y\s*[:=]\s*/i) || seriesName };
}

// ── box + histogram (canvas v1 expansion) ─────────────────────────────────────
// Both take the ORDINARY `{labels, series[].points}` shape — no new authoring key
// — because the arithmetic belongs here, not in the model's head:
//
//   box        one series per group, each a list of RAW SAMPLES. The bar spans
//              q1..q3 (IQR) and the ErrorBar draws the min..max whisker, so the
//              box IS the data rather than a summary the model asserted. d3's
//              quantileSorted is the R-7 inclusive definition, so the numbers match
//              what Excel, numpy and pandas report for the same column.
//   histogram  one series of raw samples, binned with d3 `bin` (Sturges-free,
//              10 bins or sqrt(n) whichever is larger, capped) and drawn through
//              the SAME <BarChart> path a plain bar uses. A histogram is a bar
//              chart of counts; treating it as its own kind only exists so the
//              agent can say what it means and the renderer can pick the bins.
//
// A group with FEWER THAN TWO samples has no quartiles and no whiskers — a
// "box" drawn from one number is a lie about spread, so that bar is skipped
// entirely rather than drawn as a zero-height box.

/** Sturges-flavoured bin count: sqrt(n), at least 10, never more than 40. */
function binCountFor(n: number): number {
  return Math.max(10, Math.min(40, Math.ceil(Math.sqrt(Math.max(1, n)))));
}

interface BoxRow {
  name: string;
  /** The bar's value is q3 (the TOP of the box), which is what recharts scales. */
  q3: number;
  /**
   * ErrorBar offsets, MEASURED FROM q3 — recharts renders [value-lowBound,
   * value+highBound] through the y-scale (node_modules/recharts/lib/cartesian/
   * ErrorBar.js:71-115), so a whisker at min and max is [q3-min, max-q3].
   * Both are >= 0 by construction (min <= q3 <= max), which is what keeps the
   * lower whisker pointing down: a negative offset would mirror it upwards and
   * draw a box that lies about its own range.
   */
  whisker: [number, number];
  median: number;
  n: number;
  q1: number;
  min: number;
  max: number;
}

function boxOf(series: { name: string; points: number[] }[], labels: string[]): BoxRow[] {
  const out: BoxRow[] = [];
  series.forEach((s, i) => {
    const lit = (Array.isArray(s.points) ? s.points : []).filter((p) => Number.isFinite(p));
    // Fewer than 2 samples has no quartiles and no whiskers. A box drawn from one
    // number asserts a spread that does not exist, so the group is SKIPPED — and
    // if that empties the chart, the caller renders the no-data state rather than
    // an axis with nothing on it.
    if (lit.length < 2) return;
    const sorted = [...lit].sort((a, b) => a - b);
    const q1 = quantileSorted(sorted, 0.25)!;
    const q3 = quantileSorted(sorted, 0.75)!;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    out.push({
      name: labels[i] ?? s.name,
      q3,
      whisker: [q3 - min, max - q3],
      median: quantileSorted(sorted, 0.5)!,
      n: sorted.length,
      q1, min, max,
    });
  });
  return out;
}

/**
 * The box itself: a FLOATING rect from q1 to q3 with the median ruled across it.
 *
 * A custom shape rather than a stacked two-bar trick, because a stack would make
 * the median a third segment (so a box with no median data still reserved a band)
 * and would make the y-axis show the sum of the segments rather than the value.
 * Drawn from the payload so the rect's own height is the IQR, not the axis span:
 * the bar's scaled geometry (`y`/`height`) measures from the axis domain floor,
 * which is 0 for a positive data set, so `y - q1*scaled` is only right when the
 * domain starts at 0 — using the payload's own q1/q3 and the axis' pixel scale
 * keeps it correct for a domain that does not.
 */
function BoxShape(props: any) {
  const { x, width, payload, y, height, q1: _unused } = props;
  const p = payload as BoxRow | undefined;
  if (!p) return null;
  // The bar is drawn at height = q3 pixels-per-unit, so the q1..q3 span is a
  // fraction of it. `height` is the pixel span of 0..q3, which is exactly the
  // scale factor the axis is using for this domain.
  const unit = height / (p.q3 || 1);
  const iqrPx = Math.max(1, (p.q3 - p.q1) * unit);
  const top = y + height - iqrPx;
  return (
    <g>
      <rect x={x} y={top} width={width} height={iqrPx} rx={2} className="ast-cv-box-iqr" />
      <line
        x1={x}
        x2={x + width}
        y1={top + iqrPx / 2}
        y2={top + iqrPx / 2}
        className="ast-cv-box-median"
      />
    </g>
  );
}

// ---- wave-1 kinds (2026-10-06): candlestick / waterfall / errorbar / violin ──
// All four ride the SAME engine as the box: a Bar whose scaled geometry anchors
// the drawing, plus the proven ErrorBar where it fits. The pixel contract is
// BoxShape's, measured: `height` is the span 0..bar-value, so `unit =
// height / (value || 1)` is the scale and `yOf(v) = y + height - v * unit` is
// exact for any domain that includes 0 (the domains below always do).

interface CandleRow { name: string; o: number; h: number; l: number; c: number; }

/** One candlestick per `series[0].ohlc` entry: [open, high, low, close]. */
function candleOf(ohlc: number[][], names: string[]): CandleRow[] {
  const rows: CandleRow[] = [];
  ohlc.forEach((q, i) => {
    if (!Array.isArray(q) || q.length < 4 || !q.every((v) => Number.isFinite(Number(v)))) return;
    const [o, h, l, c] = [Number(q[0]), Number(q[1]), Number(q[2]), Number(q[3])];
    rows.push({ name: names[i] ?? String(i + 1), o, h: Math.max(o, h, l, c), l: Math.min(o, h, l, c), c });
  });
  return rows;
}

function padDom(lo: number, hi: number): [number, number] {
  return [Math.min(0, Math.floor(lo * 1.05)), Math.max(1, Math.ceil(Math.max(1, hi) * 1.08))];
}

const CandleTip = (p: AnyTooltip) => {
  if (!p.active || !p.payload?.length) return null;
  const r = (p.payload[0]?.payload ?? {}) as Partial<CandleRow>;
  return (
    <div className="ast-cv-tooltip">
      <p className="ast-cv-tooltip-label">{String(p.label ?? "")}</p>
      <p className="ast-cv-tooltip-row">
        O <span className="ast-cv-tooltip-val">{fmt(r.o ?? 0)}</span>{" · "}
        H <span className="ast-cv-tooltip-val">{fmt(r.h ?? 0)}</span>{" · "}
        L <span className="ast-cv-tooltip-val">{fmt(r.l ?? 0)}</span>{" · "}
        C <span className="ast-cv-tooltip-val">{fmt(r.c ?? 0)}</span>
      </p>
    </div>
  );
};

const WaterTip = (p: AnyTooltip) => {
  if (!p.active || !p.payload?.length) return null;
  const r = (p.payload[0]?.payload ?? {}) as Partial<WaterRow>;
  return (
    <div className="ast-cv-tooltip">
      <p className="ast-cv-tooltip-label">{String(p.label ?? "")}</p>
      <p className="ast-cv-tooltip-row">
        <span className="ast-cv-tooltip-val">{fmt(r.from ?? 0)}</span> → <span className="ast-cv-tooltip-val">{fmt(r.to ?? 0)}</span>
      </p>
    </div>
  );
};

function CandleShape(props: any) {
  const { x, width, payload, y, height } = props;
  const p = payload as CandleRow | undefined;
  if (!p) return null;
  const unit = height / (p.h || 1);
  const yOf = (v: number) => y + height - v * unit;
  const up = p.c >= p.o;
  const stroke = up ? "var(--color-emerald)" : "var(--color-redx)";
  const bodyTop = yOf(Math.max(p.o, p.c));
  const bodyH = Math.max(1.5, Math.abs(yOf(p.o) - yOf(p.c)));
  return (
    <g>
      <line x1={x + width / 2} x2={x + width / 2} y1={yOf(p.l)} y2={yOf(p.h)} stroke={stroke} strokeWidth={1.2} />
      <rect x={x + width * 0.2} y={bodyTop} width={width * 0.6} height={bodyH} rx={1.5} fill={stroke} />
    </g>
  );
}

interface WaterRow { name: string; base: number; delta: number; from: number; to: number; fill: string; }

/** A waterfall/bridge: `points` are step values, `kinds[i]` marks a running delta
 *  (default) or an absolute checkpoint ("total"). The invisible `base` bar is
 *  the classic stacked-bar trick — it only positions the visible step. */
function waterOf(points: number[], kinds: string[] | undefined, names: string[]): WaterRow[] {
  const rows: WaterRow[] = [];
  let run = 0;
  points.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    const kind = String(kinds?.[i] ?? "delta").toLowerCase();
    const total = kind === "total" || kind === "absolute" || kind === "sum";
    const from = total ? 0 : run;
    const to = total ? v : run + v;
    run = to;
    rows.push({
      name: names[i] ?? String(i + 1),
      base: Math.min(from, to),
      delta: Math.abs(to - from) || 0.0001,
      from, to,
      fill: total ? "var(--color-accent)" : to >= from ? "var(--color-emerald)" : "var(--color-redx)",
    });
  });
  return rows;
}

interface ErrRow { name: string; y: number; err: [number, number]; lo: number; hi: number; }

/** Value ± error. `error.lo/hi` are ABSOLUTE bounds (the natural authoring
 *  shape); the ErrorBar engine wants POSITIVE offsets from the value, which is
 *  the box's whisker convention — both are clamped >= 0 or the lower cap
 *  mirrors upwards and the bar lies about its own range. */
function errOf(points: number[], error: { lo: number[]; hi: number[] } | undefined, names: string[]): ErrRow[] {
  const rows: ErrRow[] = [];
  points.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    const lo = Number(error?.lo?.[i]);
    const hi = Number(error?.hi?.[i]);
    const a = Math.min(v, Number.isFinite(lo) ? lo : v);
    const b = Math.max(v, Number.isFinite(hi) ? hi : v);
    rows.push({ name: names[i] ?? String(i + 1), y: v, err: [Math.max(0, v - a), Math.max(0, b - v)], lo: a, hi: b });
  });
  return rows;
}

interface ViolinRow { name: string; mid: number; top: number; kde: { x: number; y: number }[]; n: number; }

/** Silverman-rule KDE on a 64-point grid, normalised to max density 1 so the
 *  silhouette encodes SHAPE only — a density axis would be unreadable chrome. */
function kdeOf(samples: number[]): { x: number; y: number }[] {
  const lit = samples.filter((n) => Number.isFinite(n));
  if (lit.length < 2) return [];
  const n = lit.length;
  const mean = lit.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(lit.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1)) || Math.abs(mean) * 0.1 || 1;
  const h = 1.06 * sd * Math.pow(n, -0.2) || sd;
  const lo = Math.min(...lit) - 3 * h;
  const hi = Math.max(...lit) + 3 * h;
  const grid: { x: number; y: number }[] = [];
  let max = 0;
  for (let i = 0; i < 64; i++) {
    const x = lo + ((hi - lo) * i) / 63;
    let d = 0;
    for (const s of lit) d += Math.exp(-0.5 * ((x - s) / h) ** 2);
    d /= n * h * Math.sqrt(2 * Math.PI);
    if (d > max) max = d;
    grid.push({ x, y: d });
  }
  return max > 0 ? grid.map((g) => ({ x: g.x, y: g.y / max })) : grid;
}

/** One violin per series (a group), like a box: samples in `points`, or an
 *  authored `kde` when the model computed one upstream. */
function violinOf(series: { name: string; points: number[]; kde?: { x: number; y: number }[] }[], names: string[]): ViolinRow[] {
  const rows: ViolinRow[] = [];
  series.forEach((s, i) => {
    const lit = (Array.isArray(s.points) ? s.points : []).map(Number).filter((n) => Number.isFinite(n));
    const kde = Array.isArray(s.kde) && s.kde.length > 1 ? s.kde : kdeOf(lit);
    if (kde.length < 2) return;
    const sorted = [...lit].sort((a, b) => a - b);
    const mid = sorted.length ? sorted[Math.floor(sorted.length / 2)] : kde[Math.floor(kde.length / 2)].x;
    rows.push({ name: names[i] ?? s.name, mid, top: kde[kde.length - 1].x, kde, n: lit.length });
  });
  return rows;
}

function ViolinShape(props: any) {
  const { x, width, payload, y, height } = props;
  const p = payload as ViolinRow | undefined;
  if (!p || p.kde.length < 2) return null;
  const unit = height / (p.top || 1);
  const yOf = (v: number) => y + height - v * unit;
  const cx = x + width / 2;
  const half = width * 0.42;
  const left = p.kde.map((k) => `${(cx - k.y * half).toFixed(2)},${yOf(k.x).toFixed(2)}`);
  const right = [...p.kde].reverse().map((k) => `${(cx + k.y * half).toFixed(2)},${yOf(k.x).toFixed(2)}`);
  return (
    <g>
      <polygon points={[...left, ...right].join(" ")} fill="var(--color-accent)" fillOpacity={0.18} stroke="var(--color-accent)" strokeWidth={1.2} strokeLinejoin="round" />
      <line x1={cx - half * 0.4} x2={cx + half * 0.4} y1={yOf(p.mid)} y2={yOf(p.mid)} stroke="var(--color-brandtext)" strokeWidth={1.6} />
    </g>
  );
}

/** The y-axis bounds for a box chart: the whiskers' full extent plus headroom.
 *  `floorOf`/`ceilOf` are separate so a NEGATIVE sample range still starts at the
 *  data's own minimum — a box plot of negative values drawn from 0 would waste
 *  half the plot on empty space and misread the spread as small. */
function boxFloor(rows: BoxRow[]): number {
  const lo = rows.reduce((m, r) => Math.min(m, r.min), 0);
  return Math.min(0, Math.floor(lo * 1.05));
}
function boxCeil(rows: BoxRow[]): number {
  const hi = rows.reduce((m, r) => Math.max(m, r.max), 1);
  return Math.max(1, Math.ceil(hi * 1.08));
}

interface HistRow {
  name: string;
  count: number;
  /** Bin bounds, for the tooltip: counts without ranges are not a distribution. */
  from: number;
  to: number;
}

/** Sturges' rule is the textbook default, but on the small samples a chat card
 *  carries it over-bins (n=12 -> 4 bins of 3). sqrt(n) with a floor of 10 keeps
 *  the shape readable on a 360px card; 40 is the cap where x labels stop fitting. */
function histogramOf(points: number[]): HistRow[] {
  const lit = points.filter((p) => Number.isFinite(p));
  if (lit.length === 0) return [];
  // d3 `bin` returns bins with x0/x1 thresholds; the LAST bin's x1 is Infinity, so
  // it is closed to the data max — otherwise the final bar is labelled "8–∞".
  const bins = bin().thresholds(binCountFor(lit.length))(lit);
  const top = lit[Math.max(0, lit.length - 1)];
  const lo = lit.slice().sort((a, b) => a - b)[0];
  return bins
    .filter((b) => b.length > 0)
    .map((b) => ({
      name: `${fmt(b.x0 ?? lo)}–${fmt(Number.isFinite(b.x1 as number) ? (b.x1 as number) : top)}`,
      count: b.length,
      from: b.x0 ?? lo,
      to: Number.isFinite(b.x1 as number) ? (b.x1 as number) : top,
    }));
}

/**
 * Box tooltip: the five-number summary, named.
 *
 * The drawn box shows three of the five numbers (min/max are the whisker ends, the
 * quartiles are the rect's edges); the median is a ruled line. A reader cannot
 * measure any of them off a screenshot, so the tooltip states all five plus n —
 * which is also what tells them whether the box is worth trusting (a "box" from 4
 * points is a weak claim, and the card says so).
 *
 * The row is read off `payload[0].payload` — the chart's own datum — with the
 * precomputed `rows` as the fallback, and every read is optional-chained so a
 * recharts prop rename degrades to "no tooltip" rather than a thrown card.
 */
function BoxTip(p: AnyTooltip & { rows?: BoxRow[] }) {
  if (!p?.active || !p.payload?.length) return null;
  const r = (p.payload[0]?.payload ?? p.rows?.[0]) as BoxRow | undefined;
  if (!r) return null;
  return (
    <div className="ast-cv-tooltip">
      <p className="ast-cv-tooltip-label">{r.name}</p>
      {([["n", r.n], ["min", r.min], ["q1", r.q1], ["median", r.median], ["q3", r.q3], ["max", r.max]] as [string, number][]).map(([k, v]) => (
        <p key={k} className="ast-cv-tooltip-row">
          <span className="ast-cv-tooltip-key">{k}</span>
          <span className="ast-cv-tooltip-val">{fmt(v)}</span>
        </p>
      ))}
    </div>
  );
}

/** Histogram tooltip: the bin RANGE and its count. A count with no range is not
 *  readable — "4 values" is meaningless without knowing which 4. */
function HistTip(p: AnyTooltip & { rows?: HistRow[] }) {
  if (!p?.active || !p.payload?.length) return null;
  const r = (p.payload[0]?.payload ?? p.rows?.[0]) as HistRow | undefined;
  if (!r) return null;
  return (
    <div className="ast-cv-tooltip">
      <p className="ast-cv-tooltip-label">{fmt(r.from)} – {fmt(r.to)}</p>
      <p className="ast-cv-tooltip-row">
        <span className="ast-cv-dot" style={{ background: SERIES_COLORS[0] }} />
        <span className="ast-cv-tooltip-val">{r.count} {r.count === 1 ? "value" : "values"}</span>
      </p>
    </div>
  );
}



export function ChartBlockView({ block, ctx }: { block: ChartBlock; ctx?: RenderCtx }) {
  // No series ⇒ not a chart. Every adapter reads series[0], so this ONE guard
  // is what stops a malformed block from throwing inside render and blanking
  // the ENTIRE card (measured: the funnel / treemap / sankey reports).
  //
  // The guard is a FLAG, not an early return (2026-10-05, oxlint rules-of-hooks):
  // it used to `return` the empty figure here, which put every `useMemo` below it
  // behind a conditional — 3 errors that lint had been reporting on this file all
  // along, and a real (if rare) hazard: a card whose series arrive late (a
  // streaming block, or a reactive card that resolves `visible`) would mount with
  // fewer hooks than it later re-renders with, and React throws
  // "Rendered more hooks than during the previous render" — blanking the card.
  // Every read below is already guarded (`Array.isArray` / optional chaining), so
  // computing them against an empty series is safe and returns empty payloads.
  // `SERIES` is the ONE normal form every read below uses: the array when it is a
  // non-empty array, and an EMPTY array otherwise. Aliasing it here (rather than
  // testing `block.series` at each site) is what lets the no-series guard become a
  // flag instead of an early return — proven by render: without this alias,
  // `{type:"chart", chart:"bar"}` with no `series` key at all throws on
  // `block.series[0]` and blanks the card, which is precisely the defect the
  // original early return existed to prevent.
  const SERIES = Array.isArray(block?.series) ? block.series : [];
  const NO_SERIES = SERIES.length === 0;
  // A series' `points` may be a BINDING (a reactive card authors it as an
  // expression), so every read here is guarded: `.map`/`.length` on the object
  // form would throw and blank the entire card.
  const firstPts = SERIES[0]?.points;
  const labels = block.labels || (Array.isArray(firstPts) ? firstPts.map((_, i) => String(i + 1)) : []) || [];
  // Reactive: a series' points may be a binding, and a hidden series drops out.
  const activeSeries = useMemo(
    () => SERIES.filter((sr) => {
      const vis = (sr as unknown as { visible?: unknown }).visible;
      if (vis == null || !ctx) return true;
      const r = vis as Record<string, unknown>;
      if (typeof r?.["$expr"] === "string") {
        const out = evaluate(r["$expr"] as string, ctx.scope);
        return out.ok ? !!out.value : true;
      }
      return true;
    }),
    [SERIES, ctx],
  );
  const data = useMemo(() => labels.map((l, i) => {
    const row: Record<string, string | number> = { name: l };
    for (const sr of activeSeries) {
      const raw = (sr as unknown as { points: unknown }).points;
      const pts = raw != null && typeof raw === "object" && ctx ? bindPoints(raw, ctx.scope) : null;
      const lit = Array.isArray(raw) ? raw : [];
      row[sr.name] = pts ? (pts[i] ?? 0) : (lit[i] ?? 0);
    }
    return row;
  }), [labels, activeSeries, ctx]);

  const radarData = useMemo(() => {
    const rawFirst = SERIES[0]?.points;
    const axes = labels.length ? labels : (Array.isArray(rawFirst) ? rawFirst : []).map((_, i) => String(i + 1));
    return axes.map((a, i) => {
      const row: Record<string, string | number> = { axis: a };
      for (const sr of SERIES) {
        const lit = Array.isArray(sr.points) ? sr.points : [];
        row[sr.name] = lit[i] ?? 0;
      }
      return row;
    });
  }, [labels, SERIES]);

  // ── box + histogram payloads (one memo, beside the other adapters) ──────────
  // Both read the RAW points (bindings resolved first), because both TRANSFORM the
  // samples rather than view them: a box plot needs every observation, and a
  // histogram bins them. The generic `data` memo is label-indexed, so indexing it
  // by position here would silently mis-pair a bound series — each reads the
  // resolved points the scatter adapter reads.
  //
  // ONE memo for both kinds: two separate `useMemo` calls added below the no-series
  // guard were two more conditional-hook sites on top of the three that already
  // exist in this component (the guard is above every hook here — a pre-existing
  // shape, deliberately not refactored in this change).
  const BOX = block.chart === "box";
  const HIST = block.chart === "histogram";
  const CANDLE = block.chart === "candlestick";
  const WATERFALL = block.chart === "waterfall";
  const ERRBAND = block.chart === "errorbar";
  const VIOLIN = block.chart === "violin";
  const ADAPTED = BOX || HIST || CANDLE || WATERFALL || ERRBAND || VIOLIN;
  const { boxData, histData, candleData, waterData, errData, violinData } = useMemo(() => {
    const empty = { boxData: [] as BoxRow[], histData: [] as HistRow[], candleData: [] as CandleRow[], waterData: [] as WaterRow[], errData: [] as ErrRow[], violinData: [] as ViolinRow[] };
    if (!ADAPTED) return empty;
    if (BOX) return { ...empty, boxData: boxOf(activeSeries as { name: string; points: number[] }[], labels) };
    const raw = (activeSeries[0] as unknown as { points: unknown } | undefined)?.points;
    const pts = raw != null && typeof raw === "object" && ctx ? bindPoints(raw, ctx.scope) : null;
    const lit = pts ?? (Array.isArray(raw) ? (raw as number[]) : []);
    const nums = lit.map((p) => Number(p)).filter((n) => Number.isFinite(n));
    if (HIST) return { ...empty, histData: histogramOf(nums) };
    // Wave-1 kinds read their series-level payloads (ohlc / error / kde / items)
    // off the same resolved series the generic path reads. Names: the block's
    // labels first, then the waterfall items' own names — items are the natural
    // place a model puts per-step names.
    const s0 = activeSeries[0] as unknown as { ohlc?: number[][]; error?: { lo: number[]; hi: number[] }; kde?: { x: number; y: number }[]; items?: { name: string }[] };
    const names = labels.length ? labels : (Array.isArray(s0?.items) ? s0.items.map((it, i) => it?.name ?? String(i + 1)) : []);
    if (CANDLE) return { ...empty, candleData: candleOf(Array.isArray(s0?.ohlc) ? s0.ohlc : [], names) };
    if (WATERFALL) {
      const kinds = (activeSeries[0] as unknown as { waterfallKinds?: string[] })?.waterfallKinds;
      return { ...empty, waterData: waterOf(nums, kinds, names) };
    }
    if (ERRBAND) return { ...empty, errData: errOf(nums, s0?.error, names) };
    return { ...empty, violinData: violinOf(activeSeries as { name: string; points: number[]; kde?: { x: number; y: number }[] }[], labels) };
  }, [ADAPTED, BOX, HIST, CANDLE, WATERFALL, ERRBAND, VIOLIN, activeSeries, labels, ctx]);
  // Fail-soft in the same shape every other adapter uses: an empty adapter
  // renders the no-data line, never an axis with nothing on it. A box whose only
  // group has a single sample lands here too (see boxOf).
  const EMPTY_ADAPTER = (BOX && boxData.length === 0) || (HIST && histData.length === 0)
    || (CANDLE && candleData.length === 0) || (WATERFALL && waterData.length === 0)
    || (ERRBAND && errData.length === 0) || (VIOLIN && violinData.length === 0);

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

  // Axes + legend on every kind (owner 2026-10-04). The old shared fragment hid
  // both axes entirely, which is why every chart read as an unlabelled smear.
  // Axis elements must be DIRECT children — recharts detects axes by walking its
  // own children, so wrapping them in a Fragment makes every axis vanish. That
  // is exactly what the owner saw: only the scatter (inline axes) drew one.
  //
  // MEASURED (2026-10-05, mobile-canvas-audit.mjs at 360/390/412): the tick
  // font is the floor, and tick DENSITY is the second half of it. At 270px of
  // plot width an 11px mono label is ~7 characters, so nine daily labels
  // overlapped into an unreadable band. Two derived values:
  //   `tk`      — the tick font for this card's width (11px floor, 11.5+ on desktop)
  //   `interval`— how many ticks to SKIP between drawn ones, so a 9-label
  //               daily series draws 4 on a phone and all 9 on a desktop.
  // `recharts` `interval` is an integer skip, not a pixel budget, so the
  // derivation has to be a count: labels-per-phone ≈ plot width / 78px.
  const PLOT_W = typeof window !== "undefined"
    ? Math.max(160, (document.querySelector(".ast-cv-chart")?.clientWidth ?? 260) - 46 - 8)
    : 260;
  const phone = PLOT_W < 320;
  const tk = { fontSize: axisFont(window?.innerWidth ?? PLOT_W), fontFamily: "var(--font-sans)", fill: "var(--color-muted)" };
  // One label per ~78px of plot on a phone; never fewer than two drawn ticks,
  // and every tick on a desktop. recharts 2.15 takes the SKIP as a number and
  // the "always keep the first/last" behaviour INSIDE the same prop
  // (`AxisInterval = number | 'preserveStart' | …`), so there is no separate
  // intervalMode; a number skips, a string picks the keep-ends strategy.
  const axisLabels = Array.isArray(block.labels) ? block.labels : [];
  const skip = Math.max(0, Math.ceil(axisLabels.length / Math.max(2, Math.floor(PLOT_W / 78))) - 1);
  const interval = phone ? Math.max(1, skip) : 0;
  const X = <XAxis dataKey="name" tick={tk} tickLine={false} axisLine={{ stroke: AXIS_LINE }} height={24}
    interval={interval} />;
  const Y = <YAxis tick={tk} tickFormatter={(v: number) => fmt(v)} tickLine={false} axisLine={{ stroke: AXIS_LINE }} width={46}
    tickCount={phone ? 5 : undefined} scale={block.scale === "log" ? "log" : undefined} />;
  const TIP = <Tooltip content={<TT />} cursor={{ fill: "rgb(var(--c-89) / 0.04)" }} />;
  // Reference line (wave-1): a threshold/target ruled across the plot, labelled.
  const REF = block.refline ? (
    <ReferenceLine
      y={block.refline.value}
      stroke="var(--color-muted)"
      strokeDasharray="4 3"
      label={{ value: block.refline.label ?? fmt(block.refline.value), position: "insideTopRight", fill: "var(--color-muted)", fontSize: tk.fontSize }}
    />
  ) : null;
  // The legend is rendered by <ChartLegend> BELOW the ResponsiveContainer, never
  // as a recharts child — see the comment on ChartLegend for the measurement.
  const LEG_NAMES = activeSeries.map((s) => ({ name: s.name }));

  const AX = scatterAxisTitles(block.labels, String(activeSeries[0]?.name ?? ""));

  // Plot heights: a phone needs LESS height, not more. The whole card is a
  // column on a 360px screen, so a 300px sankey is half the screen for one
  // block; measured card heights at 360px were 275px for a line chart and 451px
  // for the sankey, with the legend below. Shortening the phone plot keeps the
  // data and the legend on one screen together.
  const PH = phone ? 1 : 0;   // 1 = phone plot
  const H = block.chart === "radial" || block.chart === "pie" || block.chart === "donut" ? (PH ? 180 : 210)
    : block.chart === "radar" ? (PH ? 190 : 230)
    : block.chart === "funnel" ? (PH ? 170 : 200)
    : block.chart === "treemap" ? (PH ? 190 : 240)
    : block.chart === "sankey" ? (PH ? 220 : 300)
    : BOX || HIST || CANDLE || WATERFALL || ERRBAND || VIOLIN ? (PH ? 170 : 200) : (PH ? 160 : 180);


  // Donut: single-series composition with the total in the hole. Slice colours
  // follow the LABELS (one colour per slice), not the series.
  const donutTotal = SERIES.reduce((n, s) => n + (Array.isArray(s.points) ? (s.points[0] ?? 0) : 0), 0);

  // The empty-figure guard, now AFTER every hook (see NO_SERIES above).
  if (NO_SERIES) {
    return (
      <figure className="ast-cv-chart">
        {block?.title && <figcaption className="ast-cv-chart-title">{block.title}</figcaption>}
        <p className="ast-cv-table-empty">No data — this chart arrived without any series.</p>
      </figure>
    );
  }

  return (
    <figure className="ast-cv-chart">
      {block.title && (
        <figcaption className="ast-cv-chart-title">
          {block.title}
          {typeof block.p === "number" && <span className="ast-cv-chart-p">p = {block.p}</span>}
        </figcaption>
      )}
      {/* LAYOUT LAW (owner 2026-10-04: "Where the request budget goes shows blank", "legends at the bottom"):
          the plot and its legend are SIBLINGS inside the figure. Self-sizing charts (sankey/treemap/funnel)
          and the donut carry their own legend row, so they must NOT live inside a fixed-height
          ResponsiveContainer — that box measured them 0x0 (blank) and let the legend spill out of the figure. */}
      {NATIVE.has(block.chart) ? (
        /* recharts 2.15 self-sizes Sankey/Treemap/Funnel; given a fixed-height container they measure 0×0 and
           paint NOTHING. They are rendered natively with measured pixels instead:
             sankey  → @nivo/sankey (recharts' own Sankey throws "e.split is not iterable" on our payload)
             treemap → recharts Treemap, measured width
             funnel  → recharts FunnelChart, measured width + conversion row */
        <Suspense fallback={<div className="ast-cv-graph-skeleton" aria-busy="true" />}><NativeLazy block={block} labels={labels} H={H} /></Suspense>
      ) : EMPTY_ADAPTER ? (
        // Same honest empty state the no-series guard uses, one level down: the
        // block DID validate and DOES have series, they just cannot form a
        // distribution (a one-sample group, or samples that are not finite). Saying
        // so is better than an empty axis.
        <p className="ast-cv-table-empty">
          {BOX
            ? "No distribution — a box plot needs at least two values per group."
            : "No data — this histogram needs at least one finite value."}
        </p>
      ) : BOX ? (
        <ResponsiveContainer width="100%" height={H}>
          <BarChart data={boxData} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
            {X}
            {/* The whisker runs min..max, so the axis must span the RANGE, not
                0..q3: with the default domain the upper whisker is clipped off the
                plot, and a function domain cannot help because recharts derives
                the function's input from the BAR values (q3), not from the
                ErrorBar. So the bound is stated from the computed extremes, which
                are the only place the range exists. */}
            <YAxis
              tick={tk} tickFormatter={(v: number) => fmt(v)} tickLine={false}
              axisLine={{ stroke: AXIS_LINE }} width={46}
              domain={[boxFloor(boxData), boxCeil(boxData)]}
              tickCount={phone ? 5 : undefined}
            />
            {REF}
            <Tooltip content={<BoxTip rows={boxData} />} cursor={{ fill: "rgb(var(--c-89) / 0.04)" }} />
            <Bar dataKey="q3" shape={<BoxShape />} isAnimationActive={false}>
              {/* The whisker is chrome (it is the range, not a series), so it
                  rides the muted ink and never a series hue — a coloured whisker
                  would read as a second measurement. */}
              <ErrorBar dataKey="whisker" direction="y" stroke="var(--color-muted)" strokeWidth={1.4} width={8} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : HIST ? (
        <ResponsiveContainer width="100%" height={H}>
          <BarChart data={histData} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} barCategoryGap="6%">
            {X}
            {Y}
            {REF}
            <Tooltip content={<HistTip rows={histData} />} cursor={{ fill: "rgb(var(--c-89) / 0.04)" }} />
            <Bar dataKey="count" fill={SERIES_COLORS[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      ) : CANDLE ? (
        <ResponsiveContainer width="100%" height={H}>
          <BarChart data={candleData} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} barCategoryGap="30%">
            {X}
            <YAxis tick={tk} tickFormatter={(v: number) => fmt(v)} tickLine={false} axisLine={{ stroke: AXIS_LINE }} width={46} domain={padDom(candleData.reduce((m, r) => Math.min(m, r.l), 0), candleData.reduce((m, r) => Math.max(m, r.h), 1))} tickCount={phone ? 5 : undefined} scale={block.scale === "log" ? "log" : undefined} />
            {REF}
            <Tooltip content={<CandleTip />} cursor={{ fill: "rgb(var(--c-89) / 0.04)" }} />
            <Bar dataKey="h" shape={<CandleShape />} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      ) : WATERFALL ? (
        <ResponsiveContainer width="100%" height={H}>
          <BarChart data={waterData} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} barCategoryGap="26%">
            {X}
            <YAxis tick={tk} tickFormatter={(v: number) => fmt(v)} tickLine={false} axisLine={{ stroke: AXIS_LINE }} width={46} domain={padDom(waterData.reduce((m, r) => Math.min(m, r.from, r.to), 0), waterData.reduce((m, r) => Math.max(m, r.from, r.to), 1))} tickCount={phone ? 5 : undefined} scale={block.scale === "log" ? "log" : undefined} />
            {REF}
            <Tooltip content={<WaterTip />} cursor={{ fill: "rgb(var(--c-89) / 0.04)" }} />
            <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="delta" stackId="wf" isAnimationActive={false}>
              {waterData.map((r, i) => <Cell key={i} fill={r.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : ERRBAND ? (
        <ResponsiveContainer width="100%" height={H}>
          <BarChart data={errData} margin={{ top: 12, right: 8, bottom: 0, left: 0 }} barCategoryGap="34%">
            {X}
            <YAxis tick={tk} tickFormatter={(v: number) => fmt(v)} tickLine={false} axisLine={{ stroke: AXIS_LINE }} width={46} domain={padDom(errData.reduce((m, r) => Math.min(m, r.lo), 0), errData.reduce((m, r) => Math.max(m, r.hi), 1))} tickCount={phone ? 5 : undefined} scale={block.scale === "log" ? "log" : undefined} />
            {REF}
            <Tooltip content={<TT />} cursor={{ fill: "rgb(var(--c-89) / 0.04)" }} />
            <Bar dataKey="y" fill={SERIES_COLORS[0]} radius={[3, 3, 2, 2]} isAnimationActive={false}>
              <ErrorBar dataKey="err" direction="y" stroke="var(--color-muted)" strokeWidth={1.4} width={8} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : VIOLIN ? (
        <ResponsiveContainer width="100%" height={H}>
          <BarChart data={violinData} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} barCategoryGap="26%">
            {X}
            <YAxis tick={tk} tickFormatter={(v: number) => fmt(v)} tickLine={false} axisLine={{ stroke: AXIS_LINE }} width={46} domain={padDom(violinData.reduce((m, r) => Math.min(m, r.kde[0]?.x ?? 0), 0), violinData.reduce((m, r) => Math.max(m, r.top), 1))} tickCount={phone ? 5 : undefined} scale={block.scale === "log" ? "log" : undefined} />
            {REF}
            <Tooltip content={<TT />} cursor={{ fill: "rgb(var(--c-89) / 0.04)" }} />
            <Bar dataKey="top" shape={<ViolinShape />} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      ) : block.chart === "donut" ? (
          <div className="ast-cv-donut">
            <ResponsiveContainer width="100%" height={H}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey={SERIES[0].name}
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
            {/* recharts renders no per-slice marker for a donut legend, so the
                slice names + shares are named here (owner 2026-10-04). */}
            <div className="ast-cv-chart-legend ast-cv-chart-legend-block">
              {data.map((r, i) => (
                <span key={i} className="ast-cv-legend-item">
                  <span className="ast-cv-dot" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                  {r.name} · {fmt(r[block.series[0].name])}
                  <em className="ast-cv-funnel-pct">
                    {donutTotal > 0 ? `${((Number(r[block.series[0].name]) / donutTotal) * 100).toFixed(0)}%` : ""}
                  </em>
                </span>
              ))}
            </div>
          </div>
      ) : (
      <ResponsiveContainer width="100%" height={H}>
        {block.chart === "line" ? (
          <LineChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            {X}
            {Y}
            {REF}
            {TIP}
            {activeSeries.map((s, i) => (
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
            {X}
            {Y}
            {REF}
            {TIP}
            {activeSeries.map((s, i) => (
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
            {X}
            {Y}
            {REF}
            {TIP}
            {activeSeries.map((s, i) => (
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
        ) : block.chart === "radial" ? (
          <RadialBarChart
            data={data}
            innerRadius="62%"
            outerRadius="100%"
            dataKey={SERIES[0].name}
            startAngle={90}
            endAngle={-270}
          >
            {/* Fixed 0-100 domain: without it recharts auto-scales the bar to the
                data max, so a 71% gauge rendered as a FULL ring (every gate
                gauge read as 100%). The domain is what makes the value honest. */}
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar
              dataKey={SERIES[0].name}
              cornerRadius={6}
              background={{ fill: "rgb(var(--c-89) / 0.05)" }}
              fill={SERIES_COLORS[0]}
              isAnimationActive={false}
            />
            {/* Gauge readout in the hole (owner 2026-10-04: every chart element). */}
            <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle"
              fontSize="22" fontFamily="var(--font-sans)" fontWeight="700" fill="var(--color-brandtext)">
              {fmt(Array.isArray(block.series[0].points) ? (block.series[0].points[0] ?? 0) : 0)}{block.title && /pct|%/i.test(block.title) ? "%" : ""}
            </text>
            <text x="50%" y="66%" textAnchor="middle"
              fontSize={tk.fontSize} fontFamily="var(--font-mono)" fill="var(--color-muted)">of max</text>
            <Tooltip content={<TT />} isAnimationActive={false} />
          </RadialBarChart>
        ) : block.chart === "scatter" ? (
          <ScatterChart margin={{ top: 10, right: 16, bottom: 8, left: 0 }}>
            {/* REAL numeric axes. The old pair was `hide` with no domain and the
                series carried no ZAxis-scoped size, so the plot rendered as an
                empty box — the "Latency vs payload is blank" report. */}
            <XAxis
              dataKey="x" type="number" domain={["dataMin", "dataMax"]} allowDecimals={false}
              tick={tk} tickLine={false} axisLine={{ stroke: AXIS_LINE }} height={24}
              tickCount={phone ? 5 : undefined}
              label={AX.x ? { value: AX.x, position: "insideBottom", offset: -12, fill: "var(--color-muted)", fontSize: tk.fontSize } : undefined}
            />
            <YAxis
              dataKey="y" type="number" domain={["dataMin - 10%", "dataMax + 10%"]}
              tick={tk} tickFormatter={(v: number) => fmt(v)}
              tickLine={false} axisLine={{ stroke: AXIS_LINE }} width={48}
              tickCount={phone ? 5 : undefined}
              label={AX.y ? { value: AX.y, angle: -90, position: "insideLeft", offset: 14, fill: "var(--color-muted)", fontSize: tk.fontSize } : undefined}
            />
            <ZAxis type="number" dataKey="z" range={[60, 260]} />
            <Tooltip cursor={{ stroke: "rgb(var(--c-89) / 0.25)" }} content={<TT />} />
            {activeSeries.map((sr, i) => (
              <Scatter
                key={sr.name}
                name={sr.name}
                data={scatterOf(sr, block.labels ?? [])}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                fillOpacity={0.75}
                isAnimationActive={false}
              />
            ))}
          </ScatterChart>
        ) : block.chart === "radar" ? (
          <RadarChart data={radarData} outerRadius="70%">
            {/* The polar axes carried 9.5px / 9px ticks, both under the 11px
                floor (measured 6 sub-11px findings per sweep at every phone
                width); the axis font now carries the floor and the radar keeps
                its tick count so the ring does not crowd. */}
            <PolarAngleAxis dataKey="axis" tick={tk} />
            <PolarGrid stroke={AXIS_TICKS} />
            {/* The radial scale was hidden too — a radar with no scale is a web. */}
            <PolarRadiusAxis
              angle={90} domain={[0, "auto"]}
              tick={tk}
              tickFormatter={(v: number) => fmt(v)}
              axisLine={false} tickCount={4}
            />
            <Tooltip content={<TT />} />
            {activeSeries.map((sr, i) => (
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
          </PieChart>
        )}
      </ResponsiveContainer>
      )}
      {/* THE LEGEND SITS BELOW THE PLOT, IN NORMAL FLOW, ON EVERY KIND (measured —
          see the comment on ChartLegend: recharts' <Legend> is position:absolute
          inside the surface and overlapped the x-axis tick labels on every
          recharts kind at 360/768/1280). Native charts (sankey/treemap/funnel) and
          the donut already render their own `.ast-cv-chart-legend-block` row
          directly beneath their own plot inside NativeChart / .ast-cv-donut, so
          adding a second one here would duplicate it — those kinds are excluded. */}
      {/* A box and a histogram have ONE meaning, not a set of series to disambiguate:
          the box legend is the group name and the histogram legend is the count, and
          both are already on the x axis / in the tooltip. A legend row naming the
          series would add nothing and steal height. */}
      {!NATIVE.has(block.chart) && block.chart !== "donut" && !BOX && !HIST && <ChartLegend series={LEG_NAMES} />}
    </figure>
  );
}