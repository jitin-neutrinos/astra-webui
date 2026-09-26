// Assert-based check for the `text-final` reconciliation path (no framework).
//   npx tsx src/lib/final-text.check.ts
//
// Why this exists: the gateway carries a turn's authoritative answer on
// `message.complete.text`, and some providers (Anthropic through this gateway)
// emit ZERO `message.delta` frames. The client used to ignore that field, so a
// whole reply rendered as steps-with-no-answer and only appeared after a reload
// re-pulled history. `text-final` fixes it — but it must never double-render
// text that DID stream, so every branch below is pinned.

import { applySegmentOps, type Segment, type SegOp } from "./chat-segments";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.error(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
}
const apply = (ops: SegOp[], start: Segment[] = []) => applySegmentOps(start, ops);
const texts = (segs: Segment[]) => segs.filter((s) => s.kind === "text").map((s) => s.text);

console.log("final-text reconciliation");

// 1. No deltas at all (the Anthropic path): the answer must still render once.
{
  const out = apply([{ op: "text-final", text: "Hello world." }]);
  check("no-delta provider renders the final text", texts(out).join("") === "Hello world.", texts(out));
  check("no-delta final segment is done", out.every((s) => s.status === "done"), out.map((s) => s.status));
}

// 2. Deltas streamed, final is the same string: replace, never append.
{
  const out = apply([
    { op: "text", text: "Hello " },
    { op: "text", text: "world." },
    { op: "text-final", text: "Hello world." },
  ]);
  check("streamed text is not duplicated by the final", texts(out).join("") === "Hello world.", texts(out));
  check("streamed+final collapses to ONE text segment", texts(out).length === 1, texts(out));
}

// 3. Deltas dropped mid-flight (lost frames): the final fills the gap in place.
{
  const out = apply([
    { op: "text", text: "Hello " },
    { op: "text-final", text: "Hello world, the whole answer." },
  ]);
  check("final repairs a truncated delta stream", texts(out).join("") === "Hello world, the whole answer.", texts(out));
  check("repair does not add a second segment", texts(out).length === 1, texts(out));
}

// 4. Interim answer, then a tool, then a different final: two distinct blocks.
{
  const out = apply([
    { op: "text-final", text: "Checking that for you." },
    { op: "tool", key: "t1", label: "terminal", command: "echo hi" },
    { op: "tool-done", key: "t1", resultText: "hi", exitCode: 0 },
    { op: "text-final", text: "Output: hi, exit 0." },
  ]);
  check("interim + final render as two text blocks", texts(out).length === 2, texts(out));
  check("interim text preserved", texts(out)[0] === "Checking that for you.", texts(out));
  check("post-tool summary preserved", texts(out)[1] === "Output: hi, exit 0.", texts(out));
  check("tool segment survives between them", out.filter((s) => s.kind === "tool").length === 1);
}

// 5. reasoning.available echoing the answer must not print it twice.
{
  const out = apply([
    { op: "think", text: "The quick brown fox." },
    { op: "text-final", text: "The quick brown fox." },
  ]);
  check("duplicate reasoning echo is dropped", out.filter((s) => s.kind === "thinking").length === 0, out.map((s) => s.kind));
  check("answer still rendered once", texts(out).join("") === "The quick brown fox.", texts(out));
}

// 6. Genuine reasoning that differs from the answer is KEPT.
{
  const out = apply([
    { op: "think", text: "Let me weigh the options carefully." },
    { op: "text-final", text: "Use a WebSocket." },
  ]);
  check("real thinking is preserved", out.filter((s) => s.kind === "thinking").length === 1, out.map((s) => s.kind));
  check("answer rendered alongside thinking", texts(out).join("") === "Use a WebSocket.", texts(out));
}

// 7. Empty final is a no-op (never create a blank bubble).
{
  const out = apply([{ op: "text-final", text: "" }]);
  check("empty final creates no segment", out.length === 0, out);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures !== 0) throw new Error(`${failures} check failure(s)`);
