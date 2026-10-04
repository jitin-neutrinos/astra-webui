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

/** Resolve a CSS custom property to a concrete colour. nivo writes its theme into SVG presentation attributes,
 *  where `var(--x)` is NOT resolved, so a themed fill silently fell back to black on a dark card (the node
 *  labels were invisible). Re-resolved on a theme change via the `data-theme` attribute. */
function useResolvedColor(name: string, fallback: string): string {
  const read = () => {
    if (typeof document === "undefined") return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  };
  const [c, setC] = useState(read);
  useEffect(() => {
    setC(read());
    const mo = new MutationObserver(() => setC(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-scheme", "style", "class"] });
    return () => mo.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  return c;
}

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

const Legend = ({ rows, total, totalLabel = "total" }: { rows: { label: string; value: number }[]; total?: number; totalLabel?: string }) => (
  <div className="ast-cv-chart-legend ast-cv-chart-legend-block">
    {rows.map((r, i) => (
      <span key={i} className="ast-cv-legend-item">
        <span className="ast-cv-dot" style={{ background: SERIES_COLORS[0] }} />
        {r.label} · {fmt(r.value)}
      </span>
    ))}
    {total !== undefined && <span className="ast-cv-legend-total">{totalLabel} {fmt(total)}</span>}
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
  const textColor = useResolvedColor("--color-brandtext", "#f8fafc");
  const paperColor = useResolvedColor("--cv-paper", "#12121a");
  const first = block.series?.[0];
  const points = Array.isArray(first?.points) ? first!.points : [];

  // ── sankey ───────────────────────────────────────────────────────────────
  // Form A (`nodes` + `links`) is authoritative and is left untouched. Form B —
  // the `sankey (alt)` shape documented at docs/canvas-directive.md:127, `{labels,
  // series:[{points}]}` — arrives with NO links at all: the parser only synthesises
  // `links` for form A (canvas-schema.ts:593), so form B used to fall straight
  // into the empty state below and the card read as BLANK. Measured in chromium
  // (scratch/canvas-v6/defects-e2e.mjs, 360/768/1280): before the fix both sankey
  // probes reported `painted=0, ribbons=0, nodes=0, empty=true`; after, `painted>0`
  // with nodes + ribbons drawn.
  //
  // WHY a sequential stage→stage flow is the honest reading of form B: the flat
  // series IS the funnel down the stages — label i is the volume that reached
  // stage i. Each node's magnitude is that stage's own point value (so the node
  // heights are exactly what the author typed), and the ribbon between stage i and
  // i+1 carries the volume that made it THROUGH, i.e. min(points[i], points[i+1]).
  // Using min rather than points[i+1] is what keeps conservation honest: a ribbon
  // can never be wider than its own destination node, so d3-sankey never has to
  // inflate a stage, and a flow that DROPS at a stage reads as a narrowing ribbon
  // (the funnel shape the numbers describe) instead of a lie. max() would draw a
  // ribbon wider than the node it lands on and d3-sankey would silently rebalance
  // it, which is exactly the kind of quiet fudge the parser refuses elsewhere.
  const links = useMemo(() => {
    const authored = Array.isArray(first?.links)
      ? (first!.links as { source: string; target: string; value: number }[])
          .filter((l) => l && typeof l.source === "string" && typeof l.target === "string")
          .map((l) => ({ source: l.source, target: l.target, value: Number(l.value) || 0 }))
      : [];
    if (authored.length > 0 || labels.length < 2) return authored;
    // Form B: labels + a flat numeric series, no links. Build stage i → stage i+1.
    const out: { source: string; target: string; value: number }[] = [];
    for (let i = 0; i < labels.length - 1; i++) {
      const a = Number(points[i]);
      const b = Number(points[i + 1]);
      // A missing/NaN point means "no data for that stage" — value 1 keeps the
      // SHAPE (nodes + a hairline ribbon) instead of dropping the pair; nivo
      // drops a zero-value link because it contributes no flow to scale.
      const value = Number.isFinite(a) && Number.isFinite(b) ? Math.min(Math.abs(a), Math.abs(b)) : 1;
      out.push({
        source: labels[i],
        target: labels[i + 1],
        // ALL-ZERO form B (points [0,0,0]) still renders the shape: nivo lays out
        // on the max value, and a 0 link contributes nothing, so we floor each
        // ribbon at 1 to keep the card from collapsing to an empty plot. The
        // legend below still shows the true 0s — the shape is not the lie, the
        // numbers are.
        value: value > 0 ? value : 1,
      });
    }
    return out;
  }, [first, labels, points]);

  if (block.chart === "sankey") {
    if (labels.length === 0 || links.length === 0) {
      return (
        <div className="ast-cv-chart-native" ref={ref}>
          <p className="ast-cv-table-empty">No data — this flow needs at least one stage and one connection.</p>
        </div>
      );
    }
    // every link counted ONCE (a node's own number is its in+out throughput, so summing nodes double-counts)
    const flowTotal = links.reduce((n, l) => n + l.value, 0);
    const narrow = w < 520;
    const pad = narrow ? 74 : 132;
    return (
      <div className="ast-cv-chart-native ast-cv-sankey" ref={ref}>
        <div className="ast-cv-chart-native-plot ast-cv-sankey-plot" style={{ height: H }}>
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
          /* nivo's default is "a darker shade of the node colour". The node colour is `var(--color-accent)`, which
             d3-color cannot parse, so "darker" collapsed to rgb(0,0,0): black labels on a dark card (measured 1.1:1).
             A concrete, theme-resolved colour is the only thing nivo can use here. */
          labelTextColor={textColor}
          animate={false}
          isInteractive
          theme={{
            text: { fontSize: 10.5, fontFamily: "DM Sans, ui-sans-serif, system-ui, sans-serif", fill: textColor },
            labels: { text: { fontSize: 10.5, fontWeight: 500, fill: textColor } },
            tooltip: { container: { background: paperColor, color: textColor } },
          }}
        />
        </div>
        <Legend rows={labels.map((l, i) => ({ label: l, value: points[i] ?? 0 }))} total={flowTotal} totalLabel="total flow" />
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
        <div className="ast-cv-chart-native-plot">
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
      </div>
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
      <div className="ast-cv-chart-native-plot">
        <FunnelChart width={w} height={H} margin={{ top: 8, right: 16, bottom: 8, left: 16 }}>
          <Tooltip />
          <Funnel dataKey="value" data={stages as any[]} nameKey="name" isAnimationActive={false} stroke="none" lastShapeType="rectangle">
            {stages.map((st: any, i: number) => (
              <Cell key={st?.name ?? i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
            ))}
          </Funnel>
        </FunnelChart>
      </div>
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
