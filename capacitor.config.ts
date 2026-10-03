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
    // LEAVE insetsHandling AT THE DEFAULT (`css`). Do NOT set 'disable'.
    //
    // SystemBars picks a branch on `getWebViewMajorVersion() >= 140 && hasViewportCover`:
    //
    //   true  -> WebView fills the screen and real insets are injected as
    //            --safe-area-inset-*, so the page pads itself and its own
    //            background paints under both bars (the bars show the ACTIVE
    //            theme colour). This is what we want.
    //   false -> the WebView is PADDED by the bar heights and the insets are
    //            CONSUMED (injected as 0), so the page cannot paint the bars and
    //            the transparent decor shows through as BLACK.
    //
    // `hasViewportCover` starts FALSE and is only set once onPageCommitVisible has
    // run the viewport-meta JS — so on a real device the FIRST inset pass takes
    // the padding branch and the black bars stick (owner telemetry: win 752 /
    // env 0px on the `css` build vs win 784 / env 32px on the previous one).
    // initialViewportFitValueHint is the documented way to seed it: we KNOW the
    // meta is `viewport-fit=cover`, so the correct branch is taken from the start
    // with no layout shift and no black bars.
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
  },
  ios: {
    // WKWebView contentInset handling for notch/home-indicator safe areas
    contentInset: 'automatic'
  }
};

export default config;
