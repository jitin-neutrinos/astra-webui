// Runnable check: STRICT CHRONOLOGICAL RENDERING (owner mandate 2026-09-29).
// Segments render exactly in arrival order — Thought - Tool - Text interleave
// as emitted, never grouped by kind. Guards:
//   - interleaved arrival sequence is preserved verbatim through the engine;
//   - interactivity (approval/clarify/gate) keeps its arrival slot;
//   - streaming dedup paths (text-seal / text-final collapse) are untouched;
//   - a thought transitioning run→done gets durationMs stamped (what drives the
//     ThoughtRow auto-collapse effect);
//   - the old bundler entry point is really gone.
// Run: npx tsx scripts/verify-chronology.check.ts

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import {
  applySegmentOps,
  finalizeSegments,
  type Segment,
  type SegOp,
} from "../src/lib/chat-segments.ts";

function apply(segments: Segment[], ops: SegOp[]): Segment[] {
  return applySegmentOps(segments, ops);
}

// 1. Owner's example sequence: thought, tool, response, thought, response,
//    thought, tool, thought, tool, response, tool, thought — arrival order
//    survives verbatim (kinds and per-segment text).
let segs: Segment[] = [];
segs = apply(segs, [{ op: "think", text: "T1 " }]);
segs = apply(segs, [{ op: "tool", key: "a", label: "terminal", command: "ls" }]);
segs = apply(segs, [{ op: "text", text: "R1 " }]);
segs = apply(segs, [{ op: "think", text: "T2 " }]);
segs = apply(segs, [{ op: "text", text: "R2 " }]);
segs = apply(segs, [{ op: "think", text: "T3 " }]);
segs = apply(segs, [{ op: "tool", key: "b", label: "web_search" }]);
segs = apply(segs, [{ op: "think", text: "T4 " }]);
segs = apply(segs, [{ op: "tool", key: "c", label: "read_file" }]);
segs = apply(segs, [{ op: "text", text: "R3" }]);
segs = apply(segs, [{ op: "tool-done", key: "a", resultText: "x" }]);
segs = apply(segs, [{ op: "think", text: "T5" }]);

// (note: the trailing tool-done closes tool "a" IN PLACE — no new segment —
//  so the final order has 11 entries, with T5 thinking last.)
const kinds = segs.map((s) => s.kind);
assert.deepEqual(
  kinds,
  ["thinking", "tool", "text", "thinking", "text", "thinking", "tool", "thinking", "tool", "text", "thinking"],
  "interleaved arrival order must be preserved verbatim",
);
const doneA = segs.find((s) => s.kind === "tool" && s.id === "a");
assert.equal(doneA?.status, "done", "tool-done closed the right tool in place");

// 2. Segment identity: first two think batches stay SEPARATE segments (a tool
//    between them is a barrier) — each renders as its own collapsible.
const thinks = segs.filter((s) => s.kind === "thinking");
assert.equal(thinks.length, 5, "five distinct thought segments");
assert.equal(thinks[0].text?.trim(), "T1");
assert.equal(thinks[4].text?.trim(), "T5");

// 3. Interactivity keeps its slot.
segs = [];
segs = apply(segs, [{ op: "think", text: "hmm " }]);
segs = apply(segs, [{ op: "approval", reqId: "r1", params: { command: "rm x" } }]);
segs = apply(segs, [{ op: "think", text: "more " }]);
assert.deepEqual(segs.map((s) => s.kind), ["thinking", "approval", "thinking"],
  "approval stays in its arrival slot between thoughts");

// 4. Streaming dedup untouched: sealed + streamed + final collapse to ONE text.
segs = [];
segs = apply(segs, [{ op: "text", text: "AB" }]);
segs = apply(segs, [{ op: "text-seal", text: "AB" }, { op: "text", text: "CD" }]);
segs = apply(segs, [{ op: "text-final", text: "ABCD" }]);
const texts = segs.filter((s) => s.kind === "text");
assert.equal(texts.length, 1, "dedup: one text segment");
assert.equal(texts[0].text, "ABCD");

// 5. Duration stamping on thought completion (drives the auto-collapse).
segTimingProbe();

function segTimingProbe() {
  // durationMs is stamped by closeRunningThink on tool/text arrival after a
  // running think; assert a thought followed by a tool gets a duration.
  let s: Segment[] = [];
  s = apply(s, [{ op: "think", text: "dur " }]);
  const running = s[s.length - 1];
  assert.equal(running.status, "run", "thought starts running");
  s = apply(s, [{ op: "tool", key: "z", label: "x" }]);
  const done = s.find((x) => x.kind === "thinking")!;
  assert.equal(done.status, "done", "thought closes when a tool lands");
  assert.equal(typeof done.durationMs, "number", "duration stamped on close");
}

// 6. The old bundler is gone.
let grep = "";
try {
  grep = execSync(
    "grep -rn 'bundleTurnSegments\\|ReasoningBundle\\|ReasoningCard' ../src/ 2>/dev/null || true",
    { cwd: import.meta.dirname },
  ).toString();
} catch { /* no matches = clean */ }
assert.equal(grep.trim(), "", "bundler symbols must not exist anywhere in src/");

// 7. Restore path: finalizeSegments never reorders.
const fin = finalizeSegments([...segs]);
assert.deepEqual(fin.map((s) => s.kind), segs.map((s) => s.kind), "finalize must not reorder");

console.log("verify-chronology: all checks passed");
