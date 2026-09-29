import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
// Native-shell bootstrap (push service, resume repair, gate events).
// Native-only inside; inert no-op in regular browsers.
import { initAndroidShell } from './native/android-resume'

initAndroidShell().catch(() => { /* never block app boot on shell glue */ })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
