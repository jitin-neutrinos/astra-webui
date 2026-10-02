# Regression spree 2026-10-02 (evening session) — what shipped and what remains

Session: `20261002_214942_3e0fd8`. Context: a CONCURRENT session was editing
`src/index.css` and `chat-landing.tsx` throughout — several "recurrences" below are
last-writer races with it, not bad fixes.

## Shipped (verified in real Chrome / served bundle)

| Fix | Commit | Proof |
|---|---|---|
| Copy/regenerate row fully inside the bubble (moved from `margin-top:-30px` sibling into an `actions?: ReactNode` slot INSIDE `.chat-turn` / `.chat-bubble-user`; bubbles `position:relative`, `padding-bottom:42px`) | `0ce485d` (landed by the concurrent session carrying the same correction) | 11/11 bubbles: action rect inside bubble rect on all four sides, `parentElement === bubble`, ~9px glyph↔icon gap; re-verified at 390px emulation |
| Comet stray bright tile at tail = zero-length dash renders a DOT under `stroke-linecap: round` (every band's dash pattern starts `0 …`; brightest band's dot at opacity .97 sat at the tail). One value: `butt` | `0a428f6` | A/B pixel capture at one frozen phase: round → discrete speck ~2–3× the border; butt → clean hairline |
| Sidebar vanished under the fixed z-0 video backdrop (guard selector `.app-shell > aside#astra-sidebar` matched 0 elements — aside is nested one level deeper; sibling selector `~ *` can never reach it; z-index on static does nothing) → `aside#astra-sidebar { position:relative; z-index:2 }` | `f51cece` | selector hits 0→1; topmost element at sidebar centre = nav button, not the backdrop |
| Uploaded-video backdrop never played (theme panel stored the raw HOST PATH as `src` → SPA fallback → `MEDIA_ERR_SRC_NOT_SUPPORTED` code 4) → `bgSrc()` rewrites absolute paths to `/api/hx/files/stream?path=…` | `f51cece` | real Chrome: `videoWidth 640`, canvas luma mean 126, 88% non-black; regression check `npx tsx src/components/chat-backdrop.src.check.ts` (7 cases PASS) |
| Header = sidebar glass (owner steer: header blur was a different treatment) | working tree (concurrent session's fix, re-verified here) | computed styles byte-identical: `blur(29px) saturate(1.25)` over `oklab(…/0.45)` on both `.mobile-accent-header` and `.sidebar-glass` |
| Unified slash popup (owner steer: 2 popups → 1, split Web UI / TUI; TUI rows fire `slash.exec` and paint the reply in the chat feed) | working tree | build green at `index-Ddp6MSYD.js`; **not yet visually verified in a browser** |
| Blocked-build workaround: isolated worktree `.wt-build` at HEAD + own changes → clean build `index-BMt9Nwgt.css` with butt + header glass | (not copied to live dist) | worktree build ✓ in 595ms |

## UNRESOLVED at session end — do not assume these are done

1. **The worktree build was never copied into the live `dist/`.** Source says
   `stroke-linecap: butt`; the last served bundle (`index-CASX3-uH.css`) still said
   `round` because `npm run build` failed on the concurrent session's TS6133
   (`doEndSession` unused — it deleted the End-session button mid-edit). If the tail
   tile is "still there", that is why. Grep the SERVED css before re-fixing.
2. **Unified slash popup is undeployed and unverified** — same blocked build.
3. **Owner's last request (unstarted):** delete the End-session button from the chat
   header and move the action into the three-dots row menu in the sidebar Chats
   panel (`ast-row-menu` in `chats-panel.tsx` already has an `onEndSession` slot
   stubbed). NOTE: `endArm` two-phase confirm + `doEndSession` in
   `chat-landing.tsx` are the pieces to relocate; the concurrent session's mid-edit
   deletion was moving the same direction — coordinate, don't fight it.
4. `.wt-build/` worktree and `scratch/apply-css-fixes.py` are leftovers to clean up.

## Fixture traps that faked success (cost 3 cycles)

- video-only mp4 (no audio track) → `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`, error 4.
- MPEG-4 Part 2 encode → `playing:true, readyState:4, currentTime advancing` while
  `videoWidth:0` and every frame paints black. FALSE GREEN.
- `canPlayType('video/mp4') = "probably"` proves nothing about the actual stream.
- Honest green = `videoWidth > 0` + canvas `drawImage` luma sample. Build fixtures
  with `-c:v libx264 -profile:v baseline -c:a aac`.

Related lessons (deploy-vs-src procedure, stacking guards, merged popup wiring):
skill `astra-webui-regression-fixes`.
