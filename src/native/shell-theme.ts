import { Capacitor } from '@capacitor/core';

// Registry access (Capacitor.Plugins.*) instead of static JS wrappers:
// static imports here would fail the web build (vite resolves every reachable
// import) — this file must keep building for the BROWSER bundle too. The
// native modules ARE compiled into the APK and the bridge exposes them by
// plugin name. Same pattern android-resume.ts uses for NativeNtfy.
const Plugins: any = (Capacitor as any).Plugins;

function plugin(name: string): any {
  return Plugins?.[name] ?? {};
}

// One-shot layout telemetry so bar/padding bugs are diagnosed from real device
// numbers instead of guesses. Native shell only; POSTs to /api/diag.
async function reportLayout(tag: string) {
  try {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const env = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft];
    probe.remove();
    const rect = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return [Math.round(r.top), Math.round(r.bottom), Math.round(r.height)];
    };
    const root = document.documentElement;
    const rootStyle = getComputedStyle(root);
    const w = window.innerWidth, h = window.innerHeight;
    await fetch('/api/diag', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tag, ver: '1.4.0',
        win: [w, h], vv: window.visualViewport ? [Math.round(window.visualViewport.width), Math.round(window.visualViewport.height), Math.round(window.visualViewport.offsetTop)] : null,
        screen: [screen.width, screen.height], dpr: window.devicePixelRatio,
        env,
        nativeTop: rootStyle.getPropertyValue('--native-inset-top').trim(),
        nativeBottom: rootStyle.getPropertyValue('--native-inset-bottom').trim(),
        sysTop: rootStyle.getPropertyValue('--safe-area-inset-top').trim(),
        sysBottom: rootStyle.getPropertyValue('--safe-area-inset-bottom').trim(),
        shell: rect(document.querySelector('.app-shell')),
        shellPad: [getComputedStyle(document.querySelector('.app-shell') || document.body).paddingTop, getComputedStyle(document.querySelector('.app-shell') || document.body).paddingBottom],
        header: rect(document.querySelector('.app-shell header')),
        theme: root.getAttribute('data-theme') || 'dark',
        ua: navigator.userAgent.slice(-60),
      }),
    });
  } catch { /* telemetry must never break the app */ }
}

export async function initShellTheme() {
  if (!Capacitor.isNativePlatform()) return;

  // ---- native insets ----------------------------------------------------
  // Full-bleed contract: the WebView fills the screen (no native margins — the
  // capawesome EdgeToEdge margin-applier that boxed the app is gone), the
  // system bars float OVER the page, and only the interactive chrome insets
  // itself via --native-inset-*. Values come from Capacitor core SystemBars'
  // injected --safe-area-inset-* vars (css insetsHandling mode); env() is the
  // fallback for older WebViews where the vars never appear.
  const root = document.documentElement;
  let lastTop = '', lastBottom = '';
  // Fallback insets, used ONLY when neither the injected var nor env() reports anything.
  //
  // CAUTION: when Capacitor's SystemBars takes its PADDING branch it already insets the WebView
  // by the bar heights AND reports the insets as 0. Measuring "screen minus viewport" in that
  // state re-derives the SAME gap and padding again — a double inset that pushes the chrome too
  // far down (observed as nTop 26px / nBot 22px where the bars are ~32px total). So the measured
  // value is used ONLY when the viewport is genuinely full-height (the passthrough branch, where
  // env() should have worked but a stale WebView may still report 0).
  let fallbackTop = 0, fallbackBottom = 0;
  const measureFallback = () => {
    const screenH = (window.screen && window.screen.height) ? window.screen.height : 0;
    const innerH = window.innerHeight || 0;
    const vvH = window.visualViewport ? Math.round(window.visualViewport.height) : innerH;
    const viewportH = Math.max(vvH, innerH);
    const gap = Math.max(0, Math.round(screenH - viewportH));
    // A viewport that already lost the bar height means native padding is in effect: do NOT add
    // our own inset on top. Only a full-height viewport needs the measured fallback.
    const alreadyPadded = gap > 24;
    if (!alreadyPadded) { fallbackTop = 0; fallbackBottom = 0; return; }
    if (gap > 0 && gap < 160) {
      fallbackTop = Math.round(gap * 0.55);
      fallbackBottom = gap - fallbackTop;
    }
  };
  const applyInsets = () => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden';
    document.body.appendChild(probe);
    const readVar = (name: string, envName: string) => {
      const injected = getComputedStyle(root).getPropertyValue(name).trim();
      if (injected && injected !== '0px') return injected;
      probe.style.setProperty('padding-top', `env(${envName}, 0px)`);
      const env = getComputedStyle(probe).paddingTop;
      if (env && env !== '0px') return env;
      return null; // nothing usable -> caller decides
    };
    let top = readVar('--safe-area-inset-top', 'safe-area-inset-top');
    let bottom = readVar('--safe-area-inset-bottom', 'safe-area-inset-bottom');
    probe.remove();
    if (top === null || bottom === null) {
      measureFallback();
      if (top === null) top = `${fallbackTop}px`;
      if (bottom === null) bottom = `${fallbackBottom}px`;
    }
    if (top !== lastTop) { lastTop = top; root.style.setProperty('--native-inset-top', top); }
    if (bottom !== lastBottom) { lastBottom = bottom; root.style.setProperty('--native-inset-bottom', bottom); }
  };

  // ---- bar icon contrast + GateActivity theme ----------------------------
  // Bar BACKGROUND is now the page itself (body background extends under both
  // bars). Only the ICON contrast is set natively, from SystemBars setStyle:
  // DARK style names a dark background (light icons), LIGHT the reverse.
  const parse = (c: string): [number, number, number, number] | null => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  // Sample what the PAGE paints behind each bar: the top edge of the html
  // canvas (body background + any fixed full-bleed layers like Tubes) and,
  // for the bottom, the END OF THE DOCUMENT (scrollHeight) — what you see
  // after scrolling fully down — not the viewport edge, which mid-scroll
  // shows transient content (a bubble sliding past).
  const lum = (c: [number, number, number]) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  const sampleAt = (x: number, y: number, fallback: [number, number, number]): [number, number, number] => {
    const layers: [number, number, number, number][] = [];
    let el: Element | null = document.elementFromPoint(x, y);
    while (el) {
      const c = parse(getComputedStyle(el).backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 1) break; }
      el = el.parentElement;
    }
    let [r, g, b] = fallback;
    for (let i = layers.length - 1; i >= 0; i--) {
      const [lr, lg, lb, la] = layers[i];
      r = lr * la + r * (1 - la); g = lg * la + g * (1 - la); b = lb * la + b * (1 - la);
    }
    return [Math.round(r), Math.round(g), Math.round(b)];
  };

  let lastStyle = '', lastTheme = '', lastDecor = '';
  const updateColors = () => {
    const isLight = root.getAttribute('data-theme') === 'light';
    const rootStyle = getComputedStyle(root);
    // THEME colors in the bars: read the ACTIVE palette's void (the engine writes it on :root
    // per mode) instead of hardcoded astra black/paper — bars follow every theme.
    const voidRaw = rootStyle.getPropertyValue('--color-void').trim();
    const voidM = voidRaw.match(/^(\d+)\s+(\d+)\s+(\d+)$/);
    const rgbStr = voidRaw.match(/^#([0-9a-fA-F]{6})$/);
    let voidRgb: [number, number, number] | null = null;
    if (voidM) voidRgb = [+voidM[1], +voidM[2], +voidM[3]];
    else if (rgbStr) voidRgb = [1, 3, 5].map((i) => parseInt(voidRaw.slice(i, i + 2), 16)) as [number, number, number];
    const base: [number, number, number] = voidRgb ?? (isLight ? [245, 242, 236] : [10, 10, 15]);
    const w = window.innerWidth, h = window.innerHeight;
    const top = sampleAt(w / 2, 1, base);
    // Bottom = document end (what the bar overlays at full scroll), blended
    // with html/body background (the canvas that shows when the page is short).
    const docEnd = Math.min(document.documentElement.scrollHeight - 2, h - 2);
    const bottom = sampleAt(w / 2, docEnd, base);
    // ICON contrast. The bar BACKGROUND comes from the window decor, which styles.xml paints
    // with @color/astra_void — a REAL colour. It must not be @android:color/transparent, which
    // resolves to 0x00000000 and is rendered by Android as OPAQUE BLACK (the "static black bars
    // regardless of theme" bug). Do NOT try to set the background from JS: the SystemBars
    // plugin's setBackgroundColor is documented UNSUPPORTED, and @capacitor/status-bar's is a
    // no-op under edge-to-edge. The page still paints the ACTIVE theme's void over the decor
    // wherever it reaches (insetsHandling: 'css' + viewport-fit=cover), so the bars track the
    // theme; the decor is the colour behind that.
    const style = (lum(top) + lum(bottom)) / 2 > 0.5 ? 'LIGHT' : 'DARK';
    // Use @capacitor/status-bar's setStyle, NOT SystemBars': the SystemBars implementation also
    // runs decorView.setBackgroundColor(getThemeColor(windowBackground)) on every call and again
    // on configuration changes, which OVERWRITES the decor colour we set below (that is why the
    // bars stayed on the theme default instead of tracking light/dark). The status-bar plugin's
    // setStyle only sets the icon appearance, leaving the decor ours to own.
    if (style !== lastStyle) { lastStyle = style; try { plugin('StatusBar').setStyle?.({ style }); } catch { /* optional */ } }
    // Paint the decor with the ACTIVE theme's void, so the bars show the theme colour.
    const hexOf = (c: [number, number, number]) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
    const decorHex = hexOf(base);
    if (decorHex !== lastDecor) {
      lastDecor = decorHex;
      try { plugin('AstraBars').setBackgroundColor?.({ color: decorHex }); } catch { /* optional */ }
    }
    // Native pop-up (GateActivity) follows the app theme.
    const t = isLight ? 'light' : 'dark';
    if (t !== lastTheme) { lastTheme = t; try { plugin('Preferences').set?.({ key: 'astra_theme', value: t }); } catch { /* optional */ } }
  };

  // Push the ACTIVE palette to native surfaces (notifications + gate popup). These are native and
  // outlive the WebView — the notification service holds a notification while the page is gone —
  // so without this bridge they kept the Astra accent forever after a palette change. Resolves the
  // tokens from the LIVE computed styles (so custom token edits count too), not from palettes.json,
  // and is a no-op on web.
  let lastPushed = '';
  const pushThemeToNative = () => {
    const mode = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const cs = getComputedStyle(root);
    const tok = (name: string, fb: string) => {
      const raw = cs.getPropertyValue(name).trim();
      // The engine writes #rrggbb for --color-*; anything else (a channel triple, a color-mix)
      // is not a value the native side can parse, so fall back rather than push garbage.
      return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : fb;
    };
    const tokens = {
      accent: tok('--color-cyanx', mode === 'light' ? '#0369A1' : '#22D3EE'),
      void: tok('--color-void', mode === 'light' ? '#F5F2EC' : '#0A0A0F'),
      surface: tok('--color-midnight', mode === 'light' ? '#FDFCF9' : '#12121A'),
      surfaceHi: tok('--color-depth', mode === 'light' ? '#ECE8DF' : '#1A1A2E'),
      hairline: tok('--color-surface', mode === 'light' ? '#E1DCD1' : '#252538'),
      ink: tok('--color-brandtext', mode === 'light' ? '#0F172A' : '#F8FAFC'),
      muted: tok('--color-muted', mode === 'light' ? '#5B6472' : '#9AA3B2'),
      danger: tok('--color-redx', mode === 'light' ? '#B91C1C' : '#F87171'),
      okay: tok('--color-emerald', mode === 'light' ? '#047857' : '#10B981'),
      amber: tok('--color-amber', mode === 'light' ? '#B45309' : '#FB923C'),
    };
    // Only push on a real change: the ticker below calls this every 5s.
    const sig = mode + '|' + JSON.stringify(tokens);
    if (sig === lastPushed) return;
    lastPushed = sig;
    try { plugin('AstraTheme').sync?.({ mode, tokens }); } catch { /* optional */ }
  };

  applyInsets();
  // Wait for SystemBars' injected vars + first paint, then keep watching —
  // the vars can land after onPageCommitVisible + requestApplyInsets.
  setTimeout(applyInsets, 100);
  setTimeout(applyInsets, 500);
  setTimeout(applyInsets, 1500);
  window.addEventListener('resize', applyInsets);
  requestAnimationFrame(updateColors);
  setTimeout(updateColors, 100);
  setTimeout(updateColors, 500);
  // Native theme push: boot (after the first paint has set the computed tokens), then on every
  // theme/palette change, then on the slow ticker as a safety net for a change that landed while
  // the app was backgrounded. pushThemeToNative() is change-gated, so the ticker costs nothing.
  setTimeout(pushThemeToNative, 300);
  window.addEventListener('astra-theme-change', pushThemeToNative);
  window.addEventListener('astra-palette-change', pushThemeToNative);
  // Slowed from 1200ms to 5000ms (2026-10-03): real-time device measurement
  // showed the per-keystroke timeline re-render (20.5ms at 7,366 DOM nodes) is
  // the dominant lag source; the ticker itself is minor overhead, but reducing
  // it removes a competing timer from the main thread during typing bursts.
  setInterval(updateColors, 5000);
  setInterval(pushThemeToNative, 5000);
  window.addEventListener('resize', updateColors);
  setTimeout(() => reportLayout('boot+2s'), 2000);
  setTimeout(() => reportLayout('boot+6s'), 6000);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
        updateColors();
        setTimeout(() => reportLayout('theme-change'), 400);
        break;
      }
    }
  });

  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
}
