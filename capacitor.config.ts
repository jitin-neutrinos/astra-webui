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
  ios: {
    // WKWebView contentInset handling for notch/home-indicator safe areas
    contentInset: 'automatic'
  }
};

export default config;
