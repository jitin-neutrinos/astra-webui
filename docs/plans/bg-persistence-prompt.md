# PLAN REQUEST — Astra Android: background chat-WS persistence + memory/storage cleanup

You are planning ONLY (no code edits). Produce an implementation plan document.

## Product context (verified facts, do not re-derive)
- Repo: `~/Work/projects/astra-webui`. Vite React TS web app served by zero-dep Node server (`server/server.mjs`, 127.0.0.1:3011, systemd `astra-webui.service`). Public https://astra.jitinnair.com via CF tunnel.
- `server/hermes-proxy.mjs`: holds ONE upstream WS to Hermes gateway :9119; broadcasts every upstream frame to ALL connected browser clients. Multi-client per session already works (multi-tab support).
- Browser chat WS: client connects with a ws-ticket obtained via an authenticated endpoint (find the exact route in server code — search `ws-ticket` / `ticket` in server/*.mjs; do not guess).
- Android shell: Capacitor, `server.url` = live site (no bundled dist). Kotlin at `android/app/src/main/java/com/jitinnair/astra/`:
  - `NtfyPushService.kt` (294 lines): foreground service, `specialUse` type, START_STICKY, OkHttp WS to ntfy with `pingInterval(30s)`, exponential reconnect (cap 300s), boot receiver, foreground notification channel `astra-connection` (IMPORTANCE_MIN), gate notifications channel `astra-push-v2`.
  - `MainActivity.kt`: emits `astra:resume-check` on resume/+10s.
  - Web side: `src/lib/ws-engine.ts` module-singleton WS engine (app-lifetime), resume + durable queue `astra-ws-queue-v1`; `pokeResumeCheck()` recycles silent wires.
- Owner already disabled battery optimization + enabled background tasks for the app on-device.
- Known Android truths (researched, treat as constraints):
  - Backgrounded WebView: JS timers throttled/paused, and Doze kills WebView sockets silently (no close event). Any in-WebView background keepalive is unreliable — the native FGS must own the background connection.
  - `specialUse` FGS has no Android 15 time cap (dataSync is capped 6h/24h — already migrated).
  - CF tunnel idle-kills a quiet WS at ~100s; WS-level pings every 30s prevent this.
  - WebView cookies incl. HttpOnly are readable by native code via `android.webkit.CookieManager.getInstance().getCookie("https://astra.jitinnair.com")`.

## Requirements
- R1 (core): Background chat-WS persistence, native-owned. While the app is backgrounded/closed, a native component (PREFER extending NtfyPushService — one FGS, two sockets, shared reconnect machinery; justify if you split it) holds a second OkHttp WS to the astra chat endpoint (`wss://astra.jitinnair.com/api/ws`-equivalent public route — verify exact path+ticket flow from server code). Auth: read session cookie from CookieManager, fetch fresh ws-ticket per (re)connect, then open WS. pingInterval ≤30s. Reconnect with backoff; START_STICKY + BootReceiver already restore the service.
- R2 Lifecycle: WebView in foreground → service chat-socket may stay connected (cheap, keeps it warm) BUT must not fight the page. Both connections are independent broadcast clients; verify proxy does NOT evict/dedupe per-session connections. App foregrounded → optionally drop service socket only if it saves meaningful battery; default keep-alive.
- R3 Observable value: while app is backgrounded and service socket receives `message.complete` (turn finished) for the live session, raise a LOCAL notification (channel: reuse a low-importance channel or new `astra-chat-v2`) — deep-link into the chat. Dedupe by frame id vs ntfy gate pushes (never double-notify a gate — ntfy already covers gates; suppress if the frame is a gate/approval frame).
- R4 Memory: `onTrimMemory` in MainActivity — on TRIM_MEMORY_UI_HIDDEN call `webView.pauseTimers()` (SAFE now: background connectivity is native; on resume call `resumeTimers()` before/with the existing `astra:resume-check` poke). Any other cheap wins (no largeHeap hacks).
- R5 Storage cleanup:
  - Client: prune `bg_items_<sid>` localStorage keys whose sid no longer exists in the server session list; cap/clear stale `astra-ws-queue-v1` entries.
  - Server: `server/transcode.mjs` disk cache — add a total-size cap (e.g. 512MB) with LRU eviction on write.
- R6 Server-side persistence: verify/ensure (a) proxy accepts concurrent sockets per session without eviction, (b) broadcast dedupe so one logical frame doesn't double-render when both page+service sockets are live client-side is a CLIENT concern — service socket frames must NEVER be injected into the page. Document the contract.
- R7 Verification plan: what to check on-device (subscribers-style evidence: server log showing persistent second WS while app backgrounded ≥10 min; notification on turn-complete while backgrounded; foreground behavior unchanged; memory via `adb dumpsys meminfo` before/after backgrounding; storage before/after cleanup).

## Web-UI persistence requirements (researched pattern: server-initiated heartbeat + client wake probes)
- R8 (server keepalive): `server.mjs`/`hermes-proxy.mjs` client-facing WS — add a 25s protocol-level ping loop over all connected browser sockets, `terminate()` any that did not pong since the last round (zombie reaping). This defeats the CF-tunnel ~100s idle-kill and lets the server reclaim dead clients. Browsers auto-pong invisibly — no client code needed for keepalive itself. Keep one shared interval, stagger-safe.
- R9 (client wake probes): `src/lib/ws-engine.ts` — on `visibilitychange→visible`, `window online`, `pageshow`: if socket OPEN, fire the existing cheap RPC probe (`config.get {key:"mtime"}`) with a ~3s deadline; fail → force-close + reconnect immediately with backoff reset to base. If a reconnect backoff timer is pending → cancel, reset backoff, dial now. Guard against duplicate probes.
- R10 (gapless resume): verify on reconnect the engine re-pulls session history / turn state (existing resume + `turn.settled` re-pull) so frames missed while disconnected never render as lost. Document any gap; fix if real.

## Non-goals
No FCM, no push-protocol change, no changes to ntfy gate flow, no iOS/Windows changes, no UI redesign, no new npm deps, no Kotlin coroutine rewrites.

## Output format (plan doc)
1. Architecture diagram (text): who holds which socket in foreground/background.
2. File-by-file change map (exact paths, what changes, ~LOC).
3. Auth/ticket flow sequence for the native socket.
4. Notification dedupe rules (vs ntfy gates).
5. Per-requirement test checklist (R1–R7) with pass criteria.
6. Top-3 risks + mitigations.
7. Build order (what agy builds first).
