import { Capacitor } from '@capacitor/core';
import { StatusBar, Style as StatusBarStyle } from '@capacitor/status-bar';
import { NavigationBar, Style as NavStyle } from '@capawesome/capacitor-navigation-bar';
import { EdgeToEdge } from '@capawesome/capacitor-android-edge-to-edge-support';

export async function initShellTheme() {
  if (!Capacitor.isNativePlatform()) return;

  await EdgeToEdge.enable().catch(() => {});

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
    
    EdgeToEdge.setBackgroundColor({ color }).catch(() => {});
    StatusBar.setStyle({ style: isLight ? StatusBarStyle.Light : StatusBarStyle.Dark }).catch(() => {});
    NavigationBar.setStyle({ style: isLight ? NavStyle.Light : NavStyle.Dark }).catch(() => {});
  };

  // Wait a tick for CSS to apply, then update
  requestAnimationFrame(updateColors);
  setTimeout(updateColors, 100);

  // Edge-to-edge support for Android 15+:
  // Only injected natively so web behaves normally.
  const meta = document.querySelector('meta[name="viewport"]');
  if (meta) {
    const content = meta.getAttribute('content') || '';
    if (!content.includes('viewport-fit=cover')) {
      meta.setAttribute('content', `${content}, viewport-fit=cover`);
    }
  }

  const style = document.createElement('style');
  style.id = 'astra-safe-areas';
  style.textContent = `
    html, body {
      /* Top band = exactly the notification bar. Because body bg is the themed
         void color, the bar reads as an extension of the app surface (Android
         15 paints bars with what's under them — a colored band is the only
         reliable way to keep it themed). Header starts below the bar. */
      padding-top: env(safe-area-inset-top);
      padding-bottom: env(safe-area-inset-bottom);
    }
    .app-shell {
      padding-top: 0 !important;
    }
    .app-shell {
      /* Prevent 100dvh from pushing content offscreen due to body padding */
      height: calc(100vh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)) !important;
      height: calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)) !important;
      /* Override index.css which has calc(env(safe-area-inset-bottom) + var(--kb)) */
      padding-bottom: var(--kb, 0px) !important;
    }
    .fixed.inset-0 {
      /* Ensure fixed full-screen overlays don't underlap system bars */
      top: env(safe-area-inset-top, 0px) !important;
      bottom: env(safe-area-inset-bottom, 0px) !important;
    }
  `;
  document.head.appendChild(style);

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
