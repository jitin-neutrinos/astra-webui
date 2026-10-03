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
  // Fallback insets measured natively (window vs viewport, in CSS px). Used only when
  // env(safe-area-inset-*) reports nothing, which is the case on a WebView that never got the
  // SystemBars CSS injection (we now run insetsHandling: 'disable' so the page owns the full
  // screen). Without a real fallback the chrome would sit under the bars.
  let fallbackTop = 0, fallbackBottom = 0;
  const measureFallback = () => {
    // The activity is edge-to-edge, so the difference between the physical screen and the
    // WebView viewport is the bar space. visualViewport is the most reliable source.
    const screenH = (window.screen && window.screen.height) ? window.screen.height : 0;
    const innerH = window.innerHeight || 0;
    const vvH = window.visualViewport ? Math.round(window.visualViewport.height) : innerH;
    const viewportH = Math.max(vvH, innerH);
    // screen.height is in CSS px on Android WebView; guard against a bogus value.
    const gap = Math.max(0, Math.round(screenH - viewportH));
    if (gap > 0 && gap < 160) {
      // Split the gap: the status bar is the larger share on modern phones. If we already know
      // one side, attribute the remainder to the other.
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
      return null; // nothing usable -> caller falls back to the measured value
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

  let lastStyle = '', lastTheme = '';
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
    // ICON contrast only. The bar BACKGROUND is not set from here: the window decor is
    // transparent (styles.xml windowBackground) and the page paints the ACTIVE theme's void
    // under both bars via .app-shell (bg-void + the native insets as padding), so every
    // current and future theme is covered without a native colour call.
    // Do NOT add StatusBar.setBackgroundColor here: at targetSdk 36 edge-to-edge it is ignored
    // for the status bar (shouldSetStatusBarColor returns false) and it cannot reach the
    // navigation bar at all, so it would be a silent no-op that looks like a fix.
    const style = (lum(top) + lum(bottom)) / 2 > 0.5 ? 'LIGHT' : 'DARK';
    if (style !== lastStyle) { lastStyle = style; try { plugin('SystemBars').setStyle?.({ style }); } catch { /* optional */ } }
    // Native pop-up (GateActivity) follows the app theme.
    const t = isLight ? 'light' : 'dark';
    if (t !== lastTheme) { lastTheme = t; try { plugin('Preferences').set?.({ key: 'astra_theme', value: t }); } catch { /* optional */ } }
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
  // Slowed from 1200ms to 5000ms (2026-10-03): real-time device measurement
  // showed the per-keystroke timeline re-render (20.5ms at 7,366 DOM nodes) is
  // the dominant lag source; the ticker itself is minor overhead, but reducing
  // it removes a competing timer from the main thread during typing bursts.
  setInterval(updateColors, 5000);
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
