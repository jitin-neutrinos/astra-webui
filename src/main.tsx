import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './fonts.css'
import App from './App.tsx'
// Native-shell bootstrap (push service, resume repair, gate events).
// Native-only inside; inert no-op in regular browsers.
import { initAndroidShell } from './native/android-resume'
// System-bar theming (edge-to-edge, safe-area bands, status/nav bar colors).
// Self-guards native-only; without this call the whole module is tree-shaken
// and the app paints white bands above/below the viewport (drift-erase class).
import { initShellTheme } from './native/shell-theme'
import { CanvasFullscreenProvider } from './components/canvas/canvas-fullscreen'
// White-screen-of-death guard: any uncaught render error must show a recoverable surface, never a blank page.
import { RootErrorBoundary } from './components/root-error-boundary'
// Theme engine: restore the saved palette (no-op when it is the default Astra UI)
// before first paint so a non-default palette never flashes the stock colors.
import { restorePalette, startThemeSync } from './lib/theme-store'

startThemeSync()   // listener first: restorePalette's broadcast must land on it
restorePalette()
initAndroidShell().catch(() => { /* never block app boot on shell glue */ })
initShellTheme().catch(() => { /* never block app boot on shell glue */ })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* White-screen guard wraps EVERYTHING; the canvas cards carry their own finer boundary. */}
    <RootErrorBoundary>
    {/* The fullscreen host is a page-wide singleton. It must be mounted HERE,
        once: mounting it per canvas card produced one overlay AND one
        scroll-lock per card (measured live — four stacked `.ast-cv-full` nodes
        for a single open card, with body overflow stuck at `hidden` after
        close, leaving the chat unscrollable). */}
    <CanvasFullscreenProvider>
      <App />
    </CanvasFullscreenProvider>
    </RootErrorBoundary>
  </StrictMode>,
)
