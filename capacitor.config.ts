import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jitinnair.astra',
  appName: 'Astra',
  webDir: 'dist',
  // Load the live, always-current site instead of a bundled copy — Astra is a
  // hosted web app (WS to the Hermes gateway) with no offline-first design,
  // so there is nothing to gain from shipping a stale dist/ snapshot inside
  // the native shell. Update the site, the app picks it up on next launch.
  server: {
    url: 'https://astra.jitinnair.com',
    cleartext: false
  },
  plugins: {
    // THE BARS ARE THE PAGE'S JOB — Capacitor's own inset handling must stay OFF.
    //
    // With the default `css` handling, SystemBars decides between two branches on
    // `getWebViewMajorVersion() >= 140 && hasViewportCover`:
    //
    //   true  -> pass insets through to the page (WebView paints under the bars)
    //   false -> PAD THE DECOR VIEW BY THE BAR HEIGHTS and report zero insets
    //
    // The `false` branch is the trap: on any device whose WebView is below 140
    // (real-device telemetry showed Chrome/153 is fine, but an emulator ships 133,
    // and plenty of phones lag), the WebView is shrunk by the bar heights and the
    // page is told env()/--safe-area-inset-* are 0. The result is exactly what the
    // owner reported: a strip at the top and bottom that the app does not paint,
    // so it shows whatever the window decor is (white before, black now).
    //
    // `disable` skips BOTH branches, so the WebView is never padded and the page
    // always owns the full screen. The web layout already handles the rest:
    // .app-shell carries bg-void and pads its interactive chrome by
    // --native-inset-*, which shell-theme.ts derives from env(safe-area-inset-*)
    // (real on WebView 140+ thanks to viewport-fit=cover) and falls back to a
    // measured probe. Bar icon contrast is still set from the web via
    // SystemBars.setStyle — that call is unaffected by insetsHandling.
    SystemBars: {
      insetsHandling: 'disable',
    },
  },
  ios: {
    // WKWebView contentInset handling for notch/home-indicator safe areas
    contentInset: 'automatic'
  }
};

export default config;
