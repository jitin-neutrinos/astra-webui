// no-duplication checks for text reconciliation (repo assert pattern).
// Run: npx tsx src/lib/no-dup.check.ts
import { applySegmentOps } from "./chat-segments.ts";

let fails = 0;
function ok(cond: boolean, msg: string, extra?: unknown) {
  if (!cond) { fails++; console.error("FAIL:", msg, extra ?? ""); }
}
const texts = (s: any[]) => s.filter((x) => x.kind === "text").map((x) => [x.text, x.status]);

// A: deltas then final equal -> single text.
let s = applySegmentOps([], [{ op: "text", text: "AB" }]);
s = applySegmentOps(s, [{ op: "text-final", text: "AB" }]);
ok(s.filter((x) => x.kind === "text").length === 1, "A delta+final once", texts(s));

// B: sealed interim + later deltas + full final -> collapse to ONE segment.
s = applySegmentOps([], [{ op: "text", text: "AB" }]);
s = applySegmentOps(s, [{ op: "text-seal", text: "AB" }]);
s = applySegmentOps(s, [{ op: "text", text: "CD" }]);
s = applySegmentOps(s, [{ op: "text-final", text: "ABCD" }]);
const B = s.filter((x) => x.kind === "text");
ok(B.length === 1 && B[0].text === "ABCD" && B[0].status === "done", "B collapse", texts(s));

// C: already_streamed seal with no live delta -> renders once (fallback).
s = applySegmentOps([], [{ op: "text-seal", text: "AB" }]);
const C = s.filter((x) => x.kind === "text");
ok(C.length === 1 && C[0].text === "AB", "C seal fallback", texts(s));

// D: same final twice around a tool call -> collapse, not repeat.
s = applySegmentOps([], [{ op: "text-final", text: "AB" }]);
s = applySegmentOps(s, [{ op: "tool", key: "t1", label: "x" }]);
s = applySegmentOps(s, [{ op: "tool-done", key: "t1", label: "x" }]);
s = applySegmentOps(s, [{ op: "text-final", text: "AB" }]);
ok(s.filter((x) => x.kind === "text").length === 1, "D repeat across tool", texts(s));

// E: genuinely distinct interims stay distinct.
s = applySegmentOps([], [{ op: "text-final", text: "first block" }]);
s = applySegmentOps(s, [{ op: "text-final", text: "second block" }]);
const E = s.filter((x) => x.kind === "text");
ok(E.length === 2, "E distinct blocks", texts(s));

if (fails) throw new Error(`${fails} no-dup check(s) failed`);
console.log("PASS: no-dup checks");
