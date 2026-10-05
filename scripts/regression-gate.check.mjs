// regression-gate.check.mjs — the permanent pin.
//
// Every entry below is a bug that actually shipped to astra.jitinnair.com and
// was fixed. This file does two jobs:
//
//   1. MANIFEST — each row names the bug, the check that guards it, and the
//      date it was found. If someone deletes or renames the guarding check,
//      this gate fails. That is the whole point: the check must not be
//      quietly droppable.
//   2. LIVE RE-RUN — for each guarded check that this process can execute,
//      spawn it and assert it passes. A pinned bug that has regressed fails
//      here even if nobody ran the full suite.
//
// Run: node scripts/regression-gate.check.mjs
// Convention: assert-based, no framework (see ARCHITECTURE.md).

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

/**
 * @typedef {object} Regression
 * @property {string} id       stable id, never reused
 * @property {string} found    ISO date the bug was found
 * @property {string} symptom  what the owner saw
 * @property {string} guard    check file that must exist and pass
 * @property {boolean} [live]  run it here (false = needs env, verified in its own suite)
 */

/** @type {Regression[]} */
export const REGRESSIONS = [
  {
    id: "RG-001",
    found: "2026-09-29",
    symptom: "Duplicated assistant replies / greet rows after session resume or reconnect replay.",
    guard: "src/lib/replay-dedup.check.ts",
  },
  {
    id: "RG-002",
    found: "2026-09-29",
    symptom: "text-final re-rendered content that had already streamed, double-printing the answer.",
    guard: "src/lib/chat-dedup.check.ts",
  },
  {
    id: "RG-003",
    found: "2026-09-29",
    symptom: "Text reconciliation appended instead of replacing when deltas matched the final string.",
    guard: "src/lib/no-dup.check.ts",
  },
  {
    id: "RG-004",
    found: "2026-09-29",
    symptom: "Answer disappeared when re-pulled history supplied its own final text.",
    guard: "src/lib/final-text.check.ts",
  },
  {
    id: "RG-005",
    found: "2026-09-30",
    symptom: "Approval and clarify cards leaked into the wrong chat — the proxy broadcast every frame to every socket.",
    guard: "src/lib/request-ownership.check.ts",
  },
  {
    id: "RG-006",
    found: "2026-09-30",
    symptom: "One tab adopted a sibling tab's chat session from a legacy origin-wide storage key.",
    guard: "src/lib/tab-isolation.check.ts",
  },
  {
    id: "RG-007",
    found: "2026-09-30",
    symptom: "Two tabs shared one prompt queue, so concurrent chats split or lost messages.",
    guard: "src/lib/concurrent-queue.check.ts",
  },
  {
    id: "RG-008",
    found: "2026-10-01",
    symptom: "A stale orphan overlay inflated the unread pill total past the visible session list.",
    guard: "src/lib/unread.check.ts",
  },
  {
    id: "RG-009",
    found: "2026-10-02",
    symptom: "A chat focused on the phone still went unread on the web; focus was one value per device.",
    guard: "src/lib/unread.check.ts",
  },
  {
    id: "RG-010",
    found: "2026-10-02",
    symptom: "Second tab's focus erased its sibling's — one focus per device collapsed to last-writer-wins.",
    guard: "src/lib/unread.check.ts",
  },
  {
    id: "RG-011",
    found: "2026-10-02",
    symptom: "Reconnect backoff, liveness recycle and turn watchdog math drifted; wire died silently.",
    guard: "src/lib/streaming-resilience.check.ts",
  },
  {
    id: "RG-012",
    found: "2026-10-02",
    symptom: "Engine could not wake a dead socket after the Android WebView was frozen.",
    guard: "src/lib/wake-probe.check.ts",
  },
  {
    id: "RG-013",
    found: "2026-10-03",
    symptom: "Slash command routed to the wrong surface / command surface misrouted curated commands.",
    guard: "src/lib/command-exec.check.ts",
  },
  {
    id: "RG-014",
    found: "2026-10-03",
    symptom: "Live session id did not bridge to the stored chat key, so push and deep links used a stale key.",
    guard: "server/sid-bridge.check.mjs",
  },
  {
    id: "RG-015",
    found: "2026-10-03",
    symptom: "Canvas blocks mis-parsed: a malformed block dropped data instead of degrading to text.",
    guard: "src/lib/canvas-schema.check.ts",
  },
  {
    id: "RG-016",
    found: "2026-10-03",
    symptom: "Gate canvas (approval/clarify/report) rendered the wrong shape or lost its severity.",
    guard: "src/lib/canvas-gates.check.ts",
  },
  {
    id: "RG-017",
    found: "2026-10-03",
    symptom: "Tool I/O showed raw JSON to the owner instead of a human-readable summary.",
    guard: "src/lib/tool-io.check.ts",
  },
  {
    id: "RG-018",
    found: "2026-10-03",
    symptom: "Theme artwork / wipe transitions rendered the wrong palette during a theme change.",
    guard: "src/lib/theme-wipe.check.ts",
  },
  {
    id: "RG-019",
    found: "2026-10-03",
    symptom: "Transcript tail could be cut mid-segment (safe-tail regression).",
    guard: "src/lib/safe-tail.check.ts",
  },
  {
    id: "RG-020",
    found: "2026-10-03",
    symptom: "Unread counts included tool calls, thinking blocks and auto-greet rows.",
    guard: "src/lib/unread.check.ts",
  },
  {
    id: "RG-021",
    found: "2026-10-03",
    symptom: "Reveal pacing streamed tokens at a rate that janked the composer.",
    guard: "src/lib/reveal-pace.check.ts",
  },
  {
    id: "RG-022",
    found: "2026-10-03",
    symptom: "Scroll intent failed to stick to bottom during streaming inserts.",
    guard: "src/lib/scroll-intent.check.ts",
  },
  {
    id: "RG-023",
    found: "2026-10-03",
    symptom: "Model switch left the composer showing the previous provider/model/effort.",
    guard: "src/lib/model-switch.check.ts",
  },
  {
    id: "RG-024",
    found: "2026-10-03",
    symptom: "Media transcode path-safety or cache-key determinism regressed.",
    guard: "server/transcode.check.mjs",
  },
  {
    id: "RG-025",
    found: "2026-10-03",
    symptom: "Vault leaked a value while locked, or returned plaintext after TTL expiry.",
    guard: "server/vault.check.mjs",
  },
  {
    id: "RG-026",
    found: "2026-10-03",
    symptom: "WebSocket frame filter let a foreign frame through to a chat socket.",
    guard: "server/ws-filter.check.mjs",
  },
  {
    id: "RG-027",
    found: "2026-10-03",
    symptom: "Read markers went backwards or double-counted across devices.",
    guard: "server/read-state.check.mjs",
  },
  {
    id: "RG-028",
    found: "2026-10-03",
    symptom: "Training delete-after-review retried the whole review instead of only the delete.",
    guard: "scripts/training-pipeline.check.mjs",
  },
  {
    id: "RG-029",
    found: "2026-10-03",
    symptom: "Strict chronological rendering grouped segments by kind instead of arrival order.",
    guard: "scripts/verify-chronology.check.ts",
  },
  {
    id: "RG-030",
    found: "2026-10-03",
    symptom: "Chat surface CSS lost the bottom-anchored landing card or accent scrollbars.",
    guard: "scripts/css-chat-surface.check.mjs",
  },
  {
    id: "RG-031",
    found: "2026-10-03",
    symptom: "Background (/bg) replies landed in the chat feed instead of the dock.",
    guard: "src/lib/bg-routing.check.ts",
  },
  {
    id: "RG-032",
    found: "2026-10-03",
    symptom: "Connection banner showed the wrong state during reconnect.",
    guard: "src/lib/connection-banner.check.ts",
  },
  {
    id: "RG-033",
    found: "2026-10-03",
    symptom: "pdf-view limit() ran synchronously inside the Promise executor (TDZ on run).",
    guard: "src/components/doc-previews/pdf-limit.check.ts",
  },
  {
    id: "RG-034",
    found: "2026-10-03",
    symptom: "Chat history retry policy retried forever or not at all.",
    guard: "src/lib/history-retry.check.ts",
  },
  {
    id: "RG-035",
    found: "2026-10-03",
    symptom: "Harness agent cards showed a stale status instead of live progress.",
    guard: "src/lib/harness-agents.check.ts",
  },
  {
    id: "RG-036",
    found: "2026-10-03",
    symptom: "Session row rendered the wrong unread/preview state in the sidebar.",
    guard: "src/lib/session-row.check.ts",
  },
  {
    id: "RG-037",
    found: "2026-10-03",
    symptom: "Slash-command palette matched the wrong command for a partial slug.",
    guard: "src/lib/command-registry.check.ts",
  },
  {
    id: "RG-038",
    found: "2026-10-03",
    symptom: "Source filter dropped or duplicated frames from the gateway.",
    guard: "src/lib/source-filter.check.ts",
  },
  {
    id: "RG-039",
    found: "2026-10-03",
    symptom: "Chat backdrop resolved a media path against the origin and 404'd.",
    guard: "src/components/chat-backdrop.src.check.ts",
  },
  {
    id: "RG-040",
    found: "2026-10-03",
    symptom: "Media overhaul assertions (formats, limits, previews) regressed.",
    guard: "scripts/verify-media.check.ts",
  },
  {
    id: "RG-041",
    found: "2026-10-03",
    symptom: "Slash-command parser mis-split a command with arguments.",
    guard: "src/lib/slash-commands.check.ts",
  },
  {
    id: "RG-042",
    found: "2026-10-03",
    symptom: "Background dock items did not reconcile with the server, or failed to restore on reload.",
    guard: "src/lib/bg-dock.check.ts",
  },
  {
    id: "RG-043",
    found: "2026-10-03",
    symptom: "Theme artwork resolved the wrong asset for a palette.",
    guard: "src/lib/theme-artwork.check.ts",
  },
  {
    id: "RG-044",
    found: "2026-10-03",
    symptom: "Training page tiles or retry countdown rendered stale values.",
    guard: "src/lib/training-page.check.ts",
  },
  {
    id: "RG-045",
    found: "2026-10-03",
    symptom: "Gate registry failed to capture an approval or clarify frame.",
    guard: "server/gate-api.check.mjs",
  },
  {
    id: "RG-046",
    found: "2026-10-03",
    symptom: "Gate enrichment dropped fields when enriching a ledger row.",
    guard: "server/gate-enrich.check.mjs",
  },
  {
    id: "RG-047",
    found: "2026-10-03",
    symptom: "last-reply cache returned a stale answer for a session.",
    guard: "server/last-reply.check.mjs",
  },
  {
    id: "RG-048",
    found: "2026-10-03",
    symptom: "Server command registry served a stale command list.",
    guard: "server/command-registry.check.mjs",
  },
  {
    id: "RG-049",
    found: "2026-10-03",
    symptom: "sysinfo classifier, timeout or ranking mis-reported host state.",
    guard: "server/sysinfo.check.mjs",
  },
  {
    id: "RG-050",
    found: "2026-10-03",
    symptom: "Transcode capability probe reported the wrong limit.",
    guard: "scripts/transcode-cap.check.mjs",
  },
  {
    id: "RG-051",
    found: "2026-10-03",
    symptom: "Training dump/retry math regressed (schema, upsert idempotence, retry schedule).",
    guard: "scripts/training.check.mjs",
  },
  {
    id: "RG-052",
    found: "2026-10-03",
    symptom: "Wired /api/media/transcode route lost its guards or path-safety.",
    guard: "server/transcode-route.check.mjs",
  },
  {
    id: "RG-053",
    found: "2026-10-03",
    symptom: "Ops pages failed their DOM/auth assertions in a live browser.",
    guard: "scripts/ops-pages.dom.check.mjs",
    live: false, // needs live server + ASTRA_WEBUI_PASSWORD + playwright
  },
  {
    id: "RG-054",
    found: "2026-10-03",
    symptom: "History pagination re-fetched already-held rows (order/offset mismatch) or duplicated the boundary row when prepending an older page.",
    guard: "src/lib/pagination.check.ts",
  },
  {
    id: "RG-055",
    found: "2026-10-03",
    symptom: "Rich canvas blocks (rich-blocks) rendered or validated incorrectly.",
    guard: "src/lib/rich-blocks.check.ts",
  },
  {
    id: "RG-056",
    found: "2026-10-03",
    symptom:
      "Canvas fences emitted in a real-world shape (bare block, `blocks` as an item list, NDJSON, misnested ```kpi fence, unquoted keys) degraded to raw JSON instead of rendering as a card.",
    guard: "src/lib/canvas-replay.check.ts",
  },
  {
    id: "RG-057",
    found: "2026-10-03",
    symptom:
      "Terminal/tool output rendered raw: ANSI escape codes showed as glyph soup, ISO timestamps stayed machine-formatted, and a single-line JSON result ran hundreds of characters wide. The formatter's own ISO pattern also omitted the seconds field, so EVERY real timestamp failed to humanize (caught by this check).",
    guard: "src/lib/term-format.check.ts",
  },
  {
    id: "RG-058",
    found: "2026-10-03",
    symptom:
      "Terminal / code-execute / edit-file cards duplicated the word 'output': tool results are persisted as a JSON envelope ({\"output\": \"...\", \"exit_code\": 0}) and the terminal window rendered the ENVELOPE — a `\"output\":` key line, the escaped payload on the next line, and `exit_code` as if it were output. Also pins the chat feed memo's dependency list, which is what keeps a keystroke from rebuilding the whole transcript.",
    guard: "src/lib/term-envelope.check.ts",
  },
  {
    id: "RG-059",
    found: "2026-10-03",
    symptom:
      "Skeletal loaders were theme-coloured instead of grey: the shimmer sweep painted from --c-69 (annotated cyanx, i.e. the theme ACCENT), so one skeleton read cyan under Astra, sky blue under Water and ORANGE under Fire; the canvas doc placeholder painted from --c-89 (annotated redx) and went red under Fire; the config page hardcoded bg-white/5, invisible in light mode. All skeleton fills/sweeps now read --ast-sk-fill / --ast-sk-sweep, which theme-store re-derives per palette as a chroma-free grey.",
    guard: "src/lib/skeleton-grey.check.ts",
  },
  {
    id: "RG-060",
    found: "2026-10-04",
    symptom:
      "Light theme lost its accent entirely: the theme-compliance pass rewrote the light scope's --color-cyanx to a SELF-REFERENCE (var(--color-cyanx)), which resolves to nothing — every accent-derived surface (bubbles, KPI values, chart strokes, buttons) went colourless in light mode, and color-mix() props built on it collapsed to transparent. Also pins: the canvas CSS region carries no painted hex (all token-routed), no coloured edge rails, and no unroled saturated channel var leaks past the 12 documented status/overlay exceptions.",
    guard: "src/lib/canvas-theme.check.ts",
  },
  {
    id: "RG-065",
    found: "2026-10-04",
    symptom:
      "The `graph` block was silently hijacked: TYPE_ALIASES carried a v1 entry `graph: \"chart\"`, and validateBlock resolves aliases BEFORE BLOCK_TYPES — so a knowledge graph never reached the graph validator and every card degraded. Also pins the layout maths (deterministic settle, all-pairs separation so labels never stack, dangling edges dropped), component counting that counts ISOLATED nodes, and the four new chart kinds' data contracts (natural vocabulary normalises, garbage still degrades).",
    guard: "src/lib/canvas-graph.check.ts",
  },
  {
    id: "RG-061",
    found: "2026-10-04",
    symptom:
      "Reactive canvas expression sandbox regressions: prototype/constructor/global access, huge exponents (9^9^9 → Infinity), unbounded arrays (range(100000)), template mangling, or cross-scope compile-cache leaks in canvas-expr.ts would let agent-authored JSON read globals or lie on screen.",
    guard: "src/lib/canvas-expr.check.ts",
  },
  {
    id: "RG-062",
    found: "2026-10-04",
    symptom:
      "Reactive binding regressions: pointer/expression resolution, $from dataset filters (fail-soft on unknown ops/unset bindings), sort direction, header inference (row-0-as-header) or top-clamping in canvas-bind.ts.",
    guard: "src/lib/canvas-bind.check.ts",
  },
  {
    id: "RG-063",
    found: "2026-10-04",
    symptom:
      "Text split mid-word on wrap: 23 chat/canvas surfaces used overflow-wrap:anywhere or word-break:break-word, so a tight line broke a word in half (deploy|ment) and hash/URL runs broke regardless. Now one global baseline (overflow-wrap:break-word + word-break:normal + hyphens:none) with .gate-finding-file as the only sanctioned break-all (a raw path is not prose).",
    guard: "src/lib/text-wrap.check.ts",
  },
  {
    id: "RG-064",
    found: "2026-10-04",
    symptom:
      "Accent was addressed by HUE NAME (--color-cyanx / text-cyanx), so any palette whose accent is not cyan read as 'Astra blue with a pink button'. All components now consume the role token --color-accent (theme-store repaints it per palette; the role annotation for channel vars reads `accent`, and the palette storage slot keeps its original key).",
    guard: "src/lib/canvas-theme.check.ts",
  },
  {
    id: "RG-066",
    found: "2026-10-04",
    symptom:
      "The hand-rolled graph layout collapsed every graph into a tight cluster with overlapping labels and the owner rejected it outright. Replaced with a VERBATIM port of the comindash dashboard's forceGraph.js/cytoGraph.js/graphFilter.js plus its cytoscape renderer. This row runs the UPSTREAM self-check against the port, so any divergence in the physics or the deterministic seeding fails the build.",
    guard: "src/lib/canvas-forcegraph.port.check.mjs",
  },
  {
    id: "RG-067",
    found: "2026-10-04",
    symptom:
      "Graph element adapter drift: a dangling edge must be dropped rather than fatal, and every node must get a FINITE preset position (cytoscape 3.34's constructor elements: option silently drops position fields — nodes land at 0,0).",
    guard: "src/lib/canvas-cytograph.port.check.mjs",
  },
  {
    id: "RG-068",
    found: "2026-10-04",
    symptom:
      "Graph cross-filter drift in the ported graphFilter.js: facetAvailability must report the values that still leave a non-empty graph, and applyFilters must drop orphan nodes after edge survival.",
    guard: "src/lib/canvas-filter.port.check.mjs",
  },
  {
    id: "RG-069",
    found: "2026-10-04",
    symptom:
      "Theme builder shipped an unreadable palette: the OKLab forward matrix was wrong (a/b rows), generated grounds carried full accent chroma (dark grounds read as brown/espresso), and the contrast audit reported ratios it had not measured. A user theme syncs to every device, so a bad verdict ships everywhere.",
    guard: "src/lib/color-engine.check.ts",
  },
  {
    id: "RG-070",
    found: "2026-10-04",
    symptom:
      "The reactive canvas layer was documented but dead at the parser: validateBlock dropped kpi/progress value bindings, table bind/numeric cells and chart series bindings, parseCanvasSpec stripped `state`, control defaults never seeded the scope, and a re-parse reset user edits.",
    guard: "src/lib/canvas-schema.check.ts",
  },
{
    id: "RG-071",
    found: "2026-10-04",
    symptom:
      "Diagram nodes, edge labels and connectors overlapped or ran through each other once a diagram had more than a handful of nodes: the layout was DOM-measured with a nudge heuristic that cannot guarantee free space. The pure layout is audited for node/label overlap, out-of-bounds, edge-through-node, edge-through-label, diagonal segments and determinism on 5 stress fixtures plus 200 seeded random graphs.",
    guard: "src/lib/diagram-layout.check.ts",
  },
{
    id: "RG-072",
    found: "2026-10-04",
    symptom:
      "The diagram block's optional summary/caption/kind/note fields were silently dropped by validateBlock, so a reader got no text explanation of a diagram.",
    guard: "src/lib/canvas-schema.check.ts",
  },
  {
    id: "RG-073",
    found: "2026-10-04",
    symptom:
      "Sidebar logo alignment drifted: the mark sat a pixel off the title baseline after a container change. Guards the logo/title box geometry across widths.",
    guard: "src/lib/sidebar-logo-align.check.ts",
  },
  {
    id: "RG-074",
    found: "2026-10-04",
    symptom:
      "Priority+ composer overflow: a wrong fit decision does not throw, it silently hides a control the owner needed or overflows the row on a phone. Guards the exact-fit boundary, an item wider than the whole budget, unmeasured NaN widths on first paint, monotonicity, and that every collapsible control stays reachable EXACTLY ONCE at every width.",
    guard: "src/lib/overflow-fit.check.ts",
  },
  {
    id: "RG-075",
    found: "2026-10-04",
    symptom:
      "A sharp rectangle crept back into the UI (owner law: every visible corner is a pill, a circle or a rounded rectangle). Guards index.css app-wide, with the scrollbar/bottom-attached/heat-cell exceptions documented in the check.",
    guard: "src/lib/rounding.check.ts",
  },
  {
    id: "RG-076",
    found: "2026-10-04",
    symptom:
      "A sankey authored in the documented `sankey (alt)` form (labels + a flat series, NO links) rendered BLANK: the parser only synthesises links for form A, and the renderer showed its empty state for every form-B card ('Where the request budget goes shows blank'). Measured in chromium at 360/768/1280: before painted=0 ribbons=0 nodes=0 empty=true; after painted=6 ribbons=2 nodes=4. The same report said the chart LEGEND sat at the TOP / over the plot: recharts 2.15.4 hardcodes position:absolute on its legend wrapper (Legend.js:171), so it was laid out INSIDE the chart surface and overlapped the x-axis tick labels by 30px on every recharts kind. Guards the stage-chain derivation (form A still wins, ribbons never exceed their destination stage, an all-zero flow still renders its shape), and that the legend is ordinary DOM below the plot, present for a one-series chart, and never duplicated for the kinds that carry their own legend block.",
    guard: "src/lib/canvas-chart-render.check.ts",
  },
  {
    id: "RG-077",
    found: "2026-10-04",
    symptom:
      "A KPI delta was clipped mid-word with no ellipsis ('+38m' instead of '+38ms'), because src/index.css declared .ast-cv-kpi-delta TWICE — a stale `overflow:hidden; text-overflow:ellipsis; white-space:nowrap` and a newer wrapping rule — and four sibling selectors shared the trap through a `white-space: nowrap` group rule. Ellipsis is inert on the inline-flex chip, so the old pair could only ever clip. Measured in chromium: a KPI value of '412.8ms (trailing twelve months, all regions)' reported clientWidth 273 vs scrollWidth 447 at 768px (dx=174px of text silently gone) before, dx=0 after; the phone KPI label ellipsized 29px of itself away. Guards that every value surface has exactly ONE authoritative declaration which is never nowrap, that nothing on canvas hides a value with nowrap+hidden and no ellipsis, and that prose surfaces (legend names, reference titles and notes, timeline/compare titles, table cells, keyvalue values) wrap by word.",
    guard: "src/lib/canvas-text-integrity.check.ts",
  },
  {
    id: "RG-078",
    found: "2026-10-04",
    symptom:
      "Three chart faults and a text-etiquette sweep, all measured in a real browser. (1) 'Where the request budget goes' (a sankey) rendered BLANK: the plot sat inside the fixed-height ResponsiveContainer built for recharts, so the self-sizing nivo plot measured 0px tall (svg 0x0) and painted nothing. (2) 'Latency vs payload' (a scatter) was dropped by the parser: its natural data is [[x,y]] pairs or [{x,y}] objects, which failed the numeric-array test and silently discarded the whole card; its axis titles were also hard-coded to 'request (index)' / 'p95 (ms)' for every scatter. (3) Sankey node labels rendered black on the dark card (1.1:1): nivo's default label colour is a darker shade of the node colour, the node colour is var(--color-accent), d3 cannot parse it and returns rgb(0,0,0); fixed by passing a theme-resolved concrete colour. (4) Text etiquette: KPI labels were nowrap+ellipsis, the delta chip was capped at 46% width, titles left a lone figure on its own line, tables and heatmap headers broke mid-word. Guards the source-level rules the browser audit proved matter: prose surfaces wrap by word with no ellipsis and no silent clip, the KPI row wraps, legends sit at the bottom, the self-sizing charts render OUTSIDE the fixed-height container and the sankey plot carries an explicit pixel height, scatter axis titles come from the data. The browser half lives in scratch/canvas-v6/etiquette-e2e.mjs (4 widths, 40 assertions).",
    guard: "src/lib/etiquette.check.ts",
  },
  {
    id: "RG-079",
    found: "2026-10-04",
    symptom:
      "Chat auto-ingestion or dataset build regressed: tool/system rows leaked into the SFT dataset, a conversation not starting with a user turn or not ending with an assistant turn was emitted, duplicate conversations were not deduplicated by content hash, or the ingested_at backfill left already-dumped sessions reading as un-ingested.",
    guard: "scripts/ingest.check.mjs",
  },
  {
    id: "RG-080",
    found: "2026-10-04",
    symptom:
      "A `graph` block rendered as a broken/empty card instead of a map with context. Root cause was a silent field-name disagreement across two files: canvas-graph-view.tsx reads ele.data(\"detail\") for BOTH the tap payload and the a11y adjacency table, but the ported adapter canvas-cyto.ts toElements() only ever wrote `description` (the comindash field name it was ported from). The canvas `graph` schema, docs/canvas-directive.md and every agent emission use `detail`, so the two names never met and every node's context panel came up empty. Measured on a 31-node/59-edge payload: 0 of 31 nodes carried any text while the shape validator, the parser and the d3 layout all passed — which is exactly why it survived and read as a rendering fault rather than missing data. Guards that an authored `detail` reaches cytoscape as `detail`, that the legacy `description` shape still works (this adapter is a port and the dashboard still calls it that way), that a node with neither stays null rather than a coerced 'null', and — the structural guard — that every field the view reads via .data(\"…\") is a key toElements actually writes, so a future rename cannot silently split them again.",
    guard: "src/lib/graph-node-detail.check.ts",
  },
  {
    id: "RG-081",
    found: "2026-10-04",
    symptom:
      "Training-dataset hygiene regressed: tool-result bodies leaked into the SFT set instead of a compact heading, a JSON envelope survived unwrapping, automation (cron/oneshot) or internal reviewer sessions were included, harness scaffolding (System/Surface/compaction/background-process notices) or greeting boilerplate reached the data, same-role turns were not merged, or an oversized turn was not truncated.",
    guard: "scripts/dataset.check.mjs",
  },
  {
    id: "RG-082",
    found: "2026-10-04",
    symptom:
      "The job drill-down's change evidence regressed: the doc-estate diff mis-classified a created/edited/deleted skill, a same-size (mtime-only) edit stopped counting, a no-op was reported as a change, skill names were read from the category dir instead of the skill dir, or the reviewer's FILE: claims were parsed wrongly (mid-line prose taken as a claim, duplicates kept, 'none' counted) so undeclared real work went unreported.",
    guard: "scripts/analysis.check.mjs",
  },
  {
    id: "RG-083",
    found: "2026-10-04",
    symptom:
      "Parallel chat analysis lost an edit: two concurrent reviewers both edited one SKILL.md (a shared doc estate, not under version control), so one write silently overwrote the other. Guards the collision rule — overlapping time windows AND intersecting changed-file sets are the only real collision; touching windows, different files, and no-op runs must NOT be flagged (over-reporting would needlessly re-run work, under-reporting would lose edits).",
    guard: "scripts/backfill.check.mjs",
  },
  {
    id: "RG-084",
    found: "2026-10-05",
    symptom:
      "Sidebar nav rows stacked with zero vertical gap: after the filled-selected change the Work header and Chats row both paint a full accent fill, and with no spacing they read as one merged blob. Guards that the items container keeps flex flex-col gap-1.5 mt-1 so EVERY group (Work/Configure/Operate, expanded + rail) keeps header/row spacing.",
    guard: "scripts/sidebar-gap.check.mjs",
  },
  {
    id: "RG-085",
    found: "2026-10-05",
    symptom:
      "Astra runs a SQLite build vulnerable to the WAL-reset corruption bug (SQLite 3.7.0..3.51.2: a checkpoint racing a WAL-resetting commit records frames as backfilled when they were not, so a committed transaction silently vanishes — no error at write or checkpoint time; fixed in 3.51.3, 2026-03-13). Node bundles its own SQLite, so this recurs with no diff in this repo: the dnf Node 22.22.2 shipped exactly 3.51.2, the last vulnerable release. Preconditions are live here — WAL mode plus two processes on the same file (the service plus a detached backfill runner, per training.mjs's own comment). Detected here only by reading the runtime; no test, error or log line ever mentioned it. Guards three things: the LIVE interpreter's sqlite_version() is >= 3.51.3 and is not the withdrawn 3.52.0; astra-webui.service does not still ExecStart the dnf /usr/bin/node; and the live database passes PRAGMA integrity_check with a non-empty row count. Also records that newer is not safer here — Node 24.9.0 bundles SQLite 3.50.4, so 'upgrade Node' by version number walks back into the bug.",
    guard: "scripts/sqlite-runtime.check.mjs",
  },
  {
    id: "RG-086",
    found: "2026-10-05",
    symptom:
      "A duplicated user message: the client's durable outbox is at-least-once, so a crash, a retry, or a reconnect replays prompt.submit, and the server has no memory that it already accepted that message. The client structurally cannot prevent this — it cannot distinguish 'accepted, response lost' from 'never arrived' — so a duplicate reaches the model as a second turn. Fixed by server-side idempotency (message-dedupe.mjs) claimed BEFORE the upstream forward in hermes-proxy.mjs, which is the only ordering that makes an at-least-once client safe. Guards the whole contract: the store's claim/replay/bind/bindStoredForLive/sweep/throttle semantics and a 25-way concurrent claim race (a read-then-write check would let two callers both win); and the WIRING, where the real bug class lives — claim precedes forwardToUpstream, a replay RETURNS instead of falling through, a dedupe-store crash still forwards the message (losing idempotency is recoverable, losing a send is not), and five non-prompt frame types plus a decoy method, an oversized frame, malformed JSON and a keyless legacy client are all left untouched. Proven end-to-end against the live server over a real authenticated WebSocket (11/11).",
    guard: "server/message-dedupe.check.mjs",
  },
  {
    id: "RG-087",
    found: "2026-10-05",
    symptom:
      "The prompt.submit idempotency interception regressed at the wiring level while the store kept passing: claim moved after the forward (a crash between them leaves the key unclaimed and the replay double-applies), the replay branch fell through to the gateway instead of returning, a dedupe-store error swallowed the user's message instead of forwarding it, or the prefilter grew so broad that non-prompt frames (session.create, client.info, approval.respond, tool.result, session.resume) or a message whose TEXT merely contains 'prompt.submit' got intercepted. Covers hermes-proxy.mjs's decision path as a pure function over real frame shapes, plus the source-level ordering guarantee.",
    guard: "server/message-dedupe-wiring.check.mjs",
  },
  {
    id: "RG-088",
    found: "2026-10-05",
    symptom:
      "An interrupted answer was lost. The gateway coalesces token deltas at ~30fps and then discards them — only the final message row survives — its replay ring is in-process memory (512 events / 4 MiB per session) that dies with the process, replay_epoch exists precisely because a restart resets the counters, and the HTTP stream route writes no `id:` line so Last-Event-ID resume is impossible there too. So before stream-log.mjs there was NO durable copy of a partially streamed answer: a crash mid-answer destroyed it. Guards the log's whole contract — the body-vs-reference split (prose stored, tool output referenced, since tool rows are 74,138 of 149,060 and average 2,902 B and are ALREADY durable in state.db); byte-identical reassembly of replayed deltas, which is the property that makes the feature worth anything; seq ordering, the resume cursor, replay idempotency and per-session isolation; retention purge plus the purge watermark that distinguishes 'never streamed' from 'everything I needed was deleted'; and four ways a stored payload could be unusable — oversized, many-keyed, cyclic, or a pre-existing corrupt row — each of which must degrade to a parseable marker instead of throwing in eventsSince. The WITHOUT ROWID + rowid-subquery purge no-op and the mid-JSON byte-slice corruption were both real bugs found by these checks.",
    guard: "server/stream-log.check.mjs",
  },
  {
    id: "RG-089",
    found: "2026-10-05",
    symptom:
      "While a reply streamed, every word after a canvas card VANISHED. planTurnCanvases withheld the tail fence with OPEN_FENCE_RE, which matches the first opener and captures to end of string regardless of a closer, and cut it unconditionally — so a CLOSED fence was deleted too. Measured: 'intro\\n```astra-canvas\\n{...}\\n```\\nAFTER' -> mdPerSeg ['intro\\n'], canvases [] — the card AND all following prose gone until the turn finalized. Same truncation hit an INVALID fence, whose prose was the fail-soft fallback. Guards that withholding happens only for a genuinely unterminated tail fence, that two closed fences keep their tail, that a real unterminated fence is still withheld, and that finalized output is byte-identical.",
    guard: "src/lib/canvas-streaming-loss.check.ts",
  },
  {
    id: "RG-090",
    found: "2026-10-05",
    symptom:
      "The sanitizer deleted the entire reactive layer before anything rendered, so every interactive card was inert while the whole suite stayed green (the gates test the PARSER and the bind layer, never the sanitizer). Measured: kpi value {$expr:'seats*price'} -> {'type':'kpi','label':'MRR'} with no value; progress value {$expr:'pct'} -> literal 0; a table carrying bind.$from dropped WHOLE; data.name dropped, so $from could never resolve. sanitizeCanvasSpec rebuilt each block from a literal per-type field list and copied none of the reactive keys. Guards that $expr/$from/visible/bind survive, that a bound table is never dropped, that data.name survives, and that the existing caps (10000-char strings, array and key limits) still apply INSIDE a binding.",
    guard: "src/lib/canvas-sanitize.reactive.check.ts",
  },
  {
    id: "RG-091",
    found: "2026-10-05",
    symptom:
      "Per-canvas reactive state lost the user's edits three ways. (1) canvasStore compared JSON.stringify(initial), so key order was part of the identity: a re-parse emitting the same values in a different order — which models do constantly, and the sanitizer copies state through untouched — silently reset every slider, proven by the behaviour probe (seats 30 -> 10 with nothing about the spec changed). (2) The store LRU evicted by INSERTION ORDER with no liveness check, so with >24 canvases it could evict the store of a card STILL ON SCREEN: that card's control snapped back and later writes went to an orphan store nothing was subscribed to, freezing it permanently. (3) useCanvasReset read (store as {__id?:string}).__id and __id was never assigned anywhere in the repo, so reset was a silent no-op. Also guards that sAuthored is pruned with storeMap (it leaked one entry per canvas id forever). Asserted by source shape because Node cannot load a .tsx; the behaviour itself is proven by src/lib/canvas-state.behaviour.mts.",
    guard: "src/lib/canvas-state-keepalive.check.ts",
  },
  {
    id: "RG-092",
    found: "2026-10-05",
    symptom:
      "A fresh clone of this repo could not build, twice, and nothing caught it: commit bd04fe6 (2026-10-03) wired App.tsx to four never-staged modules, and commit 2f60290 (2026-10-05) wired chat-timeline.tsx to ../lib/canvas-sanitize and canvas-view.tsx to ./canvas-export while both stayed untracked. A clean clone failed tsc with TS2307. The build never caught it because it runs in the primary checkout where the untracked file is present — only a clone is honest. This guard resolves every relative import made by a TRACKED src file and fails if the target is neither tracked nor a tracked extension of one, distinguishing 'exists but untracked' (the exact shape that breaks a clone) from 'missing entirely'.",
    guard: "scripts/untracked-imports.check.mjs",
  },
  {
    id: "RG-093",
    found: "2026-10-05",
    symptom:
      "quoteBareKeys was O(n^2): it re-scanned the whole accumulator for the previous non-whitespace character once per input character. Measured 82 KB = 1.1 s, 166 KB = 5.4 s, 334 KB = 17.3 s, and a realistic 342 KB bare-key payload = 21 s — on the SYNCHRONOUS path, i.e. once per streaming delta, freezing the tab ~20 s per frame on a common emission shape. Now tracked in a variable: the same 4000-block payload parses in 10 ms. Also guarded that bare keys still parse at every nesting depth and with whitespace around every structural character.",
    guard: "src/lib/canvas-streaming-loss.check.ts",
  },
  {
    id: "RG-094",
    found: "2026-10-05",
    symptom:
      "sanitizeCanvasSpec had exactly ONE call site in the whole codebase (chat-timeline.tsx:70), so the gate path rendered canvas blocks with no sanitiser and no length caps at all, and the streaming 'partial' card bypassed it entirely by construction. Every gate body is agent-authored, so it needs the same second line of defence. Also: every gate rendered with the DEFAULT canvasId '0', and canvasId namespaces the page-wide singleton fullscreen slot key — two gate bodies on one page resolved to the SAME slot, so expanding one could display the other.",
    guard: "src/lib/canvas-sanitize.reactive.check.ts",
  },
  {
    id: "RG-095",
    found: "2026-10-05",
    symptom:
      "The paginated export emitted a BLANK FIRST PAGE: section-aware packing pushed [start, u-1] without checking the width, and when a page held exactly a section heading whose body did not fit, that range collapsed to [0, 0] — an empty block range. A 360-configuration sweep produced 162 (45%) empty page ranges. The blank page rendered AND shipped in the downloaded PDF/PPTX, with the folio reading '1 / 2' over nothing. The existing assertPartition could not catch it (abuts 0===0 and covered 0+2===2 both hold on the buggy output) — the 'green geometry audit hid a real defect' class recorded in AGENTS.md.",
    guard: "src/lib/canvas-pagination.check.ts",
  },
  {
    id: "RG-096",
    found: "2026-10-05",
    symptom:
      "Charts silently dropped data the parser had already accepted: a scatter whose natural data is [[x,y]] pairs or [{x,y}] objects failed the numeric-array test and the WHOLE card was discarded rather than degraded. The sankey/treemap/funnel/radar/scatter kinds also accept a natural vocabulary (nodes+links, items, stages, labels+series) instead of `series`, so those shapes parsed to nothing.",
    guard: "src/lib/canvas-pagination.check.ts",
  },
  {
    id: "RG-097",
    found: "2026-10-05",
    symptom:
      "A reconnecting client could not learn what it missed, so an interrupted answer stayed unreachable even once it was durably logged. The gateway cannot serve this: its replay ring is in-process memory that dies with a restart, and the HTTP stream route emits no `id:` line, so Last-Event-ID resume is structurally impossible. stream-routes.mjs adds the durable read side. Guards the HTTP contract, where the dangerous failure is a read that LOOKS complete while having a hole in it — worse than an error, because the transcript then renders as whole while missing text: `truncated` must be TRUE after a retention purge, and FALSE for a live session, an unknown session and a caught-up cursor (otherwise the client refetches forever). Also guards cursor resume returning only seq>since, byte-identical reassembly across the HTTP boundary, the body-vs-reference split holding over the wire, pagination via limit+more+next_cursor, bad cursors returning a clean 400 rather than a silent empty answer, unrelated /api/hx paths passing through to the gateway, and bounded session keys. Two real defects were caught while writing it: /api/hx/stream/stats was swallowed by the /stream/<sid> pattern and answered session_id:'stats'; and isTruncated compared the cursor against min(seq), which reports EVERY session as truncated because the gateway's seq is sparse (measured: 966 stored rows spanning seq 8289..9553), forcing a full history refetch on every fresh load.",
    guard: "server/stream-routes.check.mjs",
  },
  {
    id: "RG-098",
    found: "2026-10-05",
    symptom:
      "Chart point data silently emptied. sanitizeCanvasSpec's chart branch rebuilt each series' points and any non-numeric or pair-shaped array ([[x,y]] or [{x,y}]) failed the numeric test, so the series rendered with NO points instead of degrading visibly — a plot frame with an empty interior and no error anywhere. Guards that numeric points survive sanitisation, that pair-shaped data is normalised rather than dropped, and that a series with unusable data degrades that SERIES rather than silently painting nothing.",
    guard: "src/lib/canvas-sanitize.points.check.ts",
  },
  {
    id: "RG-099",
    found: "2026-10-05",
    symptom:
      "A KPI whose value is computed by an expression stopped updating: the fan-out that recomputes a bound kpi.value from the reactive scope lost its dependency on the scope version, so the tile kept painting the value captured at first render even after the controlling slider moved. Guards that a bound KPI re-evaluates when its controlling state key changes.",
    guard: "src/lib/canvas-kpi-fanout.check.ts",
  },
  {
    id: "RG-100",
    found: "2026-10-05",
    symptom:
      "A message the user watched 'send' was eaten by an Android app kill (swipe away, memory pressure). src/lib/ws-store.ts persisted queued prompts to sessionStorage while its own header comment claimed they 'persist to localStorage so an Android app kill no longer eats a message the user watched send' — two fixes collided, a per-tab change (so tab A's prompt stopped leaking into tab B's chat) and a durability change, and the durability claim was silently lost. durable-outbox.ts restores it on IndexedDB (async, unbounded, worker-reachable; localStorage fails on all three and has a ~5 MiB ceiling that means QuotaExceededError — total transcript loss, not degradation). Guards the whole at-least-once contract: a failed attempt RETAINS the row with monotonic capped backoff (1s..30s) rather than dropping it, and the row is removed only when the server accepted it; the resume cursor NEVER rewinds, so a stale tab cannot replay chunks forever; uuidv7 is time-ordered and unique even within one millisecond, with its 48-bit timestamp asserted to round-trip exactly; the row cap evicts the OLDEST so what was just typed survives; oversized text truncates rather than rejecting; an expired row is never offered for sending; and a throwing subscriber cannot break a write.",
    guard: "src/lib/durable-outbox.check.ts",
  },
  {
    id: "RG-101",
    found: "2026-10-05",
    symptom:
      "Making the prompt queue durable silently BROKE per-tab isolation. IndexedDB is shared by every tab on the origin, so moving ws-store.ts's queue off sessionStorage reintroduced exactly the bug src/lib/concurrent-queue.check.ts exists to prevent — tab A's pending prompt flushing into tab B's chat — while looking like a pure improvement. ws-store.ts therefore stamps a per-tab owner id (held in sessionStorage, deliberately, so a fresh tab never inherits an old tab's pending messages) and filters the shared store on it. Guards the WIRING, which is the only layer where either property exists: durability through the unchanged public API (wsQueuePush/Remove/All/Set still take and return QueuedPrompt[], so ws-engine.ts needs no edits), insertion order preserved, remove/replace reaching disk, two simulated tabs over one shared IndexedDB never seeing each other's rows, an UNOWNED row staying adoptable so a crash between write and ownership-stamp can never orphan a pending message, and ownership being write-once so a second tab cannot steal a claimed row.",
    guard: "src/lib/ws-durable-queue.check.ts",
  },
  {
    id: "RG-102",
    found: "2026-10-05",
    symptom:
      "The transcript reordered itself. Ordering by anything a CLIENT controls is unsafe: a phone whose clock is four seconds slow emits a user message that sorts before one actually sent later. Every major platform assigns order server-side for this reason — Slack's `ts` IS the id, Discord uses a snowflake, Telegram's per-chat `message_id` keeps `date` display-only, Google Chat's `createTime` is output-only — and upstream Hermes already decided it ('Load messages in insertion order, id, never timestamp: clocks regress', hermes_state_messages.py:1061). Guards the two properties that make 'compile the chronology' true: ORDER-INDEPENDENCE (all 720 permutations of six rows produce an identical transcript, so reload / new window / new device agree regardless of arrival order) and CLOCK-INDIFFERENCE (a row carrying a deliberately hour-skewed timestamp still lands in its true position). Also: committed rows always sort before optimistic ones, so a pending send can never jump ahead of the reply it triggered; dedupe runs BEFORE sort, so a reconnect double-delivery renders once; same-millisecond optimistic ids tie-break stably; the turn fold yields ONE assistant bubble broken only by user messages (tool and assistant rows sharing a span merge, assistant-only output is a single bubble); and a late-arriving row reports which turn it SPLITS, so only two DOM nodes change instead of re-flowing the transcript.",
    guard: "src/lib/message-order.check.ts",
  },
  {
    id: "RG-103",
    found: "2026-10-05",
    symptom:
      "A gateway restart silently DESTROYED logged stream chunks. event_replay.py states it outright: 'Seq counters live in-process, so a restart resets them to 1 while clients hold high watermarks' — which is why the gateway hands out replay_epoch. So (sid, seq) is NOT unique across a restart, and the INSERT OR IGNORE on that primary key dropped every post-restart chunk: measured 2 of 2 lost, a permanent hole in the one log that exists to prevent exactly that. Fixed by adding `epoch` (a per-gateway-process discriminator) to the primary key and `mono` (Astra's own per-session monotonic counter) as the replay cursor, since a cursor on the gateway's seq would skip a whole post-restart turn. Also fixes two locateInsertion bugs found alongside it: a late user message landing INSIDE an assistant turn returned splitsTurnAt=null (it only scanned same-kind turns, so it missed the turn it actually breaks), and a trailing message returned the FIRST same-kind turn it sorted after instead of the last, placing it mid-transcript.",
    guard: "server/stream-log.check.mjs",
  },
  {
    id: "RG-104",
    found: "2026-10-05",
    symptom:
      "A transcript the training pipeline had never read was deleted by retention. The gate is the whole point: a session is deletable only when ingested_at IS NOT NULL AND it is older than 14 days (matching the gateway's own auto_archive_days) AND it is not pinned. Guards that a 20-day-old UN-INGESTED session appears in no plan and survives a real delete — the property that matters most — alongside: the plan is a receipt that deletes nothing, sessions still inside the window are kept, a session with a NULL ended_at never ages out, one ending in the future is never deletable, the boundary is inclusive of the last safe day, the plan is ordered oldest-first so a batch trims from the far end, a disabled sweeper REFUSES an explicit delete, force+dryRun still deletes nothing, a real delete removes sessions AND their messages with no orphans and is idempotent, work is batch-bounded, and the scheduled sweeper is dry-run so an unattended timer can never surprise anyone. secure_delete is enabled so freed pages are overwritten rather than left readable.",
    guard: "server/retention.check.mjs",
  },
  {
    id: "RG-105",
    found: "2026-10-05",
    symptom:
      "A canvas card was displayed as a raw JSON code block, and only reloading the page fixed it. Mechanism, measured: a slightly-malformed astra-canvas fence fails the sync parser, the fail-soft rule leaves it in the markdown, and marked faithfully paints it as a language-astra-canvas code block. The rescue tier (splitCanvasBlocksAsync) is deliberately gated off while a turn streams, and a turn whose text-final never arrived stayed status 'run' forever, so the rescue never ran. Shapes that hit it: unquoted keys wrapped in prose, single quotes, and a truncated body (repaired by NEITHER tier). Four layers now prevent it: the markdown renderer claims the fence type so the code renderer never sees it (rich-html.ts), the reveal withholds a half-arrived fence (canvas-reveal.ts), every streaming turn is closed at turn end (finalizeAnyStreaming), and a stream that stops moving gets one debounced rescue. Verified in a real browser: 23 assertions over a 299-frame streaming sweep, zero leaking frames.",
    guard: "src/lib/canvas-reveal.check.ts",
  },
  {
    id: "RG-106",
    found: "2026-10-05",
    symptom:
      "A half-revealed canvas fence reached the markdown renderer. TextRow passes the revealed PREFIX of a message, so a cut landing inside a fence produced a fence with no closer, which the parser rejects and marked then paints as code. Guards two invariants swept over EVERY reveal position across five fence shapes (3-tick, 4-tick, an ordinary code fence, two cards in one message, and a card containing backticks in its body): no frame may leak a partial fence, and prose before the first fence must never be lost. Also guards that a ``` inside the JSON body is not mistaken for the closer. Proven by reversal — disabling the guard fails 5 of 9 subtests with '1/91 frames leaked a partial fence'.",
    guard: "src/lib/canvas-reveal.check.ts",
  },
  {
    id: "RG-107",
    found: "2026-10-05",
    symptom:
      "The same chat list was downloaded THREE times per open (~900 ms of pure waiting through the Cloudflare tunnel, measured: 3 x 307 ms, the list request firing 4x in one open) — chats-panel, App.tsx's unread seed, and prune.ts each fetched it independently with nothing shared. Fixed with src/lib/sessions-cache.ts, which coalesces concurrent identical requests and briefly caches them. Guards BOTH halves, because a cache that shares too much is a worse bug than no cache: four concurrent identical callers must cost exactly ONE fetch (the coalescing property), sequential callers must collapse via the TTL, the TTL must expire and refetch, errors must not be cached and must keep their .status for the caller's 401/503 messaging, and invalidateSessions() must force a real refetch. Equally load-bearing: a DIFFERENT limit, a source-FILTERED list, a search query, and an offset page must NEVER be shared — showing the wrong chat list, or pinning page two forever, would be worse than the duplicate fetch. Also guards that parameter order and cache-busters do not split the key, since either would silently defeat coalescing.",
    guard: "src/lib/sessions-cache.check.ts",
  },
  {
    id: "RG-108",
    found: "2026-10-05",
    symptom:
      "A field was dropped from a history row that the client actually reads. server/history-trim.mjs removes fields from every message to save bandwidth, and the candidate list looked obviously safe: `api_content` (the raw provider payload, superseded by `content`) and `reasoning_content` (a byte-for-byte duplicate of `reasoning`). The dangerous part is what it ALSO looked safe to remove: `session_id` — the same chat id on all 100 rows, ~2.3 KiB per open. history-trim.check.mjs REJECTED that removal by grepping the live client tree and found NINE readers (chat-landing, subagent-panel, chat-segments, command-exec, prune, session-row, tool-io, ws-engine, ws-helpers); it looks redundant within one page but is load-bearing across routes, and dropping it would have broken deep-links, subagent frames and tool results for a different session. So the guard re-derives 'is this field read?' from src/ on EVERY run — a field a later session starts reading fails here immediately instead of silently blanking the UI. Also asserts the KEEPS: content, reasoning (drives 'Thought for Nm'), timestamp, tool_call_id, display_kind (hidden rows and failed_turn), finish_reason; that the input is not mutated; and that unknown fields pass through, because this is a drop-list and not an allow-list — a new upstream field must be safe by default.",
    guard: "server/history-trim.check.mjs",
  },
  {
    id: "RG-111",
    found: "2026-10-05",
    symptom:
      "The history field trim was installed, unit-tested green, and DID NOTHING. server/history-trim.mjs removes api_content and reasoning_content from every message row, but the router condition that invokes it in hermes-proxy.mjs was `^/api/hx/sessions/[^/]+/messages/?$` — `$`-anchored, while EVERY real history request carries a query string (`?order=latest&limit=100&offset=0`). The pattern never matched, the trim never ran, and the full payload crossed the tunnel unchanged. No test caught it: history-trim.check.mjs proves the TRIMMER is correct, which is not evidence the trimmer is CALLED. It was found only by re-measuring the live endpoint after a stash round-trip restored an older proxy — 224 KiB instead of 184 KiB, with api_content back in the payload. This check pins the ROUTER instead: extracts the shipped literal from the source, asserts it is not end-anchored and explicitly accepts a query string, then runs that exact pattern against all five real history URL shapes (including every query-string form the client sends) and against the paths it must NOT engage — the list, search, single-session, stream-log and title routes — plus the GET gate and the pass-through-on-serialize-failure fallback.",
    guard: "server/history-trim-routing.check.mjs",
  },
  {
    id: "RG-109",
    found: "2026-10-05",
    symptom:
      "The live streaming turn was being skipped by the off-screen paint optimisation, or the exemption regressed silently. src/index.css:4000 already sets `content-visibility: auto` on .chat-turn and un-skips `:first-child` — but the turn that must never be skipped is the one being STREAMED, which is almost always the LAST turn. The live turn mutates ~60x/second (the reveal animation), so while skipped the browser does layout and paint for text nobody can see, and can substitute a placeholder mid-update — which reads as a flicker of the very bubble being watched. chat-timeline.tsx stamps data-streaming on exactly that element and perf-chat.css exempts it BY ATTRIBUTE, so the exemption follows the live turn wherever it sits in the feed. This check compiles the REAL stylesheet through the project's own Vite pipeline (throwing into a temp outDir, never dist/) and asserts on declaration SETS, because lightningcss reorders declarations and substring matching would pass against a rule the build dropped. Guards that the EXISTING off-screen skip is still present (this file must not have replaced it), that the live turn is forced visible with its placeholder size dropped, that the streaming placeholder bubble is too, that the live selector is MORE SPECIFIC than .chat-turn so it cannot depend on stylesheet load order, and that the scroll container — which owns scrollTop — is never itself skipped.",
    guard: "scripts/perf-chat.check.mjs",
  },
  {
    id: "RG-112",
    found: "2026-10-05",
    symptom:
      "Opening an .xlsx/.docx/.pptx attachment from chat left the preview floating in a narrow column instead of filling the viewer. Two stacked width constraints: .mv-doc carried `max-width:960px`, and the doc slide inherited .mv-slide's 12px side padding — so a wide spreadsheet never used the available width and the gap read as a layout bug rather than a style choice. Fixed by dropping the cap to max-width:none and adding a `.mv-slide-doc` MODIFIER (not an edit to the shared .mv-slide) that stretches the preview and zeroes horizontal padding; the xlsx table also lost its per-cell max-w-[220px], so columns size to the container. The load-bearing assertion is the third one: base .mv-slide must KEEP its 12px padding, because audio and video slides share that rule and editing it instead of the modifier silently re-laid-out every player. Also asserts against the COMPILED css in dist/, parsing declarations as sets, since lightningcss reorders them and expands color-mix() into an @supports var() form that substring matching would miss. Proven by reversal — restoring max-width:960px fails exactly the cap assertion and nothing else.",
    guard: "scripts/doc-preview-fill.check.mjs",
  },
  {
    id: "RG-110",
    found: "2026-10-05",
    symptom:
      "The assistant bubble split when it must not, or the rule that keeps it whole drifted out from under the live view. The owner's requirement: ONE assistant bubble containing responses, tool calls, thinking and canvas cards, broken ONLY by a user message — and a single bubble when no user message was sent. Verified against the REAL renderer source rather than a reimplementation, because the only authority on how the live view sequences messages is chat-landing.tsx itself; a test that re-derived the rule would prove only the test. Guards the fold behaviourally (no user message -> one bubble; 50 consecutive assistant rows -> one bubble; two users each with a reply -> four bubbles, first reply kept whole; consecutive user rows produce NO empty assistant bubble between them) and the WIRING structurally: the running bubble is closed only inside the path that APPENDS A USER MESSAGE, the 'reply painted above the user's message' regression note stays recorded, and the live view still documents that it matches the history-restore rule — otherwise a reload would render a different bubble shape than the live view did.",
    guard: "src/lib/bubble-invariant.check.ts",
  },
  {
    id: "RG-113",
    found: "2026-10-05",
    symptom:
      "An accordion item's NESTED blocks vanished and the dropdown rendered with NO content on the live site — reported as 'the accordion dropdown renders with no content'. The parser was innocent and so was the renderer: validateBlock already parsed and preserved item.blocks, and AccordionView already rendered it through the same `Blocks` dispatcher. The single point of loss was sanitizeCanvasSpec, which is the ONE call on the render path (chat-timeline.tsx:70) and rebuilt every accordion item as `{title, body}`, dropping `blocks` and `open`. An item whose only content was nested blocks therefore reached the renderer as a title with body:undefined — an empty disclosure, and no error anywhere, because a dropped field is not a thrown one. The whole suite stayed green because every existing gate tested the PARSER, which had been right all along: this is the same class as RG-090 (reactive layer inert while the parser-only gates passed), and the same fix — a container that nests blocks must be sanitized by the same per-block validator as the card around it. `tabs` had the same defect in a worse form: it had NO case at all, so every tabs card fell through to `default: return null` and disappeared from the card entirely. Both now recurse through a shared sanitizeBlockList with a depth cap (the parser does not bound depth, so unbounded nesting was a stack-overflow waiting on a card that parsed fine). Guards: the exact reported card shape keeps its nested blocks through BOTH the parser and the sanitizer; an authored open:true survives; a body-only accordion is unchanged; an invalid nested block degrades fail-soft (bad block dropped, siblings and the card intact, no throw); an all-invalid item is dropped rather than left as a dead header; the fence round-trip and the markdown projection keep the nesting; deep nesting is capped; a tabs card survives; and a chart nested in an item keeps the series.points/series.data the lazy chart renderer reads. Proven by reversal — restoring the old accordion branch fails 7 of the new cases.",
    guard: "src/lib/canvas-schema.check.ts",
  },
  {
id: "RG-114",
    found: "2026-10-05",
    symptom:
      "The live 'card builds as it streams' mode could never fire. chat-timeline.tsx parsed mdFor.get(tailIdx) — the turn planner's OUTPUT — and the planner already cuts an open tail fence away, so the search always found nothing. Measured: parse(mdFor) -> null while parse(raw segment) -> 3 blocks. Fix parses the RAW segment text and strips the fence from the markdown copy. Second defect, caught by the new gate in my own first attempt: a CLOSED contained fence double-rendered, because the planner deliberately leaves those inline (canvas-schema.ts:2141, so following prose stays below the card) and RichText splits them. Guards the provisional card appearing, growing 1->2->3 blocks as they land, the payload being stripped from the markdown, prose before the fence surviving, closed fences NOT painting a provisional card while staying in the markdown, 4-tick fences both ways, and a ``` inside the card's own body not reading as the closer.",
    guard: "src/lib/canvas-live.check.ts",
  },
      {
    id: "RG-115",
    found: "2026-10-05",
    symptom:
      "A card lost the user's interaction when a reply completed. Canvas state is keyed by canvasId, and ids were derived from a per-ROW useId; `text-final` collapses a multi-segment turn into one, so the card moved to a different row, got a different id, and React mounted a fresh card — slider, zoom and scroll all reset. Measured: text segments 2 -> 1 on a prose/tool/prose+card turn, the most common multi-tool shape. Ids are now derived from the card's CONTENT (FNV hash of type:label per block) plus an occurrence index, scoped by the component uid. Guards that the same card re-parsed keeps its id, different cards get different ids, two IDENTICAL cards are separated by the occurrence index (they would otherwise collide on the page-wide singleton fullscreen slot), the id still differs per scope, and the anchor really does move at text-final so the bug cannot silently return.",
    guard: "src/lib/canvas-identity.check.ts",
  },
      {
    id: "RG-116",
    found: "2026-10-05",
    symptom:
      "A message containing a canvas card re-parsed and re-sanitised ALL of its prose on EVERY streaming delta, so the stream visibly lagged after a card appeared and worsened with answer length. The canvas render path called renderRichHtml inline in the render body; the memo the file documents (splitRichBlocks + memo'd RichBlockView) only serves the no-canvas fast path, so any card threw the optimisation away. Measured then: 4.62 ms/render vs 2.37 ms on the fast path — `marked` alone, before DOMPurify over the same HTML — i.e. 116% of one core at 25 deltas/s versus 59%. Fixed with MdPart, memo'd on its own source, and blockSig gated on hasCanvas (on the canvas path `blocks` is computed but never rendered: ~1.85 ms/render of pure waste). Verified in Chromium by COUNTING parser invocations: 50 -> 26 over 25 deltas (1.9x), plus that a changed part still re-parses so the memo cannot serve stale HTML, and that no part is blanked.",
    guard: "scripts/canvas-render-perf.browser.mts",
      },
      {
    id: "RG-117",
    found: "2026-10-05",
    symptom:
      "The paginated A4/slide export emitted a BLANK FIRST PAGE. Page ranges are half-open [start, end) — packSections pushes [start, u] where u is the first unit that did not fit — so when a page held exactly a section heading, u - start === 1 and the push [start, u - 1] collapsed to [start, start], a ZERO-WIDTH range. Measured 396 of 840 realistic 3-block configurations across both page modes (47%): page one rendered nothing and the folio printed '1 / 2' over a blank sheet. The shipped assertPartition could NOT see it — first starts 0, last ends n, ranges abut (0 === 0) and covered === n all hold on the broken output, which is the 'green geometry audit hid a real defect' class recorded in AGENTS.md. Fix: never emit a zero-width range; the heading simply travels down to join its body, which is what Rule 3 already required. Guards a full 3-block sweep per page mode for empty ranges, the headline divider+oversized-table shape, that a heading and its body never split across pages, complete non-duplicated unit coverage, that a lone heading still paginates, and that an empty document still yields exactly one page. Proven by reversal — restoring the push fails 161 of 420 configs in the a4 sweep alone.",
    guard: "src/lib/canvas-pagination.blankpage.check.ts",
  },
    ];

// ---- gate -----------------------------------------------------------------

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error("FAIL:", msg);
};

// 1. manifest integrity: unique ids, guarded files exist.
const seen = new Set();
const liveChecks = new Set();

for (const r of REGRESSIONS) {
  if (seen.has(r.id)) fail(`duplicate regression id ${r.id}`);
  seen.add(r.id);
  if (!existsSync(join(ROOT, r.guard))) {
    fail(`${r.id}: guarding check is missing — ${r.guard}. A pinned bug lost its pin.`);
    continue;
  }
  if (r.live !== false) liveChecks.add(r.guard);
}

// 2. every *.check.* file in the repo must be reachable from the manifest,
//    otherwise a new check silently escapes the gate.
const { execSync } = await import("node:child_process");
let discovered = [];
try {
  discovered = execSync(
    "find src server scripts -name '*.check.*' -not -path '*/node_modules/*'",
    { cwd: ROOT, encoding: "utf8" }
  ).split("\n").map((s) => s.trim()).filter(Boolean);
} catch { /* find unavailable: manifest integrity still checked above */ }

for (const file of discovered) {
  if (file === "scripts/regression-gate.check.mjs") continue;
  if (!REGRESSIONS.some((r) => r.guard === file)) {
    fail(`${file} is not in the regression manifest — add a row or it is unpinned.`);
  }
}

// 3. live re-run of every guarded check that can run here.
for (const file of [...liveChecks].sort()) {
  // A `.mjs` check can import a `.ts` module (the ported comindash self-checks
  // do), so the resolver is applied on the SOURCE, not just the extension.
  const isTs = /\.check\.(ts|tsx)$/.test(file) || /from ['"][^'"]+\.ts['"]/.test(readFileSync(join(ROOT, file), "utf8"));
  const args = isTs
    ? ["--import", "./scripts/ts-resolve.mjs", file]
    : [file];
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", timeout: 120_000 });
  if (r.status !== 0) {
    const last = (r.stderr || r.stdout || "").trim().split("\n").filter(Boolean).pop() || "";
    fail(`REGRESSED: ${file} — ${last.slice(0, 140)}`);
  }
}

console.log(
  `regression-gate: ${REGRESSIONS.length} pinned bugs, ${liveChecks.size} re-run live, ${discovered.length} checks discovered`
);
if (failures) {
  console.error(`${failures} regression-gate failure(s)`);
  process.exit(1);
}
