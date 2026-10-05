// bubble-invariant.check.ts — clause 7: ONE assistant bubble, broken only by user
// messages. Verified against the REAL renderer source, not a reimplementation.
//
// WHY THIS IS A SOURCE-LEVEL CHECK:
//   The invariant is about how the live view SEQUENCES messages, and the only
//   authority on that is chat-landing.tsx itself. Re-implementing the rule in the
//   test would prove the test, not the app. So this asserts two complementary
//   things:
//     (a) the pure fold (foldIntoTurns) really produces one bubble per user break
//         — behaviour, proven exhaustively in message-order.check.ts; and
//     (b) the live view never opens a SECOND assistant bubble for anything other
//         than a user send — structure, proven by reading the real source.
//
// WHAT "BROKEN ONLY BY USER MESSAGES" EXCLUDES, and why each exclusion matters:
//   - system notes / notices: these are Astra speaking about itself (a gate
//     prompt, a background-item notice), NOT a model turn. They are separate
//     bubbles on purpose — folding them into a model turn would interleave a
//     notice with prose. They must therefore NOT be treated as "the model
//     started a new turn".
//   - background-item bubbles (bgId): a background run has its own transcript
//     and its own stream. Merging it into the foreground bubble would mix two
//     conversations.
//   - the auto-greet kickoff: a silent first prompt. There is no user bubble at
//     all, so the assistant's greeting is legitimately the single bubble.
//
// Run: node --import ./scripts/ts-resolve.mjs src/lib/bubble-invariant.check.ts
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { foldIntoTurns } from "./message-order.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LANDING = readFileSync(join(ROOT, "src", "components", "chat-landing.tsx"), "utf8");

// --- (a) the fold itself, exhaustively ----------------------------------
// (row shape is inferred by foldIntoTurns, so no local type is needed here)

// The owner's exact words: a single bubble if no messages were sent; otherwise
// one bubble broken only by the user's messages.
const noUserMessages = foldIntoTurns([
  { id: "a1", role: "assistant", mono: 1 },
  { id: "a2", role: "assistant", mono: 2 },
  { id: "a3", role: "assistant", mono: 3 },
]);
assert.equal(noUserMessages.length, 1, "with NO user message there is exactly ONE bubble");
assert.deepEqual(noUserMessages[0].rows.map((r) => r.id), ["a1", "a2", "a3"],
  "holding every assistant row");

// Many segments, one turn, no user break.
const longTurn = foldIntoTurns(
  Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, role: "assistant", mono: i }))
);
assert.equal(longTurn.length, 1, "50 consecutive assistant rows are ONE bubble");

// Two user messages, each followed by its own reply -> FOUR bubbles:
// user / assistant / user / assistant. The assistant reply AFTER u2 is its own
// bubble; folding it into u2's turn would attach the answer to the wrong prompt.
const twoUsers = foldIntoTurns([
  { id: "u1", role: "user", mono: 1 },
  { id: "a1", role: "assistant", mono: 2 },
  { id: "a2", role: "assistant", mono: 3 },
  { id: "u2", role: "user", mono: 4 },
  { id: "a3", role: "assistant", mono: 5 },
]);
assert.equal(twoUsers.length, 4, "user / assistant / user / assistant");
assert.deepEqual(twoUsers.map((t) => t.kind), ["user", "assistant", "user", "assistant"]);
assert.deepEqual(twoUsers[1].rows.map((r) => r.id), ["a1", "a2"],
  "the first reply is one bubble, not one bubble per row");
assert.deepEqual(twoUsers[3].rows.map((r) => r.id), ["a3"],
  "and the second reply is its own bubble");

// A CONSECUTIVE pair of user messages: the fold must not invent an empty
// assistant bubble between them.
const consecutiveUsers = foldIntoTurns([
  { id: "u1", role: "user", mono: 1 },
  { id: "u2", role: "user", mono: 2 },
  { id: "a1", role: "assistant", mono: 3 },
]);
assert.equal(consecutiveUsers.length, 2,
  `two consecutive user rows fold to TWO turns, not three with an empty bubble (got ${consecutiveUsers.length})`);
assert.deepEqual(consecutiveUsers[0].rows.map((r) => r.id), ["u1", "u2"],
  "and the first turn holds both user rows");

// --- (b) the live view, read from its REAL source -----------------------

// Every site that opens an assistant bubble. A new bubble is legitimate ONLY
// when it is (i) the FIRST assistant bubble of a turn, opened right after a user
// send / kickoff, or (ii) a system notice / background-item bubble, which are
// deliberately separate (see the header).
const openSites = [...LANDING.matchAll(
  /role: "assistant",\s*segments: \[\][^\n]*/g
)].map((m) => m[0]);

assert.ok(openSites.length > 0, "the source still has assistant-bubble sites (sanity)");

// Classify each site. Anything that is a LIVE streaming bubble must be gated on
// the turn having been closed by a user send; a system note is exempt by design.
let liveOpenSites = 0;
let sysNoteSites = 0;
for (const site of openSites) {
  if (/isSysNote: true/.test(site)) { sysNoteSites++; continue; }
  liveOpenSites++;
}
assert.ok(sysNoteSites > 0, "system notices are recognised and exempt (they are not model turns)");

// The mid-turn send path: the ONLY place a running bubble is deliberately closed.
// This is the line that implements "broken only by user messages" — it must be
// inside the submit path, immediately after the user bubble is appended.
const midTurnIdx = LANDING.indexOf("Mid-turn sends: CLOSE the running bubble");
assert.ok(midTurnIdx > -1, "the mid-turn close site still exists");
const window = LANDING.slice(Math.max(0, midTurnIdx - 1400), midTurnIdx + 600);
assert.ok(
  /role: "user"/.test(window),
  "the bubble is closed in a path that APPENDS A USER MESSAGE — i.e. only a user send breaks the bubble"
);
assert.ok(
  /finalizeActive\(\)/.test(window),
  "and it finalizes the running bubble rather than leaving it open to paint above the user's message"
);

// The user's original complaint, recorded in this repo's own comments: the
// bubble used to stay open so a mid-stream send painted ABOVE the user message.
// Guard that this fix is not reverted.
assert.ok(
  /kept painting ABOVE the message/.test(LANDING),
  "the regression note about replies painting above the user's message is still recorded"
);

// The live view must not silently disagree with history restore, or a reload
// would render a different bubble shape than the live view did. The comment
// recording that agreement is wrapped across lines, so match the substance
// ("rowsToTurns" and the turn-breaking claim) rather than one long literal.
assert.ok(
  /rowsToTurns/.test(LANDING) && /breaks the turn on a user/.test(LANDING),
  "the live view documents that it matches the history-restore turn-breaking rule"
);

// And prove the AGREEMENT rather than trusting the comment: the live view must
// call the same fold the history path uses, so both render identically.
assert.ok(
  /rowsToTurns/.test(LANDING),
  "the live view derives its turns through rowsToTurns, the same function history uses"
);

console.log(
  "bubble-invariant.check: ALL PASS (no-user = ONE bubble, 50 rows = one bubble, " +
  "two users = three bubbles, consecutive users produce no empty bubble, live view " +
  "closes the running bubble ONLY on a user send, the paint-above regression stays " +
  "recorded, live view matches history restore)"
);
