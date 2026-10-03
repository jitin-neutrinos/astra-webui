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
    // LEAVE THIS AT THE DEFAULT (`css`). Do NOT set insetsHandling: 'disable'.
    //
    // SystemBars picks a branch on `getWebViewMajorVersion() >= 140 && hasViewportCover`:
    //
    //   true  -> WebView fills the screen, real insets are injected as
    //            --safe-area-inset-*, and the page pads itself. The page's own
    //            background paints under both bars, so the bars show the ACTIVE
    //            theme colour while the content stays inside its bounds. This is
    //            the owner's device (real-device telemetry: WebView 153,
    //            env(safe-area-inset-top) = 32px).
    //   false -> WebView is padded by the bar heights and reports zero insets;
    //            content is still inside its bounds, the decor shows in the bars.
    //
    // `disable` skips BOTH, which removes the inset injection entirely: the
    // WebView fills the screen AND the page is told there are no insets, so the
    // chrome slides under the status bar and nav bar. That was the "app bleeds
    // into the status bar" regression — a fix aimed at an old-WebView emulator
    // broke the modern device. The default is correct for the real target.
    SystemBars: {
      insetsHandling: 'css',
    },
  },
  ios: {
    // WKWebView contentInset handling for notch/home-indicator safe areas
    contentInset: 'automatic'
  }
};

export default config;
