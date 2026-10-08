# Astra WebUI — Agent Procedures & Lessons

## Astra canvas — engineered build prompt & planning (session 20261002_235609_0b7ceb)

**Planning-phase methodology:** Canvas system was engineered via detailed build prompt (Role/Context/Requirements R1-R8/Non-goals/Output format) before implementation. Prompt established frozen facts about product architecture (chat-timeline → RichText, gate bodies, Android GateActivity structure) and defined clear contracts:
- R1: Canvas schema (closed set of 13 block types), splitCanvasBlocks parser with fail-soft degradation, streaming support.
- R2: Renderer components (7 block types + lazy-loaded chart via recharts), brand tokens from @theme CSS vars, 120–220ms entrance stagger.
- R3: Timeline integration via RichText split + mount, no segment engine contract changes.
- R4: Gate body mappers (PlanBody/ReviewBody/FixBody/ReportBody → CanvasBlock[]), per-finding callouts + findings table, phase steps + radial gauges.
- R5: Android GateActivity visual refresh (teal accent, stat cards, severity chips, receipt morph + spring animation).
- R6: docs/canvas-directive.md with SOUL.md section + 3 examples.
- R7–R8: Test coverage (schema + gates fixtures), recharts in lazy chunk only, 883 kB main bundle.

**Deliverables from earlier implementation sessions (20261003 onward):** Commit `73aa53e` and later sessions realized the plan with proven constraints documented below.

**Learning:** Engineered prompts with explicit frozen facts, requirements mapping, and non-goals prevent scope creep during build and allow clean hand-offs to operators/reviewers.

## Open-source readiness audit & test revival (session 20261003_080319_32bb03)

**Critical finding:** Fresh clone build fails. Commit `bd04fe6` (07:01 on 2026-10-03) added imports for `context-page`, `memory-page`, `harness-page`, and `ui/chart.tsx` to `src/App.tsx`, but those files were created 6+ hours earlier (00:21–00:50) and never staged. The commit shipped the wiring without the parts. **Fix:** `git add` the 4 untracked component files + ops/. Working tree builds clean in 628ms.

**Runtime ledgers tracked in git.** `data/gate-ledger.jsonl` (216 KB) holds real approval-gate transcripts from actual sessions — shell commands and their descriptions. Not a credential, but machine activity history. `read-state.json` and `theme-state.json` contain session IDs. **Fix:** `git rm --cached data/*.jsonl` + gitignore; keep local copies. `read-state.json` and `theme-state.json` may be committed defaults depending on your intent.

**Hardcoded host paths break clones.** 6 sites: `server/command-registry.mjs:21 HERMES_REPO`, `server/training.mjs` ×4 (e.g., `/home/notjitin/Work`). Personal endpoints: `server/ntfy-notify.mjs:200-201 astra.jitinnair.com`, `vault-seed.mjs:130,142`. **Fix:** Env vars with sane fallbacks (e.g., `ASTRA_PUBLIC_URL=${ASTRA_PUBLIC_URL:-https://astra.example.com}`).

**22 of 50 test checks were dead.** `node` type-strips `.ts` but won't resolve extensionless imports under NodeNext rules. Correlation perfect: 7/7 checks with explicit `.ts` extensions passed; every extensionless one died. **Fix without source changes:** `scripts/ts-resolve-hooks.mjs` — a dev-only resolve hook inserted at npm script entry point (`npm run check`). Two subtleties:
- Extension must insert **before** any `?query`, or `./notify?legacy-shape` becomes `./notify?legacy-shape.ts` and the cache-busting import silently collapses.
- Candidates must build off `ctx.parentURL` — round-tripping through `url.origin` throws `ERR_INVALID_URL` once parent is itself a `.ts` URL.

**Flaky test `training-pipeline` (5/6 failure rate).** Two races, both harness-side: (1) parent flipped DELETE 500→200 after fixed 500ms settle, sweeper retried every 200ms → three races. (2) Child poll sampled transient `awaiting_retry` state with same 200ms period, could miss entirely. **Fix:** Fail exactly the first delete (no timer), prove retry from parent's attempt counter not transient state. **12/12 consecutive passes after fix.**

**Regression gate with 53 pinned bugs.** `scripts/regression-gate.check.mjs` — fails if a guard is deleted, if a check is unpinned, or if a pinned bug regresses. Gate caught 13 unpinned checks on first run. Lint error count unchanged (1 pre-existing in `chat-timeline.tsx:642`). Files: `scripts/run-checks.mjs` (parallel runner, 180s timeout per check), `.github/workflows/web.yml` (lint, build, check, guard for ≥40 discovered checks), `ARCHITECTURE.md` (backend/streaming/frontend map, 4 ADRs, Known Bugs), `docs/known-bugs/training-pipeline-r5-flake.md` (full post-mortem).

**Deliberately not done:** Message pagination blocked on gateway (`session.resume` has no `limit`/`offset` parameter); `scratch/` tracked in git (101 files including bundled output, belongs in untrack work).

**What landed:** `scripts/ts-resolve{,-hooks}.mjs`, `scripts/run-checks.mjs`, `scripts/regression-gate.check.mjs`, `.github/workflows/web.yml`, `ARCHITECTURE.md`, `docs/known-bugs/training-pipeline-r5-flake.md`, `package.json` (added `check`, `check:serial`, `verify` scripts), `.oxlintrc.json` (ignore patterns).

## Generative UI canvas system — 13-block directive (commit 73aa53e, session 20261003_100711_c3fb21)

**Canvas is the DEFAULT output format on Astra surfaces (web + Android), not an embellishment for data.** Fenced ` ```astra-canvas ` JSON blocks render as interactive surfaces (KPI rows, charts, tables, diagrams, checklists, steps, callouts, progress, timelines, comparisons, trees, code, references) interleaved inline with chat prose and wired through review/report/fix gate bodies.

**Directive (owner preference, 2026-10-03):**
- Reach for canvas FIRST every time. Several distinct cards per answer is expected; 2–4 cards per reply is normal.
- Anti-slop rule: don't fragment ONE idea across blocks. Not: use fewer cards.
- All 13 block types documented with canonical shapes in `docs/canvas-directive.md` and `~/.hermes/SOUL.md`.
- **Fence rule:** A `code` block containing ``` cannot live in a 3-backtick fence — it closes inside your JSON and degrades the whole card. Use 4-backtick fence instead.

**What works (proven):**

- **Schema + parser:** `src/lib/canvas-schema.ts` — closed set of 13 block types (kpi, chart, table, diagram, checklist, steps, callout, progress, timeline, compare, tree, code, references). Parser is fail-soft: invalid or still-streaming fences degrade to markdown, never drop content. Tests: pinned at RG-070 (7 reactive cases).
- **Renderers:** `src/components/canvas/` — each block type is a dedicated renderer. `canvas-chart.tsx` is the ONLY recharts consumer and lazy-loads via dynamic import, so 430 kB chart engine stays out of main chunk (verified: 0 recharts refs in index chunk, 883 kB total main).
- **Timeline integration:** canvases render as blocks inside chat bubbles alongside prose, via `src/components/chat-timeline.tsx`.
- **Gate integration:** review → severity KPI row + findings table; report → verdict callout + stats + phase steps + gauges; fix → checklist. Gate answer contracts unchanged; only body routing changed.
- **Android:** Capacitor WebView renders identical canvas bundle (no separate Android work needed — same HTML/CSS/JS).
- **System prompt:** `~/.hermes/SOUL.md` loaded with canvas directive at session start (includes schema + worked examples in `docs/canvas-directive.md`).

**Key constraints that survived build:**

- **Main bundle**: 883 kB with zero recharts code. Recharts lives in its own lazy chunk, loaded only when a message contains a chart.
- **Test status**: canvas-schema 11/11, canvas-gates 5/5, overall repo 35/36 (one pre-existing failure in unrelated history normalization).
- **Fail-soft parsing**: Tiered repair (commits 8a9f675, 0b4b2a7) handles malformed JSON via lenient parsing, comment/comma strip, NDJSON fallback, lazy jsonrepair library. Single bad block never sinks the whole card.

**Later refinements (proven in follow-up sessions):**

- **Reactive canvases** (commit 55a239d): state, control bindings, safe expressions, media blocks added. Parser preserves bindings end-to-end.
- **Accent as ROLE not hue** (commit 22099ff): accent token is a semantic role, not a specific hue. Words never split mid-word in text (measured on dagre layout).

**Durable patterns:**

- **Lazy recharts loading:** `React.lazy(() => import("./canvas-chart"))` with Suspense fallback. Keep as-is; manually verify bundle if structure changes.
- **Fail-soft JSON repair:** No new sync-path repair tier — any new tier must throw on partial input or live async-only. Tested against 120 historical fences (106 rendered, 14 degraded).
- **Gate body routing:** Canvas blocks map 1:1 with gate types (review, report, fix). Pure mapping in `src/lib/canvas-gates.ts` (5 checks); answer contract is untouched.

**Not yet done (next session work):**

- Service restart to go live (needs explicit approval).
- Audit existing messages to confirm canvas schema is loaded in older sessions (system prompt is only assembled at session start).

## Canvas directive — default-to-canvas policy (session 20261003_100711_c3fb21)

**Wording bug in the original directive: "prefer 1–3 canvases per answer" is read as a cap by models, opposite of intent.** Rewritten to make canvas the DEFAULT output format on Astra surfaces, with explicit clarification that 2–4 cards per answer is expected and normal.

**Changes:**

- **`~/.hermes/SOUL.md`**: Updated "Generative UI — the canvas" section with 13-block vocabulary table (was 7 types), all canonical shapes, fence rule for `code` blocks, and explicit "canvas is the default" framing.
- **`docs/canvas-directive.md`**: Expanded from 7 to 13 block types with worked examples, fence discipline rule, and anti-slop clarification ("don't fragment one idea" not "use fewer cards").
- **`~/.hermes/skills/astra-canvas`**: Added default-to-canvas rule and 2 new pitfalls (fence length, lazy-loaded chart chunk, copy button state, Astra Android surface interaction).
- **`~/.tool-router/config.json`**: Removed misleading `canvas` keyword from Canva MCP's hints (`mcp_hints.canva`). The keyword hijacked every Astra-canvas request toward the Canva MCP; excalidraw's legitimate "canvas" keyword preserved.

**Verified:** Router no longer suggests Canva for canvas block requests.

**Durable facts for future sessions:**

- Canvas is the DEFAULT output format on Astra web + Android. Do not treat it as optional or data-specific.
- All 13 block types (including newly documented `progress`, `timeline`, `compare`, `tree`, `code`, `references`) are proven and wired through renderers.
- Fence rule: a 3-backtick fence cannot wrap a `code` block that contains ```. Use 4-backtick fence.
- Anti-slop means "don't fragment a single idea across five blocks", not "use at most one card per answer".

## Canvas parsing at turn-level, not segment-level (session 20261002_191050_6d668d)

**Critical fix:** Canvas fences that span text segment boundaries (tool call in the middle of a response) were silently degrading to markdown code blocks because the fence-opener and closer landed in different segments, neither parseable on its own.

**Root cause:** Timeline's segment engine opens a new text segment on tool boundaries. A response like `prose → tool_start → tool_call → tool_end → prose with ```astra-canvas ... ``` ` gets split into multiple segments. If the fence straddles the tool boundary, the opener is in one segment (no closer), the closer is in another (no opener), both degrade.

**Fix:** Parse canvases at the **turn level** (whole message), not per segment. `planTurnCanvases` stitches text segments back together, parses out canvases (keyed by turn + block sequence), then anchors each canvas back to the segment where its **closing** fence lands — preserving document order in the transcript.

**Implementation detail:** The typewriter reveals fence-stripped markdown while streaming (3 kB of canvas JSON per character is ugly + wrong). The canvas block appears all at once when the closing fence arrives.

**Coverage:** Both live streaming and history reload share the same segment-splitter logic, so one fix covers both paths. Proven: 7 regression tests covering exact failure cases (fence split across 2+ segments, multiple canvases, document order, invalid splits, empty input).

## Canvas surface sync (canvas-surface-sync.mjs / .check.mjs)

**Generator tool for maintaining synchronized content across harness files, SOUL.md, and skill blocks.** Builds in `~/.Work/scratch/astra-canvas-v6/wt-fleet/rules/` (git worktree with fake HOME for testing). Deliverables:

- `canvas-surface-sync.mjs`: Node ESM, stdlib only. Reads PM data module (`canvas-surface-data.mjs`), renders harness blocks (4 targets), soul block (1 target), and skill blocks (56 targets). Validates parser against `src/lib/canvas-schema.ts` before any write. Marker-delimited replace/append, atomic temp+rename, 20-run backup rotation, `--check` mode, `--json` output.
- `canvas-surface-sync.check.mjs`: assert-based test suite (22 assertions), no frameworks. Covers parser validation, drift detection, idempotency, backup rotation, missing parents, missing skill markers.

**All 4 gates passed**: parser validation ✓, drift detection ✓, write+recheck idempotency ✓, clean tree (only 2 new files) ✓.

**Lessons from M4:**

- **Recipe text compression needed**: Harness block spec budgets 2,400 chars; literal RECIPES text was 2,893 chars. Solution: `compressRecipe()` strips parenthetical qualifiers (preserve block names, order, arrow structure). Full text kept in SOUL.md. Rendered block: 2,358 chars.
- **File creation logic**: Targets without markers are appended; target files that don't exist are created (except `AGENTS.md` in non-existent parent, which is skipped). This matches "append only if parent exists" rule in spec.
- **Skill frontmatter matching**: Skills matched by `name:` in first 15 lines of `**/SKILL.md` under `<home>/.hermes/skills`. Two skills exist but are in no SKILL_GROUPS (`caveman`, `humanizer`) — remain byte-identical on runs.
- **Parser path is hardcoded in check**: Check reads real `src/lib/canvas-schema.ts` for validation. If parser moves, update check path.

Session: 20261004_125622_f5774c — M3 diagram sizing and zoom implementation.

## Canvas diagram layout (diagram-layout.ts)

**Ported reference implementation.** Port behaviour from `diagram-layout.ref.mjs` to TypeScript; do NOT reinvent. Six measured invariants must survive the port:

1. Back-edge rule: nodes on "back" edges use `UP`/`trail`/`lead` algorithm (dagre acyclic layout detail).
2. Bends computed inside the free gap between two ranks (not at node edges).
3. Snap at `< 0.75` makes every segment axis-aligned (no diagonals).
4. `acyclicer: "greedy"` on the dagre graph.
5. Duplicate edges and dangling edges dropped.
6. Text breaking rule: whole words never split; only code-ish tokens (`isCodeish` test) may break by character.

When porting, narrow `any` casts to dagre call sites only; do not weaken other types. Two cases proved sufficient: the graph object itself and one layout call. `(dagre.layout as ...)` works.

Tests pass: fixture audit (5 fixtures × 2 directions), seeded random graphs (200 runs, 6–24 nodes each), determinism (same input → identical JSON string), word-break assertion, self-loop and duplicate-edge dropping, empty graph.

## Canvas schema (canvas-schema.ts)

**Parser validation pattern with legacy shape.** New schema fields (`direction`, `summary`, `caption`, `note`, `kind`) are copied with the style `isStr(x) ? x : undefined`, same as existing `detail` field. This leaves keys present but holding `undefined` for missing fields — unavoidable given the style constraint.

Parser tests: new fields survive; legacy shape (no new fields) has no new keys *carrying values* (assert serialized shape instead); non-string `kind`/`note` ignored.

Cap `summary`, `caption`, `note` at 400 characters (`.slice(0, 400)`).

## Test fixtures in TypeScript checks

**JSON loading without resolveJsonModule.** `tsconfig.app.json` does not enable `resolveJsonModule`, so `import x from "./foo.json"` fails tsc. In checks, use:

```ts
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixture = JSON.parse(readFileSync(resolve(__dirname, "diagram-fixtures/f1.json"), "utf8"));
```

Works across both `ts-node` and `node --import ./scripts/ts-resolve.mjs` loaders.

## Diagram component (canvas-diagram.tsx)

### Viewport-driven direction

Direction rule: **viewport wins.** If container width ≤ 560px, use `"tb"` (top-to-bottom), else use `block.direction ?? "lr"`. Measure container with `ResizeObserver` on scroll wrapper; update direction only when width bucket changes (not every pixel).

### Text measurement

Use one cached 2D canvas context at module scope:

```ts
const canvas = (() => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  return c.getContext("2d");
})();

function measure(text: string, fontPx: number): number {
  if (!canvas) return defaultMeasure(text, fontPx);
  canvas.font = `600 ${fontPx}px ${getComputedStyle(document.body).fontFamily}`;
  return canvas.measureText(text).width;
}
```

Pass `measure` to `layoutDiagram(…, { measure })`. Falls back to `defaultMeasure` if `document` is undefined (SSR).

### SVG structure (back-to-front rendering)

1. **Edges** (`<path>`): `M/L` commands from layout points. `stroke="var(--color-accent)"`, `strokeOpacity .85`, `strokeWidth 1.6`, `strokeLinejoin="round"`, `fill="none"`.
2. **Marker** (single, SVG `<defs>`): arrowhead at end of each edge path via `markerEnd`.
3. **Node rectangles** (`<rect>`): `rx=10`, filled `var(--cv-paper)`, stroke `var(--cv-border-strong)`.
4. **Node text** (`<text>`): wrapped lines as `<tspan>`. Label 12px/600 weight, detail 10.5px/400 weight (muted color).
5. **Edge-label chips** (`<rect>` + `<text>`): above lines so visually interrupted. 10.5px text, same fill/stroke as paper.

No colour names; use only CSS custom properties: `var(--color-accent)`, `var(--cv-paper)`, `var(--cv-border-strong)`, `var(--color-brandtext)`, `var(--color-muted)`.

### Node selection and detail panel

- **Focusable nodes**: `<g tabIndex={0} role="button" aria-label="{label}. {kind}. Connected to N: a, b.">`.
- **Selection**: click or Enter/Space. Selected node + incident edges: full opacity, `stroke="var(--color-accent)"` width 2.4. Rest: opacity 0.28.
- **Detail panel**: below the SVG stage (never overlaps). Shows node label (bold), `kind` chip, `note ?? detail`, and neighbour buttons (move selection by click).
- **Clear**: click same node again or Escape.

### Zoom and scroll

- **Wrapper**: `className="ast-cv-dg-scroll"`, `overflow:auto`, `overscroll-behavior:contain`, `touch-action: pan-x pan-y pinch-zoom`, `max-height: min(78vh, 760px)`.
- **SVG scale**: CSS `transform: scale(zoom)` on inner element; outer sizer div with `width/height: bounds.w*zoom; bounds.h*zoom`.
- **Controls**: three 44×44 buttons (ZoomOut, ZoomIn, Scan icons from lucide-react) in `.ast-cv-dg-controls` (reuse `.ast-cv-graph-controls` style).
- **Zoom clamp**: `[0.83, 2.5]`, step ×1.25. "Fit" = `min(1, containerWidth / bounds.w)` clamped at 0.83 minimum (never fit below 0.83; scroll instead). Initial zoom = Fit.

### Legend

Only when ≥2 distinct `kind` values exist. Toggle chips (`aria-pressed`). Dim non-matching nodes.

### Accessibility

- **Summary**: render `block.summary` (or generated fallback) as `<p>` above stage. Make it `aria-describedby` target of `role="group"` wrapper.
- **Text twin**: `<details className="ast-cv-dg-twin">` with `<summary>Connections as text</summary>` + `<ul>` of `<li>"A → B (label)"</li>` per edge (mirrors `.ast-cv-graph-a11y`).
- **prefers-reduced-motion**: no entrance animation.

### Component integration

Lazy-load in `canvas-blocks.tsx`:

```ts
const DiagramLazy = React.lazy(() => import("./canvas-diagram"));
case "diagram":
  return (
    <Suspense fallback={<div className="ast-cv-chart ast-cv-chart-skeleton" aria-busy="true" />}>
      <DiagramLazy block={block} id={`cv-dg-${id}-${bi}`} />
    </Suspense>
  );
```

Wrap in `<Expandable>` for fullscreen (id pattern as above). Dagre (~17 kB gz) stays out of main chunk via dynamic import.

## CSS additions (.index.css)

CSS block appended at end; references six new classes: `.ast-cv-dg`, `.ast-cv-dg-caption`, `.ast-cv-dg-panel`, `.ast-cv-dg-panel strong`, `.ast-cv-dg-panel span`, `.ast-cv-dg-neighbour`. All token-routed (CSS custom properties), no hex colours or names.

## Regression gates

Two new rows in `scripts/regression-gate.check.mjs`:
- **RG-071**: guards `src/lib/diagram-layout.check.ts`. Symptom: diagrams with >8 nodes overlapped text/lines; pure layout is audited for zero overlaps on 5 stress fixtures + 200 seeded random graphs.
- **RG-072**: guards fixture audit determinism (same input → identical JSON).

## Known limits

- **Bundle size**: dagre bundle-in via lazy load is unverified; only the dynamic import syntax proves it stays out of main chunk. Manual build check required.
- **Pre-existing gate failures**: RG-053 guard missing (`scripts/ops-pages.dom.check.mjs` not in tree); `src/lib/sidebar-logo-align.check.ts` unpinned in manifest. Not introduced by this session; left alone.
- **Visual review**: no vision tool in session; claims rest on DOM measurements (zero overlaps, 0.83–2.5 zoom, viewport-driven direction). Numeric evidence is strong, but pixel rendering unconfirmed.

## Skeleton color derivation — theme-neutral grey (commit a1ece86)

**Neutral skeleton colors derived from ink/void via oklab zero-chroma.** Session 20261003_204006_e99cd7 fixed all skeletal loading screens to use theme-derived neutral grey instead of palette-tinted colours (orange under Fire, blue under Astra/Water).

**The bug:** `.ast-sk`, `.ast-cv-doc-skeleton`, `.ast-cv-chart-skeleton` shimmer/fill colors were set to accent-following tokens (cyan x24), giving different hues per palette and making skeletons orange under Fire and blue under Astra/Water. Same for `config-page.tsx` hardcoded `bg-white/5`.

**The fix:**
1. Define `--ast-sk-fill` and `--ast-sk-sweep` in CSS at `:root` and `[data-theme="light"]` using `oklch(from var(--color-brandtext) l 0 h)` — relative color syntax that zeroes chroma (saturation) while preserving lightness from the palette's own ink/void. Exact lightness values derived per mode from contrast-ratio math: dark mode ~0.09–0.10 (ratio ~1.36–1.38), light mode ~0.26 (ratio ~1.45–1.52).
2. Apply tokens to `.ast-sk`, `.ast-cv-doc-skeleton` (fill + sweep), and `ast-cv-chart-skeleton` (fill only).
3. Note: `config-page.tsx` uses hardcoded `bg-white/5 animate-pulse` — same bug, leaves it invisible in light mode. Should replace with `ast-sk` class. Left unpatched (file dirty from concurrent session).

**Discoveries:**
- **lightningcss fallback bug:** When minifying, lightningcss resolves `@supports` fallback rules against root tokens, not scoped `:root`/`[data-theme="light"]` overrides. Dark-mode fallback for `--light-c-89` resolved as dark grey instead of white, breaking light-mode visibility. Fix: compute correct literals per mode before @supports block (CSS no longer needed dynamic fallback).
- **Contrast tuning:** oklab lightness only (zero chroma) gives true neutral, but contrast varies per palette's own ground. Saturated palettes (Fire, Earth) need slightly higher lightness; desaturated ones OK. Light mode needs 0.26 (vs. dark 0.09–0.10) to match 1.3+ contrast floor on cream paper.

**Verification:** Live browser testing across 5 palettes × 2 modes confirmed zero tinted skeletons (pure grey `rgb(54,54,54)` / `rgb(80,80,80)` under all combinations). `npm run check` passed (56 checks).

**Not fixed:**
- `config-page.tsx:64` — hardcoded `bg-white/5 animate-pulse` (separate surface, file dirty).
- Android `GateActivity.showSkeleton()` — uses `surfaceHi` (theme-mapped already, unverified per APK rebuild).

## Canvas JSON repair — tiered parsing (commit 8a9f675)

**Three-tier + lazy-lib repair for malformed `astra-canvas` JSON.** Measured against a real corpus of 120 historical fences (106 rendered, 14 degraded). Proven constraints:

| tier | repair | when | note |
|---|---|---|---|
| 1 | `balanceBrackets` | sync | trailing `}` duplicate |
| 2 | comment/trailing-comma strip, bare keys | sync | sloppy JSON |
| 3 | `extractOutermostJson` (Polaris technique) | **async only** | prose wrapper + isolation |
| 4 | `jsonrepair@3.12.0` | **async only**, own 6.4 kB chunk | missing commas, single quotes |

**Critical constraints (caught by testing, not obvious):**

- **No new sync-path repair tier.** `parseCanvasSpec` only tries `parseNdjson` fallback when `lenientJson()` THROWS. A sync-path repair that succeeds will pre-empt the fallback — and NDJSON isolation keeps only the first object, silently dropping the rest. Measured: broke NDJSON, bare-block, misnested-fence tests. **Any new tier must either throw on partial input or live async-only.**
- **Isolate before handing to a repair lib.** `jsonrepair("Here is:\n{…}\nHope this helps.")` returns `["Here is:", {…}, "Hope this helps."]` — an array that reads as valid and destroys the card. Polaris' `extractOutermostJson` (string-aware brace scan) is the extraction; require the result to validate as a real `blocks` array or treat as unrecoverable. A repair that fabricates data is worse than honest degradation.
- **Gate on fence count, not parse success.** `scanFences()` only reports closers where the body parses — i.e., exactly the malformed ones tier 4 exists to rescue. It makes the retry unreachable. Count openers with `/`{3,}astra-canvas/g` and assert async never returns FEWER cards than sync.

**Polaris ref:** `~/.smartslate/frontend/src/lib/integrations/claude/validation.ts` (415 lines) has reusable extraction (fence stripping, preamble removal, string-aware counting); that half is worth porting. It is not a library — it throws on failure, so it works as a precondition. The `validateBlueprintStructure` / `normalizeBlueprintStructure` (inferring missing fields from shape) is the other portable pattern, if display hints are ever needed.

**Regression gate:** Assert BOTH directions. Pinned tests must cover a missing comma rendering (tier 4 works) AND a missing opening `{` still degrading (no fabrication). A card with invented structure is worse than raw JSON shown as-is.

## Sidebar logo alignment (App.tsx, sidebar-logo-align.check.ts — commits ab19279, ac100ed)

**Touch-device layout bug hidden by desktop-only testing.** Reported on iPad Pro 12.9 portrait/landscape as -8.00px horizontal offset; measured 0.00px on desktop, so initial CSS fix appeared correct but was incomplete.

**Root cause:** `index.css` has a global accessibility rule `@media (pointer: coarse) { button { min-width: 44px; min-height: 44px } }` that applies only on touch devices. The logo button expanded from 28px (content-sized on desktop) to 44px (touch minimum on iPad) but was not centred in its button, so the block-level `<img>` sat at the button's left edge: `leftEdge + 28px = 36px` vs rail centre at `32px`, leaving 8px empty on the right.

**Fix:** Make the layout pointer-independent by:
1. Button fills its 48px column (w-full h-full) instead of being content-sized, so it centres naturally.
2. Wrapper uses `grid-cols-1 place-content-stretch` instead of `place-content-center`, so the grid track expands to fill the column and the button's `w-full` has something to fill.
3. Gated on `!expanded` only — expanded mode keeps the logo content-sized with label.

Result: logo centre is always 32px (rail centre = nav icon column centre) in both pointer modes. Touch target remains 48px (beats the 44px minimum).

**Regression check** (`src/lib/sidebar-logo-align.check.ts`):
- **Pure arithmetic, no DOM**: derives geometry as rail width - border, content width, nav padding + icon column width. Fails loudly if anyone re-introduces `justify-center` on the collapsed bar, drops the shared `w-12` span, or changes the rail width.
- **Coarse-pointer guard**: Documents the `@media (pointer: coarse)` rule and its 44px inflating effect. Verifies the button fills its column (defeats the inflation trap).
- **Idempotent**: Run after any sidebar layout changes. Proven to FAIL on the pre-fix code (test: reverted pattern, check threw, re-applied fix, check passed).

**Lesson:** Device-specific media queries (`@media (pointer: ...)`, `@media (orientation: ...)`) can silently change computed layout across devices. Desktop testing alone cannot catch these. The regression check pattern (geometry constants, pure arithmetic assertions) is reusable for any layout that must remain stable across breakpoints.

Session: 20261004_101712_8e779c.

## Composer split (chat-landing.tsx, index.css — commit 32bdd8f)

**Separated text input and buttons bar into two distinct rounded-rectangle cards.** Previously one `.chat-composer` box held textarea + buttons bar; `ComposerTrace` SVG traced the entire box. Now text input and buttons are visually separate, and the running line traces only the input card.

**Structure:**
- Outer shell: `.chat-composer-shell` (position: relative; display: flex; flex-direction: column; gap: 8px; no background/border)
- Input card: `.chat-composer` (border, background, border-radius: 12px, padding, hosts `ComposerTrace` SVG as a child)
- Buttons bar card: `.chat-composer-bar` (separate border, background, border-radius: 12px, no top divider)

**Key constraint: `ComposerTrace` position.**
The SVG uses `svg.parentElement` to measure and trace its host's border (the `.chat-composer` input card). Moving the SVG to a different parent = tracing a different border. If restructuring future composers, keep `<ComposerTrace>` as a direct child of the card you want traced.

**Drag-over and focus styling:**
- Drag-over: `.chat-composer-shell.drag-over` (was `.chat-composer.drag-over`). Selector must reach the outer shell to affect both cards' visual state.
- Focus-within: `.chat-composer:focus-within` still works — targets the input card only, so the focus highlight appears only on the input card border, and the buttons bar stays idle. This is the desired behaviour.

**Drop overlay:**
`.chat-drop-overlay { inset: 12px; }` was sized for one card. With shell wrapper, it now lives on the shell (still correct — covers the whole composer area). If changing, keep `inset:` and `border-radius` consistent with card padding + radius.

**Future changes:**
When redesigning the composer structure, the three elements (shell, input card, bar card) and their relationship to `ComposerTrace` define the visual and functional contract. Preserve them or deliberately re-architect `ComposerTrace` to match a new parent structure.

Session: 20261004_141638_547b29.

## Reactive canvas parser layer (canvas-schema.ts + bindings)

**Make the parser keep reactive bindings instead of dropping blocks.** The renderers already support bindings throughout (kpi/progress/chart/table); the parser was stripping them and invalidating whole blocks. Session 20261004_124053_693de4 re-wired the parser to preserve them end-to-end.

**Parser-side core changes:**

- **Binding type from canvas-bind.ts**: A binding is any object (`{$expr}|{expr}|{path}|{$state}`) or the string forms (`"$key"` pointers). The parser's `isBind()` helper detects objects; `resolveBinding()` (from `canvas-bind.ts`) handles all shapes and never throws.
- **validateBlock wrapper pattern**: Renamed the inner logic to `validateBlockInner`; export a new `validateBlock` that wraps it and copies any `visible` binding onto the result. This one wrapper covers all ~30 block types without per-case edits.
- **Type widening (lean)**: `KpiBlock.value: string | number | Binding;` (was just `string | number`), same for `ProgressBlock.value`, and `CanvasBlock = (…) & { visible?: unknown }` (adds to the union once). Every block type implicitly accepts `visible` via the intersection.
- **Series bindings**: Store a bound series' binding directly in `points` (type as `any`/cast for dagre-free types), not a new field. The renderer already looks there: `const pts = (sr.points as unknown) != null && typeof ... === "object" && ctx ? bindPoints(...) : null`.
- **Table edge case**: A table with `bind: {$from:"ds"}` is valid even with zero rows (rows come from the dataset). Numeric cells in static rows coerce to strings; objects/arrays drop the block.
- **State preservation**: The top-level `state` field (scalar config for controls) was stripped. New `pickState()` helper filters to `string|number|boolean|null` only, validates the key regex (`/^[A-Za-z_][A-Za-z0-9_]{0,63}$/`), and only adds the key if present.

**Render-side critical fixes:**

- **KPI value display**: Use `resolveBinding(raw, scope)` not `bindNumber()` for the value display. `bindNumber("money(100)")` returns the number 100; `resolveBinding()` returns the string `"$100.00"` (what the expression produced). Show it verbatim. Keep `bindNumber` only for the delta/trend numeric path.
- **Control defaults**: Without seeding, a control's own default (`bind: "n", value: 5`) exists on the block but NOT in the scope, so `{$expr: "n*2"}` resolves with `scope.n = undefined`. Fix: in `Blocks()` call `seedControlDefault(b)` for each block BEFORE reading `useCanvasScope()`. A slider/select/segmented/multiselect/toggle/search seeds its authored default into the scope exactly once; `seed()` is idempotent and doesn't notify.
- **Per-card store isolation**: A card with controls (even no explicit `state`) must get its own `CanvasStateProvider`, not share the module `FALLBACK_STORE` (causes cross-card bleed). Force this: compute `const hasControls = spec?.blocks.some(b => ["slider"...].includes(b.type))` and wrap when `!!spec?.state || !!hasControls`.
- **Chart label safety**: When a bound series exists (`series[0].points` is an object), `.map()` throws. Guard: `const firstPts = block.series[0]?.points; const labels = block.labels || (Array.isArray(firstPts) ? firstPts.map(...) : [])`. Apply the same `Array.isArray()` check to data access and sparkline derivation.
- **KPI spark binding**: `spark` can now hold a binding object. `KpiTile` already reads it as `isBinding(raw) ? bindPoints(raw, scope)`, but update `canvasToMarkdown()` to guard `Array.isArray(b.spark)` before `.join()`.

**State bug fixes:**

- **sAuthored reset on re-parse**: Move `const sAuthored = new Map()` ABOVE the `canvasStore()` function so it's defined first. Record the authored initial on creation (`sAuthored.set(canvasId, initial)`). On re-parse with an equal object, `JSON.stringify` compares correctly (was comparing by reference before). Prevents user edits resetting when the same state object re-enters.
- **Seed visibility**: `CanvasStore.seed()` modifies `this.values` but deliberately bumps NO version / doesn't notify. Readers rendered BEFORE seeding see a stale scope. Seed from the parent `Blocks()` BEFORE it calls `useCanvasScope()` (which reads the scope).

**Testing pattern:**

- `canvas-schema.check.ts`: 12 new tests (93 → 105); assert bindings survive, state is filtered, numeric cells coerce, chart/progress/table edge cases work.
- `canvas-bind.check.ts`: 1 new test: `resolveBinding({$expr: "money(5 * 10)"}, {})` returns the STRING `"$50.00"` (why KPI must not use `bindNumber` for display).
- Regression gate `RG-070`: marks the whole feature as pinned (parser layer dead at 7 reactive cases).

**Known rough edge:**

- `canvas-view.tsx` `deriveTitle()` now shows `"MRR: [object Object]"` for a bound kpi block (a new reachable code path). Not fixed in this session (strict instruction scope). Leave `canvasToMarkdown()` guards in place; consider a follow-up for title formatting if reactive cards become common.

Session: 20261004_124053_693de4 (M2 work order).

## Harness CLI agent detection (harness-agents.ts)

**Show external CLI agents in the sub-agent panel.** `subagent.list` (gateway RPC) only tracks Hermes `delegate_task` children. External agents — claude, opencode, agy — are invoked via the plain `terminal` tool (`claude -p …`, `opencode run …`, `agy -p …`) and never register there, so the panel stayed empty during long external-agent runs. Client-side detector synthesizes panel rows from `tool.start` / `tool.generating` / `tool.complete` event payloads.

**Detection strategy (conservative):**

- **Harness binaries**: claude, opencode, agy, antigravity (→ agy), codex, gemini.
- **Shell wrapper handling**: Commands may wrap in `bash -lc 'claude ...'`, `timeout 600 agy ...`, `env VAR=X opencode ...`. Skip wrappers (bash/sh/zsh/timeout/env/nohup/exec/command) to find the lead binary. Wrappers with their own arguments consume them: shells eat `flags (-lc, -c, -e…)` before the command; timeout/env eat their arguments.
- **Quote stripping**: Shell-wrapped commands arrive tokenized; `bash -lc 'claude ...'` becomes tokens `["bash", "-lc", "'claude...'"]`. Strip quotes from tokens after consuming wrapper flags: `tokens[i].replace(/^['"]|['"]$/g, "")`.
- **Agent flags**: Once the binary is the lead token, confirm intent via a flag (`-p`, `--print`, `run`, `--oneshot`, etc.) or empty next token (binary with no args is still valid).
- **Rejection**: `echo claude is great` → echo is lead, not binary. `grep -r agy src/` → grep is lead, not binary. `cat notes-claude.txt` → cat is lead, file mention rejected.

**Row synthesis**: Each detection produces `HarnessRow` (subagent_id: "harness-{tool_id}", model: harness name, status: "running", started_at: epoch seconds). On `tool.start` add; on `tool.complete` mark done then remove after ~1.2s (brief visibility, matches live-roster semantics).

**Merging with gateway roster**: Gateway `subagent.list` RPC wins on id collision; synthetic harness rows kept for unmatched tool IDs. Sort merged by `started_at` for timeline order.

**Checks**: `harness-agents.check.ts` — real fleet CLI shapes (claude -p, opencode run, agy -p, wrapped variants, abs paths, timeout/env/bash wrappers), rejection (echo/grep/cat/npm/shell basics), merge deduplication.

Session: 20260926_164023_40cc09e8.

## Request ownership (hermes-ws.ts)

**Gate server→client requests to their own session.** Server broadcasts upstream events (approval, clarify, gate requests) to every connected tab via the proxy. Before this fix, a request minted for chat A's turn rendered in chat B (ensureActive even fabricated a bubble for it). Gate both dispatch branches and resume-from-open_requests replay on strict `params.session_id === liveIdRef.current`, fail-closed on missing tags.

**Architecture**: `hermes-ws.ts` `handleRequest` dispatches server requests; `resumeOpenRequests` replays unresolved requests on reconnect. Both paths must check session ownership before creating client-side state (approval button, card render, etc.).

**Check pattern**: `request-ownership.check.ts` — assert ownership predicate on dispatch (approval/clarify/gate request tags match the live session) and resume (request's session_id filters against liveId).

Session: 20260926_164023_40cc09e8.

## Tab isolation (hermes-ws.ts, tab-isolation.check.ts)

**Each browser tab runs its own independent chat session.** localStorage is per-ORIGIN, not per-tab; two tabs on the same origin were sharing a single session ID, so opening tab B and starting a new chat would overwrite tab A's session, silently jumping both to the same conversation on their next reconnect.

**Storage resolution order (MUST be followed strictly):**

1. **URL path** — `/c/<id>` (deep links, reloads, back/forward) wins first. A tab keeps re-asserting its own id via history state.
2. **sessionStorage** — per-tab by design. A new tab gets an empty one; a reload keeps it.
3. **Nothing** — a brand-new tab at `/` starts a fresh chat, never inheriting from a sibling tab's stale value.

Delete the old origin-wide localStorage key on sight so it cannot be adopted again.

**Wire protocol isolation:** The proxy broadcasts every upstream RPC reply to every connected browser. A tab must track the RPC request IDs it actually sent and only adopt replies to its own requests. Apply the same guard to both `{id, result}` (session.create) and `{id, error}` (failure) branches — every reply path must check ownership before updating tab-local state.

**Checks**: `tab-isolation.check.ts` — storage resolution order (URL → sessionStorage → empty), legacy key cleanup, broadcast-reply ownership (adopted request must match this tab's sent ids).

Session: 20260926_164023_40cc09e8.

## Theme engine architecture & backdrop styling (session 20261003_105110_2254d1)

**Astra theme engine:** CSS custom properties + DTCG-style JSON token structure, not a framework dependency (next-themes, Radix, etc.). Theme data lives in JSON; CSS reads it via custom properties. Light/dark detection via `prefers-color-scheme` media query, with theme color palette swapped via `:root` and `[data-theme]` selectors.

**Backdrop full-screen fixed layer:** Media background (video, iframe, image) uses `position:fixed inset:0` to fill screen behind chat bubbles. **Critical:** requires explicit z-index on siblings (e.g., `aside#astra-sidebar { z-index:2 }`) to prevent paint-order bug where sidebar disappears under the backdrop. The fixed layer has `z-index:0` or unset; siblings must explicitly layer above it.

**Mobile drawer glass:** Sidebar drawer on mobile uses same glass intensity as message bubbles (`blur(29px) saturate(1.25)`) for visual consistency.

**Header/sidebar sizing:** Content-fit sizing preferred over fixed heights — use `h-16`, `min-h-0` + `py-2.5` instead of fixed `77px` to adapt to content naturally.

**Concurrent session conflicts:** Shared repo with concurrent sessions can silently revert your changes (verified: commits f51cece and 0a428f6 reverted index.css theme changes on 2026-10-02). Always verify with `git log --oneline` and `git status --short` on theme files before and after any collaborative edit.

**Video persistence (owner preference):** Background video must continue playing across page reloads and maintain play position. Use global state tracker (localStorage + throttled save) rather than component-local state, so the video resumes from where it left off.

Session: 20261003_105110_2254d1 — theme engine research, backdrop styling, mobile implementation steering (interrupted).

## Android WebView typing lag diagnosis (session 20261003_144529_84173a)

**Root cause:** Input state lives in `ChatLanding` (2030 lines); every keystroke triggers a full re-render of the component, which re-creates JSX for every message in the conversation history without memoization. The `TurnTimeline` component was not memoized, so the entire list rebuilds on each keystroke.

**Gap found:** An earlier skill file claimed `TurnTimeline` memoization was applied on 2026-10-03, but `grep memo(TurnTimeline` returned zero hits — the fix was never committed. Verify claimed fixes via git log and grep before trusting skill documentation; concurrent sessions can revert changes without updating the lesson.

**Fix strategy (ranked by cost):**
1. Memoize `TurnTimeline` with `React.memo` and a stable props shape
2. Wrap `messages.map` in parent `useMemo` so the message JSX doesn't rebuild on every keystroke
3. Add `content-visibility: auto` to off-screen message containers to skip browser layout/paint for invisible messages
4. Move draft input state out of `ChatLanding` to a sibling or parent component (largest change, only if #1–3 insufficient)

**Measurement approach:**
- **Before/after profiling:** Capture a 3–5 second keystroke burst under 4x and 6x CPU throttle in Chromium DevTools. Measure: per-keystroke duration (PerformanceObserver on event timing), long-task count (>50ms), and component rebuild % of profile.
- **Baseline probe:** Use Playwright to measure keystroke-to-DOM-update latency via `ta.press()` timing + DOM node count correlation (established pattern: `scratch/scale-probe.mjs`).
- **Test data:** A chat with 200+ messages exposes the problem immediately. Longer chats (4,000+ messages) show where the scaling breaks.

**Desktop vs. phone verification:**
- CPU throttle profiling on desktop (Chromium DevTools) catches main-thread cost and is reversible.
- **GPU costs are invisible on headless Chromium** — `backdrop-filter: blur()` on every message bubble is real on the phone but does not render in DevTools. A measured 7.1ms per character on desktop may still feel slow on a real phone if GPU texture thrashing is the next bottleneck.
- Always verify the fix on the target device before claiming it "solves" the lag. Desktop testing proves the root cause fix is correct, but the user's subjective feel is the final verdict.

**Proof captured in session:**
- Typing latency: 123ms → 7.1ms per character (6x CPU throttle, 200-message chat)
- Long tasks blocking main thread: 49 → 0
- Component rebuild cost: 27.9% → 3.3% of profile

Session: 20261003_144529_84173a — typing lag design & measurement, phone testing deferred pending device connection.

## Test harness port collision (session 20261003_085657_3abcb3)

**Problem:** Parallel check runs on the same worker pool collided on hardcoded ports (vault at 3911, transcode at 3917), causing spurious `regression-gate` failures ("stranger on port 3911") when two checks ran simultaneously. Orphaned servers remained after crashes, blocking subsequent runs.

**Root causes (three independent fixes needed):**

1. **Server child leak in `vault.check.mjs`** (line 48): `main().catch(...)` error handler only called `console.error`, leaving the spawned server process running and holding its port. When the check crashed early (e.g., socket error), the port became "in use" for the next instance. Fix: add `reapChild()` in the catch block to force-kill the child on every exit path, not just the happy path.

2. **Hardcoded base ports** in `transcode-route.check.mjs` (line 22): base port 3917 and similar were never adjusted for parallel runs. Fix: read `ASTRA_CHECK_PORT_OFFSET` env var (same pattern as vault), add offset to base port.

3. **Runner not distributing offsets** (`run-checks.mjs`, untracked at time of session): each worker slot in the pool wasn't assigned a unique offset before spawning check children. Fix: compute `ASTRA_CHECK_PORT_OFFSET = workerIndex * 10` (or similar stride) and pass to `spawnSync` via env inheritance so children inherit it automatically.

**Verification:** Deliberate overlap tests — same check (vault) spawned 8 times concurrently, each on a different port offset. Previous: 5/5 failures + orphaned servers. After fixes: 8/8 pass, zero orphaned servers. Full parallel gate suite (5 repeated runs): phantom port failures eliminated.

**Key lesson:** Crashes in check children must reap explicitly; relying on OS cleanup on process exit leaves ports held until TCP TIME_WAIT expires (~60s on Linux). A catch block that does not tear down child state is silently incomplete. Use `setTimeout(() => process.exit(1), 100)` or `spawnSync('kill', [pid])` if `reapChild()` unavailable.

**Commit state:** Port-offset fix lives in three files:
- `server/vault.check.mjs` — reap child in catch block (tracked, dirty)
- `server/transcode-route.check.mjs` — read offset, apply to port (tracked, dirty)  
- `scripts/run-checks.mjs` — compute and pass offset to each worker (untracked, part of concurrent check-suite work)

Session: 20261003_085657_3abcb3 — port collision root cause fix + Android APK optimization iterations.

## Android WebView typing lag — multi-pass optimization (session 20261003_085657_3abcb3)

**Background:** Earlier session (20261003_144529_84173a) diagnosed typing lag as message-list JSX recreation on every keystroke. This session applied iterative APK builds to test fixes in real Android environment.

**Iteration sequence (APK rebuild cycle times in parentheses):**

1. **`fitComposer` async** — `fitLayout()` was synchronous, blocking input processing. Changed to `async fitComposer()` with `setTimeout(..., 0)` to yield to the event loop. Measure: 2% improvement reported subjectively.

2. **Timeline memoization** — `TurnTimeline` component not memoized despite earlier docs claiming it was. Added `React.memo(TurnTimeline)` and stable `useMemo` on `sortedMessages`. Rebuilds dropped from ~15ms to ~3ms per keystroke.

3. **Reveal timer reduction** (16ms → 100ms) — message-reveal animation timer was firing every 16ms (60 FPS), causing 6 repaints per keystroke on Android's 90Hz display. Reduced to 100ms threshold (reveal only after 100ms idle). Measure: user reported still laggy after async fix; applied this timer change.

4. **Ticker reduction** — background telemetry ticker was waking the JS loop every 1s. Reduced to 5s minimum. Negligible direct impact but removes one source of jank.

5. **Messages list `useMemo`** (deepest fix) — final optimization wrapping `messages.map((m, idx) => ...)` in `useMemo(..., [messages])` so the entire message JSX doesn't rebuild when derived state (input draft, UI state) changes. Only rebuilds when the `messages` array reference changes. Combined all fixes above. APK 13:41 (2026-10-03).

**Key lesson:** Multiple small fixes (async, memo, timer, ticker) are necessary but not sufficient; the deepest blocker is the message-list JSX recreation. A memoized component is useless if its parent recreates its entire JSX on every keystroke. Measure each fix independently (capture profile diff before/after) to understand which one actually moves the needle.

**Testing constraint:** APK was tested on Android device with real chat history (400+ messages). Desktop Chromium DevTools profiling misses GPU effects (e.g., `backdrop-filter: blur()` is invisible in headless mode but expensive on real GPU). User's subjective "still laggy" after APK v1 forced the next iteration; desktop profiles alone cannot verify a fix without device testing.

**Delivery:** APK rebuilt and delivered via Telegram with brief changelog (useMemo message list + async fitComposer + reveal timer 100ms + timeline memo + ticker 5s). Diagnostics instrumentation enabled for on-device perf capture.

Session: 20261003_085657_3abcb3 — Android optimization iterations, harness port collision root cause fix.

## CSS chat surface styling (session 20261003_001133_bf4046)

**Three distinct CSS patterns proven in commit bd04fe6:**

### 1. Bottom-aligned content in scroll containers — the flex-end bug

**Problem:** An `overflow-y: auto` container with `justify-content: flex-end` makes overflow ABOVE the start unreachable. Classic flex-end scroll bug: when content is shorter than viewport, flex-end sticks it at the bottom (good), but when scrollable, the first part of the content can't be reached.

**Solution:** Use `margin-top: auto` on the child inside a flex column container. Same visual result, no scroll reachability bug. Works because flexbox distributes `auto` margin space, so `margin-top: auto` on a single flex item pushes it to the bottom while staying scrollable.

**Implementation in `.chat-scroll`:** Used `:has(> .chat-welcome)` selector (no TSX changes required) to turn on flex only in the landing state, leaving the message transcript a normal block scroll container.

```css
.chat-scroll:has(> .chat-welcome) { display: flex; flex-direction: column; }
.chat-scroll > .chat-welcome { margin-top: auto; margin-bottom: 10px; }
```

**Verified:** Regression check `RG-079` in `scripts/css-chat-surface.check.mjs` asserts both rules coexist — if a later edit drops `display: flex`, the check fails before the bug surfaces.

### 2. Regression testing CSS rules — the build + parse pattern

**Approach:** Instead of hand-auditing `.index.css` changes, compile through the real Vite/Tailwind pipeline into a temp `outDir`, parse the emitted CSS into rule objects (selector set + declaration set), and assert specific rules exist.

**Critical details:**

- **Compile to temporary dir, never touch `dist/`:** Regression checks run in isolation; `npm run build` would also run `tsc -b` and mix in unrelated TypeScript errors masking CSS regressions. Build CSS only, throw away the output.
- **Parse rules as SETS, not strings:** lightningcss reorders declarations inside a rule (e.g., `display` moves after `flex-direction`), so substring matching fails. Compare declarations as Sets.
- **Handle lightningcss's color-mix expansion:** `color-mix(in srgb, var(--color-cyanx) 45%, transparent)` gets expanded to a hex literal + an `@supports` guarded `var()` form. The `@supports` branch is what modern browsers use (theme-reactive). Assertion must check the `var()` form inside the `@supports` block, not the fallback hex.
- **Normalise whitespace consistently:** `norm(s) => s.replace(/\s+/g, '').replace(/;/g, '')` removes all spaces and semicolons before set comparison, so CSS variations like `.chat-scroll { scrollbar-color: var(--sb-thumb) transparent; }` vs `.chat-scroll{scrollbar-color:var(--sb-thumb)transparent;}` compare as equal.

**Pattern (from `css-chat-surface.check.mjs`):**
```js
const rules = (src) => {
  const out = [];
  for (const m of src.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((s) => norm(s)).filter(Boolean);
    const decls = new Set(m[2].split(';').map((d) => norm(d)).filter(Boolean));
    out.push({ sels, decls, raw: norm(m[0]) });
  }
  return out;
};
```

Then query: `const r = ALL.find((r) => r.sels.includes(norm('.chat-scroll')))` and assert `r.decls.has('display:flex')`.

### 3. Theme-reactive scrollbar tokens — semantic roles over channel vars

**Problem:** Scrollbar colors were hand-written as `scrollbar-color: rgb(var(--c-2) / 0.14)`, relying on generated channel vars `--c-N` that get renumbered every time the tokenize script runs. A new palette swap could silently repoint `--c-2` to a different role entirely.

**Solution:** Create semantic scrollbar tokens rooted in `--color-cyanx` (a stable, human-authored token that theme-store's `applyPalette` already re-points per palette AND per light/dark mode):

```css
:root {
  --sb-thumb: color-mix(in srgb, var(--color-cyanx) 45%, transparent);
  --sb-thumb-hover: color-mix(in srgb, var(--color-cyanx) 72%, transparent);
  --sb-track: color-mix(in srgb, var(--color-cyanx) 8%, transparent);
}
```

**Why it theme-reacts:** Custom properties resolve lazily. When `applyPalette()` swaps the inline style `root.style.setProperty('--color-cyanx', hex)`, every use of `var(--sb-thumb)` re-resolves the `color-mix()` immediately. No `[data-theme="light"]` copy needed — one `:root` block covers both modes.

**Applied to:** One shared selector list covering all chat-interface scrollable surfaces (transcript, thinking panel, terminal output, tool cards, command surfaces). Future additions join the list; nothing gets the browser's default grey rail.

```css
.chat-scroll, .chat-think-text, .chat-term-out, .suba-tail, .ai-term-body,
.ai-io-val.tall, .ai-io-val > .ai-io-md.tall, .cmdpal-list, .cmdsheet-list,
.chat-menu, .cmenu-body {
  scrollbar-width: thin;
  scrollbar-color: var(--sb-thumb) transparent;
}
```

**Verified:** Regression check asserts `--sb-thumb` is defined and uses the theme-reactive form inside `@supports (color-mix: ...) { ... }`, then asserts no other chat rule overrides scrollbar-color with a baked channel var.

**Lesson:** Semantic tokens (names like `--sb-thumb`, `--color-cyanx`) are load-bearing. They're the contract between CSS and the theme engine. Hand-picked channel vars are implementation details; never expose them to public API.

Session: 20261003_001133_bf4046 — chat landing card centering, composer scrollbar hide, accent-primary chat surface scrollbars.

## Hunk-level commits in the shared dirty tree (2026-10-05)

Concurrent sessions keep `src/index.css` (and other shared files) dirty with their own in-flight hunks. `git add <shared-file>` would commit their half-done work; `git stash --keep-index --include-untracked` sweeps ALL of it into the stash (recoverable via pop, but it briefly hides their tree state — don't).

**Safe method:** `git diff HEAD -- <file>` to a scratch file -> filter to hunks whose added lines carry a signature only YOUR edit contains (python split on `@@`) -> `git apply --cached <filtered.patch>` (index-only, working tree untouched) -> `git add <your-own-new-files>` -> commit. Verify with `git diff --cached --stat` before committing: the shared file must show only your few lines, e.g. "src/index.css | 23 +-".

Session: 20261005 — welcome card centering + mobile bubble-rail clamp (commit b0e3828).

