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

export async function initShellTheme() {
  if (!Capacitor.isNativePlatform()) return;

  // Native EdgeToEdge insets the WebView by exactly the bar heights (app stays
  // inside the usable area, no CSS padding) and paints these colours behind
  // the status + navigation bars.
  await plugin('EdgeToEdge').enable?.().catch?.(() => {});

  const updateColors = () => {
    const root = document.documentElement;
    const computedStyle = getComputedStyle(root);
    let color = computedStyle.getPropertyValue('--color-void').trim();
    if (!color) {
        color = getComputedStyle(document.body).getPropertyValue('--color-void').trim();
    }

    const isLight = root.getAttribute('data-theme') === 'light';
    if (!color) {
        color = isLight ? '#f5f2ec' : '#0a0a0f';
    }

    try { plugin('EdgeToEdge').setBackgroundColor?.({ color }); } catch { /* optional */ }
    // SystemBars style names the BACKGROUND: DARK = light icons, LIGHT = dark icons.
    try { plugin('SystemBars').setStyle?.({ style: isLight ? 'LIGHT' : 'DARK' }); } catch { /* optional */ }
  };

  // Wait a tick for CSS to apply, then update
  requestAnimationFrame(updateColors);
  setTimeout(updateColors, 100);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
        updateColors();
        break;
      }
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  });
}
