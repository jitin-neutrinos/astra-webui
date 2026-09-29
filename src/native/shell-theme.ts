import { Capacitor } from '@capacitor/core';

// Registry access (Capacitor.Plugins.*) instead of static JS wrappers:
// @capacitor/status-bar was never installed (it sat in the missing-deps list
// while this module was tree-shaken — see index.css notes). The native modules
// ARE compiled into the APK (capacitor.build.gradle), and the bridge exposes
// them by plugin name. Same pattern android-resume.ts uses for NativeNtfy.
// Static imports here would fail the web build (vite resolves every reachable
// import) — this file must keep building for the BROWSER bundle too.
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
    const chain = (x: number, y: number) => {
      let el: Element | null = document.elementFromPoint(x, y);
      const out: string[] = [];
      while (el && out.length < 6) {
        out.push(`${(String((el as HTMLElement).className || '') || el.tagName).slice(0, 36)}:${getComputedStyle(el).backgroundColor}`);
        el = el.parentElement;
      }
      return out;
    };
    const root = document.documentElement;
    const vv = window.visualViewport;
    let e2e: any = null;
    try { e2e = await plugin('EdgeToEdge').getInsets?.(); } catch { /* optional */ }
    const w = window.innerWidth, h = window.innerHeight;
    await fetch('/api/diag', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tag, ver: '1.2.x',
        win: [w, h], vv: vv ? [Math.round(vv.width), Math.round(vv.height), Math.round(vv.offsetTop)] : null,
        screen: [screen.width, screen.height], dpr: window.devicePixelRatio,
        env, e2e,
        kb: getComputedStyle(root).getPropertyValue('--kb').trim(),
        theme: root.getAttribute('data-theme') || 'dark',
        htmlBg: getComputedStyle(root).backgroundColor, bodyBg: getComputedStyle(document.body).backgroundColor,
        bodyPad: [getComputedStyle(document.body).paddingTop, getComputedStyle(document.body).paddingBottom],
        shell: rect(document.querySelector('.app-shell')),
        shellPadB: getComputedStyle(document.querySelector('.app-shell') || document.body).paddingBottom,
        top: chain(w / 2, 2), topBelow: chain(w / 2, 60), bottom: chain(w / 2, h - 2), bottomAbove: chain(w / 2, h - 60),
        ua: navigator.userAgent.slice(-60),
      }),
    });
  } catch { /* telemetry must never break the app */ }
}

export async function initShellTheme() {
  if (!Capacitor.isNativePlatform()) return;

  // Native EdgeToEdge insets the WebView by exactly the bar heights (app stays
  // inside the usable area, no CSS padding) and paints these colours behind
  // the status + navigation bars.
  await plugin('EdgeToEdge').enable?.().catch?.(() => {});

  // ---- edge sampling ---------------------------------------------------
  // The bars must read as a continuation of whatever the app paints at its very
  // top / bottom edge (login glow, header, composer...), not a guessed theme
  // token. Sample the real composited background there and hand it to the bars.
  const parse = (c: string): [number, number, number, number] | null => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
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
  const hex = (c: [number, number, number]) => '#' + c.map((n) => n.toString(16).padStart(2, '0')).join('');
  const lum = (c: [number, number, number]) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

  let lastTop = '', lastBottom = '', lastStyle = '', lastTheme = '';
  const updateColors = () => {
    const root = document.documentElement;
    const isLight = root.getAttribute('data-theme') === 'light';
    const base: [number, number, number] = isLight ? [245, 242, 236] : [10, 10, 15];
    const w = window.innerWidth, h = window.innerHeight;
    const top = sampleAt(w / 2, 1, base);
    const bottom = sampleAt(w / 2, h - 2, base);
    const topHex = hex(top), bottomHex = hex(bottom);
    if (topHex !== lastTop) { lastTop = topHex; try { plugin('EdgeToEdge').setStatusBarColor?.({ color: topHex }); } catch { /* optional */ } }
    if (bottomHex !== lastBottom) { lastBottom = bottomHex; try { plugin('EdgeToEdge').setNavigationBarColor?.({ color: bottomHex }); } catch { /* optional */ } }
    // SystemBars style names the BACKGROUND: DARK = light icons, LIGHT = dark icons.
    const style = (lum(top) + lum(bottom)) / 2 > 0.5 ? 'LIGHT' : 'DARK';
    if (style !== lastStyle) { lastStyle = style; try { plugin('SystemBars').setStyle?.({ style }); } catch { /* optional */ } }
    // Native pop-up (GateActivity) follows the app theme.
    const t = isLight ? 'light' : 'dark';
    if (t !== lastTheme) { lastTheme = t; try { plugin('Preferences').set?.({ key: 'astra_theme', value: t }); } catch { /* optional */ } }
  };

  // Wait a tick for CSS to apply, then update
  requestAnimationFrame(updateColors);
  setTimeout(updateColors, 100);
  setTimeout(updateColors, 500);
  setInterval(updateColors, 1200);
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

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
}
