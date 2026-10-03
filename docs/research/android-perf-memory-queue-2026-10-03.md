# Astra Android — Performance, Memory, Storage & Queue Optimization Review

**Status:** RESEARCH ONLY — zero code changes. Per owner instruction 2026-10-03.
**Date:** 2026-10-03 · **Commit reviewed:** `0f399f0` · **Version:** 1.11.10 (versionCode 24)
**Scope:** `android/` (Capacitor 8 shell + Kotlin service/plugin layer), `src/` (React 19 web surface), `server/` (Node proxy).
**Method:** full source read of all 8 Kotlin/Java files (2,058 lines) + the JS transport, queue and storage layer; bundle inspection of the built `dist/` and of the shipped APK; web + GitHub + Context7 research.

---

## 0. How to read this

The app is three things stacked:

1. **A native shell** — a WebView that shows a website. It has no local app files; it loads `https://astra.jitinnair.com` every launch.
2. **A background radio** — `NtfyPushService.kt` holds two live WebSockets so notifications arrive when the app is closed.
3. **The web app itself** — React, served from your server, that does all the real work.

Because of (1), the "Android app" is really a browser plus a radio. Speed and memory are therefore decided in **three** places, not one. Optimizing only the Kotlin files would miss most of the win.

**Evidence limits, stated plainly:** `adb devices` returned **no connected device**, so I could not measure real RAM, real cold-start time, or real frame rates. Every number below is from source, from the built artifacts on disk, or from vendor documentation. Where I estimate impact instead of measuring it, the row says **UNVERIFIED — needs a device**. Recommendations that would benefit from a device baseline are grouped in §9.

---

## 1. Headline findings

```astra-canvas
```kpi
{label:"APK on disk",value:"17.0 MB",delta:"release build has R8 OFF",trend:"down"}
{label:"Dead payload in APK",value:"4.5 MB",delta:"never loaded at runtime",trend:"down"}
{label:"DEX (unminified)",value:"16.8 MB / 8 files",delta:"R8 minifyEnabled=false",trend:"down"}
{label:"Main JS chunk",value:"891 KB raw",delta:"273 KB gzip",trend:"flat"}
{label:"CSS",value:"271 KB raw",delta:"44 KB gzip",trend:"flat"}
{label:"Unconditional 1 Hz tick",value:"always on",delta:"re-renders chat every second",trend:"down"}
```
```

Five things drive nearly all the cost:

| # | Finding | Where | Cost | Confidence |
|---|---|---|---|---|
| **F1** | Release build ships **unminified, unshrunk** code | `app/build.gradle:36` | ~16.8 MB DEX across 8 files | Confirmed in source |
| **F2** | APK carries **4.5 MB of web assets that are never loaded** | `android/app/src/main/assets/public/` | Dead weight on every install | Confirmed in APK listing |
| **F3** | A **1 Hz timer runs forever** and re-renders the chat tree every second | `ws-engine.ts:581` | Constant CPU + battery while open | Confirmed in source |
| **F4** | **`onRenderProcessGone` is not implemented** | `MainActivity.kt` | App dies instead of recovering when Android kills the renderer | Confirmed absent; vendor doc says required |
| **F5** | **4 of 5 heavy libraries are in the always-loaded main chunk** | `dist/assets/index-*.js` | 891 KB parsed before first paint | Confirmed by chunk scan |

---

## 2. Speed — what makes the app feel slow

### 2.1 Cold start (open → chat usable)

The shell loads a remote URL, so every launch pays: WebView boot → TLS to `astra.jitinnair.com` → HTML → 891 KB JS parse → React mount → WS handshake.

**What the code does well:**
- The HTML inlines a pre-paint theme script, so there is no white flash.
- `assets/*` is served `immutable, max-age=31536000` — correct, hashed files never re-download.
- Heavy viewers (PDF/PPTX/XLSX/DOCX/recharts ≈ 3.9 MB) are already behind `React.lazy`. Only the main chunk is on the critical path. This is well done.

**What is on the critical path and shouldn't be:**

| Item | Size | Why it's there | Fix |
|---|---|---|---|
| `index-CMi3yYrs.js` | 891 KB raw / 273 KB gzip | Vite emits one flat chunk; no `manualChunks` split | Split vendor from app code; both cache independently |
| `index-D0bl4nvx.css` | 271 KB raw / 44 KB gzip | One monolithic Tailwind v4 output, 3,445 lines | Let Vite purge per-route; move non-chat page CSS behind dynamic import |
| Google Fonts stylesheet | 3 families × 9 weights, **render-blocking** | `<link rel=stylesheet>` to `fonts.googleapis.com` in `index.html` | Self-host subset woff2 + `font-display: swap`; preloads are already there but a third-party CSS fetch still blocks paint |

> The fonts link is the single most concrete cold-start win available. It is a **render-blocking third-party request**: the browser cannot paint until that CSS arrives and the faces load. On a phone over LTE that is routinely 300–800 ms of blank screen. Self-hosting removes a DNS lookup, a TLS handshake to a third party, and the blocking behaviour in one move. **UNVERIFIED — needs a device trace** to size the win.

**Library hygiene** — the main chunk already contains string references to `marked`, `dompurify`, `motion`, `tinybase` and `xlsx`. Two prod dependencies are **completely unused in `src/`**:

- `lottie-react` — only imported by `theme-lottie.tsx`, which nothing imports (dead component). The Lottie JSON files aren't in the repo either (`public/lottie/` holds only a README).
- `@vidstack/react` / `vidstack` — zero imports anywhere.

Both are in `dependencies`, so `npm ci` installs them on every machine and every CI run, and they widen the supply-chain surface for zero runtime benefit. `playwright` is a **prod dependency** but is only used by `scripts/*.mjs` — it belongs in `devDependencies`. These are tree-shaken out of the bundle (confirmed: 0 hits in the main chunk), so this is a **build-hygiene and install-time** fix, not a runtime one. Low impact, near-zero risk.

### 2.2 Scrolling and typing (in-chat responsiveness)

Three concrete issues:

**S1 — No `memo()` anywhere. Zero of 35 components use it.**
Every parent state change re-renders every child. In `chat-timeline.tsx` the whole message list is `.map()`-ed on each render, and `RichText` calls `marked.parse` + `DOMPurify.sanitize` over the full text inside a `useMemo` keyed on `[text, streaming]`. During streaming, `text` changes on every delta, so **the entire accumulated reply is re-parsed and re-sanitized on every token**. Cost grows with reply length — an O(n²) pattern over a long answer. The repo's own research doc (`docs/research-webui-perf-2026-09-29.md`, item 1) already identified the fix (block-level memoized markdown, the Vercel Streamdown recipe) and it has not landed.

**S2 — The 1 Hz countdown timer re-renders the chat constantly.**
`ws-engine.ts:581`:
```ts
eng.countdownTimer = window.setInterval(() => {
  const at = nextRetryAt;
  useWsStore.getState().setNextRetryIn(at === null ? 0 : Math.max(0, at - Date.now()));
}, 1000);
```
This runs **unconditionally for the app's whole lifetime**, not only while a retry is pending — the comment above it says "1 Hz while a retry is pending", but the code has no such guard. Each tick calls `set()` on the zustand store; `hermes-ws.ts:48` subscribes to `nextRetryIn`, so **the hook re-renders, and `chat-landing.tsx` (2,005 lines) re-renders, once per second, forever** — even when perfectly online and idle. Combined with S1 (no memo), each of those re-renders walks the entire message tree.

The fix is one line: only arm the timer when `nextRetryAt !== null`, or move `nextRetryIn` out of the reactive store into a ref + a direct DOM write in the banner. This is the highest ratio of win to change in the entire review.

**S3 — Polling intervals that outlive their need.**
`chat-landing.tsx:836` polls `session.resume` every 3 s for the bg dock, and its `useEffect` depends on `[bgItems, storedSessionId, rpc]`. Because `bgItems` is in the dependency array and reconciliation rewrites it, **the interval is torn down and re-armed on every reconciliation** — a poll loop that resets its own timer. Similar 1 s tickers in `bg-dock.tsx:34`, `subagent-panel.tsx:62` and `training-status.tsx:72` force a re-render per second purely to advance a clock label.

**What is fine:** streaming reveal is already decoupled from arrival (`reveal-pace.ts`, 40–52 cps with a catch-up cap), and the WS liveness check is wall-clock based (5 s check, 60 s silence threshold) so Android timer throttling delays it rather than breaking it. `neon-flow.tsx` and `tubes-background.tsx` both correctly gate on `prefers-reduced-motion` **and** on `document.hidden`. These are good.

### 2.3 What I did **not** find

No service worker. That's a deliberate, defensible call — `capacitor.config.ts` points at the live URL and the comment says the app is "hosted, no offline-first design". I agree: a SW would mostly cache a site that changes constantly. Not counted as a finding.

---

## 3. Memory

```astra-canvas
```kpi
{label:"Renderer (separate process)",value:"~55 MB+",delta:"not in dumpsys meminfo",trend:"flat"}
{label:"App process",value:"browser side",delta:"what meminfo shows",trend:"flat"}
{label:"onTrimMemory levels handled",value:"1 of 6",delta:"UI_HIDDEN only",trend:"down"}
{label:"onRenderProcessGone",value:"absent",delta:"required by vendor",trend:"down"}
{label:"WebView.destroy() on exit",value:"absent",delta:"holds renderer",trend:"down"}
```
```

Android's own guidance (developer.android.com, *Manage and diagnose WebView memory* and *Handle WebView termination*) states the key facts this app currently ignores:

1. **WebView memory lives in a separate renderer process.** `dumpsys meminfo com.jitinnair.astra` shows only the browser process. The renderer can reach 55 MB+ on its own and is invisible to that number. Any memory tuning aimed at the wrong process will appear to do nothing.
2. **Web content memory is native, not Java heap.** It is not capped by `maxHeap`, does not throw OOM, and can silently grow into swap. The app therefore needs to *react to pressure*, not wait for an exception.
3. **Implementing `onRenderProcessGone` is required.** Without it, when Android kills the renderer to reclaim memory — routine on a loaded phone — the whole app exits. With it, you rebuild the WebView and the user keeps their place. Android's docs are explicit: *"If you don't implement a handler for onRenderProcessGone, it's now more likely that users will observe visible foreground terminations."*

**M1 — `onRenderProcessGone` is absent.** Verified: `grep -rn 'onRenderProcessGone' android/app/src/main/java/` returns nothing. This is the highest-severity memory finding. It converts a recoverable OS reclaim into a visible app death.

**M2 — `onTrimMemory` handles one level.** `MainActivity.kt:100` acts only on `TRIM_MEMORY_UI_HIDDEN` (correctly pausing timers and rendering — good). It ignores `TRIM_MEMORY_RUNNING_CRITICAL`, `..._MODERATE`, `..._COMPLETE` and `..._RUNNING_LOW`. On `RUNNING_CRITICAL` the right move is to shed: clear caches, drop the WebView's own caches, stop polling. Also missing: `onSaveInstanceState` / `WebView.saveState()`, which Android pairs with renderer-death recovery so navigation survives.

**M3 — No `WebView.destroy()`.** `MainActivity` holds the bridge WebView for the Activity's whole life and never destroys it. Android's guidance is that calling `destroy()` in `onDestroy()` is what actually releases native resources — GC alone is not guaranteed and is often delayed.

**M4 — Notification bitmaps are decoded once and held forever.** `fullLogo()` decodes `ic_launcher_foreground` and scales to 96×96, caching it in `logoBmp` for the service's lifetime. That is correct caching and only ~36 KB — this is a **non-issue**; flagging it so nobody "optimizes" it later.

**M5 — Two long-lived sockets hold OkHttp buffers.** `sharedClient()` uses default `readTimeout(0)` (infinite, correct for WS) and one dispatcher thread pool shared by both legs. OkHttp's default connection pool holds up to 5 idle connections each at 1 MB read buffer + 1 MB write buffer. Two sockets is well within that, so no real pressure — but a fixed, small `Dispatcher` executor and a zeroed `ConnectionPool(maxIdle=2, keepAlive=60s)` makes the bound explicit rather than inherited.

**M6 — Web-side memory: unbounded map growth.** `chatStates`, `sessionCache`, `sessionNotFoundCache`, `gateTitleCache` in `NtfyPushService.kt` are plain `mutableMapOf()` with no eviction. `sessionNotFoundCache` and `sessionCache` only ever grow, and both are keyed by session id — a user who cycles through hundreds of chats accumulates entries for the process lifetime. Small per entry, but unbounded in principle. Same shape on the web: `probed` in `theme-lottie.tsx`, `knownRowKeys`, and `chatStates.lines` (capped at 6 — correctly).

---

## 4. Storage (on-device disk)

### 4.1 The APK carries 4.5 MB it will never read

Measured from the built `app-debug.apk` (17,041,744 bytes):

| Entry | Bytes | Loaded at runtime? |
|---|---|---|
| `assets/public/assets/pdf-view-*.js` | 1,612,759 | **No** |
| `assets/public/assets/pptx-view-*.js` | 1,226,152 | **No** |
| `assets/public/assets/jszip.min-*.js` | 95,956 | **No** |
| `assets/public/assets/xlsx-view-*.js` | 331,371 | **No** |
| `assets/public/assets/docx-view-*.js` | 76,251 | **No** |
| `assets/public/assets/media-viewer-*.js` | 56,272 | **No** |
| `assets/public/astra-logo.png` | 91,966 | Only via remote URL |
| `assets/public/assets/index-*.js` + css | 971,620 | **No** |
| **`assets/public/` subtotal** | **4,491,728** | **0 bytes used** |

`capacitor.config.ts` sets `server.url = "https://astra.jitinnair.com"`, so the WebView loads the network copy and **never touches `assets/public/`**. The stale `index.html` there is from 2026-09-30, while `dist/` is from 2026-10-03 — proof it's a fossil, not a fallback.

This is 26% of the APK. On a phone, a smaller APK means a faster install and less on-disk footprint — and it removes a real correctness hazard: a stale bundled copy is one config flip away from shadowing the live site.

### 4.2 R8 is off (F1)

`app/build.gradle:35-38`:
```groovy
release {
    minifyEnabled false
    proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
}
```
Two problems:
- `minifyEnabled false` — no tree-shaking, no obfuscation, no dead-code removal.
- It uses `proguard-android.txt`, **not** `proguard-android-optimize.txt`. Google's R8 Analyzer skill states the optimized file is required to "achieve maximum utilization of R8".

Result: **8 dex files, 16,757,556 bytes** for an app whose actual Kotlin is 2,058 lines. Android's docs cite **>50% app-size reduction** from proper R8 + resource shrinking on typical apps. Also missing: `shrinkResources true`, and `android.enableR8.fullMode` (AGP 8.13 defaults it on, so that one's fine).

### 4.3 On-device runtime storage: well-behaved, with one gap

What the app writes to `localStorage` / `sessionStorage`:

| Key | Store | Cap / TTL | Verdict |
|---|---|---|---|
| `bg_items_<sid>` | localStorage | **pruned daily** against the server session list | Good — `prune.ts` is a real implementation with a check file |
| `astra-ws-queue-v2` | sessionStorage | last 20 + 24 h staleness drop | Good |
| `astra:draft:<sid>` | localStorage | **none** | ⚠️ Gap — see below |
| `astra-outbox` | sessionStorage | last 20 | Good, but **the module is dead code** (zero importers outside itself) |
| `astra-gen-files` | localStorage | `.slice(-200)` | Good |
| `astra_unread_overlay_v1` | localStorage | orphan TTL prune on list load | Good |
| `astra-bg-video-pos:<src>` | localStorage | **none, one key per distinct backdrop src** | ⚠️ Slow leak |
| `astra-step-open` | localStorage | size-capped | Good |
| `astra-palette`, `astra-theme`, `astra-sidebar*` | localStorage | fixed keys | Fine |
| `astra_device_id`, `astra_device_id_v1` | session/local | fixed | Note: **two device-id keys** — a real (small) duplication |

**Gap 1 — drafts are never pruned.** `drafts.ts` writes `astra:draft:<sid>` per session and nothing ever deletes it. `prune.ts` only sweeps the `bg_items_` prefix. Over months of new chats this accumulates one key per chat that ever had a draft. Bounded by localStorage quota (so it fails safe), but it competes with `bg_items_` for the same budget and could evict live dock state.

**Gap 2 — backdrop video positions.** `chat-backdrop.tsx` writes `astra-bg-video-pos:<src>` per distinct background. Also unbounded, also harmless-until-quota.

Both have a one-line fix in the existing `pruneStaleBgItems()` sweep, which already fetches the live session list. **This is the cheapest durable fix in the report.**

**Storage verdict:** runtime discipline is genuinely good — caps exist, TTLs exist, and there's a check file (`wake-probe.check.ts`) guarding the prune logic. The problems are all *omissions from an existing sweep*, not a design flaw.

---

## 5. Queue management

Three queues exist. Two are well-built; one is dead; one has a subtle bug.

### Q1 — WS prompt queue: solid ✅
`ws-store.ts` + `ws-engine.ts`. Capped at 20, 24 h staleness drop, per-tab `sessionStorage` with a one-time legacy migration, and a **`armQueuedCap()` that repairs rather than eats** — on the 5-minute cap it force-closes and redials twice before surfacing an honest error. `concurrent-queue.check.ts` documents the exact bug it prevents (tab A's prompt flushing into tab B's chat). This is the best-engineered part of the app.

### Q2 — bg/steer dock: correct model, leaky storage ⚠️
`bg-items.ts` is clean pure logic with `onTurnComplete` (FIFO drain) and `reconcileWithServer` (server truth wins) — both covered by `bg-dock.check.ts` / `bg-routing.check.ts`. One quirk worth stating: `dismissItem` sets `dismissed: true` but **never removes the item**, and the owner mandate is "persist until dismissed". So `bg_items_<sid>` arrays grow monotonically within a chat. The daily prune only removes keys for chats the *server* forgot — it never trims a live chat's array. A chat with 200 background items keeps all 200 forever.

### Q3 — `outbox.ts`: dead code 🗑️
49 lines, well-commented, `sessionStorage`-backed, capped at 20 — and **nothing imports it** (verified: zero references outside the file). Meanwhile `ws-store.ts` carries a *second* durable queue under a different key. Two durable queues, one live, one vestigial. Delete it — a second queue implementation is a trap for whoever edits this next.

### Q4 — Native notification queues ✅ with one fix
`NtfyPushService` coalesces the group summary on a 5 s timer (`summaryRunnable`) while per-chat notifications post immediately. That is the right shape.

**Bug:** `publishGroupSummary()` calls `publishStatus()` on **every** path, including the `chatStates.isEmpty()` early return (line 635) and the normal update path (line 674). `publishStatus()` → `manager.notify(1001, …)` → `statusNotification()` → **re-decodes nothing (logo is cached, good) but rebuilds the whole `Notification` object and re-posts it**. With `ShortcutBadger.applyCount()` on the same path, a burst of completed turns causes repeated foreground-notification churn. Only re-post when the rendered content actually changed.

---

## 6. Battery / background behaviour

This is where the app is most exposed, and where prior work already landed.

**Good:** `pingInterval(60s)` on the shared OkHttp client — one ping per socket per minute, not the 30 s the earlier audit assumed. `MainActivity.onResume` resumes timers *before* the JS poke, avoiding the silent-loss race. The WebView pauses timers at `TRIM_MEMORY_UI_HIDDEN`. `startChatPrefWatch` is at 300 s, not 60 s. Web-side 1 Hz tickers are gated on `document.hidden`.

**The remaining structural cost — two sockets, two ping timers:**
The service holds a ntfy socket (`connectWebSocket`) *and* a chat socket (`connectChatLeg`), plus the WebView holds its own third socket while foreground. That's **3 concurrent WebSockets** at peak, each independently reconnecting with its own exponential backoff (`2^attempt`, capped at 300 s). The proxy also runs a 25 s broadcast tick and a 30 s ping/reap loop server-side.

This is a deliberate design decision (documented in `hermes-ws.ts` and `android-bg-chat-ws-plan.md`) — background chat notifications must survive the WebView being frozen. I am **not** recommending removing it. The cheaper win is **coordination**: when the app is foreground (`appForeground == true`), the native chat leg duplicates what the WebView socket already receives. Gating `connectChatLeg()` on `!appForeground` — reconnecting on the `ACTION_APP_FOREGROUND` boundary — removes one socket and one ping timer for the entire time the user is actually looking at the app, with no behavioural change. **UNVERIFIED — needs a device to confirm the WebView socket really carries the frames.**

**`specialUse` FGS type: correct, keep it.** The code's own comment is right: `dataSync` has a hard 6 h/24 h cap that silently kills pushes; `specialUse` has none. Android's docs confirm the 6-hour `onTimeout` behaviour applies to `dataSync` and `mediaProcessing` only. The subtype string is honest and specific. One operational note: `specialUse` is exactly the type Google Play scrutinises — fine for a sideloaded personal app, but if this ever goes to Play it needs the declaration form justified. `onTimeout()` → `stopSelf()` is correctly implemented.

**`GestureReceiver`/`GateActionReceiver`:** creates a **fresh `OkHttpClient()` per broadcast** (line 36). Every tap on "Allow once" spawns a new client, dispatcher executor and connection pool, then abandons it. One client per notification tap is a small leak with an easy fix — share a `companion object` singleton.

---

## 7. Prioritized recommendations

Effort is my estimate. **P0 = do first.**

| ID | Priority | Change | Effort | Impact | Risk |
|---|---|---|---|---|---|
| **R1** | **P0** | Guard the 1 Hz countdown timer — arm only while `nextRetryAt !== null`, or move it out of zustand (`ws-engine.ts:581`) | ~5 lines | Removes a permanent 1 Hz full-tree re-render | Very low |
| **R2** | **P0** | Implement `onRenderProcessGone` in `MainActivity` (rebuild WebView, return `true`) + `onSaveInstanceState`/`saveState()` | ~30 lines | Stops visible app death when Android reclaims the renderer | Low |
| **R3** | **P0** | Enable R8: `minifyEnabled true`, `shrinkResources true`, switch to `proguard-android-optimize.txt` | ~5 lines | Expect **>50% APK reduction** per Android docs; 8 dex files → 1–2 | Medium — needs a real-device smoke test (Capacitor reflection, `@CapacitorPlugin`) |
| **R4** | **P0** | Self-host subset woff2 fonts with `font-display: swap`, drop the render-blocking Google CSS | ~30 min | Removes a third-party render-blocking request from cold start | Low |
| **R5** | **P1** | Block-level memoized markdown (`marked.lexer` → memoized per block) — the repo's own item #1, still unlanded | ~60 lines | Kills the O(n²) re-parse on every streaming delta | Low |
| **R6** | **P1** | Strip dead weight from the APK: exclude `assets/public/**` when `server.url` is set; delete unused prod deps (`lottie-react`, `@vidstack/react`, `vidstack`); move `playwright` to devDeps | ~20 min | −4.5 MB APK, faster install, smaller supply chain | Low (verify app still launches) |
| **R7** | **P1** | Gate `connectChatLeg()` on `!appForeground` | ~15 lines | Removes 1 of 3 sockets + 1 ping timer while in use | Medium — needs device verification |
| **R8** | **P1** | `publishStatus()` only on actual content change; share one `OkHttpClient` in `GateActionReceiver` | ~15 lines | Cuts notification churn + per-tap client leak | Low |
| **R9** | **P1** | Prune `astra:draft:<sid>` and `astra-bg-video-pos:*` in the existing `pruneStaleBgItems()` sweep | ~10 lines | Closes the only unbounded localStorage growth | Very low |
| **R10** | **P2** | Add `manualChunks` (vendor / react / editor split) in `vite.config.ts` | ~15 lines | Better long-term caching; smaller parse on repeat visits | Low |
| **R11** | **P2** | Trim dismissed entries out of `bg_items_<sid>`; delete dead `outbox.ts` | ~20 lines | Stops monotonic array growth; removes a competing queue impl | Low |
| **R12** | **P2** | Handle `TRIM_MEMORY_RUNNING_CRITICAL/MODERATE/COMPLETE`; call `WebView.destroy()` in `onDestroy()`; bound the native caches (`sessionCache` etc.) with an LRU | ~30 lines | Correct memory-pressure response | Low |
| **R13** | **P2** | Deduplicate `astra_device_id` / `astra_device_id_v1`; fixed small OkHttp `Dispatcher` + `ConnectionPool(maxIdle=2)` | ~15 lines | Removes a real duplication; makes bounds explicit | Low |

**Deliberately not recommended:**
- **Virtualized chat history.** The repo's own research already deferred this, correctly: variable-height AI bubbles break naive virtualization, and real threads are typically <500 messages. R5 addresses the actual hot path.
- **Moving markdown parsing to a Worker.** Only pays after R5, and adds an async bridge across the reveal animation.
- **Replacing `specialUse` FGS type.** It is the right type; the alternatives are worse (see §6).
- **A service worker.** The app is deliberately a thin shell over a live site.

---

## 8. Risks and things I could not verify

**Stated plainly, not buried:**

1. **No device measurement.** `adb devices` → empty. Every "faster / less memory" claim above is derived from source, artifact inspection, and vendor docs — **not from a profile on your phone.** R1/R2/R3 in particular should be validated with `dumpsys meminfo` and a cold-start trace before and after.
2. **R8 (R3) is the one change that can break the app.** Capacitor resolves plugins reflectively; `@CapacitorPlugin` classes and `@PluginMethod` entry points need keep rules. I have not tested a minified build. This is the only P0 I would not ship blind.
3. **The repo has concurrent sessions.** `git status` showed many modified files at review time, including `server/sysinfo.mjs` and several `*.check.ts`. Findings reflect commit `0f399f0` plus the working tree as of 09:0x. Another agent may have moved files since.
4. **LocalStorage quota is the backstop.** Everything is `try/catch`-wrapped and fails silent by design. That's the right posture, but it also means **storage exhaustion is invisible** — you'd see dock state silently stop persisting rather than an error. If you care, log the catch.
5. **`assets/public/` staleness is a latent trap.** Today it's inert because `server.url` wins. Anyone flipping `server.url` off for a bundled build gets a 2026-09-30 site unless they also fix the sync step.
6. **The APK in `build/outputs/` is `app-debug.apk`** — debug-signed, debug build type. My byte measurements are of the debug artifact; a release build's composition will differ (though R8 would make it far smaller).

---

## 9. Suggested measurement plan (needs the phone)

Before changing anything, capture a baseline. Roughly 20 minutes with the device connected:

```bash
adb shell dumpsys meminfo com.jitinnair.astra          # app process
adb shell dumpsys meminfo $(adb shell pidof com.google.android.webview:sandboxed_process0 | tr -d '\r')
# ^ renderer process — this is where the real WebView memory lives

# cold start timing, 3 runs
for i in 1 2 3; do adb shell am force-stop com.jitinnair.astra; \
  adb shell am start -W -n com.jitinnair.astra/.MainActivity | grep -E 'TotalTime|WaitTime'; done

# does the renderer get killed under pressure?
adb shell am send-trim-memory com.jitinnair.astra RUNNING_CRITICAL
```

Plus, in Chrome DevTools against the WebView (`chrome://inspect`): record a Performance trace while a long reply streams, and a Memory heap snapshot before/after. That will confirm or kill the S1/S2 estimates with real numbers.

---

## 10. Sources

**Vendor documentation (primary):**
- [WebView and memory](https://developer.android.com/topic/performance/memory/guide/webview-memory) — multi-process model, renderer memory invisible to `dumpsys meminfo`
- [Manage and diagnose WebView memory](https://developer.android.com/develop/ui/views/layout/webapps/manage-webview-memory) — native memory isn't capped by `maxHeap`; `destroy()` guidance
- [Handle WebView termination](https://developer.android.com/develop/ui/views/layout/webapps/handle-termination) — `onRenderProcessGone` is **required**
- [Optimize WebView startup](https://developer.android.com/develop/ui/views/layout/webapps/optimize-webview-startup) — `startUpWebView`, implicit-init ANR risk
- [Foreground service timeouts](https://developer.android.com/develop/background-work/services/fgs/timeout) — 6 h/24 h cap, `dataSync` + `mediaProcessing` only
- [Behavior changes: Android 15](https://developer.android.com/about/versions/15/behavior-changes-15) · [Android 16](https://developer.android.com/about/versions/16/behavior-changes-all)
- [Optimize for Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby) — FCM recommended over self-held sockets; exemption table
- [Enable app optimization with R8](https://developer.android.com/topic/performance/app-optimization/enable-app-optimization) — `proguard-android-optimize.txt`, `shrinkResources`, >50% size reduction
- [R8 Analyzer skill — Configuration](https://developer.android.com/agents/skills/performance/r8-analyzer/references/CONFIGURATION)

**Upstream corroboration:**
- [openclaw#80082](https://github.com/openclaw/openclaw/pull/80082) — real-world move off `dataSync` for a persistent WS after `ForegroundServiceDidNotStopInTimeException`; confirms `specialUse`/`connectedDevice` semantics at `targetSdk=36`
- [home-assistant/android#5987](https://github.com/home-assistant/android/issues/5987) — the exact 6 h `dataSync` exhaustion failure Astra was designed to avoid

**In-repo prior art (not re-derived):**
- `BATTERY_AUDIT_20260930.md` — earlier battery pass; its `pingInterval(30s)` figure is stale, the code is now 60 s
- `docs/research-webui-perf-2026-09-29.md` — item 1 (block-memoized markdown) is **R5** here, still unlanded; its virtualization decision is upheld
- `docs/plans/android-bg-chat-ws-plan.md` — the design behind the native chat leg

**Method note:** Context7 resolved Capacitor (`/websites/capacitorjs`) and the Vite/Groovy-R8 references were cross-checked against Google's own R8 docs, which are more specific for this project's needs. GitHub code search corroborated the FGS findings rather than adding new ones.