// turn-status.check.mjs — pins the sidebar live-status contract end to end.
//
// THE BUG THIS EXISTS FOR (owner 10-06: "I don't see the thinking/working text
// on the sidebar chats section on phone"): message.start carries NO payload on
// the wire (tui_gateway/contracts/events.py declares `event("message.start",
// None)`), and the proxy's stored-id stamping lived INSIDE a
// `if (stored && p.payload && typeof p.payload === "object")` guard. A start
// frame therefore never got its stamp — and never updated turn state — so the
// sidebar's "Thinking…" could not light on any surface, on any device.
//
// Asserted here:
//   1. a start frame with NO payload still stamps stored_session_id and marks
//      the turn running (under BOTH ids)
//   2. a completion frame clears it
//   3. stampRunningTurns reports live state on session-list rows (the mount path
//      a phone drawer needs, having missed the transient start frame)
//   4. an expired running entry reads idle (an interrupted turn emits no
//      completion; a permanent "Thinking…" is worse than a missing one)
//
// Runs under bare Node — no test framework, per repo convention.

import assert from "node:assert/strict";
import {
  stampRunningTurns, isTurnRunning, sidMap, recordSidMapping,
  _turnTest,
} from "./hermes-proxy.mjs";

const { markTurnRunning, markTurnIdle, reset } = _turnTest;

// ---- 1. the regression: a start frame with no payload ----------------------
reset();
recordSidMapping("live-1", "stored-1");
markTurnRunning("live-1", "stored-1");
assert.equal(isTurnRunning("live-1"), true, "running under the LIVE id");
assert.equal(isTurnRunning("stored-1"), true, "running under the STORED id");
assert.equal(isTurnRunning("other"), false, "unrelated id stays idle");

// The stored mapping must exist for the stamp to be possible at all — the old
// code required it AND a payload, so a start frame stamped nothing.
assert.equal(sidMap.get("live-1"), "stored-1", "live→stored mapping recorded");

// ---- 2. completion clears it ----------------------------------------------
markTurnIdle("live-1", "stored-1");
assert.equal(isTurnRunning("live-1"), false, "cleared on completion (live)");
assert.equal(isTurnRunning("stored-1"), false, "cleared on completion (stored)");

// ---- 3. the mount path: rows carry live truth ------------------------------
reset();
recordSidMapping("live-2", "stored-2");
markTurnRunning("live-2", "stored-2");
const rows = [
  { id: "stored-2", session_id: "live-2" },   // running
  { id: "stored-3", session_id: "live-3" },   // idle
];
stampRunningTurns(rows);
assert.equal(rows[0].turn_running, true, "running row is stamped true");
assert.equal(rows[1].turn_running, false, "idle row is stamped false");

// A row keyed ONLY by its stored id (no live id) still resolves — that is the
// shape a phone's list fetch usually returns.
const storedOnly = [{ id: "stored-2" }];
stampRunningTurns(storedOnly);
assert.equal(storedOnly[0].turn_running, true, "stored-id-only row resolves");

// A row keyed only by the live id resolves too.
const liveOnly = [{ id: "live-2" }];
stampRunningTurns(liveOnly);
assert.equal(liveOnly[0].turn_running, true, "live-id-only row resolves");

// Non-array / junk input must never throw (this runs inside the list relay).
assert.deepEqual(stampRunningTurns(null), null);
assert.deepEqual(stampRunningTurns([null, 7, "x"]), [null, 7, "x"]);

// ---- 4. staleness ----------------------------------------------------------
reset();
markTurnRunning("live-stale", "stored-stale");
assert.equal(_turnTest.size(), 2, "registered under BOTH ids");
// Age every entry: a turn is stored under its live AND stored id, so aging one
// key would leave the twin fresh and prove nothing.
_turnTest.backdateAll(16 * 60 * 1000);   // older than the 15m TTL
assert.equal(isTurnRunning("live-stale"), false, "expired entry reads idle");
assert.equal(isTurnRunning("stored-stale"), false, "expired twin reads idle too");
const staleRows = [{ id: "stored-stale" }];
stampRunningTurns(staleRows);
assert.equal(staleRows[0].turn_running, false, "expired row is not stamped running");

// A just-touched entry stays fresh.
markTurnRunning("live-stale", "stored-stale");
assert.equal(isTurnRunning("live-stale"), true, "re-marked entry is fresh again");

reset();

// ---- 5. THE RELAY PATH: stamping must not depend on another client --------
// The residual bug this pins: the stamping block lived inside
// `if ((anyTagged || anyCompleteFilter) …)`, so with NO tagged/filter socket
// connected the frames were never parsed and every message.start went out
// unstamped (measured live: `payload: null`, 2 of 4 runs). The sidebar's live
// status depends on this stamp, so it must work on a quiet proxy.
{
  const { broadcastFrame, _turnTest } = await import("./hermes-proxy.mjs");
  const { FrameDecoder } = await import("./ws-codec.mjs");

  // A capture socket: untagged, unfiltered — exactly the "nobody else is
  // connected" state that used to break stamping.
  const got = [];
  const sock = _turnTest.addCaptureSocket((buf) => {
    const dec = new FrameDecoder((f) => { if (f.opcode === 0x1) got.push(JSON.parse(f.payload.toString())); });
    dec.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  });

  try {
    // Teach the mapping the way a session.create reply does.
    broadcastFrame(Buffer.from(JSON.stringify({
      jsonrpc: "2.0", id: "x1",
      result: { session_id: "live-rt", session_key: "stored-rt", messages: [] },
    })), 0x1);

    // message.start with NO payload — the exact wire shape.
    broadcastFrame(Buffer.from(JSON.stringify({
      method: "event", params: { type: "message.start", session_id: "live-rt" },
    })), 0x1);

    const start = got.find((m) => m?.params?.type === "message.start");
    assert.ok(start, "the capture socket received message.start");
    assert.equal(
      start.params.payload?.stored_session_id, "stored-rt",
      "message.start is stamped even with NO tagged socket connected"
    );
    assert.equal(isTurnRunning("live-rt"), true, "the relay marked the turn running");
    assert.equal(isTurnRunning("stored-rt"), true, "…under the stored id too");

    // Completion clears it.
    broadcastFrame(Buffer.from(JSON.stringify({
      method: "event", params: { type: "message.complete", session_id: "live-rt", payload: { text: "done" } },
    })), 0x1);
    assert.equal(isTurnRunning("live-rt"), false, "completion cleared the running state");
  } finally {
    _turnTest.removeSocket(sock);
  }
}

console.log("turn-status.check: all assertions passed");
