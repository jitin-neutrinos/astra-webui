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
  }
  // NO plugins block — and @capawesome/capacitor-android-edge-to-edge-support is
  // UNINSTALLED. Its load() margin-applier shrank the WebView by the bar heights
  // (704px of an 848px screen) and painted two flat color strips behind the
  // bars — that was the "top and bottom padding" the owner kept reporting.
  // Capacitor core SystemBars in its DEFAULT `css` insetsHandling mode does the
  // right thing: the WebView fills the screen edge-to-edge, insets pass through
  // to the page (WebView >= 140 + viewport-fit=cover => env(safe-area-inset-*)
  // are real), and it injects --safe-area-inset-* vars. The web layout pads
  // only the interactive chrome (.app-shell) so the theme background extends
  // under both bars. Bar icon contrast is set from the web via SystemBars
  // setStyle (src/native/shell-theme.ts).
  ,
  ios: {
    // WKWebView contentInset handling for notch/home-indicator safe areas
    contentInset: 'automatic'
  }
};

export default config;
