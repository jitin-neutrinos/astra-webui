# Deterministic ordering & conflict resolution for the Astra transcript merge

Research date: 2026-10-05. Repo: `~/Work/projects/astra-webui` (web UI + Android app, `astra.jitinnair.com`).
Upstream that owns the durable log: `~/.hermes/hermes-agent` (the gateway that persists every assistant stream segment).

Requirement under review: on reload, in a new window, or on a new device, the local store and the
remote store must *compile* server-side assistant rows with client-created user messages — using
timestamps and UUIDs — to reconstruct the exact chronology of where each message displays.
Assistant output is one continuous bubble (text / thinking / tool calls / canvas cards), broken only
by user messages.

**Citation convention.** ✅ = I opened and read the text. 👀 = search-result snippet only.

---

## 0. The headline

The owner is describing an HLC problem. It is not one. The server already has a total order and
already hands it to the client; the only missing piece is that client-created user rows have no
server-assigned position yet.

Upstream Hermes is explicit about this, and it is the single most important citation in this report:

> "Load messages in insertion order (**id, never timestamp: clocks regress**)"
> — `~/.hermes/hermes-agent/hermes_state_messages.py:1061`

```python
# hermes_state_messages.py:1080-1081
sql = (f"SELECT * FROM messages WHERE session_id = ?{active_clause}"
       f"{' AND id > ?' if after_id is not None else ''} ORDER BY id {'DESC' if latest else 'ASC'}")
```

`messages.id` is `INTEGER PRIMARY KEY AUTOINCREMENT` (`hermes_state_common.py:403`) — a per-session
monotonic sequence, with `timestamp REAL NOT NULL` sitting beside it as an unused-for-ordering column.
The served endpoint is `GET /api/sessions/{session_id}/messages`
(`gateway/platforms/api_server.py:1610`, handler at `:3072`), and Astra's client already models exactly
this contract — `src/lib/pagination.ts` pins `order: "latest"` + `offset`, and `normalize-messages.ts`
derives turn boundaries from row order, never from `row.timestamp` (it uses the timestamp only to
compute `thinkDurMs` / tool `durationMs`).

So: **(b) resolves to a per-conversation server sequence. Not a tuple, not an HLC.** And (a) becomes
much smaller — UUIDv7 is a good *id* here, but it is not the ordering key.

---

## (a) UUIDv7 vs v4 — and no, an HLC is not needed

**v7 is the right choice for the id.** RFC 9562 obsoletes 4122 and defines v7 as a 48-bit big-endian
Unix-epoch-millisecond timestamp followed by 74 bits of entropy, and explicitly says
"Implementations SHOULD utilize UUIDv7 instead of UUIDv1 and UUIDv6 if possible."
✅ https://www.rfc-editor.org/rfc/rfc9562.html#section-5.7

What v7 buys you that v4 does not, in the words of the RFC's own motivation section (§2.1): v4-style
random UUIDs "have poor database-index locality… they require inserts to be performed at random
locations. The resulting negative performance effects on the common structures used for this
(B-tree and its variants) can be dramatic." ✅ same URL, §2.1

RFC 9562 §6.13 adds the sentence that settles the "who mints it" question for a single-writer backend:

> "Applications using a monolithic database may find using database-generated UUIDs (as opposed to
> client-generated UUIDs) provides the best UUID monotonicity."
✅ https://www.rfc-editor.org/rfc/rfc9562.html#section-6.13

**The precision caveat, which is the whole (a) argument.** v7's sortability is only *guaranteed within
one generator*. §6.2: "Monotonicity (each subsequent value being greater than the last) is the
backbone of time-based sortable UUIDs" — but the guarantee holds per node, and §6.4 (Distributed UUID
Generation) is explicit that with two or more nodes independently generating, you rely on the random
source: "Distributed applications generating UUIDs at a variety of hosts MUST be willing to rely on
the random number source at all hosts." ✅ §6.2 / §6.4

Translated to Astra's actual topology: phone and desktop both mint user-row UUIDv7s from their own
`Date.now()`. A phone 400 ms fast relative to the server will sort its message ahead of an assistant
segment the server already committed. **v7 therefore makes the tie-break *stable* but not
*correct*.** It gives you a deterministic answer to a question you should not be asking.

RFC 9562 also names the in-millisecond counter options (Method 1 fixed counter in `rand_a`, Method 2
monotonic random in `rand_b`, Method 3 sub-ms precision in `rand_a`), and recommends them only for
"single-node UUID implementations." ✅ §6.2 — single-node. Astra is multi-node.

**Verdict (a):** v7 yes (v4 is a real regression in index locality and in legibility when you are
debugging a transcript). HLC no. RFC 9562 v7 + a client-monotonic counter is enough *as an id*, and
"enough as an id" is exactly the ceiling — it is not an ordering primitive.

---

## (b) The canonical ordering key — and what each industry actually does

### The three candidates, ranked for this workload

| Candidate | Verdict | Why |
|---|---|---|
| **Per-conversation server `seq`** | **Correct, and already implemented upstream** | Total order by construction; survives clock regression; keyset-paginates cleanly; matches the contract Astra's client already speaks. |
| `(client_ts, id)` tuple | Reject as primary | Deterministic, but *wrong* whenever clocks disagree, and it cannot represent "arrived at the server at T". |
| HLC | Reject | Solves causality across nodes you do not have. One writer already. |

### Slack — a server-assigned fractional timestamp that doubles as the id

Slack's canonical sort key is `ts`: `"1512085950.000216"`, i.e. `seconds.microseconds`, assigned by
Slack's servers. ✅ https://docs.slack.dev/reference/methods/conversations.history.md

Two details worth stealing:

1. `ts` **is** the primary identifier. From the same doc: "You'll need a message's `ts` value,
   uniquely identifying it within a conversation." ✅ same URL — the id and the sort key are the same
   field, so they can never disagree.
2. Pagination is a **range query on that key**, not an offset: `oldest`/`latest` take a `ts`, with an
   `inclusive` flag, and "If a message has the same timestamp as `oldest` or `latest` it will not be
   included." ✅ same URL. That is keyset pagination — immune to rows arriving mid-walk, which
   Astra's current `offset`-based walk is not.

Slack's `client_msg_id` (in the `message` event) is the client-generated dedupe id, used to suppress
the "your own message echoed back" duplicate. 👀 https://api.slack.com/reference/events/message
(would need to open to quote exactly).

### Discord — a snowflake: server time + worker + process + per-process counter

✅ https://docs.discord.com/developers/reference

> Timestamp: 42 bits, "Milliseconds since Discord Epoch, the first second of 2015"
> Internal worker ID: 5 bits · Internal process ID: 5 bits · Increment: 12 bits,
> "For every ID that is generated on that process, this number is incremented"

So Discord's ordering key and its id are *the same integer*, and the id is sortable precisely because
the low bits carry a per-process monotonic counter. It also uses snowflakes for pagination
(`before`/`after` + `limit`) rather than offsets. ✅ same URL.

Discord's consistency note is the most quotable line in this whole report for Astra's purposes:

> "Discord operates at a scale where true consistency is impossible… lots of operations in our API and
> in-between our services are eventually consistent. Due to these constraints, events in Discord may:
> never be sent to a client; be sent exactly one time to the client; **be sent up to N times per
> client. Clients should operate on events and results from the API in as much of an idempotent
> behavior as possible.**"
> ✅ https://docs.discord.com/developers/reference

### Telegram — a per-chat monotonic integer, separate from the timestamp

✅ https://core.telegram.org/bots/api

`Message.message_id` is an **Integer**, documented as "Unique message identifier inside the chat", and
`Message.date` is a **separate** Integer field. Telegram's ordering key is the monotonic per-chat
integer; the human-readable timestamp is a *display* attribute that plays no part in ordering. The
same phrasing appears on `InaccessibleMessage.message_id`. ✅ same URL.

This is the cleanest confirmation that a chat transcript's order and a chat transcript's timestamps
are two different data structures, and conflating them is the bug.

### Google Chat — server time is output-only

✅ https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages
✅ https://googleapis.dev/nodejs/googleapis/latest/chat/interfaces/Schema$Message.html

`createTime` is documented "**Output only.** The time at which the message was created in Hangouts
Chat server", and `lastUpdateTime` "**Output only.** The time at which the message was last edited".
The resource name is `spaces/{space}/messages/{message}` where `{message}` is "a **system-assigned**
ID for the message", and — importantly — "If you set a cus[stom]…" (the docs allow a custom id on
create, but the *time* is never client-supplied). ✅ both URLs.

So Google Chat does the same thing Firestore does: the client may contribute an **id**, never an
**order**.

### Clock skew handling, summarised

None of the five expose a client wall-clock field as a sort key. Every one of them assigns the order
server-side and treats the client clock as either absent (Telegram, Google Chat, Slack) or the sole
source of a non-ordering display timestamp (Discord's snowflake still derives from the server's
clock). The industry is unanimous, and the unanimity is the finding.

---

## (c) Why client wall-clock timestamps are unsafe

Three independent failure modes, all of which Astra can hit on a laptop with an unsynced clock:

1. **Skew.** Two devices, both NTP-disciplined in principle, disagree by tens to hundreds of ms on a
   real network; a VM restored from a snapshot can be minutes off. 👀
   https://hld.handbook.academy/curriculum/distributed-systems-theory/clocks-and-ordering/ — its TL;DR
   claims "NTP skew between cloud VMs is routinely 10 to 250 ms" and notes quartz drift up to 150 ppm.
   (Treat the specific numbers as a secondary source; the mechanism is uncontroversial.)
2. **Regression.** NTP steps the clock backwards for correction; the user's OS does it on resume from
   suspend. This is not hypothetical — it is exactly what upstream Hermes' comment
   "**never timestamp: clocks regress**" is defending against.
3. **No causality.** Wall-clock time cannot distinguish "typed before" from "arrived before". If you
   order by it, a message composed at T and delivered at T+30 s can sort *after* a message composed at
   T+5 s and delivered at T+6 s — and the transcript shows them in the wrong order forever, because
   the order is frozen into a persisted sort key.

Firestore's design is the industry workaround in one function call: `FieldValue.serverTimestamp()`
"tracks when the server receives the update" ✅
https://firebase.google.com/docs/firestore/manage-data/add-data — the client supplies no time value at
all, and locally the SDK substitutes an estimate until the server's value lands.

The pattern that satisfies the owner: **server-assigned monotonic sequence + client-generated id +
dedupe by id.** Google Chat's `createTime` (server-only) next to a client-settable message id is the
same shape; Slack's `ts` + `client_msg_id` is the same shape.

---

## (d) Late / out-of-order arrival

### The rule

A user message that arrives out of order is **inserted at its server position**, and the assistant
bubble that follows it is **split**. The owner's invariant — assistant output is one continuous
bubble broken only by user messages — is a function of position in the ordered list, not of
arrival order. `normalize-messages.ts` already implements exactly this grouping rule today: it walks
rows in order and opens a new `Turn` whenever `row.role === "user"` or when the role is assistant/tool
and `currentTurn.role !== "assistant"`.

### Why you cannot "just append it"

If device B's user message is assigned `seq = 41` but was rendered before the server had committed the
assistant rows at `seq 42..60`, then when those rows land, the correct result is that **the bubble at
`seq 42..60` belongs *after* the new bubble**, not inside the one the user is looking at. Appending
produces a permanently wrong transcript, and — because the assistant bubble is a composite of
segments — you cannot fix it by moving a DOM node: the segment list itself has to be re-partitioned.

### The non-reflowing recipe

The re-flow cost is bounded by the fact that a *bubble* is the unit of change, and a user message
inserted at position `p` only splits the one bubble that spans `p`:

```
# Pseudocode — late-insert, incremental
insert_late(user_msg):
  p = rank(user_msg)                    # binary search the ordered list by (seq)
  i = first index where key(list[i]) > user_msg.key
  host = bubble_containing_index(i)     # nil if p lands past every assistant bubble

  if host == nil:
      append_bubble(user_msg)           # cheap path: only the tail moved
      return

  tail_segments = host.segments[k:]      # k = first segment with seq > user_msg.seq
  host.segments = host.segments[:k]      # seal the head in place — no re-render
  new_bubble_assistant(tail_segments)   # bubble between user_msg and the next one
  insert_bubble_after(host, user_msg)
```

Three properties make this cheap, and all three are properties of the *data model*, not of the UI:

- Bubbles are keyed by their first row's `seq`, so a split never changes an existing bubble's
  identity — only its segment count. React reconciles by key; the head of the bubble is untouched.
- Only two DOM nodes are inserted (the user bubble, the tail bubble). Nothing above `p` moves, so
  there is no scroll-anchoring work beyond a single `scrollHeight` delta.
- The tail bubble is already-rendered DOM being **re-parented**, not re-created, if you key canvas
  cards by their own row id — a card's internal state (expanded/collapsed, slider position) survives.

**Anti-pattern to avoid:** re-rendering the transcript from the full ordered list on every insert. It
is correct and it is what `rowsToTurns` already does on *load* — which is fine, because load is a
cold start. Do not reuse it for live inserts.

**The safety valve.** If a late user message ever lands more than a few bubbles back, fall back to the
load path (full re-derive) rather than splicing. One pathological case (an outbox message composed
offline, sent hours later, against a session that has since streamed 200 rows) is not worth an
optimised path; the full re-derive is a few hundred rows and imperceptible.

---

## (e) Append-only vs mutable records, and idempotent retries

### Append-only for the log; mutable only for lifecycle

The `messages` table is append-only in practice — there is no `UPDATE messages SET content` in the
write path, and rows are retired by flags (`active`, `compacted`, `_compressed_summary`), not by
deletion or rewrite. ✅ `hermes_state_common.py:402-429` (schema), `hermes_state_messages.py:1058`
(read path filters on those flags). This is the right shape: the transcript is the audit trail, and
edits are new facts about an old row rather than rewrites.

Astra already leans this way — the durable half of the conversation lives in the gateway's session
history and "the client never persists assistant content." 👀 `src/lib/outbox.ts:1-7`

### Idempotent PUT for retries

The owner asked specifically about idempotent PUT semantics. RFC 9110 §9.2.2 is the citation:

> "A request method is considered 'idempotent' if the intended effect on the server of multiple
> identical requests with that method is the same as the effect for a single such request. Of the
> request methods defined by this specification, PUT, DELETE, and safe request methods are idempotent.
> … Idempotent methods are distinguished because the request can be repeated automatically if a
> communication failure occurs before the client is able to read the server's response. For example, if
> a client sends a PUT request and the underlying connection is closed before any response is received,
> then the client can establish a new connection and retry the idempotent request. It knows that
> repeating the request will have the same intended effect, even if the original request succeeded,
> though the response might differ."
> ✅ https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2

§9.3.4 adds the create-vs-replace status split you need for a retry-safe create: 201 (Created) when
PUT creates a representation, 200/204 when it modifies one. ✅ same URL, §9.3.4

Two rules fall out, and they are the whole of (e):

1. **The client's UUIDv7 must be the resource identity** — `PUT /api/sessions/{sid}/messages/{client_msg_id}`.
   Then a retry after a dropped response cannot create a duplicate, because the second request addresses
   the same resource. This is exactly what RFC 9110 §9.2.2 licenses the automatic retry for. Do **not**
   `POST` and hope: a client that cannot distinguish "my POST succeeded and the response was lost"
   from "my POST never arrived" is one user-perceived duplicate bubble away from a bug report, and
   `POST` gives it no way out.
2. **Server authority over the position, client authority over the id.** On a `PUT` that creates, the
   server allocates `seq` (AUTOINCREMENT) and stores the client's UUIDv7 as `client_msg_id`. Retrying
   the identical PUT re-derives the same `seq` — SQLite's `INSERT OR IGNORE` on the `client_msg_id`
   unique index is the cheapest correct implementation, and it returns the existing row rather than
   allocating a new `seq`. This is the "idempotent PUT" shape from §9.3.4 with 201 vs 200 distinguishing
   first-write from retry.

Discord's "be sent up to N times per client… operate in as much of an idempotent behavior as possible"
✅ is the client-side half of the same rule, and it is why the client dedupes by id on ingest —
`pagination.ts:prependOlder` already does this ("dropping any row whose id we already hold"). 👀

---

## (f) Is a CRDT justified? No — and here's the evidence from your own repo

Automerge and Yjs both solve real problems, and both describe their guarantees accurately. Automerge:
"If two users concurrently insert at the same position, Automerge will ensure that on all nodes the
inserted items are placed in the same order." ✅
https://automerge.org/docs/reference/documents/conflicts/ — and it is honest about its one blind spot:
"The only case Automerge cannot handle automatically, because there is no well-defined resolution, is
when users concurrently update the same property in the same object… Automerge picks one of the
concurrently written values as the 'winner', and it ensures that this winner is the same on all nodes."
✅ same URL. Yjs's `Y.Array` offers `insert(index, content)` / `push` / `delete` ✅
https://docs.yjs.dev/api/shared-types/y.array, and its conflict resolution is by client id —
👀 https://mintlify.wiki/yjs/yjs/internals/crdt-algorithm (53-bit random clientID; concurrent same-key
writes resolve to the higher clientID, *not* by timestamp).

Astra already made this call once, correctly, and wrote down why. `src/lib/read-sync.ts:1-7`:

> "TinyBase client-state layer (2026-10-01). MergeableStore = native CRDT → read markers, presence,
> and per-tab focus written from phone + desktop + N tabs merge deterministically, no conflicts.
> Syncs over BroadcastChannel (instant same-browser tabs) + a small HTTP poll of the proxy's
> `/api/read-state` (**server watermark is durable truth; the CRDT layer is the fast path**).
> **Server-side 'ws synchronizer' was evaluated and skipped**: our proxy already owns a WS relay, and
> the read-state set is tiny — the existing relay carries the live `session.read` frames instead."

That is the correct architecture, applied to the right sub-problem: CRDT for the tiny, genuinely
concurrent, purely-client-ephemeral state (read markers, presence, focus); server-authoritative log
for the transcript. Read markers are last-writer-wins scalars — the canonical CRDT-shaped problem.
The transcript is a single-writer append-only sequence — the canonical *not*-CRDT problem.

**Over-engineering verdict:** introducing Yjs/Automerge for the transcript would mean making the
server one peer among several, which forfeits the total order you already have for free, and it would
make "delete this message" a CRDT tombstone problem instead of a DELETE. It also adds a whole
persistence + provider layer for a dataset that one process writes. Slack, Discord, Telegram and Google
Chat all use a server-assigned sequence for exactly this data; none of them uses a CRDT for it.

The correct reuse of the CRDT idea is what you already did: keep it for read-state, keep the log
server-authoritative.

---

## Recommended total ordering function

```pseudocode
# ---------------------------------------------------------------------------
# KEY(m) for a message m in conversation C. Comparable across all devices.
# HLC / client wall-clock deliberately absent.
# ---------------------------------------------------------------------------

function KEY(m):
    if m.seq != null:
        # Server-committed row: the authoritative order. SQLite
        # messages.id (AUTOINCREMENT) per session_id. "never timestamp: clocks regress".
        return (0, m.seq, m.id)              # bucket 0 = committed

    # Uncommitted optimistic client row: a UUIDv7 minted locally.
    # Sorts AFTER every committed row (bucket 1) so a not-yet-acknowledged
    # message can never jump ahead of server history on reload.
    # Ordered within itself by the UUIDv7's own time prefix (48-bit ms),
    # then by random tail — deterministic, and stable for the optimistic window.
    return (1, uuidv7_ms(m.client_msg_id), m.client_msg_id)


# ---------------------------------------------------------------------------
# MERGE — pure function. Local store + remote store in, ordered turns out.
# Runs identically on phone, desktop, and on a cold reload: no shared state,
# no coordination, no arrival-order dependence. Property: order-independence —
#   MERGE(S ∪ R) == MERGE(MERGE(S) ∪ R) for any S, R, and any order of arrival.
# ---------------------------------------------------------------------------

function MERGE(local, remote):
    rows = []

    # 1. Dedupe by durable id FIRST. Same id = same fact, never two bubbles.
    #    (RFC 9110 9.2.2 idempotent PUT means a retried create is one row.)
    by_id = {}
    for m in local + remote:
        k = m.client_msg_id ?? m.id
        if k not in by_id:
            by_id[k] = m
        else:
            # Merge: server fields win over optimistic client fields.
            # A row that has a seq is committed; an uncommitted local copy is not.
            by_id[k] = PREFER_COMMITTED(by_id[k], m)

    rows = values(by_id)

    # 2. Total order.
    rows = SORT(rows, by = KEY)

    # 3. Fold into turns. THIS is the owner's bubble rule, and it is a pure
    #    function of the ordered list — arrival order cannot affect it.
    turns = []
    cur = null
    for m in rows:
        if m.role == "user":
            cur = { role: "user", id: m.id, ts: m.ts,
                    content: m.content, files: m.files, segments: [] }
            turns.append(cur)

        else:  # assistant | tool | reasoning
            if cur == null or cur.role != "assistant":
                # Open a new bubble. Two ways in:
                #   - a user message just broke the previous bubble
                #   - the first assistant row, or an orphan tool row after compaction
                cur = { role: "assistant", id: m.id, ts: m.ts, segments: [] }
                turns.append(cur)
            cur.segments.append(SEGMENT_FOR(m))   # thinking | tool | text, in seq order

    # 4. Timestamps are DISPLAY-ONLY from here on. Note the existing
    #    normalize-messages.ts already honours this: row.timestamp feeds
    #    thinkDurMs / tool durationMs, never the ordering of a turn.
    return turns


function PREFER_COMMITTED(a, b):
    if a.seq != null and b.seq == null: return a      # a is authoritative
    if b.seq != null and a.seq == null: return b
    # both committed (retry): identical row, keep either
    if a.seq != null and b.seq != null: return a
    # both optimistic: same client_msg_id, so same content by construction
    return a
```

**Properties this gives you, and where each one comes from:**

- **Deterministic and order-independent.** Depends only on `(seq, id)`, both of which are
  stable facts in the row. Every device computes the identical list from the identical set.
- **Total.** No ties: `seq` is unique per conversation (AUTOINCREMENT), and the optimistic bucket
  falls back to `client_msg_id`, which is a UUIDv7 and therefore unique.
- **Handles clock skew by construction.** No client clock participates in the comparison. Phone
  400 ms fast: irrelevant.
- **Idempotent under retry.** Dedupe is by id *before* ordering, so the same fact arriving twice
  produces one row (RFC 9110 §9.2.2; Discord's "be sent up to N times per client" ✅).
- **The bubble rule is a fold, not a heuristic.** The owner's "assistant output is one continuous
  bubble, broken only by user messages" falls out of step 3 automatically, for every device,
  including a device that has never seen the assistant rows at all.
- **Works for the assistant's own rows unchanged.** They already have `seq`; nothing about the
  assistant stream needs to change.

**Optimistic bucket note.** Putting uncommitted rows in bucket 1 (after all committed rows) is a
deliberate choice with a visible consequence: while a user message is in flight, it renders at the
bottom — which is exactly where the user just typed it, so the UX is right. The moment the server
assigns `seq`, the row migrates from bucket 1 to bucket 0 at its true position. On a reload in the
window between "typed" and "committed", the message may render *after* some assistant rows it preceded
in wall-clock terms; that is honest (it is where the server actually put it) and it self-corrects on
the next poll. If you would rather it render first, the alternative is to have the client reserve a
position optimistically — but then you are back to trusting a client clock, which is the thing
(c) rules out.

---

## What I did not verify

- Slack's `client_msg_id` semantics 👀 only — would need to open
  https://api.slack.com/reference/events/message to quote precisely.
- The specific NTP skew figures (10–250 ms, 150 ppm) 👀 from a secondary source. The *mechanism*
  is uncontroversial and is corroborated by upstream Hermes' own "clocks regress" comment.
- Yjs's client-id conflict rule 👀 from a third-party mirror of the Yjs internals docs; the primary
  Yjs docs URL I opened covers the `Y.Array` API but not that specific resolution rule.
- Whether Astra's gateway can accept a client-supplied `client_msg_id` on the write path today — I
  read the *read* path (`GET /api/sessions/{sid}/messages`) and the schema, not the ingest handler.
  That is the one thing to check before committing to the PUT design in (e).

## Related

- `src/lib/normalize-messages.ts` — already folds rows→turns in row order; this report's step 3 is
  a description of what it does, not a change to it.
- `src/lib/pagination.ts` — already dedupes by row id on page-merge, and its module note documents
  why `order` is fixed. Its offset walk would benefit from Slack-style keyset paging on `seq`.
- `src/lib/read-sync.ts` — the existing TinyBase CRDT decision, and the precedent for (f).
- `src/lib/outbox.ts` — the offline user-message queue; `outboxRowId()` is already the
  client-message-id concept, currently `ob${Date.now()}-${random}`.
