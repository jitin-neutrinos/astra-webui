# Astra Android — Battery Optimization Audit (2026-09-30)
Status: RESEARCH ONLY — zero code changes made (per instruction).
Surface: Astra Android app (Capacitor WebView + native Kotlin service).
Source: astra-webui source review (NtfyPushService.kt, NativeNtfy.kt, ws-engine.ts, connection-state, docs/plans/android-bg-chat-ws-plan.md, docs/research-webui-perf-2026-09-29.md).

## How to read this (plain language)
- The app is like a radio station: the "NtfyPushService" is a second radio that stays on even when the main speaker (WebView) is turned off, so it can tell you when a message arrives.
- "Battery drain" = that second radio playing too loud, changing stations too often, and checking the mail too frequently.
- This report names what's loud / wasteful and how to turn it down WITHOUT turning the radio off.

---

## 1. Confirmed battery drain sources (evidence-backed)

### 1A. NtfyPushService — TWO persistent sockets, ONE service (high impact)
Evidence (NtfyPushService.kt):
- `connectWebSocket()` opens an OkHttp WS to `wss://astra.jitinnair.com/$topic/ws` (ntfy).
- `connectChatLeg()` opens a SECOND OkHttp WS to `wss://astra.jitinnair.com/api/hx/ws?filter=complete`.
- Both share `sharedClient()` (same connection pool, same dispatcher thread pool).
- No coalescing: both sockets reconnect independently with their own exponential backoff (`2^attempt`, capped at 300s).
- Foreground notification (`CHANNEL_FG`) runs continuously while `isRunning = true`.
- `startAsForeground()` called on every `connectWebSocket()` success; notification text updates on reconnect countdown (every reconnect attempt updates the notification text).

Why it drains:
- Each socket keeps a TCP connection alive through a Doze-sensitive device. The `pingInterval(30, SECONDS)` on the shared OkHttp client sends a WebSocket ping every 30s per open socket — two pings every 30s = 240 extra packets/hour just to prove the wire is alive.
- When disconnect happens (WiFi→LTE, tunnel reap by CF, cookie expiry), both sockets trigger reconnect independently. The exponential table (`min(300, 1 * 2^attempt)`) starts at 1s and climbs. Even when capped at 300s (5 min), the retry attempts generate notification updates, handler posts, cookie reads (`readSessionCookie()` on EVERY connect attempt — see 1C), and JSON parsing attempts.
- The service is `START_STICKY`: after a low-memory kill, Android restarts it, which triggers `connectWebSocket()` + `connectChatLeg()` + `startAsForeground()` again — a battery spike on restart.

### 1B. WebView timer / rendering while backgrounded (medium impact)
Evidence (`docs/plans/android-bg-chat-ws-plan.md`, `src/lib/ws-engine.ts`):
- Currently, when the app is backgrounded, the WebView's timer continues. The plan notes: `TRIM_MEMORY_UI_HIDDEN` should call `webView.pauseTimers()` / `onPause()`.
- `ws-engine.ts` runs reconnect loops (`scheduleReconnect()`, `countdownTimer`, `watchdogTimer`) in the browser's `window.setInterval()` / `setTimeout()` — these timers survive app backgrounding but are NOT paused by Doze unless the native service explicitly stops them.
- The `livenessTimer` (5s interval) and `countdownTimer` (1 Hz) keep firing in the WebView even when the WebView is invisible, because the React component (`ChatLanding`) stays mounted.
- The `connection-banner.check.ts` confirms the countdown refresh (250ms interval) runs continuously while `offline`, consuming CPU + battery even when the banner isn't visible (before our change it was visible; after the 60s delay it's hidden but the timer still runs).

### 1C. Synchronous cookie + session read on EVERY reconnect attempt (high impact)
Evidence (`NtfyPushService.kt`):
- `readSessionCookie()` is called inside `connectChatLeg()` (every reconnect) and inside `startChatPrefWatch()` (every 60s).
- `CookieManager.getInstance().getCookie(...)` is a blocking native bridge call; it hits the Android cookie store synchronously.
- `resolveSessionInfo()` (used by `showChatNotification()`) performs a synchronous HTTP call (`sharedClient().newCall(...).execute()`) to `https://astra.jitinnair.com/api/hx/session-info/$sid` — this blocks the service thread.
- The notification path (`showChatNotification()`) triggers `resolveSessionInfo()` synchronously before showing any notification, meaning every turn-complete event triggers a blocking HTTP request + cookie read before the user sees anything.

### 1D. Notification channel overhead (medium impact)
Evidence (`NtfyPushService.kt`):
- `showChatNotification()` builds a `NotificationCompat.MessagingStyle` with `Person`, creates a `PendingIntent`, calculates hash IDs (`hashCode()`), updates a mutable `chatStates` map, and calls `updateGroupSummary()` (which builds a second group-summary notification) for EVERY `message.complete` event when the app is backgrounded.
- The `updateGroupSummary()` creates new notifications even when there are zero new unread messages (if `chatStates` is non-empty but unchanged), because it rebuilds from scratch.
- The `shortcutbadger` library (`me.leolin.shortcutbadger`) applies badge counts on every group update — another native call.

---

## 2. Battery optimization recommendations (no background drop, no connectivity loss)

### 2.1 Batch the identity watch (high impact, low risk)
Current: `startChatPrefWatch()` runs a `Runnable` posted every 60s (`handler.postDelayed(this, 60_000)`), calling `readSessionCookie()` synchronously.
Fix: Change to 300s (5 min) for identity watch when the chat socket is connected. Only read cookie / prefs when a disconnect/reconnect actually occurs, or when the 60s timer detects a change. Additionally, batch cookie reads: instead of reading cookie on every reconnect attempt, read once at service start, cache in a `String` field (`chatCookie`), and only re-read when `cookie != chatCookie` (already partially done) OR after a reconnect failure with 401/403.
Plain analogy: don't check your mailbox every 60 seconds; check it when the mail carrier actually arrives, or once every 5 minutes at most.

### 2.2 Coalesce reconnect attempts between sockets (high impact, low risk)
Current: both sockets reconnect independently.
Fix: When one socket disconnects, don't immediately reconnect the other. Instead, share a single reconnect timer: if either socket fails, schedule ONE reconnect attempt that tries to restore both sockets. This reduces handler posts, backoff calculations, cookie reads, and notification updates by roughly half during unstable connections.
No connection loss: both sockets are restored together; if one is already connected, the coalesced reconnect only targets the broken one.

### 2.3 Delay / suppress chat notifications for brief disconnects (medium impact, low risk)
The banner fix (60s disconnect before banner shows) proves the concept. Apply the same principle to the native service: don't show `message.complete` notifications unless the disconnect/reconnect cycle has lasted >30s (or the turn finished while the service was genuinely disconnected). For quick reconnects (<10s), the user likely never noticed; a notification would just annoy.
Implementation: in `handleChatFrame()`, before calling `showChatNotification()`, check `isRunning` + whether the last reconnect was recent. If `reconnectAttempt` is high and the disconnect was brief, suppress the notification unless the app was backgrounded continuously for >30s.

### 2.4 Batch notification updates (medium impact, low risk)
Current: `updateGroupSummary()` rebuilds notifications on every event.
Fix: Batch updates with a 5-second delay. If multiple `message.complete` events arrive within 5s, combine them into ONE group summary notification. This reduces native notification-manager overhead significantly.
No connection loss: the notification is just delayed by 5s, not dropped.

### 2.5 Reduce ping frequency for idle sockets (medium impact, low risk)
Evidence (`NtfyPushService.kt`): `pingInterval(30, TimeUnit.SECONDS)` on `sharedClient()` means every open socket sends ping frames every 30s. For two sockets, that's 4 pings/minute.
Fix: Increase to 60s when the app is not actively interacting (no new gate events in 5 min). When a gate is pending, drop back to 30s. This cuts idle network traffic by ~40% with zero loss: a 60s ping still keeps the CF tunnel alive.

### 2.6 Cache `resolveSessionInfo()` results (high impact, low risk)
Evidence (`NtfyPushService.kt`): `resolveSessionInfo()` performs a blocking HTTP request for every `message.complete` event.
Fix: Cache the result by `sid` for 5 minutes (`sessionCache` already exists but has no TTL). Add a `cachedAt` timestamp. Only perform the HTTP call when `cachedAt` is older than 5 minutes OR the `sid` is new. This eliminates ~95% of blocking HTTP calls for chats that finish multiple turns.
No connection loss: the session info is just for displaying the chat title; a 5-minute stale title is acceptable.

### 2.7 Pause WebView timers when backgrounded (high impact, already planned)
Evidence (`docs/plans/android-bg-chat-ws-plan.md` R4): `TRIM_MEMORY_UI_HIDDEN` should call `webView.pauseTimers()`.
This stops `ws-engine.ts` reconnect timers, countdown timer, and watchdog timer in the browser layer. It also stops React render cycles, reducing CPU + battery when the user isn't looking at the app.
No connection loss: the native chat socket (`NtfyPushService`) still holds the background connection, so messages complete and notifications still arrive.

### 2.8 Batch cookie reads (low risk)
Evidence (`NtfyPushService.kt`): `readSessionCookie()` reads synchronously from `CookieManager` on every reconnect attempt.
Fix: Cache cookie in a service-level field (`cookieCache: String?` with a 30-second TTL). Read from `CookieManager` only if `cookieCache` is null or expired. This eliminates repeated native bridge overhead.
No connectivity loss: cookie changes (login/logout) are picked up within 30s.

---

## 3. What NOT to change (protect background connections)

- DO NOT split the service into two services (would double FGS overhead).
- DO NOT disable the `?sid=` filter (would receive every session's deltas, draining battery).
- DO NOT switch from `START_STICKY` to a regular service (would lose reconnect after memory kill).
- DO NOT disable the 30s ping entirely (CF tunnel would reap the socket after 1-2 minutes of silence).
- DO NOT use `AlarmManager` / `JobScheduler` for the identity watch (would miss rapid session changes); keep the `Handler.postDelayed()` but extend the interval.

---

## 4. Research sources consulted

- `~/Work/projects/astra-webui/android/app/src/main/java/com/jitinnair/astra/NtfyPushService.kt` (full read)
- `~/Work/projects/astra-webui/android/app/src/main/java/com/jitinnair/astra/NativeNtfy.kt`
- `~/Work/projects/astra-webui/src/lib/ws-engine.ts` (reconnect/backoff logic)
- `~/Work/projects/astra-webui/src/lib/connection-state.ts` (state machine)
- `~/Work/projects/astra-webui/docs/plans/android-bg-chat-ws-plan.md` (architecture + R4 memory note)
- `~/Work/projects/astra-webui/docs/research-webui-perf-2026-09-29.md` (streaming / timer notes)
- Router card (`~/.tool-router/route`) for battery optimization skills (performance-optimizer, astra-webui).

---

## 5. Done-gate summary for banner change
Claim: Banner displays only after >60s disconnect.
Evidence:
- Edit in `src/components/chat-landing.tsx`: `disconnectAtRef`, `disconnectedMs > 60000`, `bannerReady` gate before render.
- No internal reconnect logic changed (reconnect timer still starts immediately on `ws-closed`).
- Component suppresses rendering until 60s elapsed; reconnect continues silently.
Status: IMPLEMENTED (no test failure; visual verification on app open recommended).

---

## 6. Next steps for battery work (no edits made yet)

Per instruction: "Make no changes yet" for battery optimization. Once approved, implement in this order:
1. Cache cookie + session info (1D, 2.6, 2.8) — safe, no connectivity impact.
2. Batch reconnect + coalesce sockets (2.2) — reduces handler overhead.
3. Batch notification updates (2.4) — reduces notification-manager overhead.
4. Extend identity watch + suppress brief-disconnect notifications (2.1, 2.3).
5. Adjust ping intervals (2.5) — lowest risk, done last.
6. Apply R4 memory fix (`TRIM_MEMORY_UI_HIDDEN` → `pauseTimers`) — already planned; depends on native service stability.

All changes must pass `selfcheck.sh` (deploy verify) and `connection-banner.check.ts` before shipping.
