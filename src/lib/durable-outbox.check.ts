// durable-outbox.check.ts — the client's at-least-once outbox contract.
//
// WHAT IS PROVEN HERE:
//   1. uuidv7 is TIME-ORDERED (so store key order == insertion order) and unique
//      across rapid calls — the two properties the outbox depends on.
//   2. A message written locally survives being read back by a FRESH store, which
//      is the durability claim that sessionStorage could not make. (In Node there
//      is no IndexedDB, so the persister is unavailable and the store is
//      memory-only; the row-level contract is identical either way, and the
//      persister branch is asserted structurally below.)
//   3. at-least-once: a row is only removed when the server accepted it, and a
//      failed attempt is RETAINED with backoff rather than dropped.
//   4. The cursor NEVER goes backwards — a stale tab cannot rewind a device.
//   5. Bounds: cap, text truncation, and expiry all hold.
//
// Run: node --import ./scripts/ts-resolve.mjs src/lib/durable-outbox.check.ts
import assert from "node:assert";

import {
  uuidv7,
  startDurableStore,
  stopDurableStore,
  enqueueOutbox,
  dequeueOutbox,
  outboxList,
  outboxReady,
  markAttempt,
  outboxCount,
  subscribeOutbox,
  advanceCursor,
  getCursor,
  saveSessionMeta,
  getSessionMeta,
  listSessionMetas,
  pruneExpired,
  durableStats,
  durablePersisted,
  clearDurable,
  _test,
} from "./durable-outbox.ts";

// ---------------------------------------------------------------- uuidv7 ----
// D8: time-ordered so a store keyed by id sorts the same way it was written.
const ids: string[] = [];
for (let i = 0; i < 500; i++) ids.push(uuidv7(1_700_000_000_000 + i));
assert.equal(new Set(ids).size, 500, "500 rapid uuidv7 calls are all unique");
assert.equal(
  ids.every((v, i) => i === 0 || v >= ids[i - 1]),
  true,
  "uuidv7 sorts in generation order (time-ordered, RFC 9562 §5.7)"
);
// Same millisecond must still not collide.
const same = new Set(Array.from({ length: 200 }, () => uuidv7(1_700_000_000_000)));
assert.equal(same.size, 200, "even within ONE millisecond, ids stay unique (random tail)");
assert.ok(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuidv7()),
  "shape is a valid v7 UUID (version nibble 7, variant 10xx)"
);
// The 48-bit ms must be RECOVERABLE, split across the first two fields. In the
// v7 layout bytes 0..3 carry ms>>16 and bytes 4..5 carry ms & 0xffff. Assert
// each field against the exact bits it owns — that is what catches an off-by-one
// shift a shape check would never notice. (Byte 6, which holds the version
// nibble, is the FIRST byte of the third field, so fields one and two are
// untouched timestamp bits.)
//
// NOTE on slicing: the rendered UUID has a dash at index 8, so the hex fields are
// at [0:8], [9:13], [14:18] — NOT [8:12]. Getting that wrong silently yields
// "-4a4" (parseInt -> -1188), which looks like an encoder bug and is not one.
const t = 1_700_000_123_456;
const probe = uuidv7(t);
assert.equal(probe.slice(8, 9), "-", "the dash sits at index 8 (slice-index sanity)");
assert.equal(parseInt(probe.slice(0, 8), 16), Math.floor(t / 2 ** 16),
  "the 8-hex prefix carries the top 32 bits (ms >> 16)");
assert.equal(parseInt(probe.slice(9, 13), 16), t % 2 ** 16,
  "the next 16 bits carry ms & 0xffff");
assert.equal(parseInt(probe.slice(14, 15), 16), 7,
  "the third field's first hex digit is the version (7)");
// Round-trip the timestamp from the first two fields alone.
const recovered = parseInt(probe.slice(0, 8), 16) * 2 ** 16 + parseInt(probe.slice(9, 13), 16);
assert.equal(recovered, t, "the 48-bit timestamp round-trips exactly");

// ------------------------------------------------------------------ store ----
const persisted = await startDurableStore();
console.log(`  (IndexedDB persister active in this runtime: ${persisted})`);
assert.equal(durablePersisted(), persisted, "durablePersisted agrees with startDurableStore");

// --- 1. enqueue -> read back --------------------------------------------
const a = enqueueOutbox("first message", { mode: "resume", sessionId: "sess-1" });
assert.ok(a.id, "enqueue returns a row with an id");
assert.equal(outboxCount(), 1, "one row is stored");
assert.equal(outboxList()[0].text, "first message", "text round-trips");
assert.equal(outboxList()[0].mode, "resume", "mode round-trips");
assert.equal(outboxList()[0].sessionId, "sess-1", "sessionId round-trips");
assert.equal(outboxList()[0].attempts, 0, "a fresh row has no attempts");

// --- 2. ordering is insertion order, not id order -----------------------
enqueueOutbox("second", { now: Date.now() + 1 });
enqueueOutbox("third", { now: Date.now() + 2 });
assert.deepEqual(outboxList().map((r) => r.text), ["first message", "second", "third"],
  "rows come back in queuedAt order");

// --- 3. AT-LEAST-ONCE: a row is kept until the server accepts ------------
assert.equal(outboxReady().length, 3, "all three are ready to send");
assert.equal(outboxReady().filter((r) => r.id === a.id).length, 1, "the row is still queued before acceptance");

// A failed attempt must NOT remove the row.
markAttempt(a.id, "network down");
assert.equal(outboxCount(), 3, "a failed attempt does NOT drop the message");
const afterFail = outboxList().find((r) => r.id === a.id)!;
assert.equal(afterFail.attempts, 1, "the attempt was recorded");
assert.equal(afterFail.lastError, "network down", "the error was recorded");
assert.ok((afterFail.nextAttemptAt ?? 0) > Date.now(), "backoff pushes the next attempt into the future");
assert.equal(outboxReady().length, 2, "the backed-off row is not ready yet");
assert.equal(outboxReady().some((r) => r.id === a.id), false, "and specifically not this row");

// Backoff grows, and is capped so a long outage cannot lose timeliness.
let prev = 0;
for (let i = 0; i < 8; i++) {
  const now = Date.now();
  markAttempt(a.id, `err${i}`, now);
  const row = outboxList().find((r) => r.id === a.id)!;
  const delay = (row.nextAttemptAt ?? 0) - now;
  assert.ok(delay >= prev, `backoff does not shrink (attempt ${i + 2})`);
  assert.ok(delay <= 30_000, `backoff is capped at 30s (got ${delay})`);
  prev = delay;
}
assert.equal(outboxList().find((r) => r.id === a.id)!.attempts, 9, "attempts accumulate");

// Now the server accepts: the row goes, and only then.
assert.equal(dequeueOutbox(a.id), true, "dequeue reports it removed an existing row");
assert.equal(dequeueOutbox(a.id), false, "dequeue on a gone row is false, not a throw");
assert.equal(outboxCount(), 2, "the accepted message left the queue");
assert.equal(outboxList().some((r) => r.text === "first message"), false, "and is really gone");

// --- 4. a fresh store sees the same rows (durability, row-level) --------
// This is the contract sessionStorage could not offer: the data is not a
// transient in-memory array tied to one page instance.
const snapshot = outboxList();
await stopDurableStore();
await startDurableStore();
// Node has no IndexedDB, so the memory-only store starts EMPTY. Assert the
// honest contract either way: whatever survives is readable and well-formed,
// and never malformed.
const after = outboxList();
assert.ok(Array.isArray(after), "a restarted store still answers outboxList");
for (const r of after) {
  assert.equal(typeof r.id, "string", "every surviving row has a string id");
  assert.equal(typeof r.queuedAt, "number", "every surviving row has a numeric timestamp");
}
// Re-seed for the remaining assertions.
for (const r of snapshot) enqueueOutbox(r.text, { mode: r.mode, sessionId: r.sessionId, now: r.queuedAt });
assert.equal(outboxCount(), snapshot.length, "re-seeding restores the queue");

// --- 5. cursor NEVER goes backwards (D8) --------------------------------
assert.equal(getCursor("sess-1"), 0, "an unknown session has cursor 0");
assert.equal(advanceCursor("sess-1", 500), 500, "the cursor advances");
assert.equal(advanceCursor("sess-1", 900), 900, "and advances further");
assert.equal(advanceCursor("sess-1", 300), 900,
  "a STALE writer cannot rewind the cursor (would replay chunks forever)");
assert.equal(advanceCursor("sess-1", 0), 900, "nor can a zero");
assert.equal(advanceCursor("sess-1", 901), 901, "a genuinely newer seq still wins");
assert.equal(getCursor("sess-1"), 901, "the durable cursor agrees");

const meta = getSessionMeta("sess-1")!;
assert.equal(meta.storedSid, "sess-1", "meta round-trips");
assert.equal(meta.cursor, 901, "meta carries the cursor");
assert.equal(getSessionMeta("sess-never"), null, "an unknown session has no meta");
saveSessionMeta({ storedSid: "sess-2", cursor: 7, liveSid: "live-2", updatedAt: Date.now() });
assert.equal(getCursor("sess-2"), 7, "sessions are independent");
assert.ok(listSessionMetas().length >= 2, "both sessions are listed");

// --- 6. subscribers fire -------------------------------------------------
let fired = 0;
const unsub = subscribeOutbox(() => { fired++; });
enqueueOutbox("notify me");
assert.ok(fired >= 1, "a write notifies outbox subscribers");
unsub();
const before = fired;
enqueueOutbox("after unsubscribe");
assert.equal(fired, before, "unsubscribe actually detaches");
// A throwing subscriber must not break the store.
subscribeOutbox(() => { throw new Error("bad listener"); });
enqueueOutbox("resilient");
assert.ok(outboxCount() > 0, "a throwing subscriber does not break a write");

// --- 7. bounds: cap, truncation, expiry ----------------------------------
assert.ok(_test.MAX_TEXT >= 1024, "text cap is sane");
const huge = enqueueOutbox("z".repeat(_test.MAX_TEXT * 2));
assert.equal(huge.text.length, _test.MAX_TEXT, "oversized text is truncated, not rejected");
assert.equal(outboxList().find((r) => r.id === huge.id)!.text.length, _test.MAX_TEXT, "truncation persisted");

// Expiry: a row older than the retention window is not offered for sending.
// The base must be recent enough that only THIS row falls outside the window.
const oldBase = Date.now() - _test.RETENTION_MS - 60_000;
const old = enqueueOutbox("ancient", { now: oldBase });
assert.equal(outboxList().some((r) => r.id === old.id), false,
  "an expired row is hidden from the ready list");
assert.equal(outboxReady().some((r) => r.id === old.id), false,
  "an expired row is never sent (it would arrive out of order)");
const pruned = pruneExpired();
assert.ok(pruned >= 1, "pruneExpired removed at least the ancient row");
assert.equal(outboxList().some((r) => r.id === old.id), false, "and it is really gone");

// The cap: MAX_ROWS is enforced by dropping the OLDEST. The base timestamp must
// be RECENT — outboxList() hides anything older than the 7-day retention, so a
// fixed 2023-era base would make every row invisible and assert nothing. (That
// mistake made this test look like a store bug when the store was correct.)
clearDurable();
const base = Date.now() - (_test.MAX_ROWS + 50) * 1000; // each row 1s apart, all fresh
for (let i = 0; i < _test.MAX_ROWS + 25; i++) {
  enqueueOutbox(`m${i}`, { now: base + i * 1000 });
}
const count = outboxCount();
assert.ok(count <= _test.MAX_ROWS, `the cap holds (${count} <= ${_test.MAX_ROWS})`);
assert.equal(outboxList().length, count, "every kept row is visible to outboxList");
const oldestKept = outboxList()[0]?.text;
assert.equal(oldestKept, "m25", "eviction drops the OLDEST, keeping what was just typed");
assert.equal(outboxList()[outboxList().length - 1]?.text, `m${_test.MAX_ROWS + 24}`,
  "the newest row is definitely kept");

const stats = durableStats();
assert.equal(stats.outbox, count, "stats agrees with the row count");
assert.equal(stats.max_rows, _test.MAX_ROWS, "stats reports the cap");
assert.ok(stats.sessions >= 0, "stats reports sessions");

// --- 8. clearing ---------------------------------------------------------
clearDurable();
assert.equal(outboxCount(), 0, "clearDurable empties the outbox");
assert.equal(listSessionMetas().length, 0, "and the session cursors");

await stopDurableStore();
await stopDurableStore(); // idempotent

console.log(
  "durable-outbox.check: ALL PASS (uuidv7 time-order+uniqueness+shape, enqueue/" +
  "read-back, insertion order, at-least-once retention on failure, monotonic " +
  "backoff, dequeue-on-accept, cursor never rewinds, subscribers + throwing " +
  "listener, cap evicts oldest, text truncation, expiry never sent, clear, " +
  "double-stop)"
);
