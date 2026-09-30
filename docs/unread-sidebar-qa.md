# Unread / sidebar QA traps (2026-10-01, UnreadPill work)

Pitfalls hit live while shipping the animated unread pill (commits 506806b + fa7f19d).
Add to this file; don't re-derive these.

## Pill entrance animation is not frame-capturable from browser_exec

The 180ms one-shot entrance (scale .6→1 + fade, motion/react) cannot be recorded frame-by-frame
through the harness:

- The post-bump React render starves rAF for the harness's awaited `Runtime.evaluate` — every
  promise-probe variant (900ms window, 500ms, 3-frame micro-capture) times out on the IPC, even
  though the same probe pattern works pre-injection.
- Inline-style signature reads miss motion's WAAPI-driven transforms (`style` shows the settled
  `transform: none` during the whole flight).
- Background tabs freeze CSS transitions mid-value, so computed styles lie (documented trap in
  the astra-webui skill — `Page.bringToFront` first, always).

Evidence bar that IS achievable: bump lands (tab title `(N)` grows + `astra_unread_overlay_v1`
key written + pill mounts), settle state correct in both themes + 390px viewport. Treat that as
sufficient for this animation; don't burn an hour re-deriving frame capture.

## Funnel / injection mechanics

- Synthetic injection works: dispatch a MessageEvent into the tapped socket with
  `{method:'event',params:{type:'message.complete',session_id}}`. Raw stored sids pass
  `storedKeyFor`'s fallback mapping. Prefix with `message.delta` or the dedup guard drops the
  complete as a replay.
- `session.create` params: `{source:'webui'}` ONLY. Adding `surface` yields gateway error 4000.
- `AnimatePresence initial={false}` suppresses the entrance on filter-switch remounts BY DESIGN
  (frequent interaction = no animation, emil-design-eng frequency rule).
- CLEANUP after injection QA: injected keys land in `astra_unread_overlay_v1` (purge them), and
  any real throwaway sessions created must be DELETEd via `/api/hx/sessions/<id>` (200 `{ok:true}`,
  already-absent also 200). Correlate by creation-time window + title/message-count — other live
  sessions exist; never delete by title alone.

## CSS layering

- Tailwind v4: color utilities (utilities layer) beat plain author rules. When a semantic class
  owns an element's colors (`.ast-chats-search`), strip the color/border utilities from the
  element AND put border-width in the rule. Otherwise light-mode overrides silently never apply.
- rAF loops armed from `js()` die across harness calls (closure survives, ticks don't). Do
  reset→arm→inject→sample inside ONE in-page expression.
