import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
// Native-shell bootstrap (push service, resume repair, gate events).
// Native-only inside; inert no-op in regular browsers.
import { initAndroidShell } from './native/android-resume'
// System-bar theming (edge-to-edge, safe-area bands, status/nav bar colors).
// Self-guards native-only; without this call the whole module is tree-shaken
// and the app paints white bands above/below the viewport (drift-erase class).
import { initShellTheme } from './native/shell-theme'

initAndroidShell().catch(() => { /* never block app boot on shell glue */ })
initShellTheme().catch(() => { /* never block app boot on shell glue */ })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
