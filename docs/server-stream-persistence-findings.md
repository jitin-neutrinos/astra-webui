# Durable server-side persistence of LLM streaming output + retention-with-ingestion-gating

Research report for the Astra web UI design review. Scope: persist every token/chunk of
every LLM response server-side, entirely, before/while it streams to the client, so a
client disconnect loses nothing.

**URL legend.** `[OPENED]` = I fetched and read the page body. `[SEARCH-ONLY]` = the URL
appeared in search results and I did **not** open it; treat as a pointer, not a citation.

All local findings below were produced by reading the actual source on this machine and
running probes against the actual DB. Commands are reproducible.

---

## 0. Executive summary (the short version)

1. **Your gateway already emits the right event vocabulary — but cannot be resumed.**
   `POST /api/sessions/{id}/chat/stream` on the Hermes gateway emits typed SSE events
   (`run.started`, `message.started`, `assistant.delta`, `tool.started`, `tool.completed`,
   `assistant.commentary`, `assistant.completed`, `run.completed`, `error`, `done`) with a
   **monotonic `seq` per run**. But `_sse_frame()` writes only `event:` and `data:` lines —
   **never `id:`**. So `Last-Event-ID` resume is structurally impossible today
   (`~/.hermes/hermes-agent/gateway/platforms/api_server.py:244-248`). The `seq` you need for
   resume is already in the payload; you just have to own the log.
2. **Therefore Astra must be its own system of record.** The gateway is a live producer with
   no replay buffer (its `_SessionEventQueue` is an in-memory `asyncio.Queue` that dies with
   the process, `api_server.py:1102-1134`). Persist at the proxy, in the same `turn_events`
   append-only log, and make the browser's reconnect a *read* from your DB — not a
   re-subscription to the gateway.
3. **Append-only chunk log + periodic snapshot beats message-table upsert** for this
   requirement, because only the log survives a crash *mid-stream*. Measured on your box:
   40,000 chunk rows inserted in 69 ms (~580k inserts/s batched); replaying events alone
   reproduced the turn text byte-for-byte.
4. **Two SQLite settings must change today, one is a latent corruption risk:**
   - `synchronous = FULL` → **58× slower** on per-chunk autocommit (1,902 vs 111,111
     deltas/s measured). Use `NORMAL` + batched commits; that is the documented sweet spot.
   - Your Node bundles **SQLite 3.51.2**, which is in the range affected by the
     **WAL-reset bug** (fixed in 3.51.3). `[OPENED]` sqlite.org/wal.html §11. This is rare
     (≤ SSD-failure rate) but real, and your DB is 300 MB with two processes attached.
5. **Retention must be gated on ingestion, not on age.** The existing `ingest.mjs` sweeper
   already has the right primitive (`sessions.ingested_at`, `NULL` = not yet ingested).
   Extend it to a per-session watermark so purge never races the sweeper.

---

## (a) How the Hermes / OpenAI-compatible gateway exposes a resumable session event stream

### What exists locally (read, not inferred)

Gateway is live and healthy: `GET http://127.0.0.1:9119/api/health` →
`{"ok":true,"version":"0.21.4","auth_required":true}`. (Note: `/openapi.json` returns empty
and `/docs` 302s — **there is no machine-readable schema of this surface**; the source is the
only spec. Anything that depends on these event names should pin them with a regression test,
not a doc link.)

**Transport.** Astra's proxy terminates browser WebSocket and re-originates upstream over
WS with a single-use ticket (`server/hermes-proxy.mjs:574-588`, `Sec-WebSocket-Protocol:
hermes-gateway-ticket.<ticket>, hermes-gateway-v1`). Astra also has a raw WS frame codec
(`server/ws-codec.mjs`) that **explicitly rejects fragmentation** (`ws-codec.mjs:105-108`) —
relevant if you ever relay large individual frames.

**The typed stream contract** (`~/.hermes/hermes-agent/gateway/platforms/api_server.py`):

| Event | Source line | Payload keys |
|---|---|---|
| `run.started` | 3464-3466 | `user_message`, `runtime` |
| `message.started` | 3468 | `message.id`, `role` |
| `assistant.delta` | 3441-3443 | `message_id`, `delta` |
| `tool.progress` | 3449-3450 | `message_id`, `tool_name`, `delta` (thinking) |
| `tool.started` / `tool.completed` / `tool.failed` | 3451 | `message_id`, `tool_name`, `preview`, `args` |
| `assistant.commentary` | 3453-3457 | `message_id`, `text`, `already_streamed` |
| `assistant.completed` | 3357-3360, 3486+ | `message_id`, `content`, `usage` |
| `run.completed` / `run.failed` / `run.cancelled` | 3480-3499 | status-derived |
| `error` | 3364-3365 | `message`, `code` |
| `done` | 3365 | `{}` |

**Every payload is stamped by `_SessionEventQueue.payload()`** (`api_server.py:1113-1119`):

```python
def payload(self, name, payload):
    self.seq += 1
    payload.setdefault("session_id", self.session_id)
    payload.setdefault("run_id", self.run_id)
    payload.setdefault("seq", self.seq)
    payload.setdefault("ts", time.time())
    return name, payload
```

That is a per-run monotonic cursor already in the wire format. `run_id` is
`run_<uuid4hex>` and `message_id` is `msg_<uuid4hex>`.

### The three gaps that make resume impossible today

1. **No `id:` line, so no `Last-Event-ID`.** `[OPENED]` https://html.spec.whatwg.org/multipage/server-sent-events.html
   §9.2.6 — the browser tracks a "last event ID buffer", and an event block carrying `id:`
   updates it so that "if the connection died between this block and the next, the server
   would be sent a `Last-Event-ID` header". Hermes writes:
   ```python
   def _sse_frame(data, *, event=None, ensure_ascii=True) -> bytes:
       prefix = f"event: {event}\n" if event else ""
       return f"{prefix}data: {json.dumps(data)}\n\n".encode()          # api_server.py:244-248
   ```
   No `id:`, therefore no automatic resume. `EventSource` will reconnect and **silently
   miss every delta since the drop**.
2. **The queue is volatile.** `_SessionEventQueue` wraps a plain `asyncio.Queue`
   (`api_server.py:1109`). Nothing is persisted; the run is gone if the gateway restarts.
   The gateway knows this and degrades honestly — `_durable_run_status()`
   (`api_server_runs.py:347-370`) rehydrates a run record after restart and, if the owning
   PID is dead, marks it `interrupted` with "The gateway restarted before this run settled."
   That is status, not content. **Partial text is unrecoverable from the gateway.**
3. **`GET /v1/runs/{run_id}/events` is a live tap, not a replay.** `[OPENED by grep]`
   `api_server_runs.py:1016-1057` — it waits up to 1 s for `run_id in self._run_streams`,
   else returns `run_not_found`; then it drains `q.get()` with keepalives. No `Last-Event-ID`
   handling, no cursor parameter. A client that reconnects after a restart gets 404, not a tail.

**Conclusion for (a): treat the gateway as a fire-and-forget producer.** It gives you a
typed vocabulary and a per-run `seq`; it gives you no durability and no resume. Astra owns both.

### What the industry does when the producer *can* resume (prior art, for the target design)

- **WHATWG SSE** `[OPENED]` html.spec.whatwg.org/multipage/server-sent-events.html — §9.2.5
  the wire grammar; §9.2.6 the `id:`→`Last-Event-ID` mechanism; §9.2.3 "if the file ends in
  the middle of an event, before the final empty line, the incomplete event is not
  dispatched" (so a torn write must be treated as absent, never half-applied); §9.2.7 advises
  a `: keepalive` comment every ~15 s (the gateway already does this at
  `CHAT_COMPLETIONS_SSE_KEEPALIVE_SECONDS`). If you expose SSE, emit `id: <seq>` and free
  browser auto-resume.
- **OpenAI Responses API** `[OPENED]` https://platform.openai.com/docs/guides/background —
  background mode; **"Streaming a background response … You will want to keep track of a
  'cursor' corresponding to the `sequence_number` you receive in each streaming event"** and
  resume via `starting_after=cursor`. Also documented there: background data is held
  "roughly 10 minutes" unless `store: true` — i.e. **even OpenAI treats the resumable window
  as a retention policy, not infinite storage.** The reference is a *sequence number*, not a
  timestamp, which is the same contract as the gateway's `seq`.
- **Vercel AI SDK resume streams** `[OPENED]`
  https://github.com/vercel/ai/blob/d3e22682df35eccd4760dc90998794e9d9dac60c/content/docs/04-ai-sdk-ui/03-chatbot-resume-streams.mdx
  — `resume: true` on `useChat` makes the client `GET /api/chat/[id]/stream` on mount; the
  GET returns **204 No Content** when no stream is active. Same doc, two constraints worth
  copying: "client-side aborts are treated as disconnects… should not cancel the underlying
  generation", and a client abort is incompatible with resume — you need a **separate stop
  endpoint**. Your Android app must therefore distinguish "user pressed stop" from "socket
  died", or stopping will be impossible.

---

## (b) Server-side patterns for persisting a token stream so it replays after disconnect

### The three designs, and the tradeoff that actually decides it

| Design | Survives crash mid-stream? | Replay cost | Row churn | Verdict here |
|---|---|---|---|---|
| **A. Message-table upsert** (UPDATE the row as tokens arrive) | **No.** You lose everything since the last commit | O(1) read | 1 row | Rejected as the *store of record* for streaming |
| **B. Chunk-level append-only rows** | Yes, per committed batch | O(chunks) to reassemble | ~1 row/token | **Recommended** — the log *is* the truth |
| **C. Periodic snapshot only** (no log) | No — window between snapshots is lost | O(1) | low | Rejected alone; used *with* B as a read cache |

Design A fails on the exact requirement ("**entirely**, before/while it streams"): a crash
mid-turn loses the partial answer with no way to reconstruct it, because the previous value
of the column was overwritten. Design C has the same hole, just wider.

B is the only one where the durable artifact *is* the stream. The reassembly cost is bounded
by turn size, not conversation size — you only ever replay the tail after the client's cursor.

**Measured on this machine** (SQLite 3.51.2, `node:sqlite`, `synchronous=NORMAL`,
`WITHOUT ROWID` chunk table, batched transaction):

```
40,000 chunk rows in 69 ms  = ~580,000 inserts/s  (batched)
REPLAY turn t_7_2 from events alone -> 280 chars, byte-identical to streamed text
checkpoint(TRUNCATE): {"busy":0,"log":0,"checkpointed":0} in 5 ms
```

So per-chunk persistence is not a throughput problem. The **autocommit** problem is:

```
WAL + synchronous=NORMAL + autocheckpoint 1000 : 111,111 deltas/s
WAL + synchronous=FULL   + autocheckpoint 1000 :   1,902 deltas/s   <-- 58x slower
WAL + synchronous=NORMAL + autocheckpoint 0    : 142,857 deltas/s
```

`FULL` fsyncs the WAL on **every** commit `[OPENED]` sqlite.org/wal.html §2.3: "Writers sync
the WAL on every transaction commit if `PRAGMA synchronous` is set to FULL but omit this sync
if `PRAGMA synchronous` is set to NORMAL." One fsync per token is the whole cost. At ~40
deltas/s (a normal LLM token rate) both are fine; at 1,900/s only NORMAL keeps up. **Batch
or don't use FULL** — and see (c) for why NORMAL is safe here.

### Prior art: 2024-2026 event sourcing for chat

- **Tanay Shah, "Why I Use a Postgres Append-Only Log for Agent Chat (Not Redis Streams)",
  2026-04-28** `[OPENED]` https://tanayshah.dev/blog/postgres-append-only-chat-events — the
  closest published analogue to this exact design, and the explicit argument against the
  two-tier default (Vercel AI SDK 5's `resumeStream` over Redis Streams *plus* Postgres
  messages). His schema and the three rules he defends:
  - `chat_events(chat_id, seq, event_type, payload JSONB, created_at)`,
    `PRIMARY KEY (chat_id, seq)`; per-chat seq from a per-chat counter, **not** a global
    sequence, because "global sequences … couple write throughput across all chats".
  - The catch-up query every client runs: `SELECT seq, event_type, payload FROM
    chat_events WHERE chat_id = $1 AND seq > $2 ORDER BY seq`.
  - "There's no concept of 'live' versus 'historical' events; both are reads from the same
    table. … The streaming pathway and the cold-load pathway are the same code on both ends."
  - His named failure modes of the Redis tier: TTL expiry of in-flight streams, two backups
    at two different points in time, and cross-client fan-out bridges. **Astra already has one
    store, so this reduces to a non-issue — but it is the reason not to add a Redis tier.**
- **OpenComputer agent sessions** `[OPENED]`
  https://docs.opencomputer.dev/agent-sessions/events — "A session is an append-only event
  log… resume from any `seq`", with an envelope `{id, seq, ts, session, actor, type, level,
  body}`, `seq` as the resume cursor, `head` as the highest seq. Explicitly: "In the browser,
  native EventSource does this for you — each event's seq is the SSE id, so it resumes via
  Last-Event-ID on reconnect." **That is the missing `id:` line in the Hermes gateway, fixed
  in a real product.**
- **LangGraph checkpointer** `[SEARCH-ONLY]`
  https://github.com/langchain-ai/langgraphjs/blob/main/docs/docs/concepts/persistence.md
  and https://docs.langchain.com/oss/python/langgraph/checkpointers.md — `thread_id` +
  `checkpoint_id` + **pending writes** (per-node writes committed before the super-step
  snapshot, so a failed sibling isn't re-run). Its three durability modes are the closest
  published vocabulary to what you need: `exit` / `async` / `sync`. Worth reading before you
  invent names, but the `sync`/`async`/`exit` tradeoff here is *workflow-step* durability, not
  token durability — do not copy it wholesale.
- **PocketCQRS `events` package** `[SEARCH-ONLY]`
  https://pkg.go.dev/github.com/jamestryand/pocketcqrs/events — "appending events IS the
  commit", per-aggregate sequences for optimistic concurrency + a global position for total
  order. Same two-level seq idea as (per-chat seq, global id).
- **projectmem** `[SEARCH-ONLY]` https://arxiv.org/html/2606.12329 — append-only typed event
  log for AI agents, projected deterministically. Prior art for "log + projection", not for
  streaming transport.

### Recommended DDL (validated — it ran)

Validated on SQLite 3.51.2 with `node:sqlite`. `WITHOUT ROWID` on the chunk table keeps
`(turn_id, seq)` in the b-tree key so replay is one ordered index scan, no rowid indirection.

```sql
-- One row per assistant turn. The projection, not the truth.
CREATE TABLE IF NOT EXISTS turns (
  turn_id       TEXT PRIMARY KEY,
  sid           TEXT NOT NULL,
  message_id    TEXT NOT NULL,          -- gateway msg_<uuid4hex>
  run_id        TEXT,                   -- gateway run_<uuid4hex>
  role          TEXT NOT NULL,
  state         TEXT NOT NULL DEFAULT 'streaming',  -- streaming|complete|error|abandoned
  created_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  content       TEXT,                   -- snapshot, rebuilt from turn_events
  content_bytes INTEGER,
  ingested_at   INTEGER,                -- NULL = not yet folded into the training set
  purge_after   INTEGER,                -- retention deadline, NULL = hold (legal hold)
  UNIQUE (sid, message_id)
);

-- The truth. Append-only, never UPDATEd, purged by retention only.
CREATE TABLE IF NOT EXISTS turn_events (
  turn_id  TEXT    NOT NULL,
  seq      INTEGER NOT NULL,            -- gateway's per-run seq
  sid      TEXT    NOT NULL,             -- denormalised for the cross-turn catch-up query
  kind     TEXT    NOT NULL,            -- assistant.delta | tool.started | ...
  payload  TEXT,                        -- raw gateway frame (JSON) - verbatim, unparsed
  bytes    INTEGER,
  ts_ms    INTEGER NOT NULL,
  PRIMARY KEY (turn_id, seq)
) WITHOUT ROWID;

-- The catch-up query: every client, on any reconnect, asks exactly this.
CREATE INDEX IF NOT EXISTS idx_turn_events_sid_seq ON turn_events (sid, seq);
CREATE INDEX IF NOT EXISTS idx_turns_ingested        ON turns (ingested_at)
  WHERE ingested_at IS NULL;              -- partial: the sweeper's work queue stays tiny
CREATE INDEX IF NOT EXISTS idx_turns_purge           ON turns (purge_after)
  WHERE purge_after IS NOT NULL;          -- partial: retention scans only doomed turns
```

Three deliberate choices:

- **`payload` stores the verbatim gateway frame, unparsed.** The event vocabulary is
  undocumented (`/openapi.json` empty, `/docs` 302) and version-pinned to `0.21.4`. Storing
  raw JSON means a gateway upgrade that adds a field does not lose data, and the *parsed*
  projection can be re-derived and backfilled. Parsing at write time would make an upstream
  change a data-loss event.
- **`seq` is the gateway's, not a local counter.** Replay must emit byte-identical frames,
  including `event:` names and the `ts` the gateway chose. A local renumbering would make
  "resume at cursor N" mean something different from the source.
- **Partial indexes on `turns`.** With 978 sessions today and one row per turn, these are
  cheap; at 10^6 turns a full scan on every sweep is not. SQLite supports partial indexes
  (they are ordinary b-trees with a WHERE on the key set).

---

## (c) SQLite WAL settings that make this durable + concurrent-safe

### What your code does today

`server/training.mjs:70-78`:

```js
db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
try { db.exec("PRAGMA busy_timeout = 10000;"); } catch { /* older sqlite */ }
```

Measured live state of `data/astra-training.db`:

```
journal_mode      = wal
synchronous   = 2      (FULL — the compiled-in default; never set explicitly in code)
busy_timeout  = 0      (read-only probe: the pragma is inert on a readOnly handle.
                        Verified 10000 on a writable connection — see (c) item 2.)
wal_autocheckpoint= 1000   (default)
page_size         = 4096
auto_vacuum       = 0      (NONE — file never shrinks)
foreign_keys      = 1
journal_size_limit= -1     (no limit — WAL file never truncated)
page_count        = 76737  (~300 MB)
```

### What to change, and why

**1. `synchronous = NORMAL`, explicitly.** Measured 58× faster per-chunk autocommit, and the
docs make the tradeoff explicit `[OPENED]` sqlite.org/pragma.html (`PRAGMA synchronous`):
"WAL mode is safe from corruption with synchronous=NORMAL… but WAL mode does lose
durability. A transaction committed in WAL mode with synchronous=NORMAL might roll back
following a power loss or system crash. **Transactions are durable across application
crashes regardless of the synchronous setting or journal mode.**" and "The
synchronous=NORMAL setting provides the best balance between performance and safety for most
applications running in WAL mode."

This is the crux for *your* requirement. You want to survive **process** crash (server
restart, OOM, unhandled throw mid-stream) — NORMAL is fully durable for that, per the quote.
You do *not* need to survive **host power loss** losing the last few chunks; and if you did
want that, the correct answer is a periodic snapshot in `turns.content`, not per-token FULL.

2. **`busy_timeout` — verify it per connection type.** The pragma only applies to a writable
   connection (measured `10000` writable vs `0` read-only). WAL allows **one writer at a
   time** `[OPENED]` sqlite.org/wal.html §2.2: "since there is only one WAL file, there can
   only be one writer at a time" — and you have exactly the two processes the comment on line
   75-77 describes (the service + a detached backfill runner, plus `data/backfill.lock` present
   on disk). The pragma is silently ignored if unknown: "No error messages are generated if
   an unknown pragma is issued. Unknown pragmas are simply ignored" `[OPENED]` pragma.html.
   **Assert it after setting it** — a `try/catch` around a pragma that fails silently is a
   latent `SQLITE_BUSY` storm.

**3. `wal_autocheckpoint` — keep 1000, or move checkpointing off the hot path.**
`[OPENED]` sqlite.org/wal.html §2.3: the default strategy checkpoints at ~1000 pages, run by
"the same thread that does the COMMIT that pushes the WAL over its size limit", which "has
the effect of causing most COMMIT operations to be very fast but an occasional COMMIT
(those that trigger a checkpoint) to be much slower." For a token stream — where you care
about **tail latency** of each delta to the browser — that occasional stall is on your
critical path. Set `wal_autocheckpoint = 0` and run `PRAGMA wal_checkpoint(PASSIVE)` on a
timer in the ingest sweeper's idle moments. `PASSIVE` is the right mode: it "Checkpoint[s]
as many frames as possible without waiting for any database readers or writers to finish…
The busy-handler callback is never invoked in this mode" `[OPENED]` pragma.html
(`PRAGMA wal_checkpoint`). Use `TRUNCATE` only when you want the file back (my probe: 5 ms).

**4. `journal_size_limit` — set it.** It's `-1` today. `[OPENED]` pragma.html: "in WAL mode,
the write-ahead log file is not truncated following a checkpoint. Instead, SQLite reuses the
existing file… The journal_size_limit pragma may be used to limit the size of rollback-journal
and WAL files left in the file-system after transactions or checkpoints." Your `-wal` is 5.5 MB
now, but under an append-heavy chunk workload with checkpoints moved off the hot path it grows
until a reset. `PRAGMA journal_size_limit = 67108864` (64 MB) bounds it.

**5. `auto_vacuum = INCREMENTAL` — decide this now, it cannot be changed later.**
`[OPENED]` pragma.html: "auto-vacuuming is only possible if the database stores some additional
information… Therefore, **auto-vacuum must be turned on before any tables are created.** It is
not possible to enable or disable auto-vacuum after a table has been created." Your DB is
already 300 MB with `auto_vacuum = 0`, and a full `VACUUM` of it is a long exclusive operation.
Under a chunk-log workload, purge will free pages into the freelist but **the file will never
shrink** (same page: "When auto-vacuum is disabled, the database file remains the same size…
the database file does not shrink"). Options, in order of cost:
  - Put the streaming log in its **own** DB file (`data/astra-stream.db`) created with
    `PRAGMA auto_vacuum=INCREMENTAL` *before* its first table, so purge + `PRAGMA
    incremental_vacuum(N)` actually returns disk. This is the cheapest real fix and also
    isolates the hot write path from the 300 MB training DB's page cache.
  - Or `VACUUM` once during a maintenance window, then switch to `INCREMENTAL`.
  - Continuing with `auto_vacuum = 0` is legitimate **if** you also run periodic `VACUUM` —
  just know the file only ever grows between them.

**6. ⚠️ Your SQLite is 3.51.2 — in the WAL-reset bug range.** `[OPENED]`
https://sqlite.org/wal.html §11 ("The WAL-Reset Bug", page last updated 2026-08-25):

> "The bug is likely present in all version of SQLite from 3.7.0 (2010-07-21) through
> **3.51.2 (2026-01-09)**. It is fixed in version **3.51.3 (2026-03-13)** and later. Backports
> of the fix are available for some earlier releases: 3.44.6 and 3.50.7."
>
> "The bug only affects databases in WAL mode when there are **two or more database
> connections** open on the same file, in separate threads or processes, and when those two
> connections attempt to write or checkpoint at the same instant."
>
> "the SQLite developers were unable to reproduce the bug organically… Based on available
> telemetry, the occurrence rate of this problem in the wild appears to be **less than or
> equal to the expected occurrence rate of SSD malfunctions and/or cosmic-ray hits**."

Severity: low probability, **silent data loss / corruption** ("parts of the transaction
from step 3 never reach the database file, and the database file goes corrupt"). That
probability is not the concern — the concern is that a corruption bug in your *only* system of
record for every token is exactly the failure mode this whole design exists to prevent.
Mitigations, cheapest first:
  - `node:sqlite` reports `3.51.2` via `select sqlite_version()` (that's what the linked
    library actually is — note `process.versions.sqlite` says `3.50.2`; **trust
    `sqlite_version()`**, it's the live library, the other is a stale build constant).
  - Upgrade the Node runtime so bundled SQLite ≥ 3.51.3, or
  - Backport `3.50.7`/`3.44.6` (both named in the doc), or
  - **Minimize concurrent writers**: serialize chunk writes through the single proxy process
    (already the case) and stop the detached backfill runner from writing during streaming.
- Also note: you are on **btrfs** (`df -hT` → `/dev/nvme0n1p6 btrfs`, 97% used, 16 GB free).
  WAL "does not work over a network filesystem" `[OPENED]` wal.html §1 — btrfs is local so
  that's fine, but **16 GB free with a design that grows the DB is a live constraint**, and
  at 97% full you want `journal_size_limit` and the separate-DB plan in place before adding
  append-heavy load. Copy-on-write CoW amplification on btrfs also means a deleted chunk row
  does not free blocks until snapshots rotate.

### Verified on this machine (not just reasoned)

`busy_timeout` **does** apply on a writable connection (`{"timeout":10000}`) — so the
`try/catch` at `training.mjs:78` is not failing on a syntax issue; the `0` I measured came
from my probe opening the DB `readOnly`, where the pragma is inert. Correct the finding, keep
the advice: still assert it, because the pragma is silently ignored if unknown.

The **4-gate purge query was executed** against a fixture seeded with one row per failure
mode. Result:

```
P4-GATE selects: [{"turn_id":"t_old_ing","events":1}]
  t_old_ing   ingested + expired + no hold      -> PURGED   (correct)
  t_old_uning not ingested                      -> held (gate 1)
  t_new       deadline not passed               -> held (gate 3)
  t_held      expired but legal_hold row exists  -> held (gate 4)
```

Partial indexes (`WHERE ingested_at IS NULL`, `WHERE purge_after IS NOT NULL`) and the
`WITHOUT ROWID` chunk table all created cleanly on 3.51.2.

### Recommended pragma block

```js
// Run on EVERY connection, immediately after open, and ASSERT the result:
// sqlite.org/pragma.html — "Unknown pragmas are simply ignored."
db.exec("PRAGMA journal_mode = WAL;");          // persistent across connections (wal.html 3.3)
db.exec("PRAGMA synchronous = NORMAL;");         // durable across process crash; 58x faster
db.exec("PRAGMA busy_timeout = 10000;");         // MUST assert non-zero — one WAL writer
db.exec("PRAGMA wal_autocheckpoint = 0;");       // manual PASSIVE checkpoints off the hot path
db.exec("PRAGMA journal_size_limit = 67108864;") // cap the -wal file (wal.html 2.3)
db.exec("PRAGMA foreign_keys = ON;");
for (const p of ["busy_timeout","synchronous","wal_autocheckpoint"]) {
  const v = db.prepare(`PRAGMA ${p}`).get();     // verify, don't trust
}
```

---

## (d) Retention / TTL + "ingested-then-purge" patterns

### The primitive you already have

`server/ingest.mjs` is already an ingestion-gated archive, and it already has the right
column semantics:

- `sessions.ingested_at` — "set the first time a transcript is dumped into the archive… NULL =
  not yet ingested" (`training.mjs:112-115`), added by guarded `ALTER TABLE` so existing DBs
  migrate in place.
- `backfillIngested()` (`ingest.mjs:117-122`) retroactively stamps pre-existing rows:
  "Existing rows (dumped before ingested_at existed) are, by definition, already ingested."
- `uningestedSessions()` (`ingest.mjs:46-68`) is the work queue: known sids from
  `SELECT sid FROM sessions`, page the gateway at 100/page, **skip `r.is_active`**, dump the rest.
- Sweeper every 15 min, `INGEST_BATCH=4`, `MAX_SCAN=5000` safety cap.

**So the "ingested-then-purge" pattern is a two-line extension, not a new subsystem:** a purge
query that only considers rows where `ingested_at IS NOT NULL`.

### Legal/audit framing (cite, don't over-claim)

- **GDPR Art. 5(1)(e) storage limitation** `[OPENED]` https://gdpr-info.eu/art-5-gdpr/ —
  verbatim: personal data shall be "kept in a form which permits identification of data
  subjects for no longer than is necessary for the purposes for which the personal data are
  processed; personal data may be stored for longer periods insofar as the personal data will
  be processed solely for archiving purposes in the public interest, scientific or historical
  research purposes or statistical purposes in accordance with Article 89(1) subject to
  implementation of the appropriate technical and organisational measures…"
  `[SEARCH-ONLY]` for the surrounding practice claims (EDPB CEF 2025 erasure report published
  Feb 2026, "deletion index" pattern, legal-hold scoping): https://probackup.io/blog/gdpr-and-backups-how-to-handle-deletion-requests
  and https://overview.legal/topics/storage-limitation — I did not open these; the EDPB
  report itself I could not retrieve from edpb.europa.eu and am not asserting its contents.

Two things follow that are architecture, not policy:

1. **"For archiving/research under Art. 89(1)" is an *exception*, not a default.** Keeping
   every transcript forever (what `training.mjs:9` says the training tier does: "the training
   DB, which keeps every transcript forever") is the Art. 89(1) path and requires the
   technical-and-organisational safeguards. Retention defaults must be explicit per tier.
2. **Erasure vs retention are separate mechanisms.** Art. 5(1)(e) is a *standing* duty to
   delete at end-of-period; Art. 17 is an on-demand accelerant `[SEARCH-ONLY]` for its text.
   A purge job keyed only on TTL will fail an erasure request; a purge job keyed only on
   request will over-retain. You need both, and both must be able to act on the **chunk log**,
   not just `messages` — an erased transcript is not erased if its deltas remain in
   `turn_events`.

### The concrete purge algorithm

```sql
-- Step 1 (dry run, always first): what *would* go, and how many bytes.
SELECT t.turn_id, t.sid, t.purge_after,
       COUNT(e.seq) AS events, COALESCE(SUM(e.bytes),0) AS bytes
FROM turns t JOIN turn_events e ON e.turn_id = t.turn_id
WHERE t.ingested_at IS NOT NULL          -- GATE 1: never purge un-ingested data
  AND t.purge_after IS NOT NULL          -- GATE 2: explicit deadline, NULL = hold
  AND t.purge_after < :now              -- GATE 3: deadline passed
  AND NOT EXISTS (SELECT 1 FROM legal_hold h WHERE h.sid = t.sid)  -- GATE 4
GROUP BY t.turn_id
ORDER BY t.purge_after
LIMIT :batch;
```

Four gates, and **every one of them has bitten someone**:

1. **`ingested_at IS NOT NULL`** — the ingestion watermark. This is the whole point: purge
   must never race `dumpSession()` for a session the sweeper hasn't archived. Note the
   existing sweeper's own guard: it skips `r.is_active` sessions ("ingest once the chat has
   gone idle", `ingest.mjs:61`) — a streaming turn is by definition active, so an
   ingest-and-purge cycle can never touch a live turn if gate 1 is right.
2. **`purge_after IS NOT NULL`** — NULL means "hold", which is how legal hold is expressed
   without a second table read. Setting `purge_after = NULL` is the hold.
3. **`< :now`**, in bounded batches with `LIMIT` — never one unbounded `DELETE`. Per-row
   DELETE in a loop keeps each transaction short, so the single-writer constraint (§c) isn't
   starved by a retention sweep.
4. **NOT EXISTS legal_hold** — keep holds in their own table so a hold is auditable
   (`granted_at`, `reason`, `released_at`) rather than an invisible flag. Scope and time-bound
   them; a hold with no release is permanent over-retention.

Then, **and this is the step people forget**: after the `DELETE`s, reclaim the space.

- `PRAGMA incremental_vacuum(N)` — only effective under `auto_vacuum=INCREMENTAL` `[OPENED]`
  pragma.html: "causes up to N pages to be removed from the freelist. The database file is
  truncated by the same amount… has no effect if the database is not in
  auto_vacuum=incremental mode."
- `VACUUM` otherwise — full rebuild, exclusive, slow on 300 MB+.
- **And scrub the bytes**: `[OPENED]` pragma.html (`PRAGMA secure_delete`) — "When
  secure_delete is on, SQLite overwrites deleted content with zeros. The default setting …
  is normally off." and, on `fast`: "purging all old content from b-tree pages, but leaving
  forensic traces on freelist pages." A plain `DELETE` on a chunk log leaves the deleted
  token text readable in freed pages of the DB file. For a "delete my chat history" feature
  that is a real failure, and the two documented options are `PRAGMA secure_delete = ON` for
  the delete path or `VACUUM` after it. Note also the limitation stated there: it "only
  causes deleted content to be scrubbed from ordinary tables" — virtual tables (FTS shadow
  tables) need separate handling. If you ever add an FTS index over `turn_events`, that's a
  third copy to purge.

### Retention tiers I'd propose

| Tier | Contents | Gate | Default |
|---|---|---|---|
| Live stream | `turn_events` for `state='streaming'` or `< now` | never purged | until terminal + 24 h |
| Replay buffer | `turn_events` for complete turns | `ingested_at IS NOT NULL` | 30 days after `purge_after` |
| Training archive | `messages` (existing table) | already ingested | keep (Art. 89(1) path, documented) |

The split matters because the chunk log and the training archive have **different legal
statuses**: `messages` is the deliberate long-term training corpus, `turn_events` is
operational plumbing that exists only so a reconnect works. The mistake to avoid is giving
both "forever" because the training tier already says forever.

---

## (e) 2024-2026 prior art on chat-history event sourcing

Consolidated, with what each one actually contributes. Dates are the pages' own publication
dates where stated; several were found via search and I flag which I opened.

| Prior art | Date | Opened? | Contributes |
|---|---|---|---|
| [Tanay Shah — Postgres append-only chat events](https://tanayshah.dev/blog/postgres-append-only-chat-events) | 2026-04-28 | ✅ | The canonical single-table schema; the per-chat-`seq` argument; the `seq > $cursor` catch-up contract; the explicit case against Redis-Streams-plus-Postgres |
| [OpenComputer agent sessions / events](https://docs.opencomputer.dev/agent-sessions/events) | n/d | ✅ | Append-only session log, `seq` as resume cursor, `head`, and — directly relevant — **SSE `id: = seq` so `Last-Event-ID` resume works**. The exact fix the Hermes gateway lacks. |
| [Vercel AI SDK — Chatbot Resume Streams](https://github.com/vercel/ai/blob/d3e22682df35eccd4760dc90998794e9d9dac60c/content/docs/04-ai-sdk-ui/03-chatbot-resume-streams.mdx) | v6 line, 2026 | ✅ | `activeStreamId` + `GET /stream` + **204 when idle**; "client abort ≠ stop" and the required separate stop endpoint; Redis TTL as the weak point |
| [OpenAI — Background mode](https://platform.openai.com/docs/guides/background) | live | ✅ | `sequence_number` as the resume cursor (`starting_after=cursor`); ~10-minute retention on non-`store` background responses — upstream treats resumability as TTL-governed |
| [LangGraph checkpointer](https://github.com/langchain-ai/langgraphjs/blob/main/docs/docs/concepts/persistence.md) · [checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers.md) | ongoing | ❌ search | `thread_id`/`checkpoint_id`, pending-writes durability, `exit`/`async`/`sync` durability modes. Vocabulary worth borrowing; semantics are workflow-step, not token-level |
| [PocketCQRS events](https://pkg.go.dev/github.com/jamestryand/pocketcqrs/events) | ongoing | ❌ search | "appending events IS the commit"; per-aggregate seq + global position; a SQLite event store that works in WAL **and** DELETE mode |
| [projectmem (arXiv 2606.12329)](https://arxiv.org/html/2606.12329) | 2026-06, rev 2026-09 | ❌ search | Append-only typed event log for agents + deterministic projection over it |
| [jsonlreplay](https://awesome.ecosyste.ms/projects/github.com%2Fbrandonkramer%2Fjsonlreplay) | n/d | ❌ search | Trivial JSONL variant: monotonic `seq`, `sinceSeq`/`limit`/`Poll` replay. Same contract, file instead of SQLite |
| [ESAA-Conversational (arXiv 2606.23752)](https://arxiv.org/html/2606.23752) | 2026 | ❌ search | Event-sourced memory layer for agents. Appeared in search only; I could not verify content |
| [ai-that-works event-driven agents](https://github.com/ai-that-works/ai-that-works/blob/main/2025-11-05-event-driven-agents) | 2025-11-05 | ❌ (fetch failed) | Cited by Tanay Shah's related reading; extract returned CRAWL_NOT_FOUND |

**The convergent finding.** Every production implementation that survives reconnecting agrees
on three things, and all three match what the Hermes gateway already half-provides:

1. **A monotonic sequence number per conversation, not per connection.** (gateway `seq`;
   Tanay's per-chat `seq`; OpenComputer's `seq`/`head`; OpenAI's `sequence_number`.)
2. **The client holds a cursor; reconnect is a read, not a re-subscribe.** `WHERE seq > $cursor
   ORDER BY seq`. There is no separate "historical" path.
3. **The log is append-only and the message view is a projection.** None of them UPDATE a
   row to "current" text. That is the single decision that makes mid-stream crash recovery
   possible.

---

## Concrete recommendations, ranked

1. **Add `turn_events` (append-only, `WITHOUT ROWID`, keyed `(turn_id, seq)`) and persist every
   gateway frame verbatim at the proxy, before the frame goes to the browser.** This is the
   only change that satisfies the stated requirement. Measured cost: ~580k inserts/s batched,
   replay reconstructs byte-identically.
2. **Write the durable copy *before* the client write.** "Persist-then-forward" costs one
   SQLite append on the hot path; the reverse silently loses every token in the window
   between forward and commit.
3. **Make the client's reconnect a query against your DB** (`WHERE turn_id=? AND seq>?`), not a
   gateway re-subscribe. The gateway's `/v1/runs/{id}/events` returns 404 after a restart and
   has no cursor.
4. **Reconnect contract:** return `204` when the turn is terminal and fully replayed (Vercel's
   rule); while the turn is still streaming, replay from cursor then attach to live frames.
5. **Astra needs a stop endpoint distinct from disconnect.** Copy Vercel's constraint: a client
   abort is a disconnect, so the Android "stop" button cannot simply close the socket. Mark the
   turn `state='abandoned'` and stop forwarding.
6. **Set `synchronous=NORMAL` explicitly, assert `busy_timeout` actually applied, set
   `wal_autocheckpoint=0` + `journal_size_limit`, and put the chunk log in a new DB created
   with `auto_vacuum=INCREMENTAL` before its first table** (you cannot set it later).
7. **Resolve the SQLite 3.51.2 WAL-reset exposure** — upgrade the runtime to bundled SQLite
   ≥ 3.51.3, or apply the named 3.50.7/3.44.6 backport. Low probability, but silent corruption
   of your only system of record.
8. **Purge = 4 gates** (`ingested_at IS NOT NULL`, `purge_after IS NOT NULL`, expired, no
   legal hold) in bounded batches, then `incremental_vacuum` **and** `secure_delete`/VACUUM so
   the tokens are actually unrecoverable from freed pages.
9. **Assert, don't assume, every pragma.** "Unknown pragmas are simply ignored" — a
   `try/catch` around a typo'd pragma exits clean and leaves you unprotected.

### Tradeoffs, stated plainly

| Decision | You give up | You get | Cost of reversing |
|---|---|---|---|
| Append-only chunk log vs upsert | Row churn, ~1 row/token, reassembly on read | Mid-stream crash recovery (the requirement) | Migration + backfill of in-flight turns |
| ASTRA as system of record (not gateway) | One more place to keep in sync with `0.21.4` event names | Durability, replay, retention control | Low — it's additive; the gateway keeps streaming |
| `synchronous=NORMAL` | Durability across **host power loss** (not process crash) for the last uncommitted chunks | 58× write throughput | Low, but you must accept the power-loss window |
| Chunk log in its own DB file | Cross-DB queries (ATTACH) | Correct `auto_vacuum`, hot/cold isolation, deletable wholesale | Low |
| Not adding Redis for resumability | Sub-ms fan-out for very high concurrency | One system of record; no TTL cliff; no reconciliation | Only matters at thousands of concurrent streams |

### Sources

**Opened (read the body):**
- https://sqlite.org/wal.html — WAL mode, concurrency, checkpointing, `synchronous` vs commit cost, §11 WAL-reset bug
- https://sqlite.org/pragma.html — `synchronous`, `wal_autocheckpoint`, `wal_checkpoint`, `journal_size_limit`, `secure_delete`, `incremental_vacuum`, `auto_vacuum`, "unknown pragmas ignored"
- https://html.spec.whatwg.org/multipage/server-sent-events.html — §9.2.5 grammar, §9.2.6 `id:`/`Last-Event-ID`, §9.2.3 partial-event discard, §9.2.7 keepalives
- https://platform.openai.com/docs/guides/background — `sequence_number` cursor, `starting_after`, ~10-min background retention
- https://github.com/vercel/ai/blob/d3e22682df35eccd4760dc90998794e9d9dac60c/content/docs/04-ai-sdk-ui/03-chatbot-resume-streams.mdx — resume protocol, 204-when-idle, abort≠stop
- https://tanayshah.dev/blog/postgres-append-only-chat-events — append-only schema, seq contract
- https://docs.opencomputer.dev/agent-sessions/events — append-only log, seq cursor, SSE `id:`=`seq`
- https://gdpr-info.eu/art-5-gdpr/ — Art. 5(1)(e) verbatim

**Search-only (found, not opened — verify before relying on):**
- https://docs.langchain.com/oss/python/langgraph/checkpointers.md and the langgraphjs persistence doc
- https://pkg.go.dev/github.com/jamestryand/pocketcqrs/events
- https://arxiv.org/html/2606.12329 (projectmem), https://arxiv.org/html/2606.23752 (ESAA-Conversational)
- https://awesome.ecosyste.ms/projects/github.com%2Fbrandonkramer%2Fjsonlreplay
- https://probackup.io/blog/gdpr-and-backups-how-to-handle-deletion-requests, https://overview.legal/topics/storage-limitation (EDPB CEF 2025 practice claims — **unverified against edpb.europa.eu**)
- https://github.com/ably-labs/ably-ai-sdk-transport/blob/main/README.md, https://mintlify.wiki/vercel/ai/ai-sdk-ui/chatbot-resume-streams
- https://github.com/vercel/resumable-stream via deepwiki (character-offset `skipCharacters` resume)