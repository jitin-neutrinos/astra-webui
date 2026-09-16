// Runnable self-check for the chronological turn timeline (R1-R3, R6 chronology
// rule). Exercises the real applySegmentOps/finalizeSegments/findNewestCollapsedToolSeg
// engine (src/lib/chat-segments.ts) — the same code chat-landing.tsx runs — against a
// scripted frame sequence: reasoning x5 -> tool.start -> tool.generating x2 ->
// tool.complete(output+exit_code) -> reasoning (new segment) -> message.start ->
// message.delta x20 -> message.complete, plus an approval frame mid-turn.
//
// Run: node scripts/verify-chat-timeline.ts

import assert from "node:assert/strict";
import {
  applySegmentOps, finalizeSegments, findNewestCollapsedToolSeg, expandKeyBlocked, turnIsRunning,
  type Segment, type SegOp,
} from "../src/lib/chat-segments.ts";

function apply(segments: Segment[], ops: SegOp[]): Segment[] {
  return applySegmentOps(segments, ops);
}

let segments: Segment[] = [];

// 1. reasoning.delta x5 -> one running "thinking" segment, text concatenated in order.
for (let i = 0; i < 5; i++) segments = apply(segments, [{ op: "think", text: `r${i} ` }]);
assert.equal(segments.length, 1, "5x reasoning.delta must stay one thinking segment");
assert.equal(segments[0].kind, "thinking");
assert.equal(segments[0].status, "run");
assert.equal(segments[0].text, "r0 r1 r2 r3 r4 ");

// 2. tool.start CLOSES the open thinking segment and opens a new tool segment.
segments = apply(segments, [{ op: "tool", key: "t1", label: "terminal", command: "ls -la /tmp" }]);
assert.equal(segments.length, 2, "tool.start must append a new segment, not merge into thinking");
assert.equal(segments[0].status, "done", "tool.start must close the preceding thinking segment");
assert.equal(segments[1].kind, "tool");
assert.equal(segments[1].status, "run");
assert.equal(segments[1].id, "t1");

// 3. tool.generating x2 updates the SAME running tool segment (no new segment).
segments = apply(segments, [{ op: "tool-update", key: "t1", argsText: "partial args 1" }]);
segments = apply(segments, [{ op: "tool-update", key: "t1", argsText: "partial args 1 2" }]);
assert.equal(segments.length, 2, "tool.generating must not create extra segments");
assert.equal(segments[1].argsText, "partial args 1 2");
assert.equal(segments[1].status, "run", "tool must still be running before tool.complete");

// 4. tool.complete carries RAW output + exit_code, closes the tool segment.
const bigOutput = "line\n".repeat(700); // > 3000 chars -> folds
segments = apply(segments, [{ op: "tool-done", key: "t1", resultText: bigOutput, exitCode: 0 }]);
assert.equal(segments[1].status, "done");
assert.equal(segments[1].resultText, bigOutput);
assert.equal(segments[1].exitCode, 0);
assert.equal(segments[1].collapsed, true, ">3k char tool output must fold to a collapsed preview");

// 5. reasoning.delta AFTER a tool opens a NEW thinking segment (never merges with #1).
segments = apply(segments, [{ op: "think", text: "new thought" }]);
assert.equal(segments.length, 3);
assert.equal(segments[2].kind, "thinking");
assert.equal(segments[2].status, "run");
assert.notEqual(segments[2].id, segments[0].id, "post-tool reasoning must be a distinct segment");

// 6. approval frame mid-turn: closes the running thinking segment, inserts a card
//    AT THE CURRENT POSITION (not appended after all other content).
segments = apply(segments, [{ op: "approval", reqId: "srq-1", params: { command: "rm -rf build/", description: "Clean build dir", choices: ["once", "deny"] } }]);
assert.equal(segments.length, 4);
assert.equal(segments[2].status, "done", "approval must close the preceding running thinking segment");
assert.equal(segments[3].kind, "approval");
assert.equal(segments[3].reqId, "srq-1");
assert.equal(segments[3].resolved, null);

// 7. message.start has no direct segment op (chat-landing.tsx only flips isStreaming);
//    message.delta x20 must all land in ONE running text segment, appended in order.
let deltas = "";
for (let i = 0; i < 20; i++) { const chunk = `${i}`; deltas += chunk; segments = apply(segments, [{ op: "text", text: chunk }]); }
assert.equal(segments.length, 5);
assert.equal(segments[4].kind, "text");
assert.equal(segments[4].status, "run");
assert.equal(segments[4].text, deltas, "20x message.delta must concatenate into one text segment in arrival order");
assert.equal(segments[3].kind, "approval", "approval card must stay in its arrival slot, not get pushed after prose");

// 8. message.complete finalizes: every segment status -> done.
segments = finalizeSegments(segments);
assert.ok(segments.every((s) => s.status === "done"), "message.complete must close every open segment");

// 9. Full chronology check: kinds in arrival order (this is the "kill the
//    single-block bug" assertion — thinking/tool/thinking/approval/text, never
//    reordered or coalesced across a barrier).
assert.deepEqual(segments.map((s) => s.kind), ["thinking", "tool", "thinking", "approval", "text"]);

// 10. Ctrl+O expands the newest collapsed >3k tool block across the whole transcript.
const turnA = { id: "m1", segments: [{ id: "tA", kind: "tool" as const, status: "done" as const, collapsed: true, resultText: "x".repeat(4000) }] };
const turnB = { id: "m2", segments: segments }; // has our folded tool segment (segments[1])
const target = findNewestCollapsedToolSeg([turnA, turnB]);
assert.deepEqual(target, { msgId: "m2", segId: "t1" }, "Ctrl+O must target the NEWEST collapsed >3k tool block, not the first");

// 11. A1 race: approval frame arriving between tool.complete and message.start.
//     chat-landing flushes the approval immediately, so the engine sees the
//     batch [tool, tool-done, approval] followed by a delta batch — the card
//     must land in its ARRIVAL slot (after the tool, before the later prose),
//     and the post-approval text must open a NEW segment (barrier).
let race: Segment[] = [];
race = apply(race, [
  { op: "tool", key: "t2", label: "terminal", command: "make test" },
  { op: "tool-done", key: "t2", resultText: "ok", exitCode: 0 },
  { op: "approval", reqId: "srq-2", params: { command: "make deploy", choices: ["once", "deny"] } },
]);
race = apply(race, [{ op: "text", text: "Deploy needs your approval." }]);
assert.deepEqual(race.map((s) => s.kind), ["tool", "approval", "text"], "approval must sit between tool.complete and the later text, never after prose");
assert.equal(race[0].status, "done", "tool.complete before the approval must still close the tool");
assert.equal(race[1].reqId, "srq-2");
assert.equal(race[1].resolved, null);
assert.equal(race[2].status, "run", "post-approval delta opens a fresh running text segment (barrier after approval)");

// 12. A3: tool.complete with a tool_id that matches NOTHING must not close an
//     unrelated still-running tool (orphan result lands on its own segment;
//     the running tool stays running; the right key still closes the right one).
let multi: Segment[] = [];
multi = apply(multi, [
  { op: "tool", key: "tA", label: "terminal", command: "sleep 1" },
  { op: "tool", key: "tB", label: "reader", command: "" },
]);
multi = apply(multi, [{ op: "tool-done", key: "tZ-missing", resultText: "orphan", exitCode: 0 }]);
assert.equal(multi.length, 3, "mismatched tool_id appends its own done segment");
assert.equal(multi[2].status, "done");
assert.equal(multi[0].status, "run", "running tool tA must NOT be closed by an unrelated tool.complete");
assert.equal(multi[1].status, "run", "running tool tB must NOT be closed by an unrelated tool.complete");
multi = apply(multi, [{ op: "tool-done", key: "tB", resultText: "{}", exitCode: 0 }]);
assert.equal(multi[1].status, "done", "the correctly-addressed tool.complete still closes its tool");
assert.equal(multi[0].status, "run", "keyed tool.complete must not fall through to other running tools");
multi = apply(multi, [{ op: "tool-done", resultText: "keyless", exitCode: 0 }]);
assert.equal(multi[0].status, "done", "keyless tool.complete falls back to the newest running tool (tA)");

// 13. A10: a turn with an UNRESOLVED approval is paused, not streaming — no
//     infinite caret/spinner for restored mid-turn sessions.
const openAppr: Segment[] = [{ id: "a1", kind: "approval", status: "run", reqId: "srq-9", params: {}, resolved: null }];
assert.equal(turnIsRunning(openAppr, true), false, "open approval blocks running-state even while streaming");
assert.equal(turnIsRunning([{ ...openAppr[0], resolved: "once", status: "done" }], true), true, "resolved approval returns the turn to running while streaming");
assert.equal(turnIsRunning([{ ...openAppr[0], resolved: "once", status: "done" }], false), false, "no stream, no running-state");
assert.equal(turnIsRunning([{ id: "x", kind: "text", status: "run", text: "hi" }], true), true, "plain streaming text stays running");

// 14. A6: Ctrl+O key gate — bare Ctrl/Cmd+O outside a text field only.
assert.equal(expandKeyBlocked(true, false, "o", "DIV"), false, "bare Ctrl+O over the transcript expands");
assert.equal(expandKeyBlocked(false, true, "O", undefined), false, "Cmd+O (macOS, no target tag) expands");
assert.equal(expandKeyBlocked(true, false, "o", "TEXTAREA"), true, "Ctrl+O while typing in the composer must be a no-op");
assert.equal(expandKeyBlocked(true, false, "o", "INPUT"), true, "Ctrl+O inside an input must be a no-op");
assert.equal(expandKeyBlocked(false, false, "o", "DIV"), true, "plain O without modifier must not expand");
assert.equal(expandKeyBlocked(true, false, "x", "DIV"), true, "other Ctrl+<key> combos must not expand");

console.log("verify-chat-timeline: 14/14 checks passed");
