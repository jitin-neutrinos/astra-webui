# Astra multi-device / multi-session chat — framework research (2026-10-01)

Scope: frameworks that improve cross-device read/unread sync, multi-tab concurrent
chats, presence, and reconnect recovery for astra.jitinnair.com. Constraint set:
single-user personal app, self-hosted only, zero-dep Node proxy (`server/server.mjs`
+ `hermes-proxy.mjs`) in front of the Hermes gateway, React/Vite/Tailwind client,
Capacitor Android + iPad wrap, Cloudflare tunnel. No Postgres. No SaaS.

---

## TL;DR verdicts

| Framework | What it gives | Fit for Astra | Verdict |
|---|---|---|---|
| **Finish in-house watermark** (no framework) | Server-side `last_read_at` + read-event broadcast on the existing WS | Exact match — client half of it is already written (`notify.ts`) | **Do first.** ~1–2 days |
| **TinyBase** (MIT, 7–16 kB, no deps) | Reactive MergeableStore (CRDT), WS synchronizer server that runs INSIDE our Node proxy, BroadcastChannel cross-tab sync, IndexedDB persistence | Excellent — solves multi-tab + cross-device CLIENT state (unread, presence, drafts) without new infrastructure | **Adopt for client state layer** |
| **Centrifugo** (Apache-2.0, Go binary) | Battle-tested pub/sub: channels, presence + join/leave, history + automatic reconnect recovery, JWT auth, admin UI, delta compression | Good but replaces a layer we already own and works; adds a second service to run | **Optional later** (if reconnect pain grows) |
| **Socket.IO** | Rooms, presence, reconnect semantics over WS | We already hand-rolled the hard parts (filtered legs, shared ping, reaping) | Skip |
| **Yjs / Automerge / Loro (+Hocuspocus)** | CRDTs for concurrent collaborative editing | Solves a problem Astra doesn't have — one human writer, no co-editing | Skip |
| **RxDB** | Local-first DB, multi-tab leader election, pluggable replication | RxJS dep + premium-gated extras; restructures the data layer for modest gain | Skip |
| **PowerSync / ElectricSQL / Triplit** | Sync engines for Postgres-backed apps | All need Postgres (or their own server + schema ownership); Astra has neither | Skip |
| **Stream / Liveblocks / GetStream** | World-class hosted chat UI + backend | SaaS, per-MAU pricing, data leaves the box — violates self-host rule | Skip |
| **Matrix (Synapse)** | Full multi-device chat protocol: read receipts, presence, E2E, device sync | A whole chat network + homeserver to run; Hermes already owns the message store | Skip |

---

## 1. What Astra actually needs (gap analysis)

1. **Read/unread that spans devices** — today `notify.ts` keeps counts in
   localStorage (`astra_unread_overlay_v1`) = per-device, wiped on reset. The
   WhatsApp-model rewrite (server watermark `last_read_at` via
   `PATCH /api/hx/sessions/<id> {unread:false}` + thin live overlay) is half-landed
   in the working tree: `clearChat()`/`markRead()`/`getUnreadCount(sid, serverUnread)`
   exist, `seedFromServer()` exists but is **never called**, and the server side
   (store `last_read_at`, return `unread` on session rows, broadcast read events)
   **does not exist yet**. Uncommitted as of 2026-10-01.
2. **True concurrent chats** — one WS leg is tied to the active session; opening
   two chats in two tabs (or tab + phone) fights over session focus. The proxy
   already supports `?sid=` and `?filter=complete` socket modes — the missing piece
   is per-tab session identity + N concurrent chat legs.
3. **Presence** — "which chat is focused on which device" so a read on the phone
   clears the pill on the desktop instantly.
4. **Reconnect recovery** — proxy replays `message.complete` after reconnects;
   history API caps at 500 rows/window. Mostly solved, partly hand-rolled.

## 2. The recommended architecture (layered, minimal-first)

### Layer 1 — server-authoritative read state (finish what's started)
- `server.mjs`/`hermes-proxy.mjs`: persist `{storedKey: last_read_at}` (JSONL or
  SQLite the way the gate ledger does), expose it on `/api/hx/sessions` rows
  (`unread`, `last_read_at`), accept the `PATCH {unread:false}` the client already
  sends, and broadcast a small `session.read` frame to all connected clients.
- Client: wire `seedFromServer()` into the sessions fetch, clear overlay when a
  `session.read` frame arrives for the mapped row. The pill/tick UI already reads
  these fields (`chats-panel.tsx` lines 279–330).
- Result: read on ANY device (web tab, Android, iPad) clears the tag everywhere,
  survives restarts, survives localStorage wipes. Zero new deps.

### Layer 2 — TinyBase for multi-tab + client-state sync
- [TinyBase](https://tinybase.org/) ([GitHub](https://github.com/tinyplex/tinybase)):
  reactive in-memory store, `MergeableStore` is a native CRDT, ships a
  **WebSocket synchronizer server that runs inside an existing Node process**
  (`createWsServer` from `tinybase/synchronizers/synchronizer-ws-server`) — embeds
  in `server.mjs`, no second service. Client side has a ready
  `synchronizer-ws-client`, plus `synchronizer-broadcast-channel` for instant
  same-browser cross-tab propagation, and IndexedDB/OPFS persisters.
- Use it for the CLIENT-state layer only (unread overlay, per-device presence,
  composer drafts, per-tab session identity). Hermes stays the source of truth for
  messages; the `?sid=`/`?filter=complete` WS legs stay for streaming.
- Why a CRDT store is right here: read markers written from phone + desktop +
  two tabs concurrently merge deterministically — no last-writer-wins races, no
  custom conflict code. 7–16 kB gzipped, zero deps, MIT.
- Effort: ~1 day to wire the synchronizer + move the overlay into a MergeableStore.

### Layer 3 — per-tab concurrent sessions (small protocol change, no framework)
- Give every tab a `clientId` (crypto.randomUUID persisted per tab), let the
  proxy host N `?sid=<live>` legs simultaneously (it already multiplexes; the
  limit is client bookkeeping in `ws-engine.ts`, not the server).
- `tab-isolation.check.ts` already asserts per-tab storage isolation — extend it.
- TinyBase presence table (`clientId -> focusedStoredKey`) gives the "open on
  another device" indicator for free.

### Layer 4 (optional, later) — Centrifugo
- [Centrifugo](https://github.com/centrifugal/centrifugo): self-hosted Go pub/sub
  (Apache-2.0) — channels with namespaces, **presence + join/leave**, **hot
  history + automatic message recovery on reconnect**, user-limited channels,
  JWT connection auth, embedded admin UI, Prometheus metrics; scales via
  Redis/NATS when multi-node ([overview](https://selfhost.directory/project/centrifugo),
  [architecture notes](https://xiezhao.me/Centrifugo)).
- Adopt ONLY if reconnect/recovery pain grows beyond what the hand-rolled proxy
  handles. It replaces the WS fan-out layer wholesale — real migration cost, and
  today's proxy already does filtered legs + shared ping + zombie reaping
  (`ws-filter.check.mjs` passes).

## 3. Why the famous names don't fit

- **Yjs** ([yjs.dev](https://beta.yjs.dev/), [GitHub](https://github.com/yjs/yjs)) —
  fastest CRDT, huge editor ecosystem, awareness/presence CRDT built in; the
  2025-26 pattern is Yjs + Hocuspocus for collaborative editing. Astra has no
  concurrent text editing — the only shared mutable state is small scalars
  (counts, timestamps), which TinyBase's MergeableStore already covers at a
  fraction of the surface.
- **Automerge / Loro** — same class; Automerge 3 is about versioned doc history,
  Loro is a Rust perf play ([2026 comparison](https://www.youngju.dev/blog/culture/2026-05-15-crdt-local-first-engines-2026-yjs-automerge-loro-replicache-liveblocks-deep-dive.en)).
  No doc-merging problem to solve here.
- **RxDB** ([rxdb.info](https://rxdb.info/replication.html)) — genuinely strong
  multi-tab story (BroadcastChannel + leader election so only one tab replicates,
  [docs](https://rxdb.info/articles/indexeddb/indexeddb-sync.html)), but it pulls
  RxJS into the app, its best extras are paid, and the replication handlers still
  have to be written against our weird Hermes-proxy API. TinyBase gives the same
  multi-tab + sync outcome for less.
- **PowerSync / ElectricSQL / Triplit** ([comparison](https://zairalabs.ai/guide/compare/electricsql-oss-vs-powersync-oss/),
  [hands-on](https://masudpro.hashnode.dev/powersync-vs-electricsql-vs-triplit-which-local-first-sync-engine-fits-your-laravel-app)):
  all assume Postgres (or Triplit's own server + AGPL) as the sync backbone;
  ElectricSQL is read-path-only (writes go through your API anyway). Astra's
  backend is the Hermes gateway's SQLite via a bespoke proxy — wrong shape,
  would mean standing up infrastructure for one user.
- **Stream / Liveblocks / GetStream** — the "world-class chat" turnkey option
  ([example](https://getstream.io/blog/build-chat-messaging-app/)): read receipts,
  presence, typing, threads out of the box. All hosted SaaS with per-MAU pricing.
  Hard no under the self-host rule.
- **Matrix/Synapse** — the only open protocol with native multi-device read
  receipts + presence + device sync, but running a homeserver to talk to your own
  agent is an inversion of the architecture. Hermes already owns message storage.

## 4. Sequenced plan

1. **Finish Layer 1** (watermark + broadcast) — makes read/unread correct
   cross-device. Includes wiring `seedFromServer`, building the server store,
   extending `unread.check.ts`.
2. **Layer 3** (per-tab clientId + concurrent legs) — unblocks multitasking.
3. **Layer 2** (TinyBase MergeableStore + ws synchronizer) — replaces the
   localStorage overlay with CRDT state; adds presence + drafts for free.
4. **Layer 4** — only on demonstrated need.

Sources: linked inline above. Research pass 2026-10-01.
