// canvas-chart-render.check.ts — pins the two chart-rendering defects the owner
// reported on 2026-10-04: a sankey authored in the documented "alt" form rendering
// BLANK, and the chart legend sitting ON TOP of the plot instead of below it.
//
// This check reads SOURCE, not a browser — the repo has no DOM test runner (no
// jsdom/happy-dom in node_modules), and the e2e truth is measured separately in
// a real chromium by scratch/canvas-v6/defects-e2e.mjs. The numbers that check
// is pinned to, measured at 360 / 768 / 1280:
//
//   sankey form B  before: painted=0 ribbons=0 nodes=0 empty=true
//                  after : painted=6 ribbons=2 nodes=4 empty=false
//   2-series line  before: plot 250-430, legend 400-430 (30px overlap), pos=absolute
//                  after : plot 557-737, legend 749-780 (12px below), pos=relative
//   2-series bar   before: plot 493-673, legend 643-673 (30px overlap), pos=absolute
//                  after : plot 843-1023, legend 1035-1066 (12px below), pos=relative
//
// Run: npx tsx --test src/lib/canvas-chart-render.check.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const chart = readFileSync(join(here, "../components/canvas/canvas-chart.tsx"), "utf8");
const native = readFileSync(join(here, "../components/canvas/canvas-native-charts.tsx"), "utf8");
const css = readFileSync(join(here, "../index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
// Comments are stripped from the TSX sources: the WHY comments name `<Legend>`,
// `white-space: nowrap` and the old selectors in prose, and a test that matched
// prose would pass on a comment alone (proven — the first run of this file
// "passed" the no-Legend assertion against its own comment).
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const chartCode = strip(chart);
const nativeCode = strip(native);

// ── defect 1: sankey form B ─────────────────────────────────────────────────

test("sankey form B (labels + flat series, no links) synthesises a flow", () => {
  // The parser only builds `links` for form A (canvas-schema.ts:593), so form B —
  // the `sankey (alt)` shape at docs/canvas-directive.md:127 — reaches the
  // renderer with no links at all. It must build a stage i → stage i+1 chain here
  // instead of falling into the empty state.
  assert.match(
    nativeCode,
    /labels\.length - 1/,
    "a sequential stage chain is derived from the label count (form B)",
  );
  assert.match(
    nativeCode,
    /source:\s*labels\[i\][\s\S]{0,160}target:\s*labels\[i \+ 1\]/,
    "the derived link connects stage i to stage i+1",
  );
});

test("form A links still win — the derived chain never overrides authored links", () => {
  const guard = nativeCode.indexOf("authored.length > 0");
  assert.ok(guard > 0, "authored links short-circuit before the derived chain");
  // The short-circuit must come BEFORE the derivation loop, or form A (nodes +
  // links) would be silently rewritten into a flat chain.
  const loopAt = nativeCode.indexOf("for (let i = 0; i < labels.length - 1; i++)");
  assert.ok(loopAt > guard, `derivation runs after the form-A guard (guard@${guard}, loop@${loopAt})`);
});

test("a ribbon value never exceeds its own destination stage (flow stays honest)", () => {
  assert.match(
    nativeCode,
    /Math\.min\(Math\.abs\(a\), Math\.abs\(b\)\)/,
    "ribbon = min(points[i], points[i+1]): a link can never be wider than the node it lands on",
  );
  // max() would draw a ribbon wider than its destination node and let d3-sankey
  // silently rebalance it — a quiet fudge.
  assert.doesNotMatch(nativeCode, /Math\.max\(Math\.abs\(a\)/, "no max() inflation of a derived ribbon");
});

test("an all-zero form B flow still renders the shape instead of blanking", () => {
  // nivo drops a zero-value link (it contributes no flow to scale), so an
  // authored points:[0,0,0] would collapse to an empty plot. Measured: before the
  // floor the zero-valued probe reported empty=true; after, painted=6 ribbons=2.
  assert.match(
    nativeCode,
    /value:\s*value > 0 \? value : 1/,
    "each ribbon is floored at 1 so a zero-valued flow keeps its nodes and shape",
  );
});

test("a single-stage flow with no links still hits the empty state", () => {
  // The floor must not paper over a genuinely empty block: labels.length < 2
  // returns no chain, so the empty state is still reachable and honest.
  assert.match(nativeCode, /labels\.length < 2\) return authored/, "one label cannot form a flow");
});

// ── defect 2: the legend ────────────────────────────────────────────────────

test("no recharts <Legend> is mounted — its wrapper is position:absolute", () => {
  // recharts 2.15.4 Legend.js:171 hardcodes `position: 'absolute'` into
  // outerStyle, so the row is positioned INSIDE the chart surface whatever we
  // pass it. Measured: computed position "absolute" on every recharts kind, with
  // the legend row overlapping the bottom 30px of the plot box (over the x-axis
  // tick labels). The legend is therefore rendered as ordinary DOM instead.
  //
  // Comments are stripped first: the WHY comment on ChartLegend names `<Legend>`
  // in prose, and matching prose would make this test pass on a comment alone.
  const code = chartCode;
  assert.doesNotMatch(code, /<Legend\b/, "canvas-chart mounts no recharts <Legend>");
  assert.doesNotMatch(code, /\bLegend,/, "recharts' Legend is not even imported");
  assert.doesNotMatch(code, /verticalAlign=/, "no verticalAlign — nothing is positioned inside the plot");
});

test("the legend is rendered outside the ResponsiveContainer, below the plot", () => {
  // Must be a SIBLING of the container in the returned figure, not a child: a
  // child is laid out by recharts' own absolutely-positioned surface.
  const fig = chartCode.slice(chartCode.lastIndexOf("<figure"));
  assert.match(fig, /<\/ResponsiveContainer>/, "the figure closes the ResponsiveContainer");
  const after = fig.slice(fig.indexOf("</ResponsiveContainer>"));
  assert.match(
    after,
    /<ChartLegend series=\{LEG_NAMES\} \/>/,
    "the legend renders AFTER </ResponsiveContainer>, in normal document flow",
  );
  assert.ok(
    after.indexOf("<ChartLegend") < after.indexOf("</figure>"),
    "the legend is inside the figure, not after it",
  );
});

test("every recharts kind gets the legend, including a single series", () => {
  // An explicit series name beats an ambiguous chart (the 2026-10-04 design law).
  // One guard only: nothing may exclude a one-series chart from the legend.
  const code = chartCode;
  assert.match(code, /if \(!series\.length\) return null;/, "only a series-less chart has no legend");
  assert.match(code, /series=\{LEG_NAMES\}/, "the legend is fed the resolved (reactive) series");
  assert.doesNotMatch(
    code,
    /LEG_NAMES\.length > 1|series\.length < 2/,
    "a one-series chart is NOT excluded from its own legend",
  );
});

test("kinds that carry their own legend block are not given a second one", () => {
  // sankey/treemap/funnel render `.ast-cv-chart-legend-block` inside NativeChart
  // and the donut renders a per-slice row in `.ast-cv-donut`; a second legend
  // would duplicate the labels.
  const m = chartCode.match(/!NATIVE\.has\(block\.chart\) && block\.chart !== "donut"/);
  assert.ok(m, "the shared legend skips native kinds and the donut");
  // box + histogram are excluded for a different reason: a box names its GROUPS on
  // the x axis and states min/q1/median/q3/max in the tooltip, and a histogram's
  // bars are counts of one series — a legend row naming the series would add no
  // information and steal height from a 200px plot.
  assert.match(chartCode, /!BOX && !HIST && <ChartLegend/,
    "box and histogram do not get a shared legend either — they carry their own labels");
});

test("the below-plot legend is explicitly in normal flow", () => {
  // `.ast-cv-chart-legend-block` carries `position: relative; z-index: 1` from the
  // earlier overlap work; the shared legend must not inherit an absolute box.
  assert.match(
    css,
    /\.ast-cv-chart-legend-below\s*\{[^}]*position:\s*static/,
    ".ast-cv-chart-legend-below pins position:static so the legend cannot overlay the plot",
  );
});

// ── recharts library truth ──────────────────────────────────────────────────

test("the recharts build in node_modules really does hardcode position:absolute", () => {
  // Guards the premise above against a dependency bump silently changing it.
  const pkg = JSON.parse(readFileSync(join(here, "../../package.json"), "utf8"));
  assert.match(pkg.dependencies.recharts, /2\.15/, "pinned to the recharts 2.x whose legend is absolute");
  const legendJs = readFileSync(join(here, "../../node_modules/recharts/lib/component/Legend.js"), "utf8");
  assert.match(
    legendJs,
    /position:\s*'absolute'/,
    "recharts' Legend wrapper really is position:absolute — the DOM legend is required",
  );
});

// ── the no-series guard is a FLAG, not an early return (2026-10-05) ─────────────
// MEASURED, not assumed. This guard used to `return` the empty figure at the TOP of
// the component, which put every useMemo below it behind a conditional — 3
// rules-of-hooks errors oxlint had been reporting on this file all along, and a
// real hazard: a card whose series arrive late (streaming, or a reactive card that
// resolves `visible`) re-renders with a different hook count and React throws
// "Rendered more hooks than during the previous render", blanking the card.
//
// Moving it below the hooks then exposed the inverse bug, which is why the
// regression is asserted here as a SOURCE invariant: `block.series[0]` on a block
// with NO `series` key throws a TypeError. The parser never emits that shape, but
// the sanitizer/streaming path can hand the renderer anything, and the original
// early return existed for exactly that.
//
// The invariant: ONE alias normalises the series ONCE, every hook reads the alias,
// and the flag+return sit AFTER the hooks. That combination is the only shape that
// is both hook-safe and undefined-safe.
test("the no-series guard is a flag below the hooks, and every read goes through the alias", () => {
  // The alias exists and is derived defensively.
  assert.match(
    chartCode,
    /const SERIES = Array\.isArray\(block\?\.series\) \? block\.series : \[\]/,
    "series are normalised ONCE into an alias, so an absent `series` key cannot throw",
  );
  assert.match(chartCode, /const NO_SERIES = SERIES\.length === 0;/, "the guard is a boolean flag");

  // NO read may touch `block.series` / `block?.series` directly — only the alias
  // line may, and every other occurrence must come after the NO_SERIES return.
  const aliasLine = chartCode.split("\n").findIndex((l) => /const SERIES = Array\.isArray/.test(l));
  const flagLine = chartCode.split("\n").findIndex((l) => /const NO_SERIES = SERIES\.length/.test(l));
  const returnLine = chartCode.split("\n").findIndex((l) => /if \(NO_SERIES\) \{/.test(l));
  assert.ok(aliasLine >= 0 && flagLine > aliasLine, "the flag is derived from the alias, below it");
  assert.ok(returnLine > flagLine, "the empty-figure return sits BELOW the flag");

  const lines = chartCode.split("\n");
  // Lines before the guard's return may only reference `block.series` on the alias
  // line itself (and in comments). Anything else is a throw waiting to happen.
  const offenders = lines
    .slice(0, returnLine)
    .map((l, i) => [i + 1, l] as const)
    .filter(([, l]) => /block\??\.series\[|block\.series\.reduce|block\.series\.map|block\.series\.filter/.test(l))
    .filter(([, l]) => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
  assert.deepEqual(offenders, [],
    `no pre-guard read may index block.series directly (offending lines: ${offenders.map(([n]) => n).join(", ")})`);

  // …and the hooks that read the alias must all be ABOVE that return, or they
  // would re-introduce the conditional-hook bug this change removed.
  const lastHook = Math.max(
    ...lines.map((l, i) => (/useMemo\(/.test(l) ? i : -1)),
  );
  assert.ok(lastHook < returnLine,
    `every useMemo is above the guard's return (last hook line ${lastHook + 1}, return line ${returnLine + 1})`);
});
