// Runnable check: the durable stream chunk log.
// Run: node server/stream-log.check.mjs   (isolated via ASTRA_STREAM_DIR)
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "astra-stream-"));
process.env.ASTRA_STREAM_DIR = tmp;
process.env.ASTRA_STREAM_TTL_MS = "1000";

const slog = await import("./stream-log.mjs");

const SID = "sess-stream-check";

// --- 1. classification is the D2 body-or-reference line -------------------
assert.equal(slog._test.classify("message.delta"), "body", "prose is a body");
assert.equal(slog._test.classify("thinking.delta"), "body");
assert.equal(slog._test.classify("reasoning.delta"), "body");
assert.equal(slog._test.classify("message.complete"), "body");
assert.equal(slog._test.classify("gate"), "body");
assert.equal(slog._test.classify("tool.done"), "ref", "tool output is a REFERENCE");
assert.equal(slog._test.classify("tool.result"), "ref");
// Frames we deliberately do not log: transport chatter and read/presence noise.
for (const noise of ["proxy.status", "presence.snapshot", "presence.update",
                     "session.read", "sessions.changed", "training.updated",
                     "session.usage", "session.info"]) {
  assert.equal(slog._test.classify(noise), null, `${noise} is not logged`);
}

// --- 2. frames missing the gateway's own seq are refused ------------------
// Without a seq there is nothing to replay against, so logging it would write
// rows nobody can order. The log degrades to "no rows", never to junk rows.
assert.equal(slog.recordEvent({ type: "message.delta", session_id: SID, payload: { text: "x" } }), false,
  "a frame with no seq is refused");
assert.equal(slog.recordEvent({ type: "message.delta", session_id: SID, seq: 0, payload: { text: "x" } }), false,
  "seq 0 is refused");
assert.equal(slog.recordEvent({ type: "message.delta", seq: 5, payload: { text: "x" } }), false,
  "a frame with no session is refused");
assert.equal(slog.recordEvent(null), false, "null frame is refused");
slog.flushNow();
assert.equal(slog.latestSeq(SID), 0, "nothing was written for the refused frames");

// --- 3. a turn's worth of real chunks, in order --------------------------
const turn = [
  { seq: 1,  type: "message.start",      payload: { message_id: "m1" } },
  { seq: 2,  type: "thinking.delta",     payload: { text: "let me think" } },
  { seq: 3,  type: "message.delta",      payload: { text: "Hello" } },
  { seq: 4,  type: "message.delta",      payload: { text: " world" } },
  { seq: 5,  type: "tool.done",          payload: { tool_call_id: "tc1", tool_name: "terminal", command: "ls -la /tmp" } },
  { seq: 6,  type: "message.delta",      payload: { text: "\n\ndone." } },
  { seq: 7,  type: "message.complete",   payload: { status: "ok", message_id: "m1" } },
];
for (const f of turn) {
  assert.equal(slog.recordEvent({ session_id: SID, ...f }), true, `logged ${f.type}`);
}
slog.flushNow();

// --- 4. replay returns everything, in seq order --------------------------
const all = slog.eventsSince(SID, 0);
assert.equal(all.length, 7, `all 7 chunks replay (got ${all.length})`);
assert.deepEqual(all.map((r) => r.seq), [1, 2, 3, 4, 5, 6, 7], "replay is strictly ascending by seq");

// --- 5. THE CORE PROPERTY: reassembled text is byte-identical ------------
// D9: the gateway discards coalesced deltas, so this log is the only durable
// record of an interrupted answer. If replay cannot reproduce the exact text,
// the feature is worthless.
const text = all.filter((r) => r.type === "message.delta")
  .map((r) => r.payload?.text ?? "").join("");
assert.equal(text, "Hello world\n\ndone.", `reassembled text is byte-identical (got ${JSON.stringify(text)})`);

// --- 6. the D2 split is actually visible in storage ----------------------
const bodies = all.filter((r) => r.kind === "body");
const refs = all.filter((r) => r.kind === "ref");
assert.equal(bodies.length, 6, "6 prose chunks stored as bodies");
assert.equal(refs.length, 1, "1 tool chunk stored as a reference");
assert.equal(refs[0].payload, undefined, "a reference stores NO payload copy");
assert.equal(refs[0].ref_sid, SID, "the reference points at the gateway session");
assert.equal(refs[0].ref_row, "tc1", "the reference names the gateway tool_call_id");
assert.ok(refs[0].headline && refs[0].headline.includes("terminal"),
  `the reference carries an inline headline (got ${JSON.stringify(refs[0].headline)})`);

// --- 7. resume cursor: only what the client missed -----------------------
const after3 = slog.eventsSince(SID, 3);
assert.deepEqual(after3.map((r) => r.seq), [4, 5, 6, 7], "since=3 returns 4..7");
assert.equal(slog.latestSeq(SID), 7, "latestSeq is the resume cursor");
assert.equal(slog.eventsSince(SID, 7).length, 0, "since=7 returns nothing new");

// --- 8. idempotent replay: re-logging the same (sid, epoch, seq) is ignored
for (const f of turn) slog.recordEvent({ session_id: SID, ...f });
slog.flushNow();
assert.equal(slog.eventsSince(SID, 0).length, 7, "a redelivered frame does not duplicate a row");

// --- 8b. THE GATEWAY-RESTART COLLISION (real bug, found while building Phase 5)
// event_replay.py: "Seq counters live in-process, so a restart resets them to 1
// while clients hold high watermarks." So (sid, seq) is NOT unique across a restart,
// and the pre-epoch schema silently DROPPED every post-restart chunk
// (measured: 2 of 2 lost). The epoch is the discriminator; `mono` is the cursor.
const RESTART = "sess-restart-collision";
slog._test.setEpochForTest("proc-A");
for (const seq of [1, 2, 3]) {
  slog.recordEvent({ session_id: RESTART, seq, type: "message.delta", payload: { text: `before ${seq}` } });
}
slog.flushNow();
// gateway restarts: new epoch, seq back to 1
slog._test.setEpochForTest("proc-B");
for (const seq of [1, 2]) {
  slog.recordEvent({ session_id: RESTART, seq, type: "message.delta", payload: { text: `after ${seq}` } });
}
slog.flushNow();
const restarted = slog.eventsSince(RESTART, 0);
assert.equal(restarted.length, 5, `all 5 rows survive a gateway restart (got ${restarted.length})`);
assert.equal(restarted.filter((r) => String(r.payload?.text).startsWith("before")).length, 3,
  "the pre-restart chunks are intact");
assert.equal(restarted.filter((r) => String(r.payload?.text).startsWith("after")).length, 2,
  "the post-restart chunks are NOT dropped (they collided on seq before this fix)");
assert.deepEqual(restarted.map((r) => r.payload?.text), ["before 1", "before 2", "before 3", "after 1", "after 2"],
  "replay order spans the restart boundary correctly");
// The cursor is `mono`, not `seq` — seq went BACKWARDS across the restart.
assert.equal(restarted[0].seq, 1, "the gateway seq really did restart");
assert.equal(slog.latestSeq(RESTART), 5, "the cursor is monotonic ACROSS the restart (5, not 2)");
assert.deepEqual(slog.eventsSince(RESTART, 3).map((r) => r.payload?.text), ["after 1", "after 2"],
  "resuming from cursor 3 returns exactly the post-restart chunks");
slog._test.setEpochForTest("");

// --- 9. per-session isolation -------------------------------------------
const OTHER = "sess-other";
slog.recordEvent({ session_id: OTHER, seq: 1, type: "message.delta", payload: { text: "other" } });
slog.flushNow();
assert.equal(slog.eventsSince(SID, 0).length, 7, "session A is unaffected by session B");
assert.equal(slog.eventsSince(OTHER, 0).length, 1, "session B has its own log");
assert.equal(slog.latestSeq(OTHER), 1, "seq counters are per session, not global");

// --- 10. truncation detection: seq SPARSITY is not truncation ------------
// The gateway's seq counts every frame it emits; this log keeps only the ones
// that matter. So `since=0` always sits far below the oldest kept row, and that
// must NOT read as "data lost" — otherwise every fresh page load triggers a full
// history refetch. (This exact defect was caught by the Phase 3 E2E against a
// live session: 966 rows spanning seq 8289..9553, all reporting truncated.)
assert.equal(slog.isTruncated(SID, 0), false, "seq sparsity is NOT truncation");
assert.equal(slog.isTruncated(SID, 3), false, "a resume inside the window is fine");
assert.equal(slog.isTruncated("sess-that-never-streamed", 0), false,
  "a session that never streamed has nothing to miss");

// --- 11. retention (D1) purges old events and REPORTS truncation ---------
// Age the whole session past the TTL, then purge.
const d = slog.openStreamDb();
d.prepare("UPDATE stream_events SET ts_ms = ? WHERE sid = ?").run(Date.now() - 60_000, SID);
const purged = slog.purgeOlderThan(Date.now());
assert.ok(purged.removed >= 7, `expired session purged (got ${purged.removed})`);
assert.equal(slog.eventsSince(SID, 0).length, 0, "expired chunks are gone");
assert.equal(slog.isTruncated(SID, 0), true, "a client resuming from 0 is told it was truncated");
// The newer session must be untouched.
assert.equal(slog.eventsSince(OTHER, 0).length, 1, "retention did not touch a fresh session");

// --- 12. an oversized payload is truncated to VALID JSON, not a corrupt slice
const BIG = "x".repeat(200 * 1024);
const before900 = slog.latestSeq(SID);
slog.recordEvent({ session_id: SID, seq: 900, type: "message.delta", payload: { text: BIG } });
slog.flushNow();
const big = slog.eventsSince(SID, before900);
assert.equal(big.length, 1, "an oversized chunk is still recorded (truncated, not lost)");
// The read path must not throw — that was the bug a byte-slice caused.
const gotText = big[0].payload?.text ?? "";
assert.equal(typeof gotText, "string", "the stored copy is still a parseable object");
assert.ok(gotText.length < BIG.length, `the stored copy is bounded (${gotText.length} < ${BIG.length})`);
assert.equal(big[0].payload?._truncated, true, "truncation is flagged so the client can refetch");
// The recorded size is the SERIALIZED length: `{"text":"<200k>"}` = 200_000 + 11
// chars of envelope. Assert against the computed value, not a hand-counted one.
assert.equal(
  big[0].payload?._original_bytes,
  JSON.stringify({ text: BIG }).length,
  "the original serialized size is recorded"
);

// 12b. a payload with MANY keys (field-shrinking cannot rescue it) still
// yields valid JSON rather than a slice.
const manyKeys = {};
for (let i = 0; i < 4000; i++) manyKeys[`k${i}`] = `v${"y".repeat(80)}`;
const before901 = slog.latestSeq(SID);
slog.recordEvent({ session_id: SID, seq: 901, type: "message.delta", payload: manyKeys });
slog.flushNow();
const many = slog.eventsSince(SID, before901);
assert.equal(many.length, 1, "the many-key chunk is recorded");
assert.doesNotThrow(() => many[0].payload, "the many-key chunk is still parseable JSON");

// 12c. an unserialisable payload is marked, never silently dropped.
const cyclic = { text: "hi" };
cyclic.self = cyclic;
const before902 = slog.latestSeq(SID);
slog.recordEvent({ session_id: SID, seq: 902, type: "message.delta", payload: cyclic });
slog.flushNow();
const cyc = slog.eventsSince(SID, before902);
assert.equal(cyc.length, 1, "a cyclic payload is recorded rather than dropped");
assert.equal(cyc[0].payload?._unserialisable, true, "it is flagged as unserialisable");

// 12d. a CORRUPT row degrades instead of crashing the replay.
// Column order must match the table exactly: (sid, epoch, seq, mono, type, kind,
// ref_sid, ref_row, headline, payload, ts_ms).
slog.openStreamDb().prepare(
  "INSERT OR REPLACE INTO stream_events (sid, epoch, seq, mono, type, kind, ref_sid, ref_row, headline, payload, ts_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
).run("sess-corrupt", "proc-A", 1, 1, "message.delta", "body", null, null, null, "{not json", Date.now());
const corrupt = slog.eventsSince("sess-corrupt", 0);
assert.equal(corrupt.length, 1, "a corrupt row is still returned");
assert.equal(corrupt[0].payload?._corrupt, true, "a corrupt row degrades to a marker, not a throw");
assert.equal(corrupt[0]._corrupt_payload, true, "and it is flagged so the client refetches");

// --- 13. stats -----------------------------------------------------------
const st = slog.streamStats();
assert.ok(st.events >= 1, "stats counts events");
assert.ok(st.path.startsWith(tmp), "the log landed in the isolated dir, not the real data dir");
assert.equal(st.retention_ms, 1000, "TTL came from the env seam");

slog.closeStreamDb();
slog.closeStreamDb(); // idempotent
rmSync(tmp, { recursive: true, force: true });
console.log(
  "stream-log.check: ALL PASS (classification, seq refusal, byte-identical " +
  "reassembly, body/ref split, resume cursor, replay idempotency, per-session " +
  "isolation, truncation flag, retention purge, oversized truncation, stats)"
);
