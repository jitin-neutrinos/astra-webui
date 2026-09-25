import assert from "assert";
import { rowsToTurns } from "../src/lib/normalize-messages.ts";
import type { HistoryRow, Turn } from "../src/lib/normalize-messages.ts";

function runTests() {
  const tsBase = 1700000000;
  
  // 1. Thinking-only turn
  const rows1: HistoryRow[] = [
    { id: "1", role: "assistant", content: null, reasoning: "thinking", timestamp: tsBase },
    { id: "2", role: "user", content: "hi", timestamp: tsBase + 2 }
  ];
  const turns1 = rowsToTurns(rows1);
  assert.equal(turns1.length, 2);
  assert.equal(turns1[0].role, "assistant");
  assert.equal(turns1[0].segments.length, 1);
  assert.equal(turns1[0].segments[0].kind, "thinking");
  assert.equal(turns1[0].segments[0].durationMs, 2000);

  // 2. Tool pair ordering incl. multi-call row
  const rows2: HistoryRow[] = [
    { id: "msg1", role: "assistant", content: null, timestamp: tsBase, tool_calls: [
      { id: "call1", function: { name: "tool1", arguments: "{}" } },
      { id: "call2", function: { name: "tool2", arguments: "{}" } }
    ] },
    { id: "msg2", role: "tool", content: "res1", timestamp: tsBase + 1, tool_call_id: "call1", tool_name: "tool1" },
    { id: "msg3", role: "tool", content: "res2", timestamp: tsBase + 3, tool_call_id: "call2", tool_name: "tool2" },
  ];
  const turns2 = rowsToTurns(rows2);
  assert.equal(turns2.length, 1);
  assert.equal(turns2[0].segments.length, 2);
  assert.equal(turns2[0].segments[0].kind, "tool");
  assert.equal(turns2[0].segments[0].resultText, "res1");
  assert.equal(turns2[0].segments[0].durationMs, 1000);
  assert.equal(turns2[0].segments[1].kind, "tool");
  assert.equal(turns2[0].segments[1].resultText, "res2");
  assert.equal(turns2[0].segments[1].durationMs, 3000);

  // 3. Orphan tool result
  const rows3: HistoryRow[] = [
    { id: "msg1", role: "tool", content: "res", timestamp: tsBase, tool_call_id: "call1", tool_name: "tool1" },
  ];
  const turns3 = rowsToTurns(rows3);
  assert.equal(turns3.length, 1);
  assert.equal(turns3[0].segments.length, 1);
  assert.equal(turns3[0].segments[0].kind, "tool");
  assert.equal(turns3[0].segments[0].resultText, "res");

  // 4. display_kind filtering
  const rows4: HistoryRow[] = [
    { id: "msg1", role: "assistant", content: "hidden", timestamp: tsBase, display_kind: "hidden" },
    { id: "msg2", role: "assistant", content: "visible", timestamp: tsBase + 1 },
  ];
  const turns4 = rowsToTurns(rows4);
  assert.equal(turns4.length, 1);
  assert.equal(turns4[0].segments[0].text, "visible");

  // 5. attachment extraction
  const rows5: HistoryRow[] = [
    { id: "msg1", role: "user", content: "hi\n\nAttached file: /a/b.png\nAttached file: c.txt", timestamp: tsBase },
  ];
  const turns5 = rowsToTurns(rows5);
  assert.equal(turns5.length, 1);
  assert.equal(turns5[0].content, "hi");
  assert.equal(turns5[0].files?.length, 2);
  assert.equal(turns5[0].files?.[0].path, "/a/b.png");
  assert.equal(turns5[0].files?.[0].name, "b.png");

  // 6. multi-turn interleave
  const rows6: HistoryRow[] = [
    { id: "msg1", role: "user", content: "q1", timestamp: tsBase },
    { id: "msg2", role: "assistant", content: "a1", timestamp: tsBase + 1 },
    { id: "msg3", role: "user", content: "q2", timestamp: tsBase + 2 },
  ];
  const turns6 = rowsToTurns(rows6);
  assert.equal(turns6.length, 3);
  assert.equal(turns6[0].role, "user");
  assert.equal(turns6[1].role, "assistant");
  assert.equal(turns6[2].role, "user");

  // 7. empty-content assistant row with tool_calls still renders
  const rows7: HistoryRow[] = [
    { id: "msg1", role: "assistant", content: "", timestamp: tsBase, tool_calls: [{ id: "call1", function: { name: "tool1", arguments: "{}" } }] },
  ];
  const turns7 = rowsToTurns(rows7);
  assert.equal(turns7.length, 1);
  assert.equal(turns7[0].segments.length, 1);
  assert.equal(turns7[0].segments[0].kind, "tool");

  // 8. assistant row with reasoning + tool_calls + text all on one row
  const rows8: HistoryRow[] = [
    { id: "msg1", role: "assistant", content: "final text", reasoning: "thinking first", timestamp: tsBase,
      tool_calls: [{ id: "call1", function: { name: "tool1", arguments: "{}" } }] },
  ];
  const turns8 = rowsToTurns(rows8);
  assert.equal(turns8.length, 1);
  assert.equal(turns8[0].segments.length, 3);
  assert.equal(turns8[0].segments[0].kind, "thinking");
  assert.equal(turns8[0].segments[0].text, "thinking first");
  assert.equal(turns8[0].segments[1].kind, "tool");
  assert.equal(turns8[0].segments[1].label, "tool1");
  assert.equal(turns8[0].segments[2].kind, "text");
  assert.equal(turns8[0].segments[2].text, "final text");

  // 9. timestamp already in ms (>= 1e12) must not be re-multiplied by 1000
  const tsMs = 1700000000000; // 13 digits, already ms
  const rows9: HistoryRow[] = [
    { id: "msg1", role: "assistant", content: null, reasoning: "thinking", timestamp: tsMs },
    { id: "msg2", role: "user", content: "hi", timestamp: tsMs + 2000 },
  ];
  const turns9 = rowsToTurns(rows9);
  assert.equal(turns9[0].ts, tsMs);
  assert.equal(turns9[1].ts, tsMs + 2000);
  assert.equal(turns9[0].segments[0].durationMs, 2000);

  console.log("verify-history: All checks passed");
}

runTests();
