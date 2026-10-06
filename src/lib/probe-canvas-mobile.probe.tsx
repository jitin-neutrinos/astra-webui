// Mobile canvas audit — the PAGE half.
//
// Mounts the REAL card (CanvasView, not the block list) for every canvas block
// type, one chat turn each, through the REAL stylesheet (src/index.css), then
// hands the geometry to scripts/mobile-canvas-audit.mjs, which drives a real
// Chromium at 360/390/412px in dark AND light.
//
// Fidelity notes — each of these was a way the measurement could have lied:
//   • `.chat-turn` is used verbatim because it carries `content-visibility: auto`
//     + `contain-intrinsic-size`. A wrapper without it would report every
//     off-screen block as 0×0 and the audit would read "no overflow" on a card
//     that was never laid out. The auditor scrolls each turn into view first.
//   • the card is `<CanvasView spec>` (header + body + CanvasStateProvider), so
//     a `slider` really writes into the card's store and a `tabs` block really
//     holds its own nested Blocks().
//   • every fixture is authored as a JSON spec string and run through
//     `parseCanvasSpec`, so a fixture the parser drops is REPORTED (block
//     count before/after) rather than silently auditing an empty card — the
//     empty-chart trap: a chart that never rendered has nothing to overflow.
//   • the auditor must FAIL on an empty measurement set.
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
// fonts.css is NOT optional here: `@theme { --font-sans: … }` only resolves
// because Tailwind's plugin turns @theme into :root declarations, and every
// canvas font stacks on `var(--font-sans)`. A harness built without the
// Tailwind plugin measures Times New Roman at 16px instead of DM Sans at
// 11px — which reported every SVG label as a "tiny text" defect that does not
// exist in the app. Import the same stylesheet main.tsx imports.
import "../fonts.css";
import CanvasView from "../components/canvas/canvas-view";
import { CanvasFullscreenProvider } from "../components/canvas/canvas-fullscreen";
import { parseCanvasSpec } from "./canvas-schema";

/** Base URL of the auditor's static server, so media blocks get a REAL image
 *  (a data:/api: URL would take the download/transcode branch and paint the
 *  "unavailable" slot instead of the layout we mean to measure). */
const ORIGIN: string = ((window as unknown as { __PROBE_ORIGIN?: string }).__PROBE_ORIGIN ?? "");
const PIXEL = ORIGIN ? `${ORIGIN}/pixel.png` : "";

// ── fixtures: one per block type, authored with the shapes models actually emit
const SPECS: { id: string; json: string }[] = [
  { id: "kpi", json: JSON.stringify({ v: 1, blocks: [
    { type: "kpi", label: "Net revenue retention, trailing twelve months, all regions", value: "412.8ms", delta: "+38ms", trend: "up", spark: [3, 9, 6, 14, 11, 22, 19, 28] },
    { type: "kpi", label: "P95 latency", value: 1284, delta: "-9%", trend: "down" },
    { type: "kpi", label: "Error budget consumed", value: "71.4%" },
    { type: "kpi", label: "$", value: "$4.28M recurring annual revenue run rate" },
  ] }) },
  { id: "chart-line", json: JSON.stringify({ v: 1, title: "Tokens per day", blocks: [
    { type: "chart", chart: "line", title: "Weekly tokens by harness", labels: ["Mon 03", "Tue 04", "Wed 05", "Thu 06", "Fri 07", "Sat 08", "Sun 09", "Mon 10", "Tue 11"],
      series: [{ name: "claude-code", points: [120, 180, 240, 310, 290, 120, 140, 260, 330] }, { name: "opencode-go", points: [40, 60, 80, 95, 70, 30, 44, 88, 120] }] },
  ] }) },
  { id: "chart-bar", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "bar", title: "Cost by day", labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      series: [{ name: "spend", points: [126.66, 41.2, 12.04, 88.5, 64.2, 22.1, 9.9] }] },
  ] }) },
  { id: "chart-stack", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "stack", title: "Weekly tokens stacked", labels: ["W1", "W2", "W3", "W4", "W5", "W6"],
      series: [{ name: "claude", points: [120, 180, 240, 310, 290, 150] }, { name: "opencode", points: [40, 60, 80, 95, 70, 30] }] },
  ] }) },
  { id: "chart-area", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "area", title: "Cumulative spend", labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
      series: [{ name: "spend", points: [10, 26, 41, 55, 70, 92] }] },
  ] }) },
  { id: "chart-donut", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "donut", title: "Token split by harness", labels: ["claude-code", "opencode-go", "agy-gemini", "other"],
      series: [{ name: "tokens", points: [61, 22, 9, 8] }] },
  ] }) },
  { id: "chart-pie", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "pie", title: "Where the request budget goes", labels: ["gateway", "tools", "summaries", "other"],
      series: [{ name: "req", points: [1200, 800, 300, 100] }] },
  ] }) },
  { id: "chart-radial", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "radial", title: "Coverage", labels: ["a", "b", "c", "d"], series: [{ name: "cover", points: [88, 64, 41, 22] }] },
  ] }) },
  { id: "chart-radar", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "radar", title: "Profile", labels: ["speed", "cost", "quality", "safety", "docs"], series: [{ name: "us", points: [8, 5, 9, 7, 6] }] },
  ] }) },
  { id: "chart-scatter", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "scatter", title: "Latency vs payload", labels: ["req", "tool", "sum", "retry", "stream", "final", "meta", "poll", "ack"],
      series: [{ name: "p95", points: [[1, 12], [2, 44], [3, 22], [4, 91], [5, 30], [6, 12], [7, 61], [8, 18], [9, 40]] }] },
  ] }) },
  { id: "chart-box", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "box", title: "Latency spread per region", labels: ["eu-west", "us-east", "ap-south"],
      series: [{ name: "eu-west", points: [12, 15, 14, 30, 13, 18] }, { name: "us-east", points: [22, 25, 24, 41, 23, 28] }, { name: "ap-south", points: [31, 35, 34, 52, 33, 38] }] },
  ] }) },
  { id: "chart-histogram", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "histogram", title: "p95 latency (ms)", series: [{ name: "samples", points: [12, 15, 14, 30, 13, 12, 44, 51, 13, 12, 9, 30, 22] }] },
  ] }) },
  { id: "chart-candlestick", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "candlestick", title: "Weekly OHLC", labels: ["Mon", "Tue", "Wed", "Thu"],
      series: [{ name: "ACME", points: [], ohlc: [[150, 162, 145, 158], [158, 166, 152, 154], [154, 160, 148, 159], [159, 171, 157, 168]] }] },
  ] }) },
  { id: "chart-waterfall", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "waterfall", title: "Cash bridge", labels: ["Open", "Costs", "Revenue", "Tax", "Close"],
      series: [{ name: "cash", points: [120, -35, 50, -20, 115], items: [
        { name: "Open", value: 120, kind: "total" }, { name: "Costs", value: -35, kind: "delta" },
        { name: "Revenue", value: 50, kind: "delta" }, { name: "Tax", value: -20, kind: "delta" },
        { name: "Close", value: 115, kind: "total" }] }] },
  ] }) },
  { id: "chart-errorbar", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "errorbar", title: "p95 latency per deploy", labels: ["v2.1", "v2.2", "v2.3"],
      series: [{ name: "p95", points: [42, 48, 45], error: { lo: [38, 44, 41], hi: [47, 53, 49] } }],
      refline: { value: 50, label: "SLO" }, p: 0.032 },
  ] }) },
  { id: "chart-violin", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "violin", title: "Response-time distributions", labels: ["Team A", "Team B"],
      series: [{ name: "Team A", points: [38, 40, 41, 42, 42, 43, 44, 45, 46, 48, 52, 58] },
               { name: "Team B", points: [30, 33, 35, 36, 38, 40, 44, 49, 55, 62, 70, 81] }] },
  ] }) },
  { id: "palette", json: JSON.stringify({ v: 1, blocks: [
    { type: "palette", title: "Palette", against: "palettes.json", colors: [
      { name: "Accent", value: "#2bc8f3", role: "accent", note: "cyanx" },
      { name: "Void", value: "#090c12", role: "background" },
      { name: "Ink", value: "#f2f3f7", role: "text" }], scale: true, radius: true },
  ] }) },
  { id: "scorecard", json: JSON.stringify({ v: 1, blocks: [
    { type: "scorecard", title: "Heuristics", method: "heuristic", max: 4,
      items: [{ criterion: "Status visibility", score: 3, severity: "info", note: "ok" },
              { criterion: "Control", score: 2, severity: "warn", note: "no undo" }],
      verdict: "12/16" },
  ] }) },
  { id: "compliance", json: JSON.stringify({ v: 1, blocks: [
    { type: "compliance", regime: "DPDP Act 2023", asOf: "2026-10-06",
      items: [{ ref: "s.4", provision: "Notice", obligation: "Publish notice", status: "pass", severity: "info" },
              { ref: "s.8(5)", provision: "Breach", obligation: "Notify Board", due: "72h", status: "fail", severity: "danger", consequence: "penalty" }] },
  ] }) },
  { id: "schema", json: JSON.stringify({ v: 1, blocks: [
    { type: "schema", title: "Orders", tables: [{ name: "orders", rows: 18234, columns: [
      { name: "id", type: "uuid", key: "PK" }, { name: "customer_id", type: "uuid", key: "FK", ref: "customers.id" },
      { name: "total", type: "numeric(12,2)", key: "NN" }], indexes: ["(customer_id)"] }] },
  ] }) },
  { id: "sequence", json: JSON.stringify({ v: 1, blocks: [
    { type: "sequence", title: "Checkout", actors: [{ id: "app", label: "Mobile app", kind: "actor" },
      { id: "api", label: "API", kind: "service" }, { id: "pay", label: "Payment GW", kind: "external" }],
      messages: [{ from: "app", to: "api", label: "POST /checkout", kind: "sync" },
        { from: "api", to: "pay", label: "authorize", kind: "async" },
        { from: "pay", to: "api", label: "authorized", kind: "return" },
        { from: "api", to: "app", label: "201", kind: "return" }] },
  ] }) },
  { id: "theorem", json: JSON.stringify({ v: 1, blocks: [
    { type: "theorem", kind: "theorem", number: 1, statement: "Leaves = n+1 for any non-empty binary tree with n internal nodes.",
      proof: "Each internal node contributes two child slots.", refs: ["Knuth Vol 1"] },
  ] }) },
  { id: "algorithm", json: JSON.stringify({ v: 1, blocks: [
    { type: "algorithm", number: 1, steps: [{ text: "load samples S", complexity: "O(n)" },
      { text: "for each group g:", indent: 1 }, { text: "compute quartiles", indent: 2, complexity: "O(1)" }] },
  ] }) },
  { id: "clause", json: JSON.stringify({ v: 1, blocks: [
    { type: "clause", title: "MSA extract", items: [
      { ref: "12.3(a)", heading: "Liability cap", text: "Cap at 12 months fees.", risk: "warn", flags: ["capped"] },
      { ref: "12.3(b)(ii)", heading: "Carve-outs", text: "Confidentiality uncapped.", children: true, risk: "danger" }] },
  ] }) },
  { id: "obligations", json: JSON.stringify({ v: 1, blocks: [
    { type: "obligations", title: "Register", rows: [
      { ref: "12.3(a)", obligation: "Cap liability", party: "Provider", trigger: "Any claim", due: "continuous", status: "open", severity: "warn", consequence: "exposure" },
      { ref: "8.2", obligation: "Return CI", party: "Both", due: "30 days after completion", status: "open", severity: "info" }] },
  ] }) },
  { id: "chart-sankey", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "sankey", title: "Request budget",
      nodes: [{ id: "gw" }, { id: "tools" }, { id: "sum" }, { id: "ctx" }],
      links: [{ source: "gw", target: "tools", value: 1200 }, { source: "gw", target: "sum", value: 800 }, { source: "gw", target: "ctx", value: 300 }] },
  ] }) },
  { id: "chart-sankey-alt", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "sankey", labels: ["Visit", "Signup", "Paid"], series: [{ name: "flow", points: [1000, 120, 64] }] },
  ] }) },
  { id: "chart-treemap", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "treemap", title: "Repo size", items: [{ name: "src", value: 50 }, { name: "docs", value: 30 }, { name: "data", value: 12 }, { name: "scratch", value: 8 }] },
  ] }) },
  { id: "chart-funnel", json: JSON.stringify({ v: 1, blocks: [
    { type: "chart", chart: "funnel", title: "Signup drop-off", stages: [{ label: "Visits", value: 1000 }, { label: "Signup", value: 120 }, { label: "Paid", value: 64 }] },
  ] }) },
  { id: "table", json: JSON.stringify({ v: 1, blocks: [
    { type: "table", columns: ["Harness", "Monthly cost", "Tokens", "Trend", "Owner", "Notes"],
      rows: [["claude-code", "$126.66", "1.28M", "+4%", "jitinnair", "a very long note that has to wrap by word, never clip"],
        ["opencode-go", "$41.20", "410k", "+18%", "jitinnair", "second"],
        ["agy (gemini)", "$12.04", "122k", "-9%", "jitinnair", "third"]] },
  ] }) },
  { id: "table-stats", json: JSON.stringify({ v: 1, blocks: [
    { type: "table", columns: ["region", "latency"], rows: [["eu", 12], ["us", 31], ["ap", 22]], stats: { compute: ["mean", "median", "p95", "max"] } },
  ] }) },
  { id: "diagram-flow", json: JSON.stringify({ v: 1, blocks: [
    { type: "diagram", layout: "flow", direction: "lr", summary: "Ingest → normalise → store → index → answer.",
      nodes: [{ id: "a", label: "Ingest gateway", detail: "Hermes WS" }, { id: "b", label: "Normalise", kind: "transform" }, { id: "c", label: "Store", kind: "store" }, { id: "d", label: "Index" }, { id: "e", label: "Answer" }],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }, { from: "d", to: "e" }] },
  ] }) },
  { id: "diagram-er", json: JSON.stringify({ v: 1, blocks: [
    { type: "diagram", layout: "relationship", summary: "Two entities, one relationship.",
      nodes: [{ id: "user", label: "user", kind: "entity", note: "PK id", detail: "id: uuid\nemail: text\ncreated_at: timestamptz\nupdated_at: timestamptz\nname: text" },
        { id: "msg", label: "message", kind: "entity", note: "PK id", detail: "id: uuid\nuser_id: uuid FK\nbody: text\nrole: text\ntokens: int\ncreated_at: timestamptz" }],
      edges: [{ from: "user", to: "msg", cardinality: "1..*" }] },
  ] }) },
  { id: "diagram-circuit", json: JSON.stringify({ v: 1, blocks: [
    { type: "diagram", layout: "flow", summary: "Power rail.",
      nodes: [{ id: "v", label: "5V", kind: "circuit", symbol: "battery" }, { id: "r", label: "10k", kind: "circuit", symbol: "resistor" },
        { id: "c", label: "100n", kind: "circuit", symbol: "capacitor" }, { id: "g", label: "GND", kind: "circuit", symbol: "ground" }],
      edges: [{ from: "v", to: "r" }, { from: "r", to: "c" }, { from: "c", to: "g" }] },
  ] }) },
  { id: "checklist", json: JSON.stringify({ v: 1, blocks: [
    { type: "checklist", items: [{ text: "154 canvas-schema tests green", status: "done" }, { text: "etiquette law RG-078 pinned", status: "done" },
      { text: "mobile audit at 360/390/412", status: "open" }, { text: "tsc --noEmit clean", status: "fail" }] },
  ] }) },
  { id: "steps", json: JSON.stringify({ v: 1, blocks: [
    { type: "steps", items: [{ title: "Measure before fixing", detail: "capture geometry per block type at three widths", status: "done" },
      { title: "Fix per measured defect", status: "active" }, { title: "Re-measure the same harness", status: "todo" }] },
  ] }) },
  { id: "callout", json: JSON.stringify({ v: 1, blocks: [
    { type: "callout", tone: "warn", title: "Known gap", body: "A still-streaming NDJSON fence paints only after its line completes — accepted, tracked, and measurable on a phone." },
  ] }) },
  { id: "progress", json: JSON.stringify({ v: 1, blocks: [
    { type: "progress", label: "Token budget used", value: 71, max: 100, unit: "%", status: "warn", detail: "GLM coding plan renews 2026-11-01" },
  ] }) },
  { id: "timeline", json: JSON.stringify({ v: 1, blocks: [
    { type: "timeline", items: [{ title: "Parser hardening", detail: "Lenient JSON + aliases", time: "10:02", status: "done" },
      { title: "New block types", detail: "quote · keyvalue · diff · heatmap · tabs · layout · math · gitgraph", time: "11:40", status: "active" },
      { title: "Deploy", time: "17:55", status: "todo" }] },
  ] }) },
  { id: "compare", json: JSON.stringify({ v: 1, blocks: [
    { type: "compare", items: [
      { name: "Bare parse", badge: "before", caption: "the old path", points: [{ text: "6 of 30 fences rendered", tone: "con" }, { text: "no repair tier", tone: "con" }] },
      { name: "Coerced parse", badge: "after", caption: "the shipped path", points: [{ text: "27 of 30 fences rendered", tone: "pro" }, { text: "five emission shapes healed", tone: "pro" }] },
      { name: "Held for later", points: [{ text: "streaming NDJSON fences", tone: "neutral" }] }] },
  ] }) },
  { id: "tree", json: JSON.stringify({ v: 1, blocks: [
    { type: "tree", nodes: [
      { id: "lib", label: "src/lib", children: [
        { id: "schema", label: "canvas-schema.ts", detail: "2526 lines" },
        { id: "gates", label: "canvas-gates.ts", children: [{ id: "g1", label: "diagram-layout.check.ts" }] },
      ] },
      { id: "ui", label: "src/components/canvas", detail: "14 modules" }] },
  ] }) },
  { id: "code", json: JSON.stringify({ v: 1, blocks: [
    { type: "code", filename: "extract-corpus.sh", language: "bash",
      code: 'sqlite3 ~/.hermes/state.db "select id, content from messages where role=\'assistant\' and content like \'%astra-canvas%\'" > corpus.jsonl' },
  ] }) },
  { id: "references", json: JSON.stringify({ v: 1, blocks: [
    { type: "references", items: [{ title: "Vercel AI SDK — generative UI", href: "https://sdk.vercel.ai/docs/ai-sdk-ui/streaming-generative-ui", note: "streaming React server components for tool-driven surfaces" },
      { title: "assistant-ui", href: "https://www.assistant-ui.com", note: "tool-call to component mapping" }] },
  ] }) },
  { id: "quote", json: JSON.stringify({ v: 1, blocks: [
    { type: "quote", text: "Taste is trained, not innate. It is a trained instinct: the ability to see beyond the obvious and recognise what elevates.",
      attribution: "Emil Kowalski", role: "design engineer", context: "animations.dev course philosophy" },
  ] }) },
  { id: "keyvalue", json: JSON.stringify({ v: 1, blocks: [
    { type: "keyvalue", title: "Release facts", items: [{ key: "Version", value: "3.7.0", mono: true },
      { key: "Commit hash with a very long value that must wrap not clip", value: "6557b87c9e21a4b8f0e1d2c3aabbccdd", mono: true },
      { key: "Deployed", value: "live on astra.jitinnair.com" }] },
  ] }) },
  { id: "diff", json: JSON.stringify({ v: 1, blocks: [
    { type: "diff", filename: "src/lib/canvas-schema.ts", language: "ts", hunks: [
      { header: "@@ -222,6 +222,8 @@ export function validateBlock", lines: [
        { op: "ctx", text: "  const T = b.type;" },
        { op: "add", text: "  if (b.type === \"quote\") return validateQuote(b);" },
        { op: "add", text: "  if (b.type === \"tabs\") return validateTabs(b);" },
        { op: "del", text: "  // old: quote blocks were rejected outright" }] }] },
  ] }) },
  { id: "heatmap", json: JSON.stringify({ v: 1, blocks: [
    { type: "heatmap", title: "Token spend by daypart (k)", rows: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      cols: ["00-06", "06-12", "12-18", "18-24", "24-30", "30-36", "36-42", "42-48"],
      values: [[2, 14, 9, 5, 3, 8, 11, 4], [3, 18, 11, 6, 4, 9, 12, 5], [2, 16, 12, 7, 5, 10, 13, 6], [4, 21, 13, 8, 6, 11, 14, 7], [1, 12, 8, 4, 2, 7, 9, 3]] },
  ] }) },
  { id: "tabs", json: JSON.stringify({ v: 1, blocks: [
    { type: "tabs", items: [{ label: "Before", blocks: [{ type: "kpi", label: "Render rate", value: "6/30" }] },
      { label: "After the coercion pass", blocks: [{ type: "callout", tone: "success", body: "Per-block tolerance lifted the floor to 90%." }] }] },
  ] }) },
  { id: "accordion", json: JSON.stringify({ v: 1, blocks: [
    { type: "accordion", items: [{ title: "Why closed-set catalogs", body: "A2UI, json-render and CopilotKit all converge on a closed component catalog with schema validation." },
      { title: "Deferred from this pass", body: "gantt, calendar, map, rating — ranked lower by the survey.", open: false }] },
  ] }) },
  { id: "layout-stack", json: JSON.stringify({ v: 1, blocks: [
    { type: "layout", layout: "stack", blocks: [{ type: "kpi", label: "A", value: 1 }, { type: "kpi", label: "B", value: 2 }] },
  ] }) },
  { id: "layout-split", json: JSON.stringify({ v: 1, blocks: [
    { type: "layout", layout: "split", blocks: [
      { type: "chart", chart: "bar", title: "Left", labels: ["a", "b", "c"], series: [{ name: "s", points: [1, 2, 3] }] },
      { type: "callout", tone: "info", title: "Right", body: "A note beside the chart." }] },
  ] }) },
  { id: "layout-grid", json: JSON.stringify({ v: 1, blocks: [
    { type: "layout", layout: "grid", cols: 3, blocks: [{ type: "kpi", label: "One", value: 1 }, { type: "kpi", label: "Two", value: 2 }, { type: "kpi", label: "Three", value: 3 }] },
  ] }) },
  { id: "layout-bento", json: JSON.stringify({ v: 1, blocks: [
    { type: "layout", layout: "bento", blocks: [{ type: "kpi", label: "Requests today", value: "18.4k" },
      { type: "kpi", label: "P95", value: "128ms" }, { type: "kpi", label: "Errors", value: "0.4%" },
      { type: "kpi", label: "Cache hit", value: "92%" }, { type: "kpi", label: "Uptime", value: "99.98%" }] },
  ] }) },
  { id: "layout-masonry", json: JSON.stringify({ v: 1, blocks: [
    { type: "layout", layout: "masonry", blocks: [
      { type: "kpi", label: "A long metric label that has to wrap inside the tile", value: "1.28M" },
      { type: "callout", tone: "warn", title: "Note", body: "A masonry cell holds one block; the browser balances the columns." },
      { type: "kpi", label: "B", value: 2 }, { type: "kpi", label: "C", value: 3 }] },
  ] }) },
  { id: "math", json: JSON.stringify({ v: 1, blocks: [
    { type: "math", tex: "\\hat{\\beta} = (X^{\\top} X + \\lambda I)^{-1} X^{\\top} y \\quad \\text{with } \\lambda \\to 0^{+}", display: true, label: "ridge regression" },
  ] }) },
  { id: "math-long", json: JSON.stringify({ v: 1, blocks: [
    { type: "math", tex: "\\sum_{i=1}^{n} \\frac{\\partial \\mathcal{L}}{\\partial w_i} \\cdot \\left( \\sum_{j=1}^{m} a_{ij} x_j - y_i \\right)^2 + \\lambda \\lVert w \\rVert_2^2 = 0", display: true },
  ] }) },
  { id: "math-bad", json: JSON.stringify({ v: 1, blocks: [
    { type: "math", tex: "\\frac{1}{", display: true },
  ] }) },
  { id: "gitgraph", json: JSON.stringify({ v: 1, blocks: [
    { type: "gitgraph", title: "Release train", branches: [{ name: "main", head: "a1b2c3d" }, { name: "feat/mobile-cards", head: "e4f5g6h" }],
      commits: [
        { id: "e4f5g6h", branch: "feat/mobile-cards", message: "tighten card padding below 420px so content wins space", parents: ["a1b2c3d"], author: "jitinnair", when: "2h ago", tags: ["v6"] },
        { id: "a1b2c3d", branch: "main", message: "merge feat/mobile-cards", parents: ["9f8e7d6"], author: "jitinnair", when: "2h ago", merge: true },
        { id: "9f8e7d6", branch: "main", message: "measure geometry before touching CSS", author: "jitinnair", when: "5h ago" }] },
  ] }) },
  { id: "gitgraph-wide", json: JSON.stringify({ v: 1, blocks: [
    { type: "gitgraph", branches: [{ name: "main" }, { name: "release/6.0" }, { name: "feat/canvas-v6" }, { name: "hotfix/palette" }],
      commits: [
        { id: "h1", branch: "hotfix/palette", message: "palette role retint", parents: ["r1"], author: "jitinnair", when: "1d ago", tags: ["hotfix"] },
        { id: "f1", branch: "feat/canvas-v6", message: "add gitgraph block with real forks and merges", parents: ["r1"], author: "jitinnair", when: "2d ago" },
        { id: "r1", branch: "release/6.0", message: "merge canvas v6 into the release train", parents: ["m1", "f1", "h1"], author: "jitinnair", when: "3d ago", merge: true },
        { id: "m1", branch: "main", message: "canvas v6 charts self-size outside the fixed-height container", author: "jitinnair", when: "4d ago" }] },
  ] }) },
  { id: "terminal", json: JSON.stringify({ v: 1, blocks: [
    { type: "terminal", title: "Deploy check", command: "systemctl --user restart astra-webui.service && curl -sI http://127.0.0.1:3011/ | head -3", exitCode: 0,
      lines: [{ text: "active", tone: "success" }, { text: "served CSS: assets/index-phZFh2cg.css", tone: "dim" },
        { text: "ast-cv-item{min-width:0} present in served bundle", tone: "info" }] },
  ] }) },
  { id: "badges", json: JSON.stringify({ v: 1, blocks: [
    { type: "badges", items: [{ label: "parser 154/154", tone: "success" }, { label: "viewports 3/3", tone: "success" },
      { label: "recharts stays lazy", tone: "info" }, { label: "vision QA quota exhausted", tone: "warn" }, { label: "deferred: PDF reflow", tone: "danger" }] },
  ] }) },
  { id: "divider", json: JSON.stringify({ v: 1, blocks: [{ type: "divider", label: "measured defects" }] }) },
  { id: "spreadsheet", json: JSON.stringify({ v: 1, blocks: [
    { type: "spreadsheet", title: "Q3 regional revenue", filename: "q3-revenue.xlsx", sheets: ["Revenue", "Growth"],
      columns: ["Region", "Q1", "Q2", "Q3", "Growth", "Owner", "Notes"],
      rows: [["EMEA", 120, 138, 171, "+24%", "jitinnair", "renews in November"], ["APAC", 95, 104, 128, "+35%", "jitinnair", "fastest growth"],
        ["AMER", 210, 219, 244, "+16%", "jitinnair", "largest base"]], header: true },
  ] }) },
  { id: "slides", json: JSON.stringify({ v: 1, blocks: [
    { type: "slides", title: "Mobile canvas walkthrough", filename: "walkthrough.pptx", slides: [
      { heading: "Why blocks, not prose", layout: "title" },
      { heading: "What shipped", bullets: ["Three widths measured", "Per-block fixes", "Both themes verified"] }] },
  ] }) },
  { id: "document", json: JSON.stringify({ v: 1, blocks: [
    { type: "document", title: "Release brief", filename: "release-brief.docx", content: [
      { kind: "h2", text: "Canvas v6" }, { kind: "p", text: "Four editable, downloadable blocks with fullscreen expansion." },
      { kind: "li", text: "Spreadsheet — edit cells, download .xlsx" }, { kind: "li", text: "Slides — navigate a deck, download .pptx" }] },
  ] }) },
  { id: "text", json: JSON.stringify({ v: 1, blocks: [
    { type: "text", title: "deploy-notes.md", filename: "deploy-notes.md", content: "# Deploy notes\n\n1. build\n2. restart astra-webui.service\n3. verify served hash" },
  ] }) },
  { id: "slider", json: JSON.stringify({ v: 1, state: { n: 40 }, blocks: [
    { type: "slider", label: "Requests per second, modelled", bind: "n", min: 0, max: 100, step: 5, unit: "rps" },
    { type: "kpi", label: "Projected cost", value: { $expr: "n * 12.5" } }] }) },
  { id: "select", json: JSON.stringify({ v: 1, state: { r: "eu" }, blocks: [
    { type: "select", label: "Region", bind: "r", options: [{ label: "EU West", value: "eu" }, { label: "US East", value: "us" }, { label: "AP South", value: "ap" }] }] }) },
  { id: "multiselect", json: JSON.stringify({ v: 1, state: {}, blocks: [
    { type: "multiselect", label: "Series to include", bind: "s", options: [{ label: "claude", value: "c" }, { label: "opencode", value: "o" }, { label: "agy", value: "a" }] }] }) },
  { id: "segmented", json: JSON.stringify({ v: 1, state: {}, blocks: [
    { type: "segmented", label: "Interval", bind: "i", options: [{ label: "1h", value: "1h" }, { label: "24h", value: "24h" }, { label: "7d", value: "7d" }, { label: "30d", value: "30d" }] }] }) },
  { id: "toggle", json: JSON.stringify({ v: 1, state: {}, blocks: [
    { type: "toggle", label: "Include cached responses in the cost total", bind: "c" }] }) },
  { id: "search", json: JSON.stringify({ v: 1, state: {}, blocks: [
    { type: "search", label: "Filter series", bind: "q", placeholder: "Filter by name…" }] }) },
  { id: "graph", json: JSON.stringify({ v: 1, blocks: [
    { type: "graph", title: "Module graph", height: 260,
      nodes: [{ id: "schema", label: "canvas-schema", kind: "lib" }, { id: "blocks", label: "canvas-blocks", kind: "lib" },
        { id: "chart", label: "canvas-chart", kind: "lib" }, { id: "diag", label: "diagram-layout", kind: "lib" }],
      edges: [{ source: "blocks", target: "schema" }, { source: "blocks", target: "chart" }, { source: "blocks", target: "diag" }] },
  ] }) },
  { id: "image", json: JSON.stringify({ v: 1, blocks: [{ type: "image", src: PIXEL, alt: "rendered card at 390px", caption: "The card as the phone sees it." }] }) },
  { id: "gallery", json: JSON.stringify({ v: 1, blocks: [
    { type: "gallery", items: [{ src: PIXEL, alt: "one" }, { src: PIXEL, alt: "two" }, { src: PIXEL, alt: "three" }], layout: "3col" }] }) },
  { id: "video", json: JSON.stringify({ v: 1, blocks: [
    { type: "video", src: `${ORIGIN}/pixel.mp4`, caption: "A short clip." }] }) },
];

function Card({ id, json }: { id: string; json: string }) {
  const parsed = (() => {
    try {
      const authored = (JSON.parse(json).blocks ?? []).length;
      const spec = parseCanvasSpec(json);
      return { authored, spec };
    } catch (e) {
      return { authored: 0, spec: null, err: String((e as Error).message).slice(0, 120) };
    }
  })();
  // Publish what actually painted, AFTER the lazy chunks have resolved, as DATA
  // ATTRIBUTES the auditor reads — an empty count is not a pass, it is the
  // blank-card signature (a chart that never rendered has nothing to overflow).
  useEffect(() => {
    let alive = true;
    let tries = 0;
    const tick = () => {
      if (!alive) return;
      const section = document.querySelector<HTMLElement>(`[data-probe="${CSS.escape(id)}"]`);
      const host = section?.querySelector<HTMLElement>(".ast-canvas");
      const painted = host ? host.querySelectorAll(".ast-cv-item, .ast-cv-layout-cell").length : 0;
      if (painted > 0 || tries++ > 60) {
        if (section) {
          section.dataset.painted = String(painted);
          section.dataset.kept = String(parsed.spec?.blocks.length ?? 0);
          if (parsed.err) section.dataset.specError = parsed.err;
        }
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one measurement per fixture
  }, [id]);

  return (
    <section className="chat-turn" data-probe={id} data-authored={parsed.authored} data-kept={parsed.spec?.blocks.length ?? 0}>
      {parsed.spec ? <CanvasView spec={parsed.spec} canvasId={`probe-${id}`} /> : <p>fixture did not parse: {parsed.err}</p>}
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CanvasFullscreenProvider>
      <div className="chat-feed" style={{ maxWidth: 832, margin: "0 auto", padding: "16px" }}>
        {SPECS.map((s) => <Card key={s.id} id={s.id} json={s.json} />)}
      </div>
    </CanvasFullscreenProvider>
  </StrictMode>,
);

(window as unknown as { __probeReady: boolean }).__probeReady = true;