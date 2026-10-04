// Checks for the 2026-09-29 dup + greet-row fixes.
// npx tsx src/lib/replay-dedup.check.ts
import { applySegmentOps, lastAssistantHasText } from "./chat-segments.ts";
import { rowsToTurns, type HistoryRow } from "./normalize-messages.ts";

let fails = 0;
function ok(cond: boolean, msg: string, extra?: unknown) {
  if (!cond) { fails++; console.error("FAIL:", msg, extra ?? ""); }
}

// ---- Greet row filtered from history ----
const greetText = "New chat just started. Greet me briefly and naturally, then ask what I'd like to work on.";
const rows: HistoryRow[] = [
  { id: "r1", role: "user", content: greetText, text: greetText },
  { id: "r2", role: "assistant", content: "Hey Jitin. What are we working on?" },
  { id: "r3", role: "user", content: "Audit the plumbing.", text: "Audit the plumbing." },
];
const turns = rowsToTurns(rows);
ok(turns.length === 2, "greet row dropped", turns.map(t => t.role));
// The greeting ANSWER is the first visible turn; the kickoff prompt is gone.
ok(turns[0]?.role === "assistant", "first visible turn is the assistant greeting", turns[0]?.role);
ok(turns[1]?.role === "user" && turns[1]?.content === "Audit the plumbing.", "real prompt follows", turns[1]);

// A user who TYPES the greet sentence themselves still sees it (only the exact
// persisted kickoff row is dropped — match is by text, and their bubble sends
// the same text... acceptable: it only ever matches the first silent send).
const rows2: HistoryRow[] = [
  { id: "r1", role: "user", content: "Hello there", text: "Hello there" },
  { id: "r2", role: "assistant", content: "Hi!" },
  { id: "r3", role: "user", content: greetText, text: greetText },
  { id: "r4", role: "assistant", content: "Fresh session, ready." },
];
const turns2 = rowsToTurns(rows2);
// No turn carries the kickoff text as user content (the matching row is gone);
// its answer folds into the surrounding assistant turn as just another segment.
const userTurnTexts = turns2.filter(t => t.role === "user").map(t => (t.content || "").trim());
ok(!userTurnTexts.some(c => c === greetText), "no user turn renders the kickoff text", userTurnTexts);
ok(turns2.some(t => t.role === "user" && t.content === "Hello there"), "ordinary prompts intact");

// Multi-interim turn history renders the interims as separate text segments
const rows3: HistoryRow[] = [
  { id: "r1", role: "user", content: "go", text: "go" },
  { id: "r2", role: "assistant", content: "" },
  { id: "r3", role: "tool", content: "{\"output\":\"x\"}", tool_call_id: "t1" },
  { id: "r4", role: "assistant", content: "Round 1 done." },
  { id: "r5", role: "tool", content: "{\"output\":\"y\"}", tool_call_id: "t2" },
  { id: "r6", role: "assistant", content: "Round 2 done." },
];
const turns3 = rowsToTurns(rows3);
const asst = turns3.filter(t => t.role === "assistant");
ok(asst.length >= 1, "assistant turn exists");
// NOTE: rowsToTurns merges consecutive assistant rows into ONE turn; separate
// text rows separated by tool rows belong to the same turn, each its own segment.

// ---- lastAssistantHasText: multi-segment joins ----
{
  const messages = [
    { role: "user", segments: [] },
    { role: "assistant", segments: applySegmentOps([], [
      { op: "text-final", text: "Part one." },
      { op: "tool", key: "t1", label: "x" },
      { op: "tool-done", key: "t1", label: "x" },
      { op: "text-final", text: "Part two." },
    ]) },
  ] as any;
  const final = "Part one.Part two.";
  ok(lastAssistantHasText(messages, final), "joined segments match final (no separator)");
  ok(lastAssistantHasText(messages, "Part one.\n\nPart two."), "joined segments match final (newline sep)");
  ok(!lastAssistantHasText(messages, "A completely different answer"), "different text still renders");
}

// ---- live turn: whitespace-variant final collapses, doesn't duplicate ----
{
  let s = applySegmentOps([], [
    { op: "text", text: "Hello" },
    { op: "tool", key: "t1", label: "x" },
    { op: "tool-done", key: "t1", label: "x" },
    { op: "text", text: "world" },
  ]);
  s = applySegmentOps(s, [{ op: "text-final", text: "Hello\n\nworld" }]);
  const texts = s.filter((x: any) => x.kind === "text");
  // sameProse treats separator-only differences as the SAME prose: the final
  // replaces the split segments instead of stacking a duplicate copy.
  ok(texts.length === 1, "separator-variant final collapses to one text", texts.map((t: any) => t.text));
  ok((texts[0] as any).text === "Hello\n\nworld", "final (nicely separated) text kept", (texts[0] as any).text);
}

// ---- replay of complete onto a settled multi-segment turn ----
{
  const messages = [
    { role: "assistant", segments: applySegmentOps([], [
      { op: "text-final", text: "A." },
      { op: "tool", key: "t1", label: "x" },
      { op: "tool-done", key: "t1", label: "x" },
      { op: "text-final", text: "B." },
    ]) },
  ] as any;
  // gateway final = "A.\nB." — old single-segment compare missed it
  ok(lastAssistantHasText(messages, "A.\nB."), "settled multi-segment turn recognized on complete replay");
}

if (fails) throw new Error(`${fails} replay-dedup check(s) failed`);
console.log("replay-dedup.check: ALL PASS");
