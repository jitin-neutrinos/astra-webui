// Canvas v3 visual harness — mounts the REAL renderers from src through the
// REAL stylesheet. Built by vite into scratch/canvas-v3/dist and statically
// served for Playwright screenshots at desktop + mobile, dark + light.
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import { Blocks } from "../../src/components/canvas/canvas-blocks";
import { CanvasFullscreenProvider } from "../../src/components/canvas/canvas-fullscreen";
import type { CanvasBlock } from "../../src/lib/canvas-schema";

const blocks: CanvasBlock[] = [
  { type: "kpi", label: "Tokens", value: "1.28M", delta: "+12%", trend: "up", spark: [3, 9, 6, 14, 11, 22, 19, 28] },
  { type: "kpi", label: "Cost", value: "$126.66", delta: "+4%", trend: "up", spark: [8, 7, 9, 8, 10, 9, 11, 12] },
  { type: "kpi", label: "Runs with a very long label to force ellipsis", value: 342, trend: "down", spark: [30, 28, 25, 26, 22, 20, 18, 15] },
  { type: "kpi", label: "P95 (ms)", value: 412, delta: "-9%", trend: "down" },
  { type: "quote", text: "Taste is trained, not innate. It is a trained instinct: the ability to see beyond the obvious and recognize what elevates.", attribution: "Emil Kowalski", role: "design engineer", context: "animations.dev course philosophy" },
  { type: "keyvalue", title: "Release facts", items: [
    { key: "Version", value: "3.7.0", mono: true },
    { key: "Commit hash with a very long value that must wrap not clip", value: "6557b87c9e21a4b8f0e1d2c3aabbccdd", mono: true },
    { key: "Deployed", value: "live on astra.jitinnair.com" },
    { key: "Checks", value: 66 },
  ] },
  { type: "diff", filename: "src/lib/canvas-schema.ts", hunks: [
    { header: "@@ -222,6 +222,8 @@ export function validateBlock", lines: [
      { op: "ctx", text: "  const T = b.type;" },
      { op: "ctx", text: "  b.type = TYPE_ALIASES[T] ?? T;" },
      { op: "add", text: "  if (b.type === \"quote\") return validateQuote(b);" },
      { op: "add", text: "  if (b.type === \"tabs\") return validateTabs(b);" },
      { op: "del", text: "  // old: quote blocks were rejected outright" },
    ] },
  ] },
  { type: "heatmap", title: "Token spend by daypart (k)", rows: ["Mon", "Tue", "Wed", "Thu", "Fri"], cols: ["00-06", "06-12", "12-18", "18-24"], values: [[2, 14, 9, 5], [3, 18, 11, 6], [2, 16, 12, 7], [4, 21, 13, 8], [1, 12, 8, 4]] },
  { type: "tabs", items: [
    { label: "Before", blocks: [{ type: "kpi", label: "Render rate", value: "6/30" }, { type: "kpi", label: "Block types", value: 13 }] },
    { label: "After", blocks: [{ type: "kpi", label: "Render rate", value: "27/30" }, { type: "callout", tone: "success", body: "Per-block tolerance + lenient JSON repair lifted the render floor to 90%." }] },
  ] },
  { type: "chart", chart: "donut", title: "Token split", labels: ["claude-code", "opencode", "agy", "other"], series: [{ name: "tokens", points: [61, 22, 9, 8] }] },
  { type: "chart", chart: "stack", title: "Weekly tokens by harness", labels: ["Mon", "Tue", "Wed", "Thu", "Fri"], series: [{ name: "claude", points: [120, 180, 240, 310, 290] }, { name: "opencode", points: [40, 60, 80, 95, 70] }] },
  { type: "terminal", title: "Deploy check", command: "systemctl --user is-active astra-webui.service", exitCode: 0, lines: [
    { text: "active", tone: "success" },
    { text: "served CSS: assets/index-phZFh2cg.css", tone: "dim" },
    { text: "ast-cv-item{min-width:0} present in served bundle", tone: "info" },
  ] },
  { type: "badges", items: [
    { label: "parser 72/72", tone: "success" },
    { label: "viewports 4/4", tone: "success" },
    { label: "recharts lazy", tone: "info" },
    { label: "vision QA quota", tone: "warn" },
  ] },
  { type: "accordion", items: [
    { title: "Why closed-set catalogs", body: "A2UI, json-render and CopilotKit all converge on a closed component catalog with schema validation — hallucinated components can never reach the UI. The 22-type set is the correctness and security boundary." },
    { title: "Streaming research verdict", body: "Brace-depth walking with per-block validation (already shipped) matches the state of the art: jsonchunk re-parses accumulated text per push; OpenUI drops invalid and keeps valid; memoized closed blocks prevent re-render jank." },
    { title: "Deferred from this pass", body: "gantt, calendar, map, files, image, rating — ranked lower by the survey; image needs a host allowlist decision; map needs a lazy chunk. Add on demand.", open: false },
  ] },
  { type: "table", columns: ["Harness", "Cost", "Trend"], rows: [["claude-code", "$126.66", "+4%"], ["opencode-go", "$41.20", "+18%"], ["agy (gemini)", "$12.04", "-9%"]] },
  { type: "timeline", items: [
    { title: "Parser hardening", detail: "Lenient JSON + aliases", time: "10:02", status: "done" },
    { title: "New block types", detail: "quote · keyvalue · diff · heatmap · tabs", time: "11:40", status: "active" },
    { title: "Deploy", time: "17:55", status: "todo" },
  ] },
  { type: "steps", items: [
    { title: "Schema + validators", status: "done" },
    { title: "Renderers + CSS", status: "done" },
    { title: "Directive + SOUL.md", status: "active" },
    { title: "Deploy + visual QA", status: "todo" },
  ] },
  { type: "checklist", items: [
    { text: "66/66 parser checks", status: "done" },
    { text: "corpus replay 2/2", status: "done" },
    { text: "recharts stays lazy (0 hits in main)", status: "done" },
    { text: "4-viewport visual QA", status: "open" },
  ] },
  { type: "progress", label: "Token budget used", value: 71, max: 100, unit: "%", status: "warn", detail: "GLM coding plan renews 2026-11-01" },
  { type: "compare", items: [
    { name: "Bare parse", badge: "before", points: [{ text: "6/30 fences rendered", tone: "con" }, { text: "no repair", tone: "con" }] },
    { name: "Coerced parse", badge: "after", points: [{ text: "27/30 fences rendered", tone: "pro" }, { text: "5 emission shapes healed", tone: "pro" }] },
  ] },
  { type: "callout", tone: "warn", title: "Known gap", body: "A still-streaming NDJSON fence paints only after its line completes — acceptable, tracked." },
  { type: "tree", nodes: [
    { id: "lib", label: "src/lib", children: ["schema", "markdown", "gates"] },
    { id: "schema", label: "canvas-schema.ts", detail: "787 → 960 lines" },
    { id: "markdown", label: "canvas-markdown.ts" },
    { id: "gates", label: "canvas-gates.ts" },
  ] },
  { type: "code", filename: "extract.sh", language: "bash", code: "sqlite3 ~/.hermes/state.db \"select id, content from messages \\\n  where role='assistant' and content like '%astra-canvas%'\" > corpus.jsonl" },
  { type: "references", items: [
    { title: "Vercel AI SDK — generative UI", href: "https://sdk.vercel.ai/docs/ai-sdk-ui/streaming-generative-ui", note: "streaming React server components" },
    { title: "assistant-ui", href: "https://www.assistant-ui.com", note: "tool-call → component mapping" },
  ] },
  // ── v4 editable + downloadable surfaces ──────────────────────────────────
  { type: "spreadsheet", title: "Q3 regional revenue", filename: "q3-revenue.xlsx",
    sheets: ["Revenue"], rows: [
      ["Region", "Q1", "Q2", "Q3", "Growth"],
      ["EMEA", 120, 138, 171, "+24%"],
      ["APAC", 95, 104, 128, "+35%"],
      ["AMER", 210, 219, 244, "+16%"],
    ] },
  { type: "text", title: "deploy-notes.md", filename: "deploy-notes.md",
    content: "# Deploy notes\n\n1. build\n2. restart astra-webui.service\n3. verify served hash" },
  { type: "document", title: "Release brief", filename: "release-brief.docx", content: [
    { kind: "h2", text: "Canvas v4" },
    { kind: "p", text: "Four editable, downloadable blocks with fullscreen expansion." },
    { kind: "li", text: "Spreadsheet — edit cells, download .xlsx" },
    { kind: "li", text: "Slides — navigate a deck, download .pptx" },
    { kind: "li", text: "Document — edit blocks, download .docx" },
    { kind: "li", text: "Text — edit plain text, download .md/.txt" },
  ] },
  { type: "slides", title: "Canvas v4 walkthrough", filename: "walkthrough.pptx", slides: [
    { heading: "Why blocks, not prose", layout: "title" },
    { heading: "What shipped", bullets: ["Four editable surfaces", "Fullscreen on every block", "Server-side download"] },
    { heading: "The Android catch", bullets: ["blob: URLs are refused", "Bytes go to disk first"] },
  ] },
];

const el = document.getElementById("root")!;
createRoot(el).render(
  <CanvasFullscreenProvider>
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px" }}>
      <Blocks blocks={blocks} canvasId="qa" />
    </div>
  </CanvasFullscreenProvider>,
);
