# BUILD — Phase A (server only): zombie reap + ?sid= filter + transcode cap

Read the approved plan FIRST: `docs/plans/android-bg-chat-ws-plan.md` — Phase A section. Implement ONLY Phase A. Do NOT touch src/, android/, or any web/Kotlin file. No systemd commands, no service restarts, no deploys — the operator handles those.

Laziest-working-solution rules: stdlib only (node: builtins already in use), no new deps, no abstractions beyond what's listed.

## Changes
1. `server/hermes-proxy.mjs`:
   - Replace per-socket `startBrowserPing` with ONE shared 25s loop: ping every browser socket, track lastPong per socket (mark alive on opcode 0xA pong in the decoder), terminate() any socket with no pong since the previous round. First round after connect must not reap (grace).
   - `?sid=` tagged sockets: `handleWsUpgrade` reads `url.searchParams.get("sid")`; tagged sockets go on a separate send path — in the upstream-frame branch, when any tagged socket exists, JSON.parse the frame ONCE and forward ONLY `message.complete`/`message.error` frames whose `params.session_id` matches a tagged sid. No tagged sockets → parsing skipped entirely (opaque relay as today). Protocol pings bypass the filter.
   - Journald one-liners: browser socket open/close with peer count and sid if present (`ws-open peers=N sid=…` / `ws-close …`). These are the operator's on-device evidence source.
   - Contract comment block (from plan §1 R6b) near the socket registry.
2. `server/transcode.mjs`: LRU cap on the transcode disk cache — after a successful transcode only, statSync cache files, sort by atimeMs, delete oldest until total ≤ `ASTRA_TRANSCODE_MAX_BYTES` (default 512 MiB). Keep the existing 7-day TTL sweep untouched.
3. New runnable checks (plain assert, node-runnable, no framework):
   - `scripts/ws-reap-check.mjs` — raw-socket client with a valid cookie completes upgrade then never pongs; asserts the reap happens within 2 ping rounds (~60s). Bound all waits.
   - `scripts/transcode-cap.check.mjs` — tiny cap via env, fake cache files, forced transcode-path call, assert oldest evicted + total ≤ cap.

## Done condition
Both check scripts exit 0 when the operator runs them against the restarted service. `node --check server/hermes-proxy.mjs server/transcode.mjs` clean. Existing behavior for untagged sockets byte-identical (no filter overhead when no sid tags).
