# ROLE

Adversarial reviewer + fixer for a just-completed UI change in the Astra web UI.
You are NOT the author. Assume the change has bugs. Your job is to find real defects,
prove them, and fix only what you can prove.

# REPO

`~/Work/projects/astra-webui` — Vite + React 19 + TS + Tailwind v4 + `motion` v12.
Build: `npm run build` (runs `tsc -b && vite build`). Checks: `npx tsx <file>.check.ts`.
There is no test framework and you must not add one.

# WHAT WAS BUILT

A rebuild of the chat composer and its options popup, on shadcn registry primitives
(`Command`/cmdk, `Popover`, `Switch`, `Tooltip`, `ScrollArea`, `Separator` from
`src/components/ui/`) plus magicui `BorderBeam`. Files expected to have changed:

- `src/components/composer-controls.tsx` (rewritten)
- `src/components/chat-landing.tsx` (composer JSX ~1502–1590 rewritten; the duplicate
  slash menu and the `slashActive` arrow-key branches deleted)
- `src/index.css` (shadcn token bridge added to `@theme` + `[data-theme="light"]`;
  old `.chat-menu*` / `.chat-yolo-switch` rules removed; composer rules rewritten)
- `src/lib/composer-menu.ts` (NEW — pure logic, extracted for testability)
- `src/components/composer-menu.check.ts` (NEW — self-check)
- `src/components/ui/{command,popover,switch,tooltip,scroll-area,separator,border-beam}.tsx` (NEW, from registry)
- `package.json` / `package-lock.json` (six new deps)

The build agent's own claims are in `scratch/composer/build.log` and
`scratch/composer/build-cli.log`. **Treat every claim as unverified.**

Pre-change backup of the originals: `scratch/composer/backup-pre/` (plus `HEAD.txt`).
The full spec the builder worked from: `scratch/composer/build-prompt.md`.

# CHECK THIS, IN ORDER

## 1. Build gate
`npm run build` → must exit 0. `npx tsc -b` clean. Report real output.

## 2. Regression: the check files
Run EVERY `*.check.ts` in `src/` (there are ~30). Paste the pass/fail line for each.
Any pre-existing failure that is NOT caused by this change must be reported as
pre-existing, not silently fixed. Any NEW failure is a blocker — fix it.

## 3. Dead code
Grep `src/` for every identifier and CSS class the spec said to delete:
`chat-menu`, `chat-yolo-switch`, `chat-yolo-knob`, `chat-menu-label`, `chat-menu-item`,
`chat-menu-back`, `chat-slash-menu`, `chat-menu-item-active`, `slashActive`, `setSlashActive`.
Zero hits required outside `scratch/`, `dist/`, `backup-pre/`. Report the exact grep
commands and their output.

## 4. Behaviour preservation — the real risk
The composer drives live messaging. Verify NOTHING regressed. Read the diff, then confirm
each of these still works by reading the code path, not by assuming:
- `fitComposer` still recomputes textarea height on EVERY input change (typing, send-clear,
  slash-pick, draft restore) and still shrinks as well as grows.
- `send()` / `stop()` / `parseCommand` handling of `/bg` and `/steer` is untouched.
- The IME guard (`nativeEvent.isComposing || keyCode === 229`) still short-circuits Enter.
- Touch-keyboard behaviour: Enter inserts a newline when `matchMedia("(pointer: coarse)")`
  matches; sending is the button's job.
- Drag-and-drop attach, paste-attach, and attachment retry still work.
- The "Provider default" row is still non-selectable (gateway `config.set` has no clear value).
- A live model that is NOT in the curated catalog list is still injected into the model list
  and still shown as selected.
- The catalog is still re-fetched each time the popup opens (`onOpen`).
- Nothing in `src/lib/hermes-ws.ts`, `ws-engine.ts`, `ws-store.ts`, `outbox.ts`,
  `drafts.ts`, `normalize-messages.ts` was modified.

## 5. AnimatePresence correctness
For every `AnimatePresence` in the new code, verify against this trap list and report each:
- `return null` / a `!open` early return ABOVE the `AnimatePresence` (exit never plays)
- `key={open}` or `key={isOpen}` instead of a constant/item key
- the animated child nested one level below another conditionally-rendered wrapper
- a wrapper component that drops the `exit` prop instead of spreading props
- `AnimatePresence` outside the Popover portal
- `mode` set on the drill-down swap (must be `"wait"`), `initial={false}` on nested layers

## 6. Reduced motion
`usePrefersReducedMotion` must come from `@/components/chat-timeline` (one source of truth,
not a second hook). Every transform/spring must be gated. Opacity fade must survive.
`BorderBeam` must be fully suppressed. The global `@media (prefers-reduced-motion: reduce)`
block in `src/index.css` must keep the `0.01ms` net and cover every new keyframe/class.

## 7. Accessibility — check the code, name the line
- Real `<label>` for the textarea + `aria-describedby` on the keyboard hint
- `aria-haspopup="dialog"` + correct `aria-expanded` on the options chip
- Yolo is a real `Switch` with `role="switch"` + `aria-checked` (hand-rolled switch CSS gone)
- Focus returns to the options chip on close (not to the textarea)
- `aria-label` on every icon-only button; `aria-hidden` on decorative icons
- `aria-busy` on send while in flight
- Selection state marked by icon/text, never colour alone
- Focus ring is `:focus-visible`, never removed without a replacement
- Contrast: read the ACTUAL hex values shipped and compute the ratios. Body/placeholder/hint
  ≥ 4.5:1, controls/icons/focus ring ≥ 3:1, in BOTH `[data-theme="dark"]` (the default) and
  `[data-theme="light"]`. Report each ratio you actually computed with its inputs. If a ratio
  fails, fix it.

## 8. Theme + responsive
- Every new colour resolves correctly in BOTH themes. Find the light-theme overrides and
  confirm the new token bridge has light equivalents. A token that is only defined for dark
  is a bug.
- Textarea font-size is ≥16px (iOS Safari force-zooms below that; this ships as a Capacitor APK).
- No `backdrop-filter`, no `glass`, no glow, no gradient text, no `z-[9999]`.
- Tap targets ≥44px on the coarse-pointer breakpoint; the send button's hit area is 44px
  even if the visible mark is 34px.

## 9. Motion discipline
No `layout` / `layoutId` anywhere in the composer subtree (the textarea auto-grows per
keystroke, so a measured layout node above it jitters the popup).
No animation of `height`/`width`/`top`/`left`/`margin`.
No `will-change` added to motion elements.
Durations/easings match the spec table in `build-prompt.md` §R5.

## 10. Code quality
- No dead imports, no unused props, no commented-out blocks, no `any` that was avoidable.
- The extracted pure logic in `src/lib/composer-menu.ts` is genuinely pure (no React, no DOM).
- Public exports of `composer-controls.tsx` still satisfy every import site — grep for
  `from "./composer-controls"` and `from "@/components/composer-controls"` and check each.
- No new dependency beyond: `cmdk`, `@radix-ui/react-dialog`, `@radix-ui/react-popover`,
  `@radix-ui/react-switch`, `@radix-ui/react-tooltip`, `@radix-ui/react-scroll-area`,
  `@radix-ui/react-separator`. Report any extra dep in `package.json` diff.
- Comments explain WHY, not what. No AI-slop comments ("// This component renders...").
  No generic filler comments at all.

# RULES

- Fix only defects you can demonstrate. No speculative refactors, no style churn, no
  reformatting untouched code.
- If you change a file, say which line and why.
- Never claim a check passed without pasting its real output.
- If everything passes, say so plainly in one line and stop. Do not invent work.

# OUTPUT

1. `npm run build` result (exit code + real tail of output).
2. Check-file table: name → pass/fail → one-line cause for any failure.
3. Dead-code grep: command + hit count.
4. Behaviour-preservation table: item → PASS/FAIL/BROKEN → evidence (file:line).
5. AnimatePresence trap table: location → clear / trap found.
6. A11y table: item → line → verdict.
7. Contrast: each computed ratio with its inputs, dark and light.
8. Defects you FIXED: file:line, what was wrong, what you changed.
9. Defects you FOUND but did NOT fix: file:line, why you left it.
10. Top 3 residual risks in this change.

Terse. Factual. Command output over prose.
