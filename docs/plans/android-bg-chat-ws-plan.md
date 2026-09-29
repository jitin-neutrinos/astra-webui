# Plan — Android background chat-WS persistence + memory/storage cleanup

Status: PLAN (operator gate — nothing below is built yet)
Repo: ~/Work/projects/astra-webui · Date: 2026-09-29
Pipeline: recon done (all file/line refs below read from source, not assumed) → this doc is the gate → agy builds in phases A→C → Claude Code tests → Hermes verifies on-device.

## 0. Recon corrections (facts that change the design)

Three assumptions in the request are corrected by the code:

1. **The native chat socket needs NO ws-ticket.** The ticket machinery
   (`getWsTicket`, `Sec-WebSocket-Protocol: hermes-gateway-ticket.*`) lives in
   `server/hermes-proxy.mjs:55-89,247-258` and is ONLY for the proxy→gateway leg
   (127.0.0.1:9119). The browser-facing WS is authenticated by the
   `astra_session` HttpOnly cookie alone — `server.mjs:301-318` (`server.on("upgrade")`
   checks `validToken(cookies[COOKIE])` and nothing else). The native leg copies
   the browser's exact auth: cookie header, done.
2. **The public chat-WS path is `/api/hx/ws`** (`server.mjs:303`,
   `ws-engine.ts:628`), not `/api/ws`. Native URL:
   `wss://astra.jitinnair.com/api/hx/ws`.
3. **R8 is half-built already.** `hermes-proxy.mjs:203-225` has a 25s
   `proxy.status tick` broadcast, a 30s per-socket protocol ping
   (`startBrowserPing`), and a 30s upstream ping (line 316). Missing piece is
   pong-tracking + zombie `terminate()` — that's the only R8 work left.

Also verified (R6a): `browserSockets` is a plain `Set` (`hermes-proxy.mjs:147`)
with no eviction, dedupe, or per-session cap — any number of concurrent sockets
per session is already supported. Multi-tab works today through exactly this.

---

## 1. Architecture — who holds which socket

```
FOREGROUND (app open)
  ┌─ WebView page ──── ws-engine.ts ─── WS#1 wss://astra.jitinnair.com/api/hx/ws
  │                   (full broadcast: deltas, gates, completions; sends prompts)
  └─ NtfyPushService ─ WS#2 same URL + ?sid=<liveSid>  (FILTERED leg, read-only)
                      └─ also ntfy WS (gates) — unchanged
  Server: one upstream WS to gateway :9119; broadcast fan-out to all browser
  sockets; sockets tagged with ?sid= receive ONLY message.complete/message.error
  frames whose session_id matches. No eviction. Pings every 30s keep CF tunnel
  alive on every leg incl. the filtered one.

BACKGROUND / app closed
  WebView JS throttled+dead (Doze) — WS#1 gone silently. resume-check poke
  repairs it on next resume (existing v1.1 behavior).
  NtfyPushService (specialUse FGS, START_STICKY, BootReceiver) still holds:
    ─ ntfy WS  → gate pushes (approval cards)        [unchanged]
    ─ WS#2     → message.complete for the live chat  → LOCAL notification
                 (channel astra-chat-v2, deep-link astra://open?path=/c/<stored>)
```

Both sockets are independent broadcast clients of the same proxy. WS#2 is
strictly read-only (never sends a prompt, never injects a frame into the
WebView). Default policy (R2): keep WS#2 connected in foreground too — a warm
socket means instant background notify with zero reconnect cost; battery cost
of an idle pinged socket is negligible vs the churn of teardown/redial.

Contract (R6b, to be documented in code comments + this doc):
- The proxy treats every socket identically (no session identity server-side).
- The page renders ONLY from frames arriving on its own ws-engine socket.
- The native service consumes frames natively (JSONObject) and NEVER calls
  `evaluateJavascript` with frame data. There is no bridge that could
  double-render — the two legs never meet.

---

## 2. File-by-file change map

### Phase A — server (deploy-safe, no client change needed)

| File | Change | ~LOC |
|---|---|---|
| `server/hermes-proxy.mjs` | (1) R8 finish: replace per-socket `startBrowserPing` timer with ONE shared 25s loop that pings every socket, tracks `lastPong` per socket (decoder marks alive on opcode 0xA), and `terminate()`s any socket that hasn't ponged since the previous round (zombie reap). (2) `?sid=` filter: `handleWsUpgrade` reads `url.searchParams.get("sid")`; tagged sockets are served by a separate send path — in the upstream frame branch (line ~301), when any tagged socket exists, JSON.parse the frame once and forward ONLY `message.complete` / `message.error` events whose `params.session_id` matches (parse gated on `tagged.size > 0` so the no-filter path stays opaque-relay as today). (3) One-line journald log on browser socket open/close/peer-count (`ws-open peers=N sid=…`) — the R7 evidence source. | ~55 |
| `server/transcode.mjs` | R5: total-size cap with LRU eviction on write. After a successful transcode (and only then — no per-request stat storm): `statSync` all cache files, sort by `atimeMs`, delete oldest until total ≤ cap. `ASTRA_TRANSCODE_MAX_BYTES` env knob, default 512 MiB. Keep existing 7-day TTL sweep untouched. | ~30 |
| `scripts/ws-reap-check.mjs` (new) | Runnable check: raw-socket client completes the WS upgrade with a valid cookie then never pongs; asserts the server's reap log line appears within ~60s. | ~40 |
| `scripts/transcode-cap.check.mjs` (new) | Runnable check: set cap tiny via env, write fake cache files, force one transcode-path call, assert oldest files were evicted and total ≤ cap. | ~35 |

### Phase B — web (src/)

| File | Change | ~LOC |
|---|---|---|
| `src/lib/ws-engine.ts` | R9: `wakeProbe()` — on `visibilitychange→visible`, `window online`, `pageshow` (new listener): if socket OPEN → `rpc("config.get",{key:"mtime"})` raced against a 3s deadline; fail → close + null socket + `dispatchEvent("online")` + `reconnectAttempt = 0`. If a reconnect timer is pending → cancel it, reset backoff, dial now. Single-flight guard (`probeInFlight` flag) against duplicate probes. Extends the existing `tryImmediateReconnect` block (line ~521) which currently dials only when the socket is NOT open — the half-open-socket gap this fixes. Also: push session identity to native — subscribe to `liveSessionId`/`storedSessionId` changes and call the native bridge (below). | ~55 |
| `src/lib/native-session-bridge.ts` (new) | Guarded Capacitor call: dynamic-import the plugin only when `Capacitor.isNativePlatform()`; browser = no-op. Exposes `pushLiveSession(liveSid, storedKey)` → `NativeNtfy.setLiveSession`. | ~20 |
| `src/lib/ws-store.ts` | R5: `loadQueue()` drops entries with `queuedAt` older than 24h (staleness cap on `astra-ws-queue-v1`; the 20-entry count cap already exists at line 50). | ~6 |
| `src/lib/prune.ts` (new) | R5: once per 24h (timestamp in `localStorage["astra-prune-at"]`), fetch `/api/hx/sessions?limit=500&order=recent`, collect sids, delete every `localStorage` key `bg_items_<sid>` whose sid is absent. Called from the app bootstrap after auth resolves. | ~35 |
| `src/App.tsx` (or `main.tsx`) | Call `pruneStaleBgItems()` once post-login. | ~5 |
| `src/lib/wake-probe.check.ts` (new) | tsx-runnable assert file for the probe state machine (open+fail→reconnect-now, pending-timer cancel, no double probe). | ~45 |

### Phase C — Android (Kotlin)

| File | Change | ~LOC |
|---|---|---|
| `android/.../NtfyPushService.kt` | R1: becomes the owner of TWO sockets (kept as ONE service, ONE FGS — shared Handler, shared OkHttp client, per-leg reconnect counters; splitting into a second FGS would double the foreground-notification overhead and the boot-restore surface for zero benefit). New inner `ChatLeg`: reads live sid + stored key from prefs, reads cookie via `CookieManager.getInstance().getCookie("https://astra.jitinnair.com")` (called on a background thread at each connect attempt), opens `wss://…/api/hx/ws?sid=<liveSid>` with `Cookie` header; no cookie → idle 60s retry (app never logged in / logged out). Cheap substring prescan (`"message.complete"`) before full JSONObject parse so broadcast deltas cost ~nothing. On `message.complete` for the live sid, app backgrounded, not a gate frame → local notification, channel `astra-chat-v2` (IMPORTANCE_DEFAULT, silent, no full-screen intent — gates keep their channel), notify id = hash(session_id + payload msg identity), deep-link `astra://open?path=/c/<storedKey>`. Foreground gating: `onStartCommand` handles new `ACTION_APP_FOREGROUND/BACKGROUND` intents sent from MainActivity — foreground = suppress chat notifications (page renders live). Reconnect machinery shared with ntfy leg (same exponential table, independent attempt counters). 401/403 on upgrade → hard backoff (5 min cap) + re-read cookie next attempt. Re-check prefs every 60s; if the live sid changed, redial with the new filter. | ~120 net |
| `android/.../MainActivity.kt` | R4: `onTrimMemory` — `TRIM_MEMORY_UI_HIDDEN` → `webView.pauseTimers()` (+ `webView.onPause()`, stops rendering — free battery win; safe now that background connectivity is native). `onResume`: `resumeTimers()` + `webView.onResume()` FIRST, then the existing `emitResumeCheck()` (order matters — poking JS into a paused-timer WebView is a dead poke). Also notify service of foreground state: `onPause` → background intent, `onResume` → foreground intent. | ~20 |
| `android/.../NativeNtfy.kt` | New `@PluginMethod setLiveSession(liveSid, storedKey)` → SharedPreferences (`astra_live_sid`, `astra_stored_key`). | ~20 |
| `AndroidManifest.xml` | No new permissions (INTERNET, FGS specialUse, WAKE_LOCK, BOOT all present). No change. | 0 |
| `android/app/build.gradle` | `versionCode`/`versionName` bump (1.5.x). | 2 |

Total: ~90 server, ~165 web, ~160 Kotlin. No new npm deps, no coroutines, no FCM.

---

## 3. Auth/ticket flow — native chat socket

(Corrected: no ticket on this leg. Ticket flow below is shown once to close the loop.)

```
Browser leg (existing, unchanged):
  password → POST /api/login → Set-Cookie astra_session (HttpOnly, 30d)
  → new WebSocket(/api/hx/ws)   [browser sends cookie automatically]

Proxy→gateway leg (existing, unchanged — the ONLY place tickets exist):
  proxy POSTs /auth/password-login → hermes_session cookies
  → POST /api/auth/ws-ticket (single-use, 30s TTL)
  → upgrade /api/ws w/ Sec-WebSocket-Protocol: hermes-gateway-ticket.<t>, hermes-gateway-v1

NEW native leg (R1):
  1. WebView login (or biometric cookie replay on cold start) → cookie in CookieManager.
  2. Page ws-engine, whenever liveSessionId/storedSessionId changes:
       native-session-bridge → NativeNtfy.setLiveSession(liveSid, storedKey) → prefs.
  3. Service ChatLeg connect attempt (every attempt, on its executor thread):
       cookie = CookieManager.getCookie("https://astra.jitinnair.com")
       null/empty → sleep 60s, retry (no app login yet — stay quiet)
       prefs liveSid empty → sleep 60s (no chat identity pushed yet)
       else OkHttp request:
         url  = wss://astra.jitinnair.com/api/hx/ws?sid=<liveSid>
         header Cookie: astra_session=<token>
  4. server.mjs upgrade: validToken(cookie) ✓ → handleWsUpgrade tags socket with sid.
  5. Server forwards ONLY message.complete / message.error frames with
     params.session_id === liveSid (plus protocol pings, which bypass the filter).
  6. message.complete + app backgrounded → local notification → deep-link
     astra://open?path=/c/<storedKey> → MainActivity.handleDeepLink (existing).
  7. onFailure/onClosed → shared exponential backoff (1s→300s cap), re-read cookie
     + prefs at every attempt (cookie expiry/logout re-arms automatically after
     the next in-app login; biometric replay writes the fresh cookie).
```

Why the `?sid=` filter exists at all: an unfiltered background socket receives
EVERY broadcast delta of EVERY session — a radio wakeup and a JSON parse per
few-hundred-ms during any active turn, all day. The filter cuts leg traffic to
~one frame per finished turn + 30s pings. Server cost: one JSON.parse per
upstream frame ONLY while a tagged socket is connected (parse-gated).

---

## 4. Notification dedupe rules (vs ntfy gates)

| Frame | Arrives on | Notification | Rule |
|---|---|---|---|
| approval / clarify / `srq-*` gate frame | ntfy WS AND (unfiltered) chat wire | **ntfy only** | Chat leg never sees gates: `?sid=` filter passes only message.complete/error. Belt-and-braces: Kotlin ignores every frame whose `method` is set or whose id starts `srq-`. → double-notify structurally impossible. |
| `message.complete` (live sid, app backgrounded) | chat leg only | **astra-chat-v2** once | notifyId = hash(session_id + payload msg identity) — same-turn replays replace in place instead of stacking. |
| `message.complete` (other sids) | never delivered | none | Filtered out server-side. |
| `message.complete` (app foreground) | chat leg + page renders | none | Foreground flag (MainActivity → service intents) suppresses chat notifications. |
| `message.error` | chat leg | none in v1 | Background error buzz = noise; owner sees errors live. Revisit if wanted. |
| ntfy gate push | ntfy WS | existing channel | Unchanged flow, unchanged channel. |

No cross-channel id collision: gate notify ids hash the ntfy message id
(existing), chat ids hash session_id+msg identity — different keys, both
`.coerceAtLeast(2)` so neither ever collides with the FGS notification (1001).

---

## 5. Per-requirement test checklist (R1–R10)

Pass criteria are evidence-shaped (subscribers-style), not self-reported.

**R1 — native background chat WS**
- [ ] `journalctl --user -u astra-webui -f` shows `ws-open peers=N sid=<liveSid>` when app opens, and NO `ws-close` for the sid-tagged socket across ≥10 min backgrounded + screen off (phone on WiFi and once on mobile data).
- [ ] `adb shell dumpsys activity services com.jitinnair.astra` — one NtfyPushService instance, specialUse FGS.
- [ ] Server restarted under the socket → reconnect lands (reap/backoff log lines), no manual app open.

**R2 — foreground coexistence**
- [ ] App foreground: proxy log shows peers=2 stable (page + service), no eviction/close lines over 5 min of active chat.
- [ ] Prompt from desktop renders live in the open phone page; NO local chat notification (foreground suppress).
- [ ] 3 browser tabs + service socket (peers=4) all stream the same turn; none dropped.

**R3 — turn-complete notification while backgrounded**
- [ ] Phone backgrounded + screen off; submit a prompt from a DESKTOP tab; on turn end a local notification arrives ≤5s after the server's `message.complete` (compare journald timestamp vs notification — `adb shell dumpsys notification --noredact | grep -A3 astra-chat-v2`).
- [ ] Tap → app opens deep-linked to the right `/c/<sid>`.
- [ ] A gate raised during the same period produces ONE notification (ntfy card), zero from the chat channel.
- [ ] Gate answered from the phone popup card still works (regression: `/api/gate/:id` flow untouched).

**R4 — memory**
- [ ] `adb shell dumpsys meminfo com.jitinnair.astra` TOTAL_PSS: baseline old APK vs new APK, each: foreground, then after 10 min backgrounded. Expect a measurable drop (paused timers + paused WebView rendering). Record both numbers in the phase report.
- [ ] After background→resume, chat immediately streams (resumeTimers-before-poke ordering correct).

**R5 — storage**
- [ ] Chrome remote-inspect the WebView: seed `localStorage["bg_items_fakesid"]`, reload → key gone after the prune pass; real chats' keys survive.
- [ ] Seed a >24h-old `astra-ws-queue-v1` entry → dropped on load.
- [ ] `scripts/transcode-cap.check.mjs` passes (forced eviction under a tiny cap); `du -sh` on the transcode dir ≤ cap after the check.

**R6 — server-side contract**
- [ ] Code-verified (this recon): `browserSockets` Set, no eviction/dedupe — peer-count log lines confirm at runtime (peers≥4 stable in R2 test).
- [ ] Contract paragraph (§1) lands as a comment block in `hermes-proxy.mjs` + this doc.

**R7 — aggregate**: the R1–R5 evidence above IS the deliverable; phase report carries a table (check → evidence line → pass/fail), then `done_gate(claims, evidence)` before "complete" is claimed.

**R8 — server keepalive + zombie reap**
- [ ] `scripts/ws-reap-check.mjs`: silent non-ponging client gets `terminate()`d ≤2 ping rounds (~60s), reap logged.
- [ ] Idle filtered socket (phone backgrounded, quiet chat) survives ≥10 min through the CF tunnel (no close/reopen churn in logs) — pings are doing their job.

**R9 — client wake probes**
- [ ] `npx tsx src/lib/wake-probe.check.ts` all-green.
- [ ] Live: kill the socket via the `__wsSockets` wrapper (established test pattern), switch tab away and back → probe fails → immediate reconnect → banner walks offline→restored→gone.
- [ ] Backoff-timer pending + `online` event fires → timer cancelled, dial now (assert in check file).

**R10 — gapless resume**
- [ ] Verified-by-design (recon): reconnect path is `onSocketOpen → session.resume(storedKey)` → resume reply carries `running` truth (`applyReplyTruth`) → idle ⇒ `turn.settled` ⇒ history re-pull renders the final text; missed deltas never render as loss. Live repro to confirm once: kill socket mid-turn, turn finishes while offline, refocus → final text present exactly once (no-dup invariant, `no-dup.check.ts` still green).
- [ ] Any real gap found → fix inside the existing resume path, not a new mechanism.

---

## 6. Top-3 risks + mitigations

1. **Cookie expiry/logout on the native leg** (30-day TTL; logout clears it):
   401-loops would burn battery. Mitigation: hard 5-min backoff on 401/403, cookie
   re-read at every attempt, quiet-idle when absent. Re-arms itself on the next
   in-app login (biometric replay writes the fresh cookie). Documented behavior:
   chat notifications pause until the app is opened once post-expiry.
2. **Stale `?sid=` filter after a chat switch** (page rebinds liveSessionId, service
   holds the old filter until reconnect): notifications would miss the newly-live
   chat's turn ends. Mitigation: 60s prefs re-check in the service → redial on
   change. Residual window ≤60s; acceptable for a notify path.
3. **`pauseTimers()` global-pause side effects** (pauses ALL the app's WebView
   timers, incl. any plugin JS): safe now only because background connectivity is
   native — the exact reason this plan sequences Phase C AFTER the service owns
   the chat leg. Ordering bug class (poke into paused timers) is fenced by
   resumeTimers-first in onResume + the R4 resume test.

Honorable mention (accepted, not mitigated): background turn-complete notifies
even when the owner is watching the same chat on desktop. If it annoys, add a
"quiet if any other client sent the prompt" heuristic later — not now.

## 7. Build order (agy)

Serialize phases (one agy run at a time in this repo — standing rule); each
phase ends with its runnable checks green before the next starts.

1. **Phase A — server**: hermes-proxy (R8 reap + shared ping loop, `?sid=`
   filter, peer-count logs, contract comment) + transcode cap + both check
   scripts. Hermes restarts `astra-webui.service`, runs
   `node scripts/ws-reap-check.mjs` + `node scripts/transcode-cap.check.mjs`
   live, verifies multi-tab unchanged. Server-first because every downstream
   observation flows through it and it's deploy-safe alone.
2. **Phase B — web**: ws-engine wake probes + native session bridge + store
   staleness + prune + checks (`npx tsx src/lib/wake-probe.check.ts`, existing
   resilience checks re-run). Build via `node node_modules/vite/bin/vite.js
   build` (wrapper-hang rule), md5 disk=served deploy verify, no service
   restart needed (dist-only).
3. **Phase C — Android**: Kotlin (service chat leg + MainActivity trim/fg
   signals + plugin method + version bump). Hermes verifies the artifact
   itself: `./gradlew assembleDebug` under JDK21 env, apksigner verify, dex
   grep for `ChatLeg`/`astra-chat-v2` across ALL classes*.dex, `git status`
   file map, then APK → Telegram sendDocument.
4. **On-device evidence**: R1–R5 checklist above, results table, `done_gate`
   before any "complete".

Out of scope (non-goals, restated): FCM, push-protocol changes, ntfy gate-flow
changes, iOS/Windows, UI redesign, new npm deps, coroutine rewrites.
