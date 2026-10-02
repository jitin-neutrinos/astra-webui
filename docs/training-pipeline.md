# End-session training pipeline

Live 2026-10-01. Owner flow: End session button (chat header, left of New chat) →
transcript archived → review agent updates skills/agent/project docs → chat deleted
from visible list → transcript retrievable forever.

## Components

| Piece | File | Notes |
|---|---|---|
| Pipeline server module | `server/training.mjs` | SQLite via `node:sqlite` (`DatabaseSync`, WAL), zero npm deps |
| API routes | `server/server.mjs` | `POST /api/training/end-session`, `GET /api/training/sessions[/<sid>]`, `GET /api/training/jobs` |
| Status chip / jobs panel | `src/components/training-status.tsx` | fed by `training.updated` WS events + `/api/training/jobs` |
| End-session button | `src/components/chat-landing.tsx` (header) | arm→confirm within 4s; lands on welcome screen (R7) — see "End ≠ new chat" below |
| WS relay | `src/lib/ws-engine.ts` | `training.updated` server-origin event emitted explicitly |
| Cookie helpers | `server/hermes-proxy.mjs` | `hermesCookieOrNull` (logs errors), re-exported `clearHermesCookie` |
| Checks | `scripts/training.check.mjs`, `scripts/training-pipeline.check.mjs` | 4/4 unit groups; full R2–R5 lifecycle against a fake gateway + fake hermes |
| Build plan (glm-5.3 ultra) | `docs/plans/end-session-training-pipeline.md` | frozen verified-context prompt + file map + risk register |

## Flow

1. Button POSTs `{sid, title, source}` → job row created (`dumping`), API returns
   immediately (409 if a job for the sid is already active).
2. Async dump: paged `order=oldest&limit=200&offset=N` from the gateway; upsert by
   `(sid, row_id)` makes re-dumps idempotent. Markdown export + pre-review tarball of
   the doc estate (skills, SOUL.md, project AGENTS.md) land in `data/training-exports/`.
3. Worker: `hermes chat --oneshot --query-file <prompt> -m glm-5.3-flash --provider
   zai --in $HOME` (model pin is ABSOLUTE — no fallback model ever). Timeout 20 min.
4. Success → gateway `DELETE /api/sessions/<sid>` → job `done`, `review_status
   deleted`; sidebar refreshes via the existing `sessions.changed` event.
5. Failure → `awaiting_retry`, `next_attempt_at = now + 5h`; sweeper (60 s) retries
   due jobs, resumes restart-interrupted ones, and does delete-only retries when the
   review already succeeded. 6 strikes → `failed` (visible; transcript still kept).

Retrieval: `GET /api/training/sessions/<sid>` returns the full raw rows forever.
DB: `data/astra-training.db` (gitignored).

## End ≠ new chat (owner 2026-10-01, fixed + deployed)

The End session button originally routed through `onNewChatClick()` — the full
new-chat flow: 2s press animation → skeleton → `onNewChat` → resetSignal →
`greetPendingRef=true` → auto-sent "New chat just started…" greeting that minted
a fresh session. Owner rule: ending must land on the "Welcome Jitin" landing
page and mint NOTHING.

Fix (all in `chat-landing.tsx`): `doEndSession` sets `endWelcomeRef.current =
true` then calls `onNewChat?.()` **directly** (skips the ncFlow animation); the
resetSignal effect consumes the flag and sets `greetPendingRef=false` instead
of true. The New chat button keeps the animation + greeting unchanged.

- The greeting suppression flag is the load-bearing piece — any future path that
  reuses `onNewChat` must decide whether it greets (reset effect handles it via
  the ref; a plain resetSignal bump greets, end-session doesn't).
- Audit caveat: a live click-through of end→welcome was never browser-verified
  (it would end a real session + trigger a training dump). Owner confirmed it
  implicitly by ending a session post-deploy with no complaint. Don't claim
  click-through verification you didn't do.

## Deploy verification trap

`endWelcomeRef`-style identifiers don't survive the minified bundle — grepping
the served JS for source names proves nothing. Prove the deploy instead by the
chain: source mtime < dist asset mtime (build freshness) + `md5sum dist/...` ==
served asset hash + selfcheck. A `done_gate` verdict of `partial` on the
behavior claim is honest when only this chain exists — say so in the handoff
rather than claiming the click was exercised.

## Live audit (2026-10-01, all clean)

First real-world run: 3 sessions through the pipeline (576, 720, 25 rows).
DB row counts matched `sessions.message_rows` exactly for all three; ended
sids absent from the gateway list; archive `GET /api/training/sessions/<sid>`
→ 200 for both completed; zero `awaiting_retry`/`failed` rows; in-flight
reviewer spawned ~3 min after end and stayed within its 20-min window.
Known warts (by design, not bugs): each end writes a ~93MB pre-review tarball
snapshot of the whole doc estate into `data/training-exports/` (≈280MB after
3 sessions — prune old ones eventually); reviewer `--oneshot` sessions still
appear in the owner's sidebar session list.

## Pitfalls proven the hard way (2026-10-01)

- `hermes chat` cwd flag is `--in DIR`. `-q` is the QUERY flag — passing a path
  there exits 2 immediately.
- Spawn workers with `detached: true` and kill the whole group
  (`process.kill(-pid, "SIGKILL")`). Killing only the direct child leaves orphaned
  grandchildren (`sleep`, helpers) holding stdio open — the child `close` event
  never fires, so the timeout path silently never runs.
- Test harnesses that own an HTTP server must spawn scenario children with async
  `spawn()`, never `spawnSync()` — spawnSync freezes the parent event loop so its
  server cannot answer the child. Looks like the child "stalling at dumping".
- Scenario children must use a static cookie provider
  (`setGatewayCookieProvider(async () => "hermes_session_at=fake")`); the proxy's
  real login is hardcoded to the live gateway and 401-loops against a fake.
- `hermesCookieOrNull` logs its swallowed errors — a silent null cookie sent the
  worker into a 401 loop that cost a full debug session.
- One-shot hermes sessions in this pipeline get their `~/.tool-router/route
  "<task>"` calls hard-blocked by the command gate (Tirith: nested-executable-body
  unresolved, no user present to approve; observed in the 2026-10-01 planning
  session, and review workers run the same one-shot shape). Fail-open by design —
  costs one wasted call; the session proceeds fine without the router card.

## Verify

```bash
node scripts/training.check.mjs          # unit groups (schema, retry math, upsert)
node scripts/training-pipeline.check.mjs # full lifecycle, fake gateway + fake hermes
```

Live contract proven 2026-10-01: real 576-row chat ended via the button → dumped →
reviewed by real glm-5.3-flash in ~5 min → deleted from visible chats → retrievable
via `/api/training/sessions/<sid>` (200, 576 rows).
