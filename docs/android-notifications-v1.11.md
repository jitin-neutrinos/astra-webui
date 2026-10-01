# Android notifications v1.11 (2026-10-01)

## What changed (versionCode 15, commits 49cab25 + b289a32)

All three system surfaces (banner heads-up, panel row, lockscreen row) are ONE
`Notification` per event, built in `NtfyPushService.kt`. Branding levers are
native only — web component registries (21st/aceternity/magicui/shadcn) have
nothing that styles Android system notifications; checked, none apply.

- `res/drawable/ic_astra_notify.xml` — flat white 4-point star + spark, alpha
  mask (status-bar small icon on every notification).
- `res/drawable/ic_astra_badge.xml` — flat #0A0A0F tile + solid #22D3EE star
  (large icon; rasterized via `astraBadgeBitmap()` for `setLargeIcon`, resource
  icon for the MessagingStyle `Person`).
- `ic_action_approve/deny.xml` — flat check/X action icons.
- Gate (approval) banner: `setColorized(true)` → flat solid-cyan call-style
  banner. Clarify gates stay standard style with cyan accent.
- Chat replies: MessagingStyle with branded persona; group summary carries
  badge + cyan.
- `GateActionReceiver`: Toast → branded self-clearing confirmation
  notification (`setTimeoutAfter` 4s ok / 8s fail, IMPORTANCE_LOW channel
  `astra-confirm`).

## Status notification (owner spec, 2026-10-01)

The persistent FGS notification (id 1001) is a status carrier:
unread total > 0 → cyan `ic_unread_count` tile + "N unread replies" + badge;
else connected (`ntfyUp`) → green `ic_status_dot` (#10B981);
else red dot (#EF4444) "Connecting…/Reconnecting…".
`publishStatus()` is called from ws onOpen, scheduleReconnect, and both ends of
`publishGroupSummary()`. `setOnlyAlertOnce(true)` so count updates never chime.

## Traps

- **PUSH DEAD AFTER FRESH INSTALL** (root cause 2026-10-01, fix 1e33e04): uninstall+reinstall
  wipes `ntfy_conn`; the once-per-process push-pipe arm in `android-resume.ts` fired
  pre-login (/api/ntfy-config 401s, silent catch) and never retried → ntfy `subscribers=0`,
  zero notifications while chat kept working. Diagnosis: `docker logs ntfy` → Server stats
  `subscribers=N` (0 = phone listener gone; server + gate ledger always healthy). Fix:
  `armPushPipe()` rides every `astra:resume-check`. Emulator repro notes: AVD astra36 lives
  in `~/Work/android-sdk/avd` (boot needs `ANDROID_AVD_HOME`), seed creds via run-as cp
  into shared_prefs AFTER force-stop (app rewrites prefs on launch). Status-notification
  green/red dot doubles as health check — red = push leg dead.
- `ntfyUp` starts false; on cold start the dot is red until first ws open —
  correct (it really is connecting).
- `startAsForeground()` takes no text arg anymore; status text derives from
  state. Don't reintroduce `foregroundNotification(text)`.
- All colors flat — owner explicitly banned gradients in notifications.
- Unread state resets when the service dies (in-memory `chatStates`). Accepted
  (same behavior as v1.9); the web unread sidebar is the durable source.
- Unverified on-device: banner/lockscreen visuals + status dot transitions
  need eyes on a real device after install (no adb here). APK handoff via
  Telegram (msg 4817).
