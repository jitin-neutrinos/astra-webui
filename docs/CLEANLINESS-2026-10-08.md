# Astra Web UI — Cleanliness Report (2026-10-08)

## State: CLEAN

| Check | Result |
|---|---|
| git status | clean (0 modified, 0 untracked) |
| local vs origin | in sync (origin/main == HEAD) |
| check suite | 133 passed, 0 failed, 1 skip (ops-pages needs live creds) |
| tsc -b | clean |
| vite build | clean |
| production service | active, health 200, pinned Node 22.23.3 (SQLite 3.51.3) |

## What was done in this pass

1. **RG-151 pinned** — session-files catalog cache-bypass check was unpinned (gate flagged it); pinned with its bug story.
2. **6 foreign work streams committed** (after verifying: tsc clean, full build, full suite, live title-search route auth-gated correctly):
   - sidebar title search (chats-panel + /api/hx/sessions/titles gateway route)
   - theme/font/shape/brand persistence (theme-store, theme-panel, main.tsx, index.html pre-paint, theme-sync server)
   - canvas-sanitize page preservation + wave-1 allowlist
   - chat-timeline brand icon + silent-blank canvas guard
   - canvas-blocks duplicate sequence case removal
   - attachment-tray filename + aria-label
3. **Pushed**: main was 16 commits ahead; after this pass ~33 commits pushed to origin (github.com/jitin-neutrinos/astra-webui), HEAD = d81cf31.
4. **Debris removed**: 72 patch_*.cjs one-offs (gitignored; several deleted), probe/scratch/test junk (~50 files deleted, tracked scratch/ probes committed-then-removed), dist-cssprobe/, parity-out/, gtest files, src/index.css.pre-tok, unused src/components/ui/chart.tsx.
5. **gitignore extended**: runtime data (dbs/backups/locks/theme-bg), patch_*.cjs, probe/scratch patterns, parity-out/, dist-cssprobe/; untracked graphify-out/ (103 MB derived), read-state/theme-state/gate/test ledgers, command-registry cache — history preserved for audit, live files untouched on disk.
6. **Docs committed & triaged**: research findings (offline-first storage, stream persistence, ordering/merge, voice notes, canvas raw-code proposal), 6 training-pipeline reviewer notes, 3 known-bugs RCAs, AGENTS.md, ARCHITECTURE.md.
7. **Node upgrade (SQLite WAL bug)**: production service was ALREADY pinned to ~/.local/node-22.23.3 (SQLite 3.51.3, fixed) — the failing check ran against the dnf system node (22.22.2, SQLite 3.51.2, vulnerable). Fix: node/npm/npx/corepack symlinked into ~/.local/bin (already first in PATH) → every shell now resolves 22.23.3. Suite went 131+2fail → **133 pass, 0 fail**. No sudo needed; dnf nodejs left untouched (Nobara repos have nothing newer; dnf nodejs 24 would actually REGRESS SQLite to 3.50.4 — documented in the check itself).
8. **css-surface check updated** to pin the new composer contract (inner cards borderless, shell carries the bubble outline) — the old persistent-glow pin was superseded by the owner's steer.

## Remaining open items (deliberate, documented)

- **known-bugs/canvas-raw-code-while-focused-rca.md** — root-caused, fix NOT implemented (mechanism proven, browser persistence not reproduced). Real work remaining if it still reproduces.
- **known-bugs/touch-target-layout-shift.md** — iPad logo offset, root-caused, fix not implemented.
- **known-bugs/training-pipeline-r5-flake.md** — FIXED 2026-10-03, kept as record.
- **ops-pages.dom.check.mjs** — skips without live creds (ASTRA_WEBUI_PASSWORD + playwright); runs only when env provided.
- dnf system nodejs stays 22.22.2 until Nobara ships ≥22.23.3; local 22.23.3 covers all dev + prod paths.
