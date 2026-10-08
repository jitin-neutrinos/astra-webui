# Astra — Architecture

Astra is a **stateless, auth-gated proxy** to a Hermes gateway. The server never
talks to a model provider. All agent state lives in the gateway; Astra is a
surface.

That one decision drives everything below. It is also what makes Astra
portable: point it at any Hermes install and it works, with no fork of Hermes
required.

```
browser (React/Vite SPA, src/)
   │  REST  /api/*
   │  WS    /api/ws?  (+ ?sid= for background subscriptions)
   ▼
server/  (zero-dependency Node, :3011)
   │  proxies, never originates agent state
   ▼
Hermes gateway  (chat, sessions, tools, approvals — all owned there)
```

---

## 1. Backend — `server/`

| File | Lines | Responsibility |
|---|---|---|
| `hermes-proxy.mjs` | 802 | The whole agent-facing surface: REST proxy, WebSocket relay, ticket auth, frame filtering |
| `server.mjs` | 593 | HTTP shell, auth endpoints, static serving, route table |
| `sysinfo.mjs` | 556 | Host facts for the Ops pages (classifier, ranking, timeout) |
| `training.mjs` | 513 | Dump → review → delete lifecycle over the gateway, SQLite (WAL) |
| `vault-seed.mjs` | 354 | Harvests env vars into the vault registry; values encrypted at rest |
| `ntfy-notify.mjs` | 255 | Push emission (banner / panel / lockscreen) |
| `vault.mjs` | 145 | AES-256-GCM vault; key derived by scrypt, never written to disk |
| `last-reply.mjs` | 141 | Last-answer cache per session |
| `read-state.mjs` | 130 | Read markers, monotonic, multi-device |
| `gate-enrich.mjs` | 121 | Enriches gate ledger rows for the UI |
| `transcode.mjs` | 208 | Media transcode with path-safety + deterministic cache keys |
| `command-registry.mjs` | 164 | Slash-command surface |
| `ws-codec.mjs` | 119 | WebSocket frame encode/decode |
| `theme-assets.mjs` / `theme-sync.mjs` | 157 | Theme palette + artwork serving |

Every `*.check.mjs` in `server/` runs under bare Node with no framework.

### Auth model

Constant-time compare on both sides, HMAC-signed expiry token in an
`HttpOnly; Secure; SameSite=Lax` cookie (`astra_session`, 30 days), 8
attempts / 10 min / IP in-memory rate limit. The password itself lives in
`~/.config/astra-webui/env` (mode 0600), **never in the repo**.

Routes: `/api/health`, `/api/login`, `/api/me`, `/api/logout`.

---

## 2. Streaming — WebSocket, not SSE

Astra speaks the gateway's WebSocket protocol and speaks it well. This is the
part that is genuinely ahead of most Hermes front-ends, so the invariants are
written down here.

**Ownership.** The engine is a module singleton (`src/lib/ws-engine.ts`, 923
lines) that lives *outside* React. Nothing a component does — mount, unmount,
StrictMode double-invoke, or the Android WebView being frozen — can tear down
the reconnect brain. React reads state from `ws-store` (zustand) and forwards
frames through a listener list.

**Reconnect.** `nextReconnectDelay(attempt)` — 1s base, ×2 per attempt, 30s
cap, ±15% jitter, retried indefinitely, reset on open. Never gives up.

**Two independent watchdogs**, because they catch different failures:

| Watchdog | Threshold | Action |
|---|---|---|
| Transport liveness | 60s total silence | Recycle the wire (dead socket that still reads OPEN) |
| Turn watchdog | 45s of turn silence | Ask the gateway for truth via a `session.resume` probe, then `finalize` / `stay` / `wait` |

`watchdogAction` never false-kills: a failed probe returns `wait`, never
`finalize`.

**Durable queue.** Prompts typed while offline are flushed on reconnect, and
carry `mode: "resume" | "fresh"` so a reconnect mid-flight continues the right
session instead of starting a new one.

**Segment ops.** The frame → UI contract is 13 typed ops in
`src/lib/chat-segments.ts` (`applySegmentOps`, `finalizeSegments`,
`expandKeyBlocked`, `turnIsRunning`):

```
think  tool  tool-update  tool-done  text  text-final  text-seal
gate  approval  clarify  done  run
```

`text-final` / `text-seal` / `tool-done` are **barriers** — they are what
stop streamed deltas from being double-rendered once the authoritative final
text arrives. Every duplicate-rendering bug traced back to a missing barrier.

**Frame filtering.** `server/ws-filter.mjs` + `request-ownership` guarantee a
frame reaches only the chat it belongs to. This was a real leak: the proxy
used to broadcast every upstream frame to every socket.

---

## 3. Frontend

React 19 + Vite 8 + Tailwind v4, TypeScript strict. Key layout work is in
`chat-timeline.tsx` (renders segments in **strict arrival order** — Thought,
Tool, Text interleave as emitted, never grouped by kind) and
`src/components/canvas/` (the generative-UI block set).

**Generative UI.** Chat renders ```` ```astra-canvas ```` blocks as composed
surfaces: `kpi`, `chart`, `table`, `diagram`, `checklist`, `steps`, `callout`.
Schema and worked examples: `docs/canvas-directive.md`. Invalid blocks degrade
to a plain code block — data is never dropped to make a block work.

**Reactive parser invariants** (M2 session 20261004_124053_693de4, committed
`9918edd`; pinned by RG-070 → `canvas-schema.check.ts`, with the `money()`
string proves living in `canvas-bind.check.ts` under the pre-existing RG-062 pin):

- `kpi.value` resolves with `resolveBinding`, NOT `bindNumber` — `money(...)`
  resolves to a formatted STRING (`"$50.00"`, proven by test); going through `bindNumber`
  strips `$`/`,` and shows a bare number. `bindNumber` is only for `delta`,
  `progress.value` and `visible`.
- Chart series carry their binding AT `points` (no `pointsBind` field) exactly
  where the renderer already looks, and every chart read of `.points` is
  `Array.isArray`-guarded (label derivation, data rows, radar, donut total,
  radial readout, scatter) — a bound series without resolvable points draws
  zeros, it never throws.
- `visible` is accepted on EVERY block: `validateBlock` is a thin wrapper that
  copies a binding `visible` onto whatever `validateBlockInner` returned — no
  per-type case knows about it. `CanvasBlock` is the union intersected once
  with `{ visible?: unknown }` (compiled clean; no per-interface fallback).
- Top-level `state` survives into `spec.state` filtered to scalar values on
  valid identifiers (`^[A-Za-z_][A-Za-z0-9_]{0,63}$`); a stateless card has NO
  `state` key at all (deepEqual with the old shape).
- Control defaults self-seed into the card scope on first render (slider →
  `value ?? min`, select/segmented → `value ?? first option`, toggle →
  `value ?? false`, search → `""`, multiselect → `value ?? []`), so a reader
  like `{"$expr":"seats*2"}` has its value before the user touches anything.
- Any card WITH a control gets its own store; without this, controls on
  stateless cards would share the module-level FALLBACK_STORE across cards
  (one card's slider moving every other card's KPI).
- `canvasStore` records the authored `state` on CREATION, so the first re-parse
  handing the same card a new-but-equal initial object does not reset the
  user's edits.
- `CanvasStore.seed()` also sets `this.frozen = null`. It deliberately bumps no
  version (seeding runs during render, so notifying would be a re-render loop),
  and `snapshot()` caches per version — without dropping the cache a seeded
  control default stays invisible until the next `set()`. This one line is the
  difference between the seed working and silently not working.
- `canvasToMarkdown` prints `(live)` for a binding-valued prop, never
  `[object Object]`, and treats a bound `points` as empty.

**Theming.** Palette engine with realtime device sync over `/api/theme/state`;
accents derive bubbles, glows and buttons via `color-mix`. Nine palettes, all
WCAG-passing in both dark and light.

---

## 4. Native shells

| Platform | Wrapper | Notes |
|---|---|---|
| Windows | Tauri 2 (`src-tauri/`) | Tray, native toasts, `astra://` deep links, auto-updater |
| iOS | Capacitor (`ios/`) | Wrap of the live site, unsigned IPA for sideloading |
| Android | Capacitor + ntfy foreground service (`android/`) | Background push survives the WebView being frozen |

Windows artifacts are built by `windows-build.yml` on a `win-v*` tag; iOS by
`ios-build.yml`.

**Theme → native bridge (2026-10-03, commit `835c619`).** Notifications, the
notification icon accent and the full-screen gate popup follow the ACTIVE web
palette. The web layer (`src/native/shell-theme.ts` → `pushThemeToNative()`)
resolves ten tokens from live computed styles and pushes them through the
`AstraTheme` Capacitor plugin on `astra-theme-change` / `astra-palette-change`
(+ boot + a 5s change-gated tick); the plugin writes `CapacitorStorage` and
starts `NtfyPushService` with `ACTION_THEME_CHANGED`, which re-issues posted
chat cards in place. Native reads through `AstraThemeRead` (stamp-validated
cache); pure token maths lives in `AstraTokenMath`, pinned by
`AstraTokenMathTest` (11 asserts, JVM-run via `./gradlew :app:testDebugUnitTest`
— the file deliberately imports no Android classes).

**Platform ceiling (binding):** since targetSdk 31 Android renders every
notification card from the system template — custom card background from a
palette is unreachable; the accent, icon and the gate popup are the restylable
surface. `NotificationChannel` has no colour setter (only `setLightColor`, the
LED). Therefore the two halves ship separately: the native side rides in the
APK, but `pushThemeToNative()` executes only from the DEPLOYED site build —
delivering an APK without redeploying the site leaves the bridge silent.

---

## 5. Testing — the `*.check.*` convention

**No test framework.** Every check is assert-based and runs under bare Node,
either directly or through a resolve hook.

```bash
npm run check          # every check, parallel
npm run check:serial   # one at a time, for debugging
npm run verify         # lint + build + checks
```

### Per-check runs (the M3 diagram session, 20261004_125622_f5774c)

A work order in an isolated worktree sometimes enumerates SINGLE checks instead
of the full parallel run — the exact command that works:

```bash
# from the repo/worktree root; ts-resolve needs CWD-relative ./scripts
node --import ./scripts/ts-resolve.mjs src/lib/<name>.check.ts
# tabulate the pass/fail pair without reading the whole TAP stream:
node --import ./scripts/ts-resolve.mjs src/lib/$n.check.ts 2>&1 \
  | grep -E "^# (pass|fail)"
```

Note `node:test` (not `node --test`): `diagram-layout.check.ts` imports
`{ test }` from `node:test` and node:type-strips it — no separate test runner
invocation needed, but it DID surface node's factory-reset `# Subtest:` blocks
in the output (harmless, grep past them).

### Why `scripts/ts-resolve.mjs` exists

Node type-strips `.ts` but does **not** resolve extensionless relative
specifiers — it follows NodeNext rules where `./x` must exist on disk. Vite and
esbuild accept both, so app source is written extensionless. The result: any
check that transitively imported a non-check module could not run at all.

`scripts/ts-resolve-hooks.mjs` is a resolve hook that retries a failed relative
resolve against `.ts` / `.tsx` / `/index.ts`. It is dev-only, never bundled,
and leaves app behaviour untouched. **22 of 50 checks were dead before it.**

Two subtleties it handles, both of which produced false test failures while
being written:

- The extension must be inserted **before** any `?query`, so a cache-busting
  import (`./notify?legacy-shape`) becomes `./notify.ts?legacy-shape`.
- Candidates must be built against `ctx.parentURL` directly. Round-tripping
  through `url.origin` throws `ERR_INVALID_URL` once the parent is itself a
  `.ts` file URL (whose origin is `"null"`).

### Headless render probes (canvas, no browser)

`*.check.*` covers the pure canvas modules only — the React half of a canvas
card (KPI resolution, progress bars, the `Blocks()` seed loop, chart guards) has
no DOM gate. Prove it without a browser with `tsx` + `react-dom/server`
(proven in the M2 reactive-parser session, 20261004_124053_693de4):

```bash
# from the worktree root (tsx needs node_modules reachable from the probe)
npx tsx <probe>.mts
```

Three non-obvious requirements, each of which failed first:

- **tsx compiles JSX with the CLASSIC runtime**, so `React` must exist as a
  global before the component modules load, or you get
  `ReferenceError: React is not defined` at the first `<Ctx.Provider>`. Set
  `globalThis.React = React` at the top and use **dynamic `await import()`** for
  the `.tsx` modules (static imports are hoisted and run first).
- **A probe file outside the repo cannot resolve bare `react`** —
  `ERR_MODULE_NOT_FOUND`. Import it by absolute path into the worktree's
  `node_modules/react/index.js` (and `react-dom/server.js`).
- **A probe that imports an absolute path into the PRIMARY checkout measures the
  wrong tree.** The PM's `pm-probe-*.mts` under `~/Work/scratch/` hardcode
  `/home/notjitin/Work/projects/astra-webui/src/...`, so in an isolated git
  worktree they keep reporting the old behaviour no matter what the worktree
  contains (verified: distinct inodes, `git worktree list` shows both). Copy the
  probe into the scratch dir with ONLY the import repointed at the worktree, run
  both, and report that the verbatim gate is unpassable rather than editing the
  PM's file or the primary checkout.

`renderToStaticMarkup` output shows KPI/progress values pre-animation —
`CountUp` renders a zero-placeholder frame (`200` → `"000"`), so only a
non-numeric resolved string (`"$250,000"`) proves the value path; a formatted
`money()` string appearing verbatim in the markup IS the assertion.

### Regression gate

`scripts/regression-gate.check.mjs` is the permanent pin. Each row names a bug
that actually shipped, the check that guards it, and the date it was found. It
enforces three things:

1. Every guarded check **exists** — a pinned bug cannot lose its pin.
2. Every `*.check.*` in the repo **is** in the manifest — a new check cannot
   escape unpinned.
3. Every guarded check that can run here **passes now** — a pinned bug that
   regresses fails the gate.

Current state: **72 pinned bugs, 66 re-run live, 68 checks discovered**
(2026-10-04, M2 reactive-parser session 20261004_124053_693de4 — the numbers
from the last live run, printed by the gate itself; the M2 sessions proved
per-check runs and RAN the gate standalone with `timeout 560`). Ground truth
has always been the gate run itself — count it live:
`node scripts/regression-gate.check.mjs` prints `N pinned bugs, M re-run live,
K checks discovered`. The route it cites for failures includes pre-existing
rows (`RG-053: guarding check is missing — scripts/ops-pages.dom.check.mjs`
and the training-pipeline probe crash), reported by BOTH the diagram session
and M2 session. Also: a standalone gate run APPENDS to `data/test-ledger.jsonl`
(a live-checked script writes side effects); if a work order's file list is
exclusive, truncate it back instead of `git checkout`-ing (`head -57 > … && cp`).

---

## 6. Known bugs

**No known-failing checks.** Environment-dependent checks are reported
**SKIP**, never PASS: `scripts/ops-pages.dom.check.mjs` needs a live server on
`:3011`, `ASTRA_WEBUI_PASSWORD`, and a Playwright browser.

Resolved 2026-10-03, kept as a record:

| ID | Bug | Resolution |
|---|---|---|
| RG-028 | `training-pipeline` R5 flaked ~5-in-6 — two harness races: a parent-side 500 ms timer flip against 200 ms retries, and a poll that sampled a *transient* `awaiting_retry` state. Product logic was always correct. | Fake gateway now fails exactly the first delete; the child waits for the terminal state and the retry is proven by the parent's attempt counter. 12/12 consecutive passes. See `docs/known-bugs/training-pipeline-r5-flake.md`. |

---

## 7. ADRs

### ADR-001 — Proxy, not in-process

Astra is a stateless proxy to the Hermes gateway rather than an in-process
agent host.

**Why.** An in-process host must reach into agent internals, which couples the
UI to a specific Hermes build and makes concurrency a thread-safety problem
(process-global env vars, per-session locks). The proxy keeps every agent
concern — sessions, tools, approvals, memory — owned by the gateway, so Astra
works against any Hermes install without forking it, and two tabs can hold two
independent live chats.

**Cost.** Astra cannot add agent capabilities the gateway does not expose
(e.g. message pagination has no gateway parameter yet). Accepted: the gateway
is the right place for that.

### ADR-002 — WebSocket transport, WebUI-owned segment engine

Astra relays the gateway's WebSocket frames and renders them through its own
segment engine rather than consuming SSE events.

**Why.** Resume, liveness recycling, turn watchdog and a durable offline queue
all require a bidirectional channel. It also lets Astra present a turn as an
ordered narrative (`chat-timeline`) instead of a flat event log.

**Cost.** Astra owns the frame contract, so a gateway protocol change lands
here first. Mitigated by `chat-segments.ts` being pure and directly checked.

### ADR-003 — No test framework; checks run under bare Node

**Why.** The whole product is zero-dependency on the server side, and every
assertion is a plain comparison. A framework would add install weight and a
second syntax to learn for no gain.

**Cost.** No discovery, no parallelism, no watch mode — hence `run-checks.mjs`.
The trade is deliberate and documented.

### ADR-004 — Web CI added 2026-10-03

The web app had **no CI at all** — nothing built it, nothing ran its checks.
`.github/workflows/web.yml` now runs `lint`, `build`, `check`, plus a guard
that fails if fewer than 40 checks are discovered. That guard exists because a
suite that silently emptied itself would otherwise pass green.

The build step is what would have caught the 2026-10-03 state where
`src/App.tsx` imported three modules that had never been committed — a fresh
clone of the public repo failed `tsc -b` with three `TS2307` errors.
