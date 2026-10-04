// Written-etiquette static check (owner 2026-10-04). The browser audit lives in scratch/canvas-v6/etiquette-e2e.mjs
// (real Chromium, 4 widths, ~50s). THIS file is the cheap, deterministic half that runs in every `run-checks`:
// it pins the SOURCE-LEVEL rules the browser audit proved matter, so a future edit that reintroduces the bug fails
// at commit time, not on a phone.
//   node --import ./scripts/ts-resolve.mjs src/lib/etiquette.check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const css = read("../index.css").replace(/\/\*[\s\S]*?\*\//g, "");
const chart = read("../components/canvas/canvas-chart.tsx");
const native = read("../components/canvas/canvas-native-charts.tsx");

/** The LAST declaration of a property for a selector wins in the cascade; return that value (or null). */
function finalValue(selector: string, prop: string): string | null {
  let v: string | null = null;
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(",").map((s) => s.trim().replace(/\s+/g, " "));
    if (!sels.includes(selector)) continue;
    const d = m[2].match(new RegExp("(?:^|;|\\s)" + prop + "\\s*:\\s*([^;]+)"));
    if (d) v = d[1].trim();
  }
  return v;
}

// 1) the prose/label surfaces wrap by word and are never cut with an ellipsis or a silent clip
const MUST_WRAP = [
  ".ast-cv-kpi-label", ".ast-cv-kv-key", ".ast-cv-tree-detail", ".ast-cv-quote-ctx", ".ast-cv-slider-label",
  ".ast-cv-term-title", ".ast-cv-term-cmd", ".ast-cv-badge", ".ast-cv-heat-row", ".ast-cv-heat-col", ".ast-cv-seg",
  ".ast-cv-sheet-tab", ".ast-cv-full-title", // a card's file tab and the fullscreen header: found cut on a real card at 320px
];
for (const sel of MUST_WRAP) {
  const ws = finalValue(sel, "white-space");
  assert.ok(ws === "normal" || ws === "pre-wrap", `${sel}: white-space must wrap (got ${ws})`);
  assert.equal(finalValue(sel, "text-overflow"), "clip", `${sel}: text-overflow must be clip, never ellipsis`);
  assert.notEqual(finalValue(sel, "overflow"), "hidden", `${sel}: overflow must not silently clip prose`);
}

// 2) KPI delta chip: wraps below the value, never a squeezed sliver
assert.equal(finalValue(".ast-cv-kpi-row", "flex-wrap"), "wrap", "KPI row must wrap so the delta chip drops below the value");
assert.equal(finalValue(".ast-cv-kpi-delta", "max-width"), "100%", "delta chip must be allowed the full row (no 46% cap)");

// 3) widows: prose balances/prettifies
assert.equal(finalValue(".ast-canvas", "text-wrap"), "pretty", "canvas prose must use text-wrap: pretty");
assert.equal(finalValue(".ast-cv-kpi-label", "text-wrap"), "balance", "labels must balance");

// 4) CHART LAW: legends sit at the BOTTOM — in normal flow, as a sibling AFTER the plot. (The first version of this
//    check asserted `verticalAlign="bottom"` on a recharts <Legend>; that element was later removed, so the loop matched
//    nothing and the assertion could no longer fail. These assertions test the design that exists now.)
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const chartCode = strip(chart), nativeCode = strip(native);
assert.equal((chartCode.match(/<Legend\b/g) ?? []).length, 0,
  "no recharts <Legend>: it is absolutely positioned INSIDE the plot surface, so it overlaps the plot and cannot be moved clear of it");
const legendAt = chartCode.indexOf("<ChartLegend");
const plotEnd = chartCode.lastIndexOf("</ResponsiveContainer>");
assert.ok(legendAt > 0 && plotEnd > 0 && legendAt > plotEnd, "the legend row must come AFTER the plot in DOM order (= below it)");
assert.ok(nativeCode.indexOf("<Legend rows") > nativeCode.indexOf("ast-cv-sankey-plot"), "the sankey legend must come AFTER the sankey plot");
for (const sel of [".ast-cv-chart-legend", ".ast-cv-legend"]) {
  const pos = finalValue(sel, "position");
  assert.ok(pos === null || pos === "static" || pos === "relative", `${sel}: legend must be in normal flow, never absolutely positioned (got ${pos})`);
}
assert.ok(/NATIVE\.has\(block\.chart\) \? \(/.test(chart), "native charts must be rendered outside the fixed-height ResponsiveContainer");
const nativeIdx = chart.indexOf("NATIVE.has(block.chart) ? (");
const rcIdx = chart.indexOf("<ResponsiveContainer width=\"100%\" height={H}>");
assert.ok(nativeIdx > 0 && rcIdx > nativeIdx, "the sankey/treemap/funnel/donut branches must come BEFORE the fixed-height container (they self-size)");
assert.ok(/ast-cv-sankey-plot[^>]*style=\{\{ height: H \}\}/.test(native), "the sankey plot must carry an explicit pixel height (it measured 0px = blank)");

// 5) no chart-title hard-coded axis labels leaking between charts (scatter had 'request (index)' / 'p95 (ms)' for ALL data)
assert.ok(!/value:\s*"request \(index\)"/.test(chart), "scatter axis titles must come from the block's labels, not be hard-coded");
assert.ok(!/value:\s*"p95 \(ms\)"/.test(chart), "scatter axis titles must come from the block's labels, not be hard-coded");

console.log("etiquette.check: wrap-by-word, no ellipsis, KPI chip wraps, legends at the bottom, sankey has real height");
