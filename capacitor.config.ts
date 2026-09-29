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
    // Root cause of the padded bands: Capacitor's core SystemBars pads the whole
    // window by the bar heights AND zeroes the insets, so EdgeToEdge's themed
    // overlays got height 0 and the bare window background showed instead.
    // Disable that padding; EdgeToEdge insets the WebView by exactly the bar
    // heights and paints the theme colour behind the bars.
    SystemBars: { insetsHandling: 'disable' },
    EdgeToEdge: { backgroundColor: '#0a0a0f' }
  },
  ios: {
    // WKWebView contentInset handling for notch/home-indicator safe areas
    contentInset: 'automatic'
  }
};

export default config;
