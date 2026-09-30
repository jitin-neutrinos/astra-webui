---
name: chats-sidebar
---
# Chats sidebar reference — verified patterns 2026-09-30.

Always-on (hard):
- Unread = server `last_read_at` watermark (PATCH `/api/hx/sessions/<storedKey> { unread: false }`).
  Client overlay from `message.complete` reconciles; replay deduped by `turn_id`. Watching visible chat stamps server immediately (no overlay bump).
- Response-only counting: assistant `message.complete` only; greet (`GREET_RE`), `message.error`, `approval`, `gate`, `message.delta`, tool/thinking skipped.
- Filter switch clears accumulated merged rows (`setSessions([])`) before new fetch.
- Pagination: accumulated; page-2+ preserves merged state.
- Badge icons: custom single-color filled glyphs (`fill: currentColor; stroke: none`); no purple; no third-party icon assets.
- Token chip (`.ast-tok-chip`): `tok:{formatted}` + ` $:{formatted}` in violet-tint, same height/weight as `.ast-model-tag` (cyan-tint).
- Sub-agent lane: backend excludes delegate children; only `oneshot` as separate source filter.
- Greeting: only on real `resetSignal > 0`; never on reload/revisit/reconnect.
- Mobile (390px): `flex-wrap` on `.ast-filter-chip` row; `overflow:hidden; min-width:0` on `.ast-row-title` / `.ast-row-sub`.
- Verification chain before every deploy: `npm run build; selfcheck.sh; md5sum; unread.check.ts; source-filter.check.ts; session-row.check.ts`.
