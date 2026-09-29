// Runnable check: thinking+response bundling (render-side). Exercises
// bundleTurnSegments — the same function TurnTimeline renders through — plus
// regression guards for the invariants the change must not touch:
//   - the engine keeps arrival order (never mutates input);
//   - the streaming dedup path is unaffected (text-seal / text-final / prefix
//     collapse still behave exactly as before);
//   - interactivity (approval/clarify/gate) always lands in `response`, never
//     buried inside the reasoning card.
//
// Run: npx tsx scripts/verify-bundling.check.ts

import assert from "node:assert/strict";
import {
  applySegmentOps,
  bundleTurnSegments,
  type Segment,
  type SegOp,
} from "../src/lib/chat-segments.ts";

function apply(segments: Segment[], ops: SegOp[]): Segment[] {
  return applySegmentOps(segments, ops);
}

// 1. think -> tool -> text turn bundles into ONE reasoning card + response text.
let segs: Segment[] = [];
segs = apply(segs, [{ op: "think", text: "reasoning here " }]);
segs = apply(segs, [{ op: "tool", key: "t1", label: "terminal", command: "ls" }]);
segs = apply(segs, [{ op: "tool-done", key: "t1", resultText: "file.txt" }]);
segs = apply(segs, [{ op: "text", text: "The answer." }]);
segs = apply(segs, [{ op: "text-final", text: "The answer, finalized." }]);
const turn = finalizeOf(segs);
const bundled = bundleTurnSegments(turn);
assert.equal(bundled.reasoning !== null, true, "turn with thinking+tools must produce a reasoning card");
assert.equal(bundled.reasoning!.thinking.length, 1, "all thinking goes into the card");
assert.equal(bundled.reasoning!.tools.length, 1, "all tools go into the card");
assert.ok(bundled.response.every((s) => s.kind === "text"), "all text stays outside the card");
assert.ok(
  bundled.response.some((s) => s.text === "The answer, finalized."),
  "final text rendered in the response area",
);

// 2. Arrival order preserved (bundle must NOT reorder the canonical segments).
assert.equal(turn[0].kind, "thinking", "engine order unchanged: thinking first");
assert.equal(turn[1].kind, "tool", "engine order unchanged: tool second");
assert.equal(turn[2].kind, "text", "engine order unchanged: text last");

// 3. Interactivity never buried: approval/clarify/gate segments are response.
segs = [];
segs = apply(segs, [{ op: "think", text: "hmm " }]);
segs = apply(segs, [{ op: "approval", reqId: "r1", params: { command: "rm x" } }]);
const b2 = bundleTurnSegments(finalizeOf(segs));
assert.equal(b2.reasoning!.thinking.length, 1);
assert.equal(b2.response.length, 1);
assert.equal(b2.response[0].kind, "approval", "approval card stays outside the reasoning card");

// 4. Turn with ONLY text: no reasoning card at all.
const b3 = bundleTurnSegments([{ id: "x", kind: "text", status: "done", text: "hi" }]);
assert.equal(b3.reasoning, null);
assert.equal(b3.response.length, 1);

// 5. Tools-only turn (no thinking): card holds the tool, response empty.
segs = [];
segs = apply(segs, [{ op: "tool", key: "t9", label: "web_search" }]);
segs = apply(segs, [{ op: "tool-done", key: "t9", resultText: "{}" }]);
const b4 = bundleTurnSegments(finalizeOf(segs));
assert.equal(b4.reasoning !== null, true);
assert.equal(b4.reasoning!.tools.length, 1);
assert.equal(b4.response.length, 0);

// 6. Streaming dedup regression: interim seal + final collapse still dedup
//    through the unchanged engine (no double render after bundling).
segs = [];
segs = apply(segs, [{ op: "text", text: "AB" }]);
segs = apply(segs, [{ op: "text-seal", text: "AB" }, { op: "text", text: "CD" }]);
segs = apply(segs, [{ op: "text-final", text: "ABCD" }]);
const b5 = bundleTurnSegments(finalizeOf(segs));
assert.equal(b5.response.filter((s) => s.kind === "text").length, 1, "sealed+streamed+final collapse to ONE text segment");
assert.equal(b5.response[0].text, "ABCD");

// 7. Bundle id is stable per thinking content (live + restored renders share it).
segs = [];
segs = apply(segs, [{ op: "think", text: "stable " }]);
segs = apply(segs, [{ op: "text", text: "done" }]);
const b6a = bundleTurnSegments(finalizeOf(segs));
segs = [];
segs = apply(segs, [{ op: "think", text: "stable " }]);
segs = apply(segs, [{ op: "text", text: "done" }]);
const b6b = bundleTurnSegments(finalizeOf(segs));
assert.equal(b6a.reasoning!.id, b6b.reasoning!.id, "same reasoning content → same bundle key across reloads");

// 8. Multiple thinking segments (reasoning after a tool) ALL land in the card.
segs = [];
segs = apply(segs, [{ op: "think", text: "before " }]);
segs = apply(segs, [{ op: "tool", key: "t2", label: "read_file" }]);
segs = apply(segs, [{ op: "tool-done", key: "t2", resultText: "..." }]);
segs = apply(segs, [{ op: "think", text: "after " }]);
segs = apply(segs, [{ op: "text", text: "ok" }]);
const b7 = bundleTurnSegments(finalizeOf(segs));
assert.equal(b7.reasoning!.thinking.length, 2, "reasoning from both sides of the tool bundles together");
assert.equal(b7.reasoning!.tools.length, 1);

console.log("verify-bundling: 8/8 checks passed");

function finalizeOf(segments: Segment[]): Segment[] {
  // mirror finalizeSegments' status flip without the timing map
  return segments.map((s) => (s.status === "run" ? { ...s, status: "done" as const } : s));
}
