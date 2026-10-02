# ROLE

You are the planning architect for a feature in an existing, live, production React app. Produce an
**implementation plan document**. You are NOT writing the implementation — you are producing the plan a
separate build agent will execute without being able to ask you questions.

Style: terse, technical, no filler. No emoji.

---

# PRODUCT CONTEXT (verified facts — do not re-derive, do not guess)

## Repo

- Path: `/home/notjitin/Work/projects/astra-webui`
- Git repo, branch `main`, HEAD `e661941`. Working tree has unrelated modified data files
  (`data/gate-ledger.jsonl`, `data/read-state.json`, `data/test-ledger.jsonl`) and untracked scratch —
  **do not touch, revert, or commit those**.
- Stack: Vite 8 + React 19 + TypeScript ~6.0.2 + Tailwind CSS v4 (via `@tailwindcss/vite`) +
  shadcn/ui `new-york` style. `components.json` is hand-written.
- Package manager: npm. Node modules already installed.
- Service: `systemd --user` unit `astra-webui.service`, listening on `127.0.0.1:3011`, public URL
  `https://test.jitinnair.com`. Auth: password-only login → HttpOnly `astra_session` cookie.
- Server: `server/server.mjs` — zero-dependency `node:http` server. Static `dist/` + JSON APIs.

### Dependencies ALREADY in package.json (reuse — do not add)

`motion@^12.43.0` (this is the framer-motion successor; import from `motion/react`),
`lottie-react`, `lucide-react`, `cmdk`, `clsx`, `tailwind-merge`, `zustand`, `dompurify`, `marked`,
`@radix-ui/react-{collapsible,dialog,popover,scroll-area,separator,switch,tooltip}`,
`@capacitor/*` (Android/iOS shells exist — the app ships as a native wrapper too).

### Dependencies NOT present

- **GSAP is NOT installed.** Do not add it. All motion in this repo goes through `motion/react`.
  This is a deliberate repo decision (the sister Hermes UI uses `motion/react` everywhere) — using
  `motion/react` satisfies the "animation" requirement without a new dependency.
- `@radix-ui/react-{tabs,accordion,progress}` are NOT installed and are needed by shadcn primitives.

## Theme engine (the pages MUST inherit theme automatically)

- `src/index.css` `@theme` block defines the semantic tokens every component should use:
  `--color-void` (#0a0a0f), `--color-midnight` (#12121a), `--color-depth` (#1a1a2e),
  `--color-surface` (#252538), `--color-brandtext` (#f8fafc), `--color-muted` (#6b7280),
  `--color-cyanx` (#22d3ee), `--color-violetx` (**#34d399 — despite the name this is now the brand
  GREEN**, changed in commit 57a7190), `--color-fuchsiax` (#d946ef), `--color-redx` (#f87171).
- `src/theme-engine/registry/*.css` holds 9 palettes (`astra-ui-dark`, `astra-ui-light`,
  `catppuccin-mocha`, `dracula`, `gruvbox-dark-medium`, `nord`, `one-dark`, `rose-pine-dawn`,
  `solarized-dark`, `tokyo-night-dark`, `tokyo-night-light`), each with dark+light variants, all
  WCAG-audited.
- `src/lib/theme-store.ts` exports `applyPalette(p, mode)`, `getMode()`, `palettes`, `currentPaletteId()`,
  `setPalette`, `resetToAstra`, `readCustom`, `setToken`, `mergeCustom`, `restorePalette`,
  `startThemeSync()` (5s poll of `GET/PUT /api/theme/state`, revision-guarded, cross-device).
- **Rule: new pages use these tokens (`bg-void`, `text-brandtext`, `border-white/[0.07]`,
  `bg-midnight/50`) and `color-mix()` derivatives of the active brand colour. NEVER hardcode a hex
  colour in new code.** That is what makes theme switching free.
- Existing precedent for derived accents: `src/index.css` uses e.g.
  `color-mix(in oklab, var(--color-cyanx) 7%, transparent)` for bubble grounds and
  `rgb(var(--c-15) / 0.45)` for glow alphas — `--c-N` channel vars are injected by the tokenize pass.
  Read `src/index.css` (2671 lines) around the `@theme` block and the `chat-*` classes for the
  established idiom before inventing anything.

## Routing / navigation

`src/App.tsx` (658 lines):
- `parsePath()` maps `location.pathname` → `{ view, sessionId }`.
- `view` union is currently `'chat' | 'files' | 'tracker' | 'config' | 'approvals' | 'vault'`.
- A `useEffect` on `[view]` pushes the path AND sets the document title through a `TITLES` record.
- `Sidebar` (same file) renders 3 accordion groups from a `groups` array, persisted in
  `localStorage["astra-sidebar-groups"]`, defaults `{ Work: true, Configure: false, Operate: false }`.
  - **Work**: Chats, Files
  - **Configure**: Config, Vault, Skills, Plugins, MCP, Profile
  - **Operate**: Approvals & Reviews, Cron Jobs, Logs, System Health, Analytics,
    Webhooks & Pairing, Global Token Tracker
- Items with an `onClick` are live; items without one are dead placeholders (Skills, Plugins, MCP,
  Profile, Cron Jobs, Logs, System Health, Analytics, Webhooks currently have none).

## Existing page pattern to mirror

`src/components/approvals-page.tsx` is the newest, cleanest page. Its shape:
```
export function XPage({ onBack }: { onBack: () => void })
  const [tab, setTab] = useState<...>(...)
  const fetchX = async () => { try { const res = await fetch(`/api/...`); if (res.ok) setState(await res.json()) } catch {} ; setLoading(false) }
  useEffect(() => { fetchX(); const i = setInterval(fetchX, 5000);
                    const h = (e) => { if (e.detail?.type === "...") fetchX() };
                    window.addEventListener("astra-ws-event", h);
                    return () => { clearInterval(i); window.removeEventListener("astra-ws-event", h) } }, [tab])
  return (
    <div className="flex h-full w-full flex-col bg-void text-brandtext overflow-hidden">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] px-4 md:px-6"> …back button (md:hidden), icon, <h1 className="truncate font-display text-base font-semibold"> …
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24"> … </div>
```
`src/components/token-tracker.tsx` (307 lines) is the reference for a **live-polling stats page
with period switching (Today / 7 days / 30 days)**, `formatTokens`, `formatUSD`, per-harness
breakdown rows, and an explicit "NO synthetic fallback data: if the API is unreachable we show the
error, not fake rows" comment. Reuse that discipline.

Other reference components: `config-page.tsx` (469 lines, sectioned settings), `files-page.tsx`,
`vault-page.tsx`, `subagent-panel.tsx` (live roster rows).

## Server pattern to mirror

`server/server.mjs` routes are sequential `if (path === "...")` blocks. Auth gate idiom (copy exactly):
```js
const cookies = {};
(req.headers.cookie || "").split(";").forEach((c) => { const i = c.indexOf("="); if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim(); });
if (!validToken(cookies[COOKIE])) { res.writeHead(401, {"content-type":"application/json"}); return res.end('{"error":"unauthenticated"}'); }
```
Upstream-proxy idiom, from the `/api/beacon/*` block (lines ~435-459) — rewrite the path onto a
localhost base, pipe, and **502 with a JSON body on connection error**:
```js
const targetUrl = new URL(req.url.replace("/api/beacon/", "/api/"), "http://127.0.0.1:8789");
const proxyReq = request(targetUrl, { method: req.method, headers: { ...req.headers, host: targetUrl.host } },
  (proxyRes) => { res.writeHead(proxyRes.statusCode, proxyRes.headers); proxyRes.pipe(res); });
proxyReq.on("error", () => { res.writeHead(502, {"content-type":"application/json"}); res.end('{"error":"tokenbeacon unreachable"}'); });
req.pipe(proxyReq);
```
`/api/hx/*` (line 518) proxies to the Hermes dashboard at `127.0.0.1:9119` with server-side login and
auto-relogin. Any `/api/*` not matched falls through to a JSON 404.

Sibling server modules that already exist and are the pattern for "a new server concern in its own
file": `theme-sync.mjs`, `theme-assets.mjs`, `read-state.mjs`, `training.mjs`, `vault.mjs`,
`command-registry.mjs`, `last-reply.mjs`, `gate-enrich.mjs`, `ntfy-notify.mjs`. Several have a
matching `*.check.mjs` self-test.

---

# DATA SOURCES — all probed live on 2026-10-02, these are the ONLY sources you may use

## Via the existing `/api/hx/*` proxy (already authed server-side — frontend calls these directly)

| Endpoint | Verified shape |
|---|---|
| `GET /api/hx/skills` | `[{ name, description, category, enabled: boolean, usage: number, provenance: "agent" }]` — **the `usage` integer is the per-skill call count. This is the "most used skills" source of truth.** |
| `GET /api/hx/mcp/servers` | `{ servers: [{ name, transport: "stdio", url, command, args: [], env: {}, auth, enabled: boolean, tools: null \| string[], source: "config", plugin: null }] }` — env values arrive REDACTED (`"21st...624f"`); `tools: null` means not yet probed, that is not an error |
| `GET /api/hx/dashboard/plugins` | `[{ name, label, description, icon, version, tab, slots: [], entry, css, has_api, source }]` |
| `GET /api/memory` | `{ active: "holographic", providers: [{ name, description, available, configured, status: "ready", setup: { pip_dependencies: [], external_dependencies: [], required_env: [], dependencies_installed: true } }] }` |
| `GET /api/hx/tools/toolsets` | `[{ name, label, description, platform, platform_label, enabled, available, configured, tools: [] }]` |

Write/verify endpoints that exist for **actions** (not required for v1, but the plan should note them
as the wiring point for future enable/disable controls):
`PUT /api/hx/skills/toggle`, `PUT /api/hx/mcp/servers/{name}/enabled`,
`POST /api/hx/mcp/servers/{name}/test`, `PUT /api/memory/provider`.

## Loopback services to probe server-side (the browser cannot reach these — the astra server must)

| Service | Port | Verified response |
|---|---|---|
| headroom proxy | 8787 | `GET /health` → `{ service:"headroom-proxy", status:"healthy", ready:true, version:"0.37.0", timestamp, uptime_seconds, checks:{ startup:{enabled,ready,status,error}, http_client:{...}, cache:{...}, rate_limiter:{...}, memory:{enabled,ready,status,backend:"local",initialized,native_tool,bridge_enabled}, upstream:{enabled,ready,status} } }` |
| headroom-tracker | 8788 | `GET /api/stats` → `{ tracker_version, timestamp_utc, summary_rows_30d: [], latest_20_records: [], optimization_status: { headroom_version, proxy_healthy: true, mode: "cache", requests_30d: 80, compression_ratio_pct: 3.9, tokens_saved_30d: 241026, cost_saved_usd: 707.90, cost_saved_breakdown_usd: { compression, cache_read }, input_cost_paid_usd: 732.21, cache_read_share_pct: 107.7, agent_breakdown: [{ agent, label, requests, models: [], providers: [], tokens_saved, savings_percent }] } }` |
| tokenbeacon | 8789 | `GET /api/status` → `{ capture_last_run, pricing_last_run, derive_last_run }` (epoch seconds) |
| openviking | 1933 | `GET /health` → `{ status:"ok", healthy:true, version:"0.4.21", auth_mode:"dev" }` |
| laya-mcp | 8015 | `GET /health` → `{"error":"unauthorized"}` — **auth-gated, NOT down.** `systemd --user` has `laya-proxy.service` (8016→8015) that injects the bearer for other clients. Treat 401 as `status:"auth-gated"`, never as unhealthy. |
| ollama | 11434 | `GET /api/tags` → 200. Backs OpenViking embeddings + tool-router dense vectors. |

## Filesystem / config sources (server reads them, never the browser)

- `~/.hermes/config.yaml` — `compression: { enabled: true, threshold: 0.75, target_ratio: 0.2,
  protect_last_n: 20, protect_first_n: 3, threshold_tokens: 786000, proactive_prune_tokens: 0,
  proactive_prune_min_result_chars: 8000, proactive_prune_min_reclaim_tokens: 4096,
  hygiene_max_turn_hold_seconds: 10, idle_compact_after_seconds: 0, max_attempts: 3,
  checkpoint_required: false }`, `prompt_caching: { cache_ttl: "1h" }`, `memory: { provider: "holographic" }`,
  plus `agent.base_url`, `streaming.enabled`, `dashboard.show_token_analytics`.
  **Read these live. Values drift; never hardcode the numbers above.**
- `~/.hermes/context_length_cache.yaml` — `{ context_lengths: { "model@endpoint": N } }`.
- `~/.hermes/memories/MEMORY.md` + `USER.md` (+ `.lock` siblings) — the markdown memory stores.
  Parse entry count + char usage + per-entry length. Do NOT dump full entry bodies into the UI payload.
- `~/.tool-router/index.json` — `{ version, built_at, cwd, items: [...], stats: {...} }` (363 KB).
- `~/.tool-router/index.dense.meta.json` — dense-vector index metadata.
- `~/.tool-router/gaps.json` — dict keyed by bag-of-words phrase → (186 KB).
- `~/.tool-router/config.json` — `{ laya_rerank: { timeout_s }, mcp_hints: { "<mcp>": "<hint>" } }`.
- `~/.tool-router/breaker-{laya,ollama,rewriter}.json` — circuit-breaker state.
- `~/.hermes/skills/**/SKILL.md` — 517 skill files on disk (catalog metadata: category, mtime).
- `~/.hermes/plugins/*` — 28 plugin directories.
- `~/.hermes/hooks/` — hook scripts.
- `systemctl --user list-units` — running-unit rollup (headroom-proxy, headroom-tracker, laya-mcp,
  laya-proxy, openviking, ovgate, hermes-gateway, hermes-dashboard, astra-webui, taal-server,
  graphify-shared, penpot-mcp, neutrinos-mcp, …).
- `~/.local/bin/leanctx` (v0.3.1). **NOTE: `leanctx --version` is NOT a valid flag — it errors with
  a bench-subcommand usage message.** Get the version a working way (e.g. `pip show leanctx` or
  `leanctx bench list`) and make the probe tolerant.

---

# REQUIREMENTS

Build **three new pages** in the Configure nav group, each a live operations dashboard.

## Shared

- **S1** Add `Context`, `Memory`, and `Harness` items to the **Configure** nav group in `src/App.tsx`,
  each wired to a real route and a real page component. Extend the `view` union, `parsePath()`,
  the `TITLES` record, the `[view]` effect's pushState branches, and the `Sidebar` `groups` array.
  Each new item gets an `onClick` — no dead placeholders.
- **S2** One **new server module** `server/sysinfo.mjs` owning all probing/aggregation for these
  pages, exporting pure helpers plus route handlers, following the sibling-module pattern. Wire it
  into `server/server.mjs` behind the existing `validToken` cookie gate. Read `/api/hx/*` server-side
  with the same Hermes login the existing proxy already does — **re-use that helper, do not
  re-implement a second login.**
- **S3** Aggregation must be **concurrent and bounded**: probe every independent source in parallel
  with a hard per-source timeout (recommend 2500 ms), and never let one dead service stall the page.
  A source that fails becomes a row with `status: "unreachable"` and the failure reason — the page
  still renders everything else.
- **S4** Health status vocabulary is exactly: `healthy` · `degraded` · `auth-gated` · `unreachable` ·
  `disabled` · `inactive`. Colour-map each consistently across all three pages and use a `<8px`
  round status dot (the one legal circle).
- **S5** Polling: fetch on mount, then on a sensible interval per page (context/memory 5 s,
  harness 30 s — the skills list is large and mostly static). Pause polling when
  `document.visibilityState === "hidden"`, resume + refetch on return. Clear timers and listeners
  on unmount (see the `approvals-page.tsx` cleanup shape).
- **S6** **Zero fake data.** No synthetic rows, no placeholder numbers, no optimistic defaults. An
  unreachable source renders its error state. This mirrors the explicit rule in `token-tracker.tsx`.
- **S7** Never expose a secret. Env values from `/api/hx/mcp/servers` arrive pre-redacted — pass them
  through only if needed, and never read `~/.hermes/.env` or `~/.config/astra-webui/env` in this
  code path.
- **S8** Theme: use only the `@theme` tokens and `color-mix()` derivatives. Dark AND light must both
  pass. No hardcoded hex in new code. Use the standard icon (`text-cyanx`, i.e. the resolved brand
  accent) for headings, matching `approvals-page.tsx`.
- **S9** Vendor components land **byte-for-byte** from their registry; brand values go on call-site
  props/classes, never inside the vendor file. Magic UI source: `curl -s https://magicui.design/r/<name>.json`
  then read `files[].content` with python — `web_extract` strips JSX and is not usable.
- **S10** Accessibility & responsiveness: WCAG 2.2 AA, 44px touch targets, visible focus, real
  `<button>`/`<table>` semantics, `aria-live="polite"` on the health summary so a status change is
  announced, full keyboard navigation, and `prefers-reduced-motion` respected on every animation.
- **S11** Leave one runnable check behind for the non-trivial logic: `server/sysinfo.check.mjs`
  covering the health-status classifier, the failure→`unreachable` degradation, the timeout path,
  and the usage-ranking. Follow the existing `*.check.mjs` convention (`bash -n`-style plain node,
  no test framework).

## Context page — "all context-based tools and optimization we have wired in: connection status, health, usage check, stats and data"

- **C1** Headroom proxy (8787): per-`check` breakdown (`startup`, `http_client`, `cache`,
  `rate_limiter`, `memory`, `upstream`), version, uptime, ready flag.
- **C2** Token/optimization stats from headroom-tracker (8788): `optimization_status` — mode,
  `requests_30d`, `compression_ratio_pct`, `tokens_saved_30d`, `cost_saved_usd` + its breakdown,
  `input_cost_paid_usd`, `cache_read_share_pct`, and the per-agent breakdown.
  **KNOWN DATA DEFECT — must be surfaced honestly in the UI, not papered over:** the tracker's
  combined "all"/summary row reports a total cost of `$0.00` and zero output tokens while the
  per-harness rows carry the real figures. Render the per-harness rows as authoritative and label
  the aggregate as unreliable rather than showing `$0.00` as if it were true.
  **Second known defect:** the tracker's `leanctx` "installed" flag is hardcoded in
  `token-tracker-collector.py` (not measured), so do not present it as a live measurement.
  **Third:** token-shift is an enterprise SaaS feature that is NOT running here — never imply it
  works. If any field surfaces it, label it unavailable.
- **C3** Config-derived context window/optimization settings read live from `~/.hermes/config.yaml`
  (`compression.*`, `prompt_caching.cache_ttl`, `streaming.enabled`, `agent.base_url`) and the
  `context_length_cache.yaml` entry count + a few representative cached windows.
- **C4** Tool-routing stack health: `~/.tool-router/index.json` `stats` + `built_at` age, dense-index
  metadata, `config.json` `laya_rerank.timeout_s`, the three circuit-breaker states, and the count
  of tracked `mcp_hints`.
- **C5** laya-mcp (8015) presence — 401 must render `auth-gated`, not `unreachable`.
- **C6** leanctx presence + version via a working probe; ollama (11434) health (it backs both the
  dense vectors and OpenViking embeddings); tokenbeacon (8789) last-run ages for
  capture/pricing/derive.
- **C7** A live **toolsets** list from `/api/hx/tools/toolsets` with `enabled`/`available`/
  `configured` as a health rollup.
- **C8** A stat-tile row across the top (animated counters) and a period switcher
  (Today / 7 days / 30 days) mirroring `token-tracker.tsx`, since the tracker exposes windowed rows.

## Memory page — "all memory-based tools and optimization we have wired in: connection status, health, usage check, stats and data"

- **M1** Provider matrix from `/api/memory`: every provider's `available` / `configured` / `status`
  and its `setup.dependencies_installed`, with the `active` provider badged. Missing dependencies
  surfaced per provider, not as one global error.
- **M2** Memory-store statistics: `MEMORY.md` and `USER.md` entry counts, char counts, budget usage
  percentage, per-entry lengths, and last-modified. Report budget pressure honestly — at plan time
  the memory store reads ~96% of its 2200-char budget and the user profile store is **over** its
  declared budget, so a >100% indicator is a real, expected state that the UI must render clearly
  (not clamp to 100%). **Show counts and sizes; do not dump entry bodies into the payload.**
- **M3** Holographic fact-store health: fact count, trust-tier distribution if derivable, and the
  search/probe/reason/contradict capability set. If no count endpoint is reachable, show an honest
  `unavailable` state — do not fabricate a number.
- **M4** OpenViking (1933): health, version, `auth_mode`; plus the `ovgate` memory-write gate (1934→1933)
  as a separate row, since it sits in the write path.
- **M5** ollama health (the embedding dependency for OpenViking) and the `openviking` CLI/venv presence.
- **M6** Compression/memory optimization linkage: the compression + prompt-caching settings that
  govern how much survives compaction, cross-referenced with the Context page's live numbers rather
  than duplicated wholesale.

## Harness page — "all harness-based tools and optimization we have wired in, all the skills, most-used
skills, which skills are disconnected/outdated/inactive, the same for MCPs and plugins, hooks,
scripts and other tools, plus connection status, health, usage check, stats and data"

This is the largest page. Organize as a sectioned dashboard with a filter/search control.

- **H1** **Skills** (the headline): total count, enabled vs disabled, and a **usage-ranked list**
  driven by the `usage` integer from `/api/hx/skills`. Show top-used prominently.
  Classify each skill so the owner can act on it:
  - *inactive* — `enabled === false`
  - *unused* — `usage === 0` (candidate for retirement; say so neutrally)
  - *outdated* — SKILL.md `mtime` older than a stated threshold, surfaced as an age in days, not a
    verdict. The plan must pick and document the threshold.
  - *healthy* otherwise.
  Merge the `usage` counts with on-disk `SKILL.md` facts (category, mtime) — 517 files on disk vs the
  API catalogue: **report the reconciliation** (catalogue count, disk count, and the delta) rather
  than silently preferring one.
- **H2** **MCP servers**: every server with `enabled`, `transport`, `command`/`url`, `source`,
  `plugin` ownership, and tool count where known. `tools: null` means "not probed" — render that as
  a distinct `not-probed` note, never as zero tools. `env` values are pre-redacted upstream; expose a
  "has env" boolean only, never the values.
- **H3** **Plugins**: every entry from `/api/dashboard/plugins` with `version`, `label`, slots,
  `entry`/`css`, `has_api`. Cross-reference the 28 directories in `~/.hermes/plugins`.
- **H4** **Hooks** (`~/.hermes/hooks/`) and **scripts**: enumerate with path, mtime, size, and a
  readable one-line purpose if the file exposes one (shebang/docstring). Read-only.
- **H5** **Toolsets** (`/api/hx/tools/toolsets`) with `enabled`/`available`/`configured` and tool counts.
- **H6** **Harness runtimes**: the agent CLIs the machine actually has (`claude`, `opencode`, `agy`,
  `codex`, `gemini` — the recognised binaries are in `src/lib/harness-agents.ts` `HARNESS_BINARIES`)
  probed by presence + `--version`-style check with a short timeout, each reported as a row. Use
  `shutil.which`/an equivalent existence probe on the server; do not assume a binary is installed.
- **H7** **Search + filter** across all harness entities (a single text filter, and status filters
  for healthy / inactive / outdated / unreachable). 517 skills make unfiltered rendering unusable —
  virtualise or cap the rendered list with a "showing N of M" affordance, and say which.
- **H8** A summary tile row: total skills, MCPs, plugins, hooks, toolsets; counts by health status;
  and the count of items needing attention.

---

# FORCED OUTPUT FORMAT

Return a single Markdown document with exactly these sections, in this order.

## 1. Architecture & data flow
One short diagram (ASCII) and one paragraph per page: browser → `server.mjs` route → `sysinfo.mjs` →
upstream sources. State where each upstream source is read (server-side file read, loopback HTTP, or
existing `/api/hx/*` proxy) and which are cached vs live.

## 2. API surface
Exact table: method, path, auth, response shape, cache TTL, failure shape. Include the exact JSON
shape each new endpoint returns, with the status-vocabulary field named once and reused.

## 3. File-by-file change map
Every file to create or modify, with a one-line description and whether it is new or edited. Group by
`server/`, `src/lib/`, `src/components/`, `src/App.tsx`, and vendor installs. Include the exact npm
packages to add (only the Radix primitives actually required — nothing else).

## 4. Component inventory
Which vendor components to install, from which registry, with the verbatim-fetch recipe for each
(registry name → exact URL/JSON path → target file). Justify each against a specific requirement.
Explicitly list what you searched for and did NOT find, so the build agent does not re-search.

## 5. Per-requirement implementation notes
One short block per requirement ID (S1…S11, C1…C8, M1…M6, H1…H8). Each block: the exact function or
JSX to write, the file it goes in, and the trap to avoid. Be specific enough that no judgement call
is left open.

## 6. Data-truth rules
The list of things that must be rendered as *unreliable*, *unavailable*, or *not-probed* rather than
as a healthy number — including the tracker's broken aggregate row, the hardcoded leanctx flag, the
absent token-shift feature, `tools: null` MCP entries, laya's 401, and over-budget memory stores.

## 7. Test checklist
Runnable commands a reviewer can execute, each with the pass condition. Must include: the
`sysinfo.check.mjs` run, `npm run build`, the server restart, the self-check script against BOTH
`http://127.0.0.1:3011` and `https://test.jitinnair.com`, and one live-fire assertion per page that
reads the actual DOM. Also state how to reach an authed page without typing the password (mint a
session via `POST /api/login` on the loopback port, then reuse the cookie — Cloudflare 403s a
server-side POST to the public URL).

## 8. Top 3 risks
Each risk: what breaks, how it presents to the user, and the mitigation.

## 9. Non-goals
What this change deliberately does NOT do.

---

# CONSTRAINTS

- **Ponytail discipline (laziest thing that actually works):** reuse before adding. `motion/react`
  exists — do not add GSAP. The status tile, the health dot, the counter and the list all have
  existing patterns in this repo. Every new dependency must be justified against an existing one.
- **Do not re-implement auth.** The Hermes login, the cookie helpers and the `/api/hx/*` proxy
  already exist in `server/hermes-proxy.mjs`; call into them.
- **No bundler, no npm runtime deps beyond the Radix primitives.** The server stays zero-dependency
  `node:http`; a new server module must add nothing to `package.json`.
- **Do not modify** `data/gate-ledger.jsonl`, `data/read-state.json`, `data/test-ledger.jsonl`, or any
  `scratch/` file that is not yours. Do not touch `~/.hermes/hermes-agent` (upstream) or
  `~/.hermes/config.yaml`.
- **Never deploy.** The plan does not restart services and does not push.
- **Do not type or request the app password.** A minted session cookie is the mechanism.
- Read `references/` in the repo (`references/*.md`) before planning any animation, authed QA, or
  tokenized-CSS change — the pitfalls documented there are load-bearing.

# DONE CONDITION

The build agent receives this plan plus the product context above and implements it **without asking
a single clarifying question**. Every path, port, endpoint, token name, and file location above is
verified-real. Where you must choose a value (timeout, stale threshold, poll interval, list cap),
state the choice and its justification inline rather than leaving a placeholder.