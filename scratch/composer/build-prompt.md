# ROLE

Senior product-design engineer. Redesign and rebuild the **chat composer** and its
**options popup** in the Astra web UI. You have authority over layout, markup and CSS.
You have ZERO authority over messaging behaviour — see NON-GOALS.

# REPO

`~/Work/projects/astra-webui` — Vite + React 19 + TypeScript + Tailwind v4 + `motion` v12
(import from `motion/react`) + lucide-react. There is currently **no shadcn theme layer**
(only `@radix-ui/react-collapsible` is installed). Styling is hand-written CSS in
`src/index.css` (1580 lines) plus Tailwind utility classes in JSX.

## Verified facts about the current code — do not re-derive

- `src/components/composer-controls.tsx` (244 lines) — the options chip + the whole
  hand-rolled 3-level drill-down popup (`role="dialog"`, children are
  `<button aria-selected>`). Exports `Attachment`, `filesToAttachments`, `CatalogPayload`,
  `EFFORTS` (local const), `ComposerControls`.
- `src/components/chat-landing.tsx` (1599 lines) — the page. Composer JSX is at
  **lines 1502–1590**. A SECOND hand-rolled menu exists at **lines 1534–1544**
  (`.chat-slash-menu` slash-command listbox). State: `slashOpen`, `slashActive`
  (lines 242–243), `slashMatches` (line 1131), `pickSlash` (line 1133), `onKey`
  (line 1141) intercepts Arrow/Enter/Escape while `slashOpen`.
- Autosize `fitComposer` (chat-landing.tsx ~line 1113) recomputes textarea height on every
  `input` change. **Keep this behaviour exactly.**
- `send()` parses `/bg` and `/steer` client-side via `parseCommand` from `@/lib/slash-commands`.
- `TUI_COMMANDS` const at chat-landing.tsx ~line 46.
- `usePrefersReducedMotion` is exported from `src/components/chat-timeline.tsx`.
  Use it. Do not add a second reduced-motion hook.
- Design tokens live in `src/index.css`: `@theme` block has `--color-void #0a0a0f`,
  `--color-midnight #12121a`, `--color-depth #1a1a2e`, `--color-surface #252538`,
  `--color-brandtext #f8fafc`, `--color-muted #6b7280`, `--color-cyanx #22d3ee`,
  `--color-violetx #8b5cf6`, `--color-redx #f87171`. Fonts: DM Sans (sans),
  Playfair Display (display), JetBrains Mono (mono). `:root` has `--motion-fast 150ms`,
  `--motion-slow 220ms`, `--ease-brand cubic-bezier(0.2,0,0,1)`,
  `--surface-base/raised/overlay/step2`, `--radius-inner/outer/pill`.
  `[data-theme="light"]` overrides exist further down the file — READ them before editing.
- Existing composer CSS: lines 180–208 and 252–283. Popup/menu CSS: 263–269, 277–283.
  Light-theme overrides for these start around line 836.
- Media queries: `@media (max-width: 1023px)` (~line 640) enlarges tap targets; there are
  narrow-screen rules at ~653–661. Keep and extend them.
- `src/lib/utils.ts` exports `cn` (clsx + tailwind-merge). Both deps installed.
- Self-check files are `*.check.ts` and run with `npx tsx <file>`. They use a plain
  `ok(cond, msg)` + `process.exit(1)` pattern. There is NO test framework. Do not add one.
- `components.json` exists (style new-york, aliases `@/components`, `@/lib/utils`,
  `@/components/ui`), but `npx shadcn@latest` FAILS validation in this repo
  (`Validation failed: - tailwind: Required`). **So: do not run the shadcn CLI.**
  Registry source for the components below is already downloaded to
  `scratch/composer/registry/` — copy from there.

# COMPONENTS TO INSTALL — verbatim registry code, do not handroll, do not rewrite

Copies are already on disk in `scratch/composer/registry/`. Read each, then write it into
`src/components/ui/` under the same filename. Preserve them as close to verbatim as
possible so future upstream syncs stay trivial.

| target file | source file in scratch/composer/registry | npm deps to add |
|---|---|---|
| `src/components/ui/command.tsx` | `shadcn__command__command.tsx` | `cmdk`, `@radix-ui/react-dialog` |
| `src/components/ui/popover.tsx` | `shadcn__popover__popover.tsx` | `@radix-ui/react-popover` |
| `src/components/ui/switch.tsx` | `shadcn__switch__switch.tsx` | `@radix-ui/react-switch` |
| `src/components/ui/tooltip.tsx` | `shadcn__tooltip__tooltip.tsx` | `@radix-ui/react-tooltip` |
| `src/components/ui/scroll-area.tsx` | `shadcn__scroll-area__scroll-area.tsx` | `@radix-ui/react-scroll-area` |
| `src/components/ui/separator.tsx` | `shadcn__separator__separator.tsx` | `@radix-ui/react-separator` |
| `src/components/ui/border-beam.tsx` | `magicui__border-beam__border-beam.tsx` | none (`motion` already installed) |

Install the deps with `npm install` (project deps only — never sudo, never global).
Do NOT add gsap. Do NOT add any other dependency.

`src/components/ui/shine-border.tsx` is on disk as an **option** — use it ONLY if it earns
its place; border-beam is the default choice. Say in your report why you chose.

## Required: shadcn token bridge

The registry components reference tokens that do not exist in this repo. Add a token
bridge to the `@theme` block in `src/index.css` mapping shadcn names onto the EXISTING
brand variables — never introduce a new colour. Minimum set:
`--background, --foreground, --card, --card-foreground, --popover, --popover-foreground,
--primary, --primary-foreground, --secondary, --secondary-foreground, --muted,
--muted-foreground, --accent, --accent-foreground, --destructive, --border, --input,
--ring, --radius`.
Map `--primary` → `--color-cyanx`, `--background` → `--color-void`, `--popover` →
`one step above --color-depth`, `--muted-foreground` → `--color-muted`, etc. Provide
`[data-theme="light"]` overrides for the same set, matching the existing light palette.
Read the light-theme block first so you match its actual values.

# R1 — One menu system, not two

Delete the hand-rolled `.chat-menu` markup. Build ONE primitive on top of
`Command` + `Popover` and use it for BOTH the options popup and the slash-command listbox.

- Options popup: `Popover` (portal + fixed positioning, so it can never be clipped by an
  `overflow:hidden` ancestor) wrapping a `Command`. `CommandInput` gives typeahead
  filtering for free — this is the fix for the 100+ item model list.
- Slash listbox: the same `Command` primitives in a no-input variant
  (`Command` + `CommandList` + `CommandGroup` + `CommandItem`, no `CommandInput`).
  Keyboard behaviour (arrows / Home / End / typeahead / Enter-to-pick / Escape-to-close)
  comes from cmdk — delete the hand-rolled `slashActive` index state and the arrow-key
  branches in `onKey`. Keep the IME guard (`isComposing` / `keyCode 229`) intact.

# R2 — Two levels maximum, never three

Root panel rows: **Attach files**, **Yolo mode** (switch), **Reasoning effort ›**,
**Model ›**.

- Effort subpanel: the 8 `EFFORTS` values. Keep "Provider default" as a non-selectable
  state row exactly as today (gateway has no clear value — see the comment at
  composer-controls.tsx:181).
- Model subpanel: a provider filter (the existing provider list) plus a filtered model
  list. Keep the live-but-custom model injection logic verbatim
  (composer-controls.tsx lines 226–229) and keep `onOpen` re-fetching the catalog.
- Fixed panel width 280px, identical at both levels, `transform-origin` at the trigger
  corner. Back row carries the parent name + chevron.

# R3 — Composer layout rebuild

One bordered container; textarea region on top; ONE control bar anchored to the bottom
edge behind a 1px `border-t` divider so it reads as a child region.

- Exactly ONE primary control on the right: send (or stop while streaming).
- Left side: options chip + a **state chip that shows the live model and effort** so the
  user can see the current settings without opening anything. Truncate with `min-w-0` +
  `truncate`; never let a long model id widen the bar.
- Keep `Attach files` reachable from the popup (do not add a second attach button).
- Kill the triple-messaging: the placeholder, the `.chat-composer-hint`, and the popup
  must not all repeat the same send/newline sentence. Keep ONE short keyboard hint,
  wire it with `aria-describedby`, and drop it below the bar (or to an icon-only
  affordance) under the narrow-screen breakpoint.
- Composer max width: keep the current `max-w-[52rem]` shell alignment unless you can
  justify the change; consistency with the transcript matters more than the number.

# R4 — Surfaces, colour, type

- **Solid surfaces only.** NO `backdrop-filter`, NO glass, NO glow, NO gradient text, NO
  neon. Three-step solid surface ladder (page base → composer → popup), separated by
  1px borders and one tinted offset shadow `0 8px 24px -8px`, tinted to the background
  hue, not pure black.
- One accent (cyan) only: primary action, current selection, focus. Current selection
  must ALSO be marked by a `Check` icon and/or text — never colour alone.
- Documented radius scale: composer 16px outer, popup 12px, controls 8px, chips pill.
  Add a `--radius-*` var or a comment block recording the scale.
- Type: DM Sans (`var(--font-sans)`) for the composer AND the popup. No Playfair in the
  popup. **Textarea font-size floor 16px** (below 16px iOS Safari force-zooms a focused
  input — this app ships as a Capacitor APK). Secondary text floor 12px.
- **Sentence case everywhere inside the popup.** The current uppercase+`.18em` tracking
  `.chat-menu-label` treatment is being deleted — replace it with sentence-case group
  labels at normal tracking and normal weight. Monospace micro-labels are out.
- Menu row height 32–36px, gap 2–4px, denser than the page. Values right-aligned or
  trailing, always `min-w-0 truncate`.
- Contrast floors: body/placeholder/hint ≥ 4.5:1; controls, icons, focus rings ≥ 3:1 — in
  BOTH themes. Verify by reading the actual hex values you ship, do not assume.
- Give the popup a named z-layer from a documented scale (e.g. `--z-popover: 40`).
  No `z-[9999]`.

# R5 — Motion. Use exactly this set.

Easing: enter `cubic-bezier(0.16, 1, 0.3, 1)`, exit `cubic-bezier(0.4, 0, 1, 1)`.
Animate `transform` and `opacity` ONLY — never `height`, `width`, `top`, `left`, `margin`.
Never `height` during streaming (a jumpy composer while a reply arrives is the worst
possible jank).

| interaction | dur | ease | properties |
|---|---|---|---|
| composer focus ring | 120ms | ease-out | border-color + box-shadow colour only |
| popup open | 160ms | enter | `scale .96→1`, `y 4→0`, `opacity 0→1` |
| popup close | 120ms | exit | `scale →.98`, `y →2`, `opacity →0` |
| panel drill-in | 200ms | enter | `x 24→0` |
| panel drill-out | 160ms | exit | `x 0→±24` |
| yolo switch knob | spring `{stiffness:420, damping:32, mass:0.6}` | — | `x 0→18`; track bg 150ms |
| send press | 90ms / 140ms | ease-out | `scale .94` |
| slash listbox | 140ms / 100ms | enter/exit | `y -4→0` + opacity |

- **`AnimatePresence` correctness is mandatory.** Keep `AnimatePresence` mounted and let
  the conditional child be its DIRECT child with a STABLE key and an `exit` prop. Never
  `return null` above `AnimatePresence`; never `key={open}`; never nest the animated child
  one level below another conditional wrapper; put `AnimatePresence` in the component
  that owns `open` and render the Popover portal INSIDE it.
  `mode="wait"` for the drill-down swap. `initial={false}` on nested layers.
- **No `layout` / `layoutId` anywhere in the composer subtree.** The textarea auto-grows
  on every keystroke, so a measured layout node above it re-continuously and the popup
  will visibly jitter.
- Under `usePrefersReducedMotion()`: drop every transform and spring; keep a ≤200ms
  opacity cross-fade. Never a hard cut, never `linear`. Keyboard-initiated open/close may
  skip animation entirely (it happens hundreds of times a day).
- `BorderBeam`: one instance wrapping the composer. Only visible when the composer is
  focused AND idle (not streaming, no text). `colorFrom`/`colorTo` = the brand cyan and
  violet so it stays on-brand — no orange/purple defaults. Must be fully suppressed under
  reduced motion. Keep it subtle: if in doubt, ship it disabled behind one prop.
- Gate hover transforms behind `@media (hover: hover) and (pointer: fine)`.
- Do not hand-add `will-change` to motion elements.
- Add whatever new keyframes/classes you need to `src/index.css`, and register them in the
  EXISTING `@media (prefers-reduced-motion: reduce)` block (keep the `0.01ms` net, not `0s`).

# R6 — Interaction & accessibility (all of it, not a subset)

- Real `<label>` for the textarea (visually hidden is fine) + `aria-describedby` → the
  keyboard hint. Never rely on the placeholder alone.
- `aria-haspopup="dialog"` on the options chip, `aria-expanded` reflecting state, and a
  chevron that rotates 180° when open.
- Yolo is a REAL `Switch` from `switch.tsx` (`role="switch"`, `aria-checked`). Delete the
  hand-rolled `.chat-yolo-switch` CSS. Keep the explanatory sub-line.
- Close on outside pointerdown and on `Escape`, and **restore focus to the trigger chip**,
  not the textarea.
- `aria-label` on every icon-only button (options, send, stop, back, chevrons);
  `aria-hidden="true"` on decorative lucide icons that sit next to a visible text label.
- `aria-busy` on send while a send is in flight so a double click cannot double-submit.
  Keep the existing `disabled` logic on empty input.
- Send button must keep a 44×44px hit area on touch even if the mark is 34px.
- All seven states for every control: default, hover, focus-visible, active, disabled,
  loading, error. Use `:focus-visible` for rings so pointer users don't see them.
- **Add an inline error row inside the composer for send failures, with a retry action.**
  No toasts for composer failures. This is a real gap today.
- Designed empty state for "no models match" inside the model panel, naming the next
  action. Never a blank panel.
- On coarse-pointer / narrow screens, render the popup as a **bottom sheet**, not a
  dropdown. Tapping a level-1 row pushes level 2 in place; one tap outside returns to
  level 1.
- Keep the textarea focusable and NEVER disable it during streaming.
- Keep `fitComposer` autosize, the `max-height` cap, and add a scroll affordance (a
  top/bottom fade or inset shadow) when the textarea is scrollable so "more below" is
  visible.

# NON-GOALS — out of scope, do not touch

- No change to `send()`, `stop()`, `parseCommand` handling, `/bg`, `/steer`, drafts,
  outbox, WebSocket code, or anything in `src/lib/hermes-ws.ts`, `ws-engine.ts`,
  `ws-store.ts`.
- No redesign of the chat timeline, message bubbles, subagent panel, or bg dock.
- No backend / `server/` changes. No systemd, no tunnel, no DNS. **You do not deploy.**
- No new test framework. No `vitest`/`jest`.
- No new dependency beyond the six listed. No `gsap`.

# FORCED OUTPUT / DELIVERABLES

1. `npm install` the six deps. Show the command and its exit code.
2. Write the seven registry components into `src/components/ui/` (verbatim from scratch).
3. Add the shadcn token bridge to `src/index.css` (`@theme` + `[data-theme="light"]`).
4. Rewrite `src/components/composer-controls.tsx` around the new primitives. Keep its
   PUBLIC EXPORTS backwards-compatible: `Attachment`, `CatalogPayload`, `filesToAttachments`
   (used by `chat-landing.tsx` and `attachment-tray.tsx` — check every import site with
   grep before changing a signature).
5. Update `src/components/chat-landing.tsx` composer JSX (lines 1502–1590) and delete the
   duplicate slash menu (lines 1534–1544) plus the now-dead `slashActive` state and
   arrow-key branches. Verify with grep that no reference to the deleted symbols remains.
6. Add/replace CSS in `src/index.css`. **Delete** the rules you replace — do not leave
   dead CSS like `.chat-menu`, `.chat-yolo-switch`, `.chat-menu-label` behind. Grep the
   whole `src/` at the end for every class you deleted and prove there are zero hits.
7. **One runnable check behind the non-trivial logic.** Add
   `src/components/composer-menu.check.ts` (same `ok(cond,msg)` + exit-1 pattern as the
   existing `*.check.ts` files) that asserts the pure logic you extract: the model-list
   injection rule, the provider→model resolution, the "Provider default is not selectable"
   rule, and the slash-command filter. Extract that logic into a pure module (e.g.
   `src/lib/composer-menu.ts`) so it is testable without rendering.
8. `npx tsc -b` → exit 0. Then `npm run build` → exit 0. Paste both real outputs.
9. Run the new check AND every pre-existing check that touches what you edited:
   `npx tsx src/lib/slash-commands.check.ts` at minimum. Paste real output for each.
10. Report, terse, in this order:
    - the exact files created / modified / deleted, with line counts
    - the deps you installed and their versions from `package.json`
    - every CSS class you deleted and the grep command that proves zero remaining hits
    - which check files you ran and their actual pass/fail output
    - anything you deliberately left alone and why
    - the top 3 risks you see in your own work

Terse. No preamble. No "I will now...". Report facts and command output only.
If you skip a requirement, say which one and why in one line. Never claim a check passed
that you did not run.
