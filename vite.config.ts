import { execSync } from 'node:child_process'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Build stamp for the client update check (src/lib/build-check.ts): the CF
// edge caches index.html for a year regardless of origin no-cache, so the
// running bundle must self-detect a newer server build via /api/build-id and
// reload. Stamping by file mtime fails by construction (vite reads dist's
// mtime BEFORE writing the new files, so build N ship build N-1's mtime and
// every deploy triggers two reload rounds). The stable shared stamp is the
// git commit of the working tree, read identically by the server at request
// time and by vite at build time: same tree → same stamp, deploy → new stamp.
const gitStamp = (() => {
  try {
    return execSync('git rev-parse --short=12 HEAD', { cwd: import.meta.dirname }).toString().trim()
  } catch { return '' }
})()

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __ASTRA_BUILD_ID__: JSON.stringify(gitStamp) },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: { port: 5174 },
})
