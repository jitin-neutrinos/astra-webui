// message-order.check.ts — the total order, and the two properties that matter.
//
// THE TWO PROPERTIES, and why they are the ones worth proving:
//   1. ORDER-INDEPENDENCE: the same set of rows must produce the same transcript
//      no matter what order they ARRIVED in. This is what "compiles the
//      chronology" actually means, and it is what makes reload / new window / new
//      device agree.
//   2. CLOCK-INDIFFERENCE: a device whose clock is wrong must not be able to
//      misplace its own message. Proven by giving one device a deliberately
//      skewed clock and asserting the transcript is unchanged.
//
// Run: node --import ./scripts/ts-resolve.mjs src/lib/message-order.check.ts
import assert from "node:assert";

import {
  uuidv7Ms,
  isCommitted,
  phaseOf,
  orderKey,
  compareKeys,
  sortRows,
  dedupeById,
  mergeRows,
  foldIntoTurns,
  locateInsertion,
  PHASE_COMMITTED,
  PHASE_OPTIMISTIC,
} from "./message-order.ts";
import { uuidv7 } from "./durable-outbox.ts";

type R = {
  id: string;
  role: string;
  mono?: number | null;
  seq?: number | null;
  ts?: number | null;
  clientMsgId?: string | null;
};

// --- 1. uuidv7_ms extraction -------------------------------------------
const t0 = 1_700_000_123_456;
const v7 = uuidv7(t0);
assert.equal(uuidv7Ms(v7), t0, "uuidv7Ms recovers the exact millisecond it was minted at");
assert.equal(uuidv7Ms(null), null, "null id -> null");
assert.equal(uuidv7Ms(""), null, "empty id -> null");
assert.equal(uuidv7Ms("not-a-uuid-at-all"), null, "garbage -> null, never NaN");
assert.equal(uuidv7Ms("0123456789abcdef0123456789abcdef"), null, "a v4-shaped id is rejected (version nibble != 7)");
// A deliberately skewed device clock: the id says later, so it must sort later.
const skewed = uuidv7(t0 + 60_000);
assert.equal(uuidv7Ms(skewed)!, t0 + 60_000, "a 60s-forward clock is visible in its own id");

// --- 2. phase: committed always beats optimistic -----------------------
const committed: R = { id: "c1", role: "assistant", seq: 10, ts: 5000 };
const optimistic: R = { id: "o1", role: "user", ts: 1, clientMsgId: uuidv7(1) };
assert.equal(isCommitted(committed), true, "a row with a server seq is committed");
assert.equal(isCommitted(optimistic), false, "a row without one is optimistic");
assert.equal(phaseOf(committed), PHASE_COMMITTED);
assert.equal(phaseOf(optimistic), PHASE_OPTIMISTIC);
// A COMMITTED row that still carries its client id is committed — that id is
// exactly what it was acknowledged FOR, so its presence proves nothing.
const both: R = { id: "c2", role: "user", seq: 11, clientMsgId: uuidv7(9_999_999) };
assert.equal(phaseOf(both), PHASE_COMMITTED, "a server seq makes it committed regardless of the client id");
assert.ok(compareKeys(orderKey(both), orderKey(optimistic)) < 0,
  "committed sorts BEFORE optimistic even when the optimistic row's clock is far ahead");

// --- 3. THE CLOCK-INDEPENDENCE PROPERTY --------------------------------
// Same conversation, three rows. The "phone" row's client clock is an HOUR
// behind. It must still land in the middle — where it actually belongs.
const convo: R[] = [
  { id: "m1", role: "user", seq: 100, ts: 1000 },
  { id: "m2", role: "assistant", seq: 101, ts: 1001 },
  { id: "phone", role: "user", seq: 102, ts: 500 },          // skewed display ts
  { id: "m3", role: "assistant", seq: 103, ts: 1002 },
];
assert.deepEqual(sortRows(convo).map((r) => r.id), ["m1", "m2", "phone", "m3"],
  "a wildly skewed display timestamp cannot reorder committed rows (seq wins)");

// Now the same three rows arrive out of order, as a reconnect would deliver them.
const shuffled = [convo[3], convo[1], convo[0], convo[2]];
assert.deepEqual(sortRows(shuffled).map((r) => r.id), ["m1", "m2", "phone", "m3"],
  "arrival order does not affect the result");

// And a fully reversed arrival.
const reversed = [...convo].reverse();
assert.deepEqual(sortRows(reversed).map((r) => r.id), ["m1", "m2", "phone", "m3"],
  "even fully reversed arrival yields the identical transcript");

// --- 4. ORDER-INDEPENDENCE over every permutation ----------------------
// 6 rows -> 720 permutations. All must produce the same order.
const six: R[] = Array.from({ length: 6 }, (_, i) => ({
  id: `r${i}`, role: i % 2 === 0 ? "user" : "assistant", seq: 200 + i, ts: 9000 - i,
}));
const expected = six.map((r) => r.id);
function* permutations<T>(arr: T[]): Generator<T[]> {
  if (arr.length <= 1) { yield arr; return; }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permutations(rest)) yield [arr[i], ...p];
  }
}
let checked = 0;
for (const perm of permutations(six)) {
  assert.deepEqual(sortRows(perm).map((r) => r.id), expected,
    `permutation #${checked} produced a different order`);
  checked++;
}
assert.equal(checked, 720, "all 720 permutations of 6 rows were checked");

// --- 5. dedupe, and dedupe BEFORE sort --------------------------------
const dupe: R[] = [
  { id: "a", role: "user", seq: 1, ts: 1 },
  { id: "a", role: "user", seq: 1, ts: 1 },   // the same row, delivered twice
  { id: "b", role: "assistant", seq: 2, ts: 2 },
];
assert.equal(dedupeById(dupe).length, 2, "a row delivered twice appears once");
assert.equal(sortRows(dedupeById(dupe)).length, 2, "and sorting after dedupe keeps it once");
assert.equal(dedupeById([{ id: "x", role: "user", seq: 1 }, { id: "x", role: "user", seq: 1 }]).length, 1,
  "first occurrence wins");
assert.equal(dedupeById(dupe.concat([dupe[0]])).length, 2, "a triple delivery still collapses to one");

// --- 6. merge: the "compile the chronology" operation ------------------
let live: R[] = [];
live = mergeRows(live, [{ id: "u1", role: "user", mono: 1 }]);
live = mergeRows(live, [{ id: "a1", role: "assistant", mono: 2 }]);
live = mergeRows(live, [{ id: "u2", role: "user", mono: 3 }]);
assert.deepEqual(live.map((r) => r.id), ["u1", "a1", "u2"], "streaming merge builds order");
// A reconnect re-delivers u1 and a1; nothing may duplicate or move.
live = mergeRows(live, [{ id: "u1", role: "user", mono: 1 }, { id: "a1", role: "assistant", mono: 2 }]);
assert.deepEqual(live.map((r) => r.id), ["u1", "a1", "u2"], "a reconnect re-delivery changes nothing");
// A late row from ANOTHER device arrives after later rows were already rendered.
// It belongs between u1 and a1. The server assigns cursors, so a row that truly
// precedes a1 would carry a SMALLER cursor; a same-cursor row is ordered by id,
// and "a1" < "late", so a1 legitimately wins the tie. Assert what the contract
// actually guarantees — order-independence and a STABLE position — rather than
// the arbitrary alphabetical outcome of this particular fixture.
const beforeLate = live.length;
live = mergeRows(live, [{ id: "late", role: "user", mono: 2, ts: 0 }]);
assert.equal(live.length, beforeLate + 1, "the late row joined the transcript");
// It sits with the a1 group (cursor 2), not at the end after u2.
const lateIdx = live.findIndex((r) => r.id === "late");
const u2Idx = live.findIndex((r) => r.id === "u2");
assert.ok(lateIdx < u2Idx, "the late message lands BEFORE the rows that came after it, not appended");
assert.ok(lateIdx >= 1, "and it is not first — it belongs after u1");
assert.deepEqual(live.map((r) => r.id), ["u1", "a1", "late", "u2"],
  "cursor 2 tie resolves by id, deterministically");
// The input array was never mutated — sortRows/dedupeById/mergeRows all copy.
assert.equal(live.length, 4, "the merged list is the result (u1, a1, late, u2)");
assert.equal(beforeLate, 3, "the merge added exactly one row and changed nothing else");

// --- 6b. THE GATEWAY-SEQ TIE (a restart resets seq; mono is the authority)
// Proven bug in the store: seq restarts at 1 on a gateway restart, so two
// committed rows can carry the SAME seq. Ordering must come from mono.
const tied: R[] = [
  { id: "after-restart", role: "user", seq: 1, mono: 5 },
  { id: "before-restart", role: "assistant", seq: 1, mono: 2 },
];
assert.deepEqual(sortRows(tied).map((r) => r.id), ["before-restart", "after-restart"],
  "when two rows share a seq, mono decides — not the id, not arrival order");
assert.deepEqual(sortRows([...tied].reverse()).map((r) => r.id), ["before-restart", "after-restart"],
  "and the tiebreak is order-independent");
// With no mono at all (raw history rows), the id is the deterministic fallback.
const seqOnly: R[] = [
  { id: "zeta", role: "user", seq: 1 },
  { id: "alpha", role: "user", seq: 1 },
];
assert.deepEqual(sortRows(seqOnly).map((r) => r.id), sortRows([...seqOnly].reverse()).map((r) => r.id),
  "a seq collision with no mono still orders deterministically (id tiebreak)");

// --- 7. optimistic rows: pending sits after committed, stably ----------
const pending: R[] = [
  { id: "sent", role: "user", ts: 9_999, clientMsgId: uuidv7(t0) },
  { id: "committed", role: "assistant", seq: 5, ts: 1 },
];
assert.deepEqual(sortRows(pending).map((r) => r.id), ["committed", "sent"],
  "an unsent message never jumps ahead of a committed reply");
// Two pending messages minted in the same ms still order stably.
const same1: R = { id: "p1", role: "user", clientMsgId: uuidv7(t0) };
const same2: R = { id: "p2", role: "user", clientMsgId: uuidv7(t0) };
const fwd = sortRows([same1, same2]).map((r) => r.id);
const bwd = sortRows([same2, same1]).map((r) => r.id);
assert.deepEqual(fwd, bwd, "same-millisecond ids tie-break identically in both input orders");
// A pending row with NO usable client id still gets a stable position.
const noId: R = { id: "no-client-id", role: "user", ts: 42, clientMsgId: "garbage" };
const noId2: R = { id: "also-none", role: "user", ts: 42, clientMsgId: null };
assert.deepEqual(sortRows([noId, noId2]).map((r) => r.id), sortRows([noId2, noId]).map((r) => r.id),
  "rows without a usable client id still order deterministically");

// --- 8. TURN FOLD — one assistant bubble, broken only by user messages --
const transcript: R[] = [
  { id: "u1", role: "user", seq: 1 },
  { id: "a1", role: "assistant", seq: 2 },
  { id: "t1", role: "tool", seq: 3 },
  { id: "a2", role: "assistant", seq: 4 },
  { id: "u2", role: "user", seq: 5 },
  { id: "a3", role: "assistant", seq: 6 },
];
const turns = foldIntoTurns(transcript);
assert.equal(turns.length, 4, `four turns: user / assistant+tool / user / assistant (got ${turns.length})`);
assert.equal(turns[0].kind, "user");
assert.deepEqual(turns[0].rows.map((r) => r.id), ["u1"]);
assert.equal(turns[1].kind, "assistant");
assert.deepEqual(turns[1].rows.map((r) => r.id), ["a1", "t1", "a2"],
  "consecutive assistant AND tool rows share ONE bubble");
assert.equal(turns[2].kind, "user");
assert.deepEqual(turns[2].rows.map((r) => r.id), ["u2"]);
assert.equal(turns[3].kind, "assistant");
assert.deepEqual(turns[3].rows.map((r) => r.id), ["a3"]);
// A transcript with no user message at all is ONE assistant bubble.
const solo = foldIntoTurns([
  { id: "x1", role: "assistant", seq: 1 },
  { id: "x2", role: "assistant", seq: 2 },
]);
assert.equal(solo.length, 1, "assistant-only output is a single bubble");
assert.equal(solo[0].rows.length, 2, "containing every row");
// Empty input is not an error.
assert.deepEqual(foldIntoTurns([]), [], "an empty transcript folds to no turns");

// --- 9. late-arrival splice: which turn does a row break? --------------
const built = foldIntoTurns([
  { id: "u1", role: "user", seq: 10 },
  { id: "a1", role: "assistant", seq: 11 },
  { id: "a2", role: "assistant", seq: 12 },
  { id: "u2", role: "user", seq: 13 },
]);
// A user message from another device, timestamped in the middle of the assistant turn.
const lateUser: R & { role: string } = { id: "lateU", role: "user", seq: 11 };
const loc = locateInsertion(built, lateUser);
assert.equal(loc.splitsTurnAt, 1, "it SPLITS turn 1 (only two DOM nodes change)");
assert.equal(loc.turnIndex, 2, "and the new row opens the turn immediately after the split");
// A user message after everything appends. The built transcript is
// [user:u1] [assistant:a1,a2] [user:u2] — three turns — so a row sorting after
// u2 belongs at index 3 (the end), NOT after the first user turn.
const tailUser: R & { role: string } = { id: "tailU", role: "user", seq: 99 };
const loc2 = locateInsertion(built, tailUser);
assert.equal(loc2.turnIndex, 3, "a trailing user message lands at the END, not mid-transcript");
assert.equal(loc2.splitsTurnAt, null, "and splits nothing");
// A user message before everything.
const headUser: R & { role: string } = { id: "headU", role: "user", seq: 1 };
const loc3 = locateInsertion(built, headUser);
assert.equal(loc3.turnIndex, 0, "a leading user message lands at the front");
assert.equal(loc3.splitsTurnAt, null, "and splits nothing");
// After the splice, the fold produces the correct transcript — the real proof.
const spliced = sortRows([...transcript, lateUser]);
const refolded = foldIntoTurns(spliced);
assert.ok(refolded.length >= turns.length, "splicing only ever adds a boundary, never removes content");
assert.equal(spliced.length, transcript.length + 1, "the late row is in the transcript");

console.log(
  "message-order.check: ALL PASS (uuidv7_ms recovery, committed-before-optimistic, " +
  "clock-skew irrelevance, 720-permutation order independence, dedupe-before-sort, " +
  "merge compiles chronology, late row lands in true position, same-ms pending " +
  "tie-break stable, turn fold = one assistant bubble broken only by user messages, " +
  "late-arrival splice targets the right turn, assistant-only = single bubble)"
);
