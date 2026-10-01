// android-resume.ts — Capacitor-shell bootstrap. Loaded ONLY on native
// platforms (guarded by Capacitor.isNativePlatform()). Glues four native-side
// realities to the web app:
//
// 1. RESUME REPAIR — when the app returns to the foreground, Doze may have
//    silently dropped the WS (no `close` event ever fires inside a frozen
//    WebView). The shell signals `astra:resume-check` on resume + ~10s later;
//    chat-landing forwards that to hermes-ws's pokeResumeCheck(), which forces
//    a reconnect cycle if the wire has been silent beyond the transport window.
//    This is the root fix for "app disconnects quickly / stops responding /
//    must kill and reopen the app".
// 2. PUSHPERM — ask POST_NOTIFICATIONS once (Android 13+), then offer
//    full-screen-intent (lock-screen popup) special access at most once a day.
//    Both user-revocable; failures degrade to heads-up only, never crash.
// 3. GATE EVENTS — native GateReceiver broadcasts gate JSONs as
//    `astra:gate` CustomEvents; re-emitted as `astra:gate-native` for any
//    global listener (in-app banner when the gate's chat is NOT the open one).
// 4. PUSH PIPE — ensure the ntfy foreground service is running with the
//    server's topic config, fetched from /api/ntfy-config (cookie auth).
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

let booted = false;

export async function initAndroidShell(): Promise<void> {
  if (booted) return;
  booted = true;
  if (!Capacitor.isNativePlatform()) return;
  if (Capacitor.getPlatform() !== "android") return;

  // -- 2. push permissions ----------------------------------------------------
  try {
    const Plugins: any = (Capacitor as any).Plugins;
    const status = await Plugins?.NativeNtfy?.permission?.();
    if (status?.granted === false && status?.canAsk === true) {
      await Plugins?.NativeNtfy?.askPermission();
    }
  } catch {
    // permission methods absent on older builds — Android <13 needs no runtime ask
  }
  try {
    const Plugins: any = (Capacitor as any).Plugins;
    const fsi = await Plugins?.NativeNtfy?.canFullScreenIntent?.();
    if (fsi?.granted === false) {
      // Don't nag on every launch — at most once per day.
      const last = Number((await Preferences.get({ key: "astra_fsi_ask" })).value || 0);
      if (Date.now() - last > 86_400_000) {
        await Preferences.set({ key: "astra_fsi_ask", value: String(Date.now()) });
        await Plugins?.NativeNtfy?.requestFullScreenIntent();
      }
    }
  } catch { /* optional */ }

  // -- 4. push pipe -----------------------------------------------------------
  // Ensure the native foreground service holds ONE subscription to the ntfy
  // topic. Config comes from the server (env-injected NTFY_URL/TOPIC/AUTH b64)
  // so no secret is bundled into the APK and rotation is server-side.
  //
  // Re-arm on EVERY app resume, not just process start: a fresh install (or
  // cleared data) cold-boots this module BEFORE login, /api/ntfy-config 401s,
  // and the old once-per-process guard then left the push service idle
  // forever ("subscribers=0" on ntfy, no notifications at all). Login only
  // happens later, so the retry has to ride the resume event.
  let arming = false;
  const armPushPipe = async () => {
    if (arming) return;
    arming = true;
    try {
      const res = await fetch("/api/ntfy-config", { credentials: "same-origin" });
      if (res.ok) {
        const cfg = await res.json();
        if (cfg?.url && cfg?.topic && cfg?.auth) {
          const conn = `${cfg.url}|${cfg.topic}|${cfg.auth}`;
          const prev = (await Preferences.get({ key: "ntfy_conn" })).value;
          if (prev !== conn) {
            await Preferences.set({ key: "ntfy_conn", value: conn });
          }
          await (Capacitor as any).Plugins?.NativeNtfy?.start();
        }
      }
    } catch { /* push unavailable — chat still works fully */ }
    arming = false;
  };
  armPushPipe();

  // -- 1+3. resume repair + gate events --------------------------------------
  // The Kotlin side emits `astra:resume-check` on every onResume + ~10s later.
  // Chat-landing listens for `astra:ws-poke` and calls pokeResumeCheck().
  window.addEventListener("astra:resume-check", () => {
    window.dispatchEvent(new CustomEvent("astra:ws-poke"));
    armPushPipe();   // re-arm push after login-then-resume (fresh-install path)
  });

  window.addEventListener("astra:gate", ((e: CustomEvent) => {
    const detail = e.detail || {};
    window.dispatchEvent(new CustomEvent("astra:gate-native", { detail }));
  }) as EventListener);
}
