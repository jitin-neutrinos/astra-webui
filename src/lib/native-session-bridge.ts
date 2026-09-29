// native-session-bridge.ts — pushes the page's session identity to the native
// shell so the Android background chat-socket can subscribe to the right
// session (its upgrade URL carries ?sid=<liveSid>). Browser builds: no-op.
// Native calls are best-effort — chat never depends on the push leg landing.
export function pushLiveSession(liveSid: string | null, storedKey: string | null): void {
  try {
    // Dynamic access (not registerPlugin import) — mirrors android-resume.ts
    // and stays safe under node-run check files where Capacitor is absent.
    const Plugins = (globalThis as any).Capacitor?.Plugins;
    Plugins?.NativeNtfy?.setLiveSession?.({ liveSid, storedKey }).catch(() => {});
  } catch { /* not native / plugin old — background notify stays off */ }
}
