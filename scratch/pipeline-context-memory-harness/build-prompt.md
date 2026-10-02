# ROLE

You are the BUILD agent for a feature in a live, production React app. You implement the plan below
**completely and correctly**, and you verify your own work by running commands. You do not ask
questions. Where the plan names a value, use it. Where it left a choice, the choice is stated here.

Style: terse, technical, no filler. No emoji. Write code, then run the checks.

---

# NON-NEGOTIABLES (violating any of these = the build is failed)

1. **Ponytail: laziest thing that actually works.** Reuse before adding. **ZERO new npm
   dependencies.** Do not add GSAP, do not add a yaml library, do not add a virtualisation library,
   do not add Radix primitives. `motion` is already installed and is the only animation library.
2. **Never deploy, never restart a service, never push.** The only service restart is a reviewer step.
3. **Do not touch** `data/gate-ledger.jsonl`, `data/read-state.json`, `data/test-ledger.jsonl`,
   `~/.hermes/hermes-agent`, `~/.hermes/config.yaml`, or any file outside this repo except READ-only
   reads of the paths listed under DATA SOURCES.
4. **Never read** `~/.hermes/.env` or `~/.config/astra-webui/env`. Never log an env value.
5. **Never type or request the app password.** Minting a session cookie via `POST /api/login` on
   `127.0.0.1:3011` is the sanctioned mechanism.
6. **Zero fake data.** No `?? 0`, no invented defaults, no placeholder rows, no optimistic values. An
   unreachable source renders its error state.
7. **Zero hardcoded hex colours** in new code. Use only `@theme` tokens and `color-mix()` derivatives.
   Verify with: `rg '#[0-9a-fA-F]{3,8}' src/components/{context,memory,harness}-page.tsx src/components/ops/ src/lib/ops-*.ts` must return nothing.
8. **Vendor files land byte-for-byte.** Write them with python `open(path,"w").write(content)` from the
   registry JSON, never by retyping. Brand values go on call-site props, never inside the vendor file.
9. **The pages are read-only.** No enable/disable/toggle controls in v1. No writes anywhere.
10. Leave the runnable check `server/sysinfo.check.mjs` behind and make it pass.

---

# REPO

- `/home/notjitin/Work/projects/astra-webui` — Vite 8 + React 19 + TS 6 + Tailwind v4 + shadcn
  `new-york`. npm. Node modules installed.
- Service: `systemd --user` `astra-webui.service` on `127.0.0.1:3011`, public `https://test.jitinnair.com`.
- Build: `npm run build` (`tsc -b && vite build`).
- **TRAP:** a terminal call that mixes `npm run build` with other commands gets REFUSED as a
  long-lived process and is refused BEFORE executing, so edits in the same call never land. Keep
  mutation and build in SEPARATE calls. If refused, wrap: `timeout 200 npm run build 2>&1 | tail -2`.

## Read these before writing code (they are the patterns you must match)

- `src/components/approvals-page.tsx` — the page scaffold (header, back button, polling, cleanup).
- `src/components/token-tracker.tsx` — live-polling stats page, period switcher, `formatTokens`,
  `formatUSD`, `HARNESS_META`, and the "NO synthetic fallback data" discipline. DO NOT EDIT IT;
  duplicate the ~10 lines of formatters into `src/lib/ops-format.ts`.
- `server/server.mjs` — route registration, the `validToken` cookie gate idiom, the `/api/beacon/`
  proxy idiom (lines ~435-459), and the final `/api/*` JSON-404 fallthrough.
- `server/hermes-proxy.mjs` — **already exports `hermesCookieOrNull()` (line 98) and
  `clearHermesCookie()` (line 106). IMPORT AND REUSE THEM. Do not write a second Hermes login.**
- `server/read-state.check.mjs` — the plain-node `node:assert` self-check convention (no framework).
- `server/training.mjs` — the `process.env.ASTRA_HERMES_URL || "http://127.0.0.1:9119"` precedent.
- `src/index.css` — the `@theme` token block (~lines 31-45) and the `color-mix` / `rgb(var(--c-N) / a)`
  idioms. Use those. `src/lib/theme-store.ts` — palette runtime.
- `src/App.tsx` — nav wiring (658 lines; edit points listed in S1).
- `references/*.md` in this repo — load-bearing pitfalls (authed QA, decorative CSS, theme a11y).

---

# DATA SOURCES — read-only, all verified live

## Through the reused Hermes cookie, server-side (base `http://127.0.0.1:9119`)

| Path | Shape |
|---|---|
| `/api/skills` | `[{ name, description, category, enabled: boolean, usage: number, provenance: "agent" }]` — **503 rows, 503 enabled, 405 with usage 0.** `usage` is the call count. |
| `/api/mcp/servers` | `{ servers: [{ name, transport:"stdio", url, command, args, env, auth, enabled, tools: number[] \| null, source:"config", plugin: null }] }` — **71 rows, 53 enabled, 18 disabled, 61 with `tools: null`, 3 with non-empty `env`.** Env values arrive pre-redacted. |
| `/api/dashboard/plugins` | `[{ name, label, description, icon, version, tab, slots: [], entry, css, has_api, source }]` |
| `/api/memory` | `{ active: "holographic", providers: [{ name, description, available, configured, status:"ready", setup: { pip_dependencies, external_dependencies, required_env, dependencies_installed } }] }` |
| `/api/tools/toolsets` | `[{ name, label, description, platform, platform_label, enabled, available, configured, tools: [] }]` |

## Loopback HTTP

| Port | Path | Verified |
|---|---|---|
| 8787 | `/health` | `{ service:"headroom-proxy", status:"healthy", ready:true, version:"0.37.0", timestamp, uptime_seconds, checks:{ startup, http_client, cache, rate_limiter, memory, upstream } }` — each sub-check is `{ enabled, ready, status, error }` |
| 8788 | `/api/stats` | `{ tracker_version, timestamp_utc, summary_rows_30d: [], latest_20_records: [], optimization_status: { headroom_version, proxy_healthy, mode:"cache", requests_30d: 80, compression_ratio_pct: 3.9, tokens_saved_30d: 241026, cost_saved_usd: 707.90, cost_saved_breakdown_usd:{ compression, cache_read }, input_cost_paid_usd: 732.21, cache_read_share_pct: 107.7, agent_breakdown: [{ agent, label, requests, models, providers, tokens_saved, savings_percent }] } }` |
| 8789 | `/api/status` | `{ capture_last_run, pricing_last_run, derive_last_run }` (epoch seconds) |
| 8789 | `/api/summary?days=N` | **VERIFIED 200.** Drives the Context period switcher. |
| 1933 | `/health` | `{ status:"ok", healthy:true, version:"0.4.21", auth_mode:"dev" }` |
| 1934 | `/health` | ovgate (memory-write gate, 1934→1933) |
| 8015 | `/health` | **HTTP 401 `{"error":"unauthorized"}` = `auth-gated`, NOT down.** Never retry, never follow a redirect on it. `laya-proxy` on 8016 injects the bearer for other clients. |
| 11434 | `/api/tags` | `{ models: [...] }` — backs OpenViking embeddings + tool-router dense vectors |

## Filesystem (server-side reads only)

- `~/.hermes/config.yaml` — emit only `compression.*` (14 keys), `prompt_caching.cache_ttl`,
  `streaming.enabled`, `agent.base_url`, `memory.provider`. Values drift; never hardcode.
- `~/.hermes/context_length_cache.yaml` — `{ context_lengths: { "model@endpoint": N } }`.
- `~/.hermes/memories/MEMORY.md` — **2163 bytes / 2128 chars, 4 entries, 2163/2200 = 98.3%.**
- `~/.hermes/memories/USER.md` — **1809 bytes / 11 entries, 1809/1375 = 131.6% — OVER BUDGET.**
  **The entry separator is `§`, verified.** Splitting on `\n\n` is WRONG (gives 1 block for MEMORY.md).
  Budgets: `MEMORY_BUDGET_CHARS = 2200`, `USER_BUDGET_CHARS = 1375` — declare as named constants with
  a comment that they mirror the Hermes memory tool's own limits. Report `chars` as the **character**
  count (2128 / 1809-equivalent) and ALSO surface bytes; never clamp `usage_pct`.
  `.lock` siblings exist — existence only; treat an mtime under 60 s as "locked by an active session".
- `~/.tool-router/index.json` — `{ version, built_at, cwd, items, stats }` (363 KB — parse, never ship raw).
- `~/.tool-router/index.dense.meta.json`, `~/.tool-router/config.json`
  (`{ laya_rerank:{timeout_s}, mcp_hints:{...} }`), `~/.tool-router/breaker-{laya,ollama,rewriter}.json`.
  **DO NOT read `gaps.json` (186 KB, not required).**
- `~/.hermes/skills/**/SKILL.md` — **517 files on disk vs 503 in the catalogue. Report the delta.**
- `~/.hermes/plugins/` — 28 directories.
- `~/.hermes/hooks/` — hook files.
- `systemctl --user list-units --type=service` — filter to `/^(headroom|laya|openviking|ovgate|hermes|astra|taal|graphify|penpot|neutrinos|ollama)/`.
- `~/.local/bin/leanctx` — **`--version` is NOT a valid flag** (it errors with a bench usage message).
  Use `execFile(leanctx, ["bench","list"])` and parse, with a `pip show leanctx` fallback, else
  `degraded` with reason "version probe inconclusive".
- `~/Work/openviking/.venv/bin/ov` — `--version`.

---

# PLAN

## S1 — `src/App.tsx`, six edit points

1. Declare `type View = 'chat'|'files'|'tracker'|'config'|'approvals'|'vault'|'context'|'memory'|'harness'`
   ONCE above `Shell`, then replace the four inline union literals: the `parsePath()` return (L271),
   the `useState` generic (L282), the `Sidebar` `activeView` prop type (L389), and
   `TITLES: Record<typeof view, string>` (L294).
2. `parsePath()`: add `if (p === "/context") return { view: "context", sessionId: null };` plus the
   same for `/memory` and `/harness`, BEFORE the `/c/…` match.
3. `TITLES` += `context: "Context — Astra"`, `memory: "Memory — Astra"`, `harness: "Harness — Astra"`.
4. Add three `else if` pushState branches mirroring L295-299.
5. `Sidebar` groups `Configure` array (L468-475): insert after `Vault`:
   `{ name: "Context", icon: <Gauge className="h-4 w-4" strokeWidth={1.5} />, onClick: () => { onOpenContext?.(); } }`,
   `{ name: "Memory", icon: <Brain className="h-4 w-4" strokeWidth={1.5} />, onClick: () => { onOpenMemory?.(); } }`,
   `{ name: "Harness", icon: <Terminal className="h-4 w-4" strokeWidth={1.5} />, onClick: () => { onOpenHarness?.(); } }`.
   **Verified:** `Gauge`, `Brain`, `Terminal` all resolve from `lucide-react@1.46` (so are `Boxes`,
   `FileClock`, `Layers`). Add the imports. Pass `onOpenContext/onOpenMemory/onOpenHarness` as
   optional props using the existing `onOpenConfig` optionality pattern.
6. Active-row mapping (L596-602) += the three `item.name === … ? activeView === … :` branches, and
   `Shell` renders `{view === 'context' && <ContextPage onBack={() => setView('chat')} />}` etc.
   beside L375-383.
   **TRAP:** do NOT add a `@ts-ignore` to the active mapping chain. If TS2367 appears, the narrowing is
   telling you the truth — route the comparison through a module-scope helper function (a function
   parameter is not narrowed at the call site, unlike a local `const`). This is a documented repo law.

## S2 — `server/sysinfo.mjs` (NEW)

- Module-level `TTLCache` + `export async function handleSysinfo(req, res, path)` switching on
  `/api/sysinfo/context|memory|harness`; unknown sub-path → 404 `{"error":"not found"}`.
- Upstream reads via `import { hermesCookieOrNull, clearHermesCookie } from "./hermes-proxy.mjs";`
  and `const HERMES_URL = process.env.ASTRA_HERMES_URL || "http://127.0.0.1:9119";`.
  `fetchUpstream(apiPath)` = GET with `Cookie: await hermesCookieOrNull()`; on 401 →
  `clearHermesCookie()` then exactly ONE retry; on transport error → `{ status:"unreachable", reason }`.
  **TRAP: never use global `fetch()` — the server is zero-dependency `node:http`. Use
  `request()` from `node:http` exactly like the `/api/beacon/` block.**
- Exports the pure helpers so `sysinfo.check.mjs` can import them: `classifyHttpStatus`,
  `raceTimeout`, `classifySkill`, `classifyToolset`, `rankSkills`, `reconcileSkills`, `parseFlatYaml`,
  `parseMemoryStore`.
- Zero new dependencies: `node:http`, `node:fs`, `node:child_process`, `node:util`, `node:path` only.

## S3 — bounded concurrency

`export async function raceTimeout(ms, label, promiseFn)` → `{ok:true, value}` | `{ok:false, error}`.
Every probe wrapped; the aggregator runs `Promise.allSettled` so a rejection is impossible by
construction. Per-source timeout **2500 ms** (the slowest legitimate source, tracker `/api/stats` over a
cold SQLite, answers in ~300 ms; 8× headroom, worst case under one poll interval). Subprocess probes
additionally get `execFile` `timeout: 3000`. **TRAP: `Promise.race` alone leaks the loser — the
`finally { clearTimeout(t) }` and `req.destroy()` in the http helper are what stop the socket
leaking. A 517-file scan plus 5 subprocesses in the same process as the whole app makes leaked
sockets a real problem.**

## S4 — `src/components/ops/status.tsx` (NEW)

```ts
export const STATUS_META: Record<OpsStatus, { label: string; dot: string; text: string }> = {
  "healthy":     { label: "Healthy",     dot: "bg-violetx",  text: "text-violetx" },
  "degraded":    { label: "Degraded",    dot: "bg-fuchsiax", text: "text-fuchsiax" },
  "auth-gated":  { label: "Auth-gated",  dot: "bg-cyanx",    text: "text-cyanx" },
  "unreachable": { label: "Unreachable", dot: "bg-redx",     text: "text-redx" },
  "disabled":    { label: "Disabled",    dot: "bg-muted",    text: "text-muted" },
  "inactive":    { label: "Inactive",    dot: "bg-muted",    text: "text-muted" },
};
```
**`violetx` IS the brand green (`#34d399`) despite its name — commit 57a7190 retinted it.** Do not
"correct" it to purple.
`StatusDot` = `h-2 w-2 rounded-full` (8px, the only legal circle), `aria-hidden`, **always paired
with a visible text label** so colour is never the sole signal (WCAG 1.4.1). Do NOT branch the dot
colour on dark/light — the palette registry swaps the token values and both modes are WCAG-audited.
Also export `StatusRow`, `StatTile`, and `OpsPageShell` (the approvals-page header/scroll scaffold,
shared by all three pages rather than copied three times).

## S5 — polling hook, `src/components/ops/use-ops-poll.ts` (NEW)

`useOpsPoll<T>(url, intervalMs)` → `{ data, error, refresh }`. One effect: initial fetch,
`setInterval`, plus a `visibilitychange` listener that clears/rearms the timer and refetches on
`-> visible`. Cleanup clears both (approvals-page L21-35 shape). Intervals: **context 5000, memory
5000, harness 30000**. Dependency is the `url`, so a period switch re-arms cleanly. Keep an `alive`
flag so a late fetch after unmount cannot `setState`.

## S6 — no fake data

Every section: `data?.x?.status === "unreachable" ? <ErrorRow reason/> : …`. No `?? 0`, no `|| 5`.
Loading uses the skeleton idiom from approvals-page L61-63. Copy the token-tracker header comment
into each page file:
`/* NO synthetic fallback data: if a source is unreachable we render the error, not invented rows. */`

## S7 — secrets

MCP `env` is reduced server-side to `has_env: Object.keys(env || {}).length > 0`; values are dropped,
never logged. Do not `console.log` a whole upstream payload. Do not import or read any `.env`.

## S8 — theme

Section cards: `rounded-2xl border border-white/[0.08] bg-midnight/50` (token-tracker idiom).
Page root: `bg-void text-brandtext`. Heading: `className="h-5 w-5 text-cyanx"` + `font-display`.
Tints only via `color-mix(in oklab, var(--color-cyanx) N%, transparent)`.
**TRAP: do NOT use `text-slate-*` (old pages have it); new code uses `text-muted` / `text-brandtext`
so the palettes actually swap.**

## S9 — vendor, byte-for-byte

`curl -s https://magicui.design/r/number-ticker.json` then
`python3 -c 'import json;d=json.load(open("/tmp/nt.json"));open("src/components/ui/number-ticker.tsx","w").write(d["files"][0]["content"])'`
(`web_extract` strips JSX and mangles `ReturnType<typeof setTimeout>` — do not use it).
Its only dependency is `motion`, already installed. `dependencies: ["motion"]`, no registryDependencies.
Justification: C8 mandates animated counters; the vendor file is ~70 lines of pure `motion/react`, so
hand-rolling `useSpring`+`useInView` would reproduce it. Brand values on the call site only
(`className="text-brandtext text-2xl"` overrides the vendor's own `text-black dark:text-white`).
Verify byte-identity with `md5sum` against a re-fetch.

**Searched and NOT found — do not re-search:** no in-repo animated counter
(`useSpring|useMotionValue|animate(` across `src/**/*.tsx` hits only `theme-toggle.tsx`'s WAAPI
`document.documentElement.animate`); no stat-tile/chart primitive in the local shadcn set;
Magic UI `animated-list`/`marquee`/`dot-pattern` rejected (no requirement needs them, and the theme
engine already owns grounds); `@radix-ui/react-tabs|accordion|progress` deliberately NOT installed —
the tab strip is the existing segmented-control idiom (`role="tablist"` buttons as in
token-tracker.tsx L205-217), lists are native elements, disclosure is plain conditional render.

## S10 — accessibility

Real `<button>` for every interactive control. `focus-visible:outline focus-visible:outline-2
focus-visible:outline-cyanx/60` on every button/input (sidebar L550 idiom). Tabular data (MCPs,
plugins, runtimes) is a real `<table>` with `<th scope="col">`; other lists are `<ul>`/`<li>`.
A `<p aria-live="polite">` health summary at the top of each page. The filter input is
`<label>`-bound. 44px touch targets on touch-primary controls. Every animation gated behind
`useReducedMotion()` from `motion/react` and/or `motion-reduce:` classes.

## S11 — `server/sysinfo.check.mjs` (NEW)

Plain node + `node:assert`, **no test framework** (the `read-state.check.mjs` convention). Deterministic:
no fs, no network. Cover:
- `classifyHttpStatus` — 2xx→healthy, 401→auth-gated, 403→auth-gated, 5xx→degraded, ECONNREFUSED→unreachable.
- the degradation path — `raceTimeout(50, …)` against a never-resolving promise resolves `{ok:false}`
  in ~50 ms, not never.
- `classifySkill` — precedence inactive > unused > outdated > healthy; **180-day boundary: exactly 180 is NOT outdated**.
- `rankSkills` — usage descending, name tiebreak.
- `reconcileSkills` — catalog_only/disk_only/both on a fixture.
- `parseFlatYaml` — nested block, **quoted scalar stays a string** (`cache_ttl: "1h"` must not become
  `1h`→`1`), bool/int coercion.
- `parseMemoryStore` — `§` separator, uncapped `usage_pct`, `over_budget` true when over.
- a status-vocabulary validator over every emitted fixture row.
Print `sysinfo.check: ALL PASS (classifier, timeout, ranking, reconcile, yaml, memory, vocab)`, exit 0.

## C1 — Context page, section "Headroom Proxy"

GET 8787 `/health`. Render version, `uptime_seconds` as `Xd Yh Zm`, `ready`, and one `StatusRow` per
`checks.{startup,http_client,cache,rate_limiter,memory,upstream}` with that sub-check's own
`status`/`error`. Page-level status = all sub-checks ready ? healthy : degraded.
**TRAP: read only the leaf fields (`enabled`/`ready`/`status`/`error`) — never echo the nested objects.**

## C2 — section "Token Optimization"

Pass `optimization_status` through verbatim. Render mode, requests_30d, compression_ratio_pct,
tokens_saved_30d, cost_saved_usd + `cost_saved_breakdown_usd`, input_cost_paid_usd,
cache_read_share_pct, and `agent_breakdown` as rows.
Honesty rails: the payload pins `aggregate_row_reliable: false` and `leanctx_flag:
"hardcoded-not-measured"`. Summary tiles compute totals from `agent_breakdown` ONLY and carry the
caption "aggregate summary row is known-broken ($0.00 / 0 output) — per-agent rows are authoritative".
leanctx row is captioned "installed (flag is hardcoded in the collector, not measured)".
Any token-shift mention renders "unavailable (enterprise SaaS)".
**TRAP: `cache_read_share_pct` can exceed 100 (107.7 observed is real). Render raw. No clamping.**

## C3 — section "Context Config (live)"

`parseFlatYaml(readFileSync(config.yaml))` → emit only `compression.*`, `prompt_caching.cache_ttl`,
`streaming.enabled`, `agent.base_url`, `memory.provider` as key/value rows. Plus
`context_length_cache.yaml` count + first 5 samples. **A missing key renders "not set", never a default.**

## C4 — section "Tool Router"

`index.json` `stats` as rows; `built_at` → age ("rebuilt 3h ago"); dense meta passthrough;
`config.json` `laya_rerank.timeout_s` and `mcp_hints_count` (COUNT ONLY — hint values may name env keys);
`breaker-*.json` → `{name, state, age_s}`. Status: any breaker open → degraded, else healthy.

## C5 — laya 8015

401 → `status: "auth-gated"`, reason "service up, bearer-gated (laya-proxy on 8016 injects it for
clients)". Rendered as a normal healthy-adjacent row. **Never red, never retried.**

## C6 — leanctx / ollama / tokenbeacon

leanctx: `execFile("~/.local/bin/leanctx", ["bench","list"])` 3000 ms → parse version, else `pip show
leanctx` fallback, else `degraded`. **`--version` is never called.** ollama: 11434 `/api/tags` →
`models_count`. tokenbeacon: 8789 `/api/status` → three age tiles as `Ns/Nm/Nh ago`.

## C7 — section "Toolsets"

`classifyToolset(t)`: `!enabled` → disabled; enabled && !available → inactive; enabled && available
&& !configured → degraded; else healthy. Render label, platform_label, tools_count (0 is real, show 0).

## C8 — stat tiles + period switcher

Four `StatTile`s — Requests 30d, Tokens saved 30d, Cost saved USD, Compression % — using
`<NumberTicker>` behind a `useReducedMotion()` gate (render the plain formatted number when reduced).
All four labelled "30d". The period switcher (Today / 7 days / 30 days) is the segmented
`role="tablist"` idiom from token-tracker.tsx L205-217 and drives a separate "Usage by window" table
fetched from `/api/beacon/summary?days=N` (VERIFIED 200). Add the note "tracker optimization fields are
30-day fixed; windowed rows come from tokenbeacon".
**TRAP: do NOT re-point the four tiles at the windowed numbers — that would be fabrication.**

## M1 — Memory page, section "Providers"

Rows from `/api/memory`. Per row: available/configured/status chip, `setup.dependencies_installed`,
and `missing` = names from non-empty pip/external/required_env (**names only — never values**).
Active provider gets a `bg-cyanx/10 text-cyanx` badge. **TRAP: `setup` can be absent — optional-chain.**

## M2 — section "Memory Stores"

`parseMemoryStore(file, budget)`: `entries = content.split("§").map(s=>s.trim()).filter(Boolean).length`,
`chars` = char count, `bytes` = byte count, `usage_pct = chars/budget*100` (UNCAPPED, 1 dp),
`over_budget = chars > budget`, `mtime` from statSync.
UI: a card per store with entries, chars/budget, and a budget bar whose FILL width is
`min(100, usage_pct)%` while the NUMBER beside it shows the true value. Over 100% renders the number
in `text-redx` plus an "over budget" tag. **USER.md is 131.6% — a real, expected state.**
`.lock` sibling with mtime < 60 s → "locked by an active session". **No entry bodies in the payload.**

## M3 — section "Holographic fact store"

No fact-count endpoint is exposed by any reachable service. Render `status: "unavailable"` with reason
"no count endpoint exposed" as a muted row — **never a number, never an estimate.** Render the declared
capability chips (`search, probe, related, reason, contradict, update, remove, list`) captioned
"declared capability set".

## M4 — OpenViking + ovgate

1933 `/health` → version, auth_mode, healthy. **ovgate is its OWN row:** 1934 `/health`; 200 +
`status:"ok"` → healthy; any other HTTP response → degraded with the code; conn error → unreachable.
Caption: "sits in the memory-write path (1934→1933)".

## M5 — ollama + ov CLI

ollama row captioned "embedding backend for OpenViking + tool-router dense vectors".
`ov`: `statSync` + `execFile("~/Work/openviking/.venv/bin/ov", ["--version"])` 3000 ms.

## M6 — section "Compaction Survivability"

Fresh re-read of the compression block + `prompt_caching.cache_ttl` as key/value rows (shared parser,
NOT a copy of the Context payload) with the note "live usage impact: see Context → Token Optimization".

## H1 — Harness page, section "Skills" (headline)

Server: `catalog = fetchUpstream("/api/skills")`; `disk = scanSkills("~/.hermes/skills")` — recursive
`readdir(…, {withFileTypes:true})` collecting `*/SKILL.md` → `{name: parentDirName, mtimeMs, category}`.
`reconcileSkills` joins case-insensitively on name → `{...catalogFields, on_disk, in_catalog, age_days}`.
Classification precedence: **inactive** (`enabled===false`) → **unused** (`usage===0`) → **outdated**
(`age_days > 180`) → healthy. Threshold **180 days**, justified: the fleet re-syncs on harness updates
roughly quarterly, so two quarters untouched is worth a look — and it is an AGE statement, not a
verdict. UI copy: "untouched for 184d".
UI: four summary chips (total / enabled / disabled / unused) + a reconciliation line reporting BOTH
counts and all four deltas (e.g. "catalogue 503 · disk 517 · both … · catalog-only … · disk-only …").
Top-10 by usage shown prominently, then the filterable full list.
Neutral copy for unused: "0 recorded calls — retirement candidate".
**TRAP: `usage` may be undefined on a row — treat as 0 for RANKING but display "—", never "0".**

## H2 — section "MCP servers"

Columns: name, transport, `command || url`, source, plugin, enabled (read-only chip), tools column,
has_env. **Tools column: `tools_probed ? tools_count : <span className="text-muted">not probed</span>` —
`null` is NEVER rendered as 0.** `has_env` is a lock glyph + "env" tag, values never rendered.
Row status: `!enabled` → disabled, else healthy (**v1 does not test connections**).
Section footer notes the future wiring points: `PUT /api/hx/skills/toggle`,
`PUT /api/hx/mcp/servers/{name}/enabled`, `POST /api/hx/mcp/servers/{name}/test` — display-only in v1.

## H3 — section "Plugins"

label, version, tab, slots_count, entry/css as mono paths, has_api chip, source. Cross-reference
`readdir("~/.hermes/plugins")` (28 dirs) → list `disk_only` names under "on disk but not registered".

## H4 — section "Hooks & scripts"

`readdir("~/.hermes/hooks")` → `{name, path, mtime, size_bytes, purpose}` where purpose is the first
`#` comment or the shebang-following description line from the first 2 KB. Read-only, never executed.
Empty dir → honest empty state.

## H5 — section "Toolsets"

Same source and `classifyToolset` as C7 (shared function), with tool counts.

## H6 — section "Harness runtimes"

Probe the deduped binary set from `HARNESS_BINARIES` in `src/lib/harness-agents.ts`
(claude, opencode, agy, codex, gemini — the antigravity→agy alias must be deduped). The server cannot
import TS, so hardcode the deduped list server-side with a comment naming
`src/lib/harness-agents.ts` as the source of truth.
`execFile(bin, ["--version"], {timeout:3000})`: success + parsed version → healthy; ENOENT →
unreachable "not installed"; exists but the probe fails (bad flag) → retry once with `["-v"]`, else
degraded "present, version probe failed".
Plus a "User services" sub-list from `systemctl --user list-units --type=service --no-legend`,
filtered by the fleet regex, non-active units first.
**TRAPS: never `shell:true` on execFile; never probe with a bare `run` (a CLI would hang on stdin).**

## H7 — filter bar

Pinned at the top of the scroll area: one `<input type="search">` matching name/description/category/
command/url (case-insensitive substring) + status chips All · healthy · inactive · unused · outdated ·
unreachable · disabled. Filtering is client-side over the payload. The skills list renders the first
**150** matched rows with a "Show 150 more" button and a persistent "showing N of M" line, captioned
"capped render list". 150 ≈ 6 screenfuls, keeps the DOM under ~2k nodes with no virtualisation dep.
MCP/plugin/hook lists render in full.

## H8 — tile row

`NumberTicker` tiles (reduced-motion-gated): Skills, MCPs, Plugins, Hooks, Toolsets totals, plus
"needs attention" = client-side count of rows whose status ∉ {healthy, auth-gated}, across all sections.
`<p aria-live="polite">` health summary under the tiles.

## 6. Data-truth rules — these are hard requirements, not style

1. Tracker aggregate row: `$0.00` + zero output tokens is a KNOWN DEFECT. Per-agent rows are
   authoritative; aggregate tiles are computed from them and carry the "aggregate row known-broken"
   caption. Payload pins `aggregate_row_reliable: false`.
2. leanctx "installed": hardcoded in `token-tracker-collector.py`, not measured. Version comes only
   from the working probe.
3. TokenShift: enterprise SaaS, not running. Renders "unavailable (enterprise SaaS)". Never implied working.
4. MCP `tools: null` → "not probed", never "0 tools". `tools_count` is `number | null` end to end.
5. laya 401 → `auth-gated`, healthy-adjacent colour, with reason text. Never red.
6. Memory budget >100%: the NUMBER is never clamped; the BAR clamps. `over budget` tag in `text-redx`.
7. Fact-store count / trust tiers → `unavailable` with reason. No number, no estimate.
8. `cache_read_share_pct` >100 → raw passthrough.
9. Skill catalog↔disk delta → both counts + all four reconciliation numbers. Never silently prefer one.
10. Missing `usage` → ranked as unknown, displayed "—".
11. ovgate non-200 → degraded with the HTTP code, not healthy.
12. Never `console.log` an upstream payload wholesale.

## 8. Top 3 risks — build defensively against all three

1. **Probe stampede / event-loop smear.** The harness aggregate = dashboard catalogue + a 517-file scan
   + 5 subprocesses + systemctl, in the SAME process as the whole app. Multiple tabs polling 30 s could
   stack runs and make every page sluggish. Mitigation: 25 s server cache + **single-flight in-flight
   promise dedup** + 2500 ms per-source race + `execFile` timeouts + timer cleanup in `raceTimeout`.
2. **Upstream dashboard login dependency.** Catalogue reads ride `hermesCookieOrNull()`. If the Hermes
   cookie is unavailable or 9119 is down, skills/MCP/plugins/memory sections degrade while the rest of
   the page renders. Mitigation: exactly one retry after `clearHermesCookie()` (matching existing proxy
   behaviour), per-section degradation, reason surfaced verbatim. **Never a page-level error.**
3. **Mini-YAML parser drift.** `config.yaml` is parsed by a hand-rolled two-level reader (a yaml lib is
   forbidden). If a future config reshapes nesting, keys could be silently dropped and the UI would show
   a setting as absent when grep finds it. Mitigation: emit ONLY positively-matched keys, pin behaviour
   in the check file against a fixture with quoted scalars + bools + int, label the section
   "read live from ~/.hermes/config.yaml (subset)", and render a miss as "not set".

---

# REQUIRED OUTPUT / DELIVERABLES

1. `server/sysinfo.mjs` (new)
2. `server/sysinfo.check.mjs` (new, must pass)
3. `server/server.mjs` (edit: import + one route block before the `/api/*` 404 fallthrough, after the
   `/api/beacon/` block ~L460):
```js
if (path.startsWith("/api/sysinfo/")) {
  const cookies = {};
  (req.headers.cookie || "").split(";").forEach((c) => { const i = c.indexOf("="); if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim(); });
  if (!validToken(cookies[COOKIE])) { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":"unauthenticated"}'); }
  try { return await handleSysinfo(req, res, path); }
  catch (err) { console.error("[sysinfo]", err?.message || err); if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end('{"error":"sysinfo failed"}'); } }
}
```
4. `src/lib/ops-types.ts`, `src/lib/ops-format.ts` (new)
5. `src/components/ops/status.tsx`, `src/components/ops/use-ops-poll.ts` (new)
6. `src/components/context-page.tsx`, `memory-page.tsx`, `harness-page.tsx` (new)
7. `src/components/ui/number-ticker.tsx` (vendor, byte-for-byte)
8. `src/App.tsx` (edit)
9. `scripts/ops-pages.dom.check.mjs` (new, Playwright DOM live-fire check)

---

# VERIFY YOUR OWN WORK — run these, in order, and report the REAL output

Do NOT restart the service and do NOT deploy. Everything below runs against the source tree or the
already-running service without touching it.

```bash
cd /home/notjitin/Work/projects/astra-webui

# 1. pure-logic check — MUST print the ALL PASS line, exit 0
node server/sysinfo.check.mjs

# 2. syntax-check the new server modules before anything else loads them
node --check server/sysinfo.mjs && node --check server/sysinfo.check.mjs

# 3. vendor byte-identity (must produce two identical hashes)
curl -s https://magicui.design/r/number-ticker.json -o /tmp/nt.json
python3 -c 'import json;d=json.load(open("/tmp/nt.json"));open("/tmp/nt-expected.tsx","w").write(d["files"][0]["content"])'
md5sum /tmp/nt-expected.tsx src/components/ui/number-ticker.tsx

# 4. zero hardcoded hex in new code — MUST return nothing
rg '#[0-9a-fA-F]{3,8}' src/components/context-page.tsx src/components/memory-page.tsx \
   src/components/harness-page.tsx src/components/ops/ src/lib/ops-types.ts src/lib/ops-format.ts

# 5. package.json untouched by dependency drift — MUST show no gsap / yaml / react-window
git diff --stat package.json package-lock.json

# 6. typecheck + bundle (SEPARATE call from any file mutation)
timeout 200 npm run build 2>&1 | tail -5

# 7. prove the aggregators work against the LIVE services, without touching the service.
#    Import the module and call the builders directly — they are plain node.
node --input-type=module -e '
  import("./server/sysinfo.mjs").then(async (m) => {
    console.log("exports:", Object.keys(m).join(", "));
  }).catch(e => { console.error("IMPORT FAIL", e.message); process.exit(1); });'
```

**MANDATORY honesty rule:** if a check fails, say so with the real output and either fix it or report it
as failed. Never claim a check passed that you did not run. Never fabricate command output.

# WHEN DONE, REPORT

- Files created / edited, with line counts.
- The real output of `node server/sysinfo.check.mjs`.
- The real output of `npm run build` (exit status).
- The md5 comparison for the vendor file.
- The hex-grep result (must be empty).
- Anything you could NOT do, stated plainly.
- Confirmation that `package.json` gained no dependencies and that no service was restarted or deployed.