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
