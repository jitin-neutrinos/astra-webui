# BUILD — Phase B (web only): wake probes + native session bridge + storage prune

Read the approved plan FIRST: `docs/plans/android-bg-chat-ws-plan.md` — Phase B section. Implement ONLY Phase B. Do NOT touch server/ or android/. No deploys, no service restarts, no systemd.

Laziest rules: no new npm deps, reuse existing ws-engine machinery (tryImmediateReconnect block ~line 521, config.get mtime probe, backoff refs).

## Changes
1. `src/lib/ws-engine.ts` — R9 wakeProbe():
   - Listeners: `visibilitychange`→visible, `window online`, `pageshow`. Register inside `startEngine()` (window guard), remove on teardown if a teardown path exists.
   - Socket OPEN → race `rpc("config.get",{key:"mtime"})` against a 3s deadline; fail → close socket, null it, reset reconnectAttempt=0, dispatch `new Event("online")` so the existing dial listener reconnects now. Success → nothing.
   - Pending reconnect timer → cancel it, reset backoff, dial immediately.
   - Single-flight `probeInFlight` flag against duplicate probes.
   - Also: subscribe to liveSessionId/storedSessionId changes → call the native bridge (below) with both values.
2. `src/lib/native-session-bridge.ts` (new) — guarded: dynamic-import the plugin registration only when `Capacitor.isNativePlatform()`; browser = no-op export. Exposes `pushLiveSession(liveSid, storedKey)`.
   - IMPORTANT: the native side is Phase C (not built yet). Resolve the plugin via `window.NativeNtfy` / CapacitorPlugins registry with an optional-chained call that fails silent — do NOT import a TS symbol that won't exist yet. Add a TODO marker `// Phase C: NativeNtfy.setLiveSession(liveSid, storedKey)` at the call site.
3. `src/lib/ws-store.ts` — `loadQueue()` drops entries older than 24h (`queuedAt`).
4. `src/lib/prune.ts` (new) — once per 24h (`localStorage["astra-prune-at"]`): GET `/api/hx/sessions?limit=500&order=recent`, delete every `bg_items_<sid>` localStorage key whose sid is absent from the list. Export `pruneStaleBgItems()`.
5. `src/App.tsx` (or main bootstrap after auth resolves) — call `pruneStaleBgItems()` once post-login, fire-and-forget.
6. `src/lib/wake-probe.check.ts` (new) — tsx-runnable assert file: open+fail→reconnect-now, pending-timer cancel→dial now, single-flight (second trigger during flight is ignored). Pure logic importable without a real socket.

## Done condition
`npx tsx src/lib/wake-probe.check.ts` green; `node node_modules/vite/bin/vite.js build` exits 0; existing checks still green (`npx tsx src/lib/streaming-resilience.check.ts`, `request-ownership.check.ts`, `no-dup.check.ts`). Do NOT run the vite build yourself if it hangs — leave it to the operator, but run the tsx checks.
