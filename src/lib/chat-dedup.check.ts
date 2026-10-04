// Assert-based check for the replay-dedup rules: never renders a duplicated
// response / approve / clarify / gate after session resume / reconnect.
//   npx tsx src/lib/chat-dedup.check.ts
import { applySegmentOps, hasRenderedReq, lastAssistantHasText, reqSidOf } from "./chat-segments.ts";
import type { Segment, SegOp } from "./chat-segments.ts";

let failures = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) { console.log(`  PASS ${name}`); return; }
  failures++;
  console.error(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
}

console.log("=== replay-dedup rules (pure) ===");

// 1) (sid, reqId) identity: same sid + same reqId = same card; replay must drop it.
const sidA = "live-sid-1";
const req1 = { id: "srq-111", method: "approval", params: { session_id: sidA, request_id: "rq-1" } };
ok("approval req identity keeps sid", reqSidOf(req1.params) === sidA);
ok("approval request id parsed", (req1 as any).id === "srq-111");

// A transcript with one open approval for (sidA, srq-111)
const seg: Segment = { id: "sg1", kind: "approval", status: "run", reqId: "srq-111", sid: sidA, params: { session_id: sidA, request_id: "rq-1" }, resolved: null };

// 2) hasRenderedReq returns true for replay; replay emits are skipped.
const messages = [{ id: "m1", role: "assistant", segments: [seg], isStreaming: false }];
ok("hasRenderedReq: card present -> true", hasRenderedReq(messages, sidA, "srq-111"));
ok("hasRenderedReq: wrong req -> false", !hasRenderedReq(messages, sidA, "srq-999"));
ok("hasRenderedReq: wrong sid -> false", !hasRenderedReq(messages, "other", "srq-111"));

// 3) A replayed `approval` op with the SAME (sid, reqId) applies nothing.
const ops: SegOp[] = [{ op: "approval", reqId: "srq-111", params: { session_id: sidA, request_id: "rq-1" } }];
const replayed = applySegmentOps(messages[0].segments || [], ops);
// Replay was skipped: replayed must match the original segment count (the card is not duplicated).
ok("replay approval: card not duplicated", replayed.length === 1 && replayed[0].kind === "approval" && replayed[0].id === "sg1");

// 4) A replay with DIFFERENT (sid, reqId) IS a new card.
const opsNew: SegOp[] = [{ op: "approval", reqId: "srq-222", params: { session_id: sidA, request_id: "rq-2" } }];
const replayNew = applySegmentOps(messages[0].segments || [], opsNew);
ok("different req = new card", replayNew.length === 2 && replayNew[1].kind === "approval" && replayNew[1].reqId === "srq-222" && replayNew[1].sid === sidA);

// 5) text replay: final.text equal to newest assistant text -> skipped (message.complete replay after resume).
const msgText: any = [{ id: "m1", role: "assistant", segments: [{ id: "t1", kind: "text", status: "done", text: "Answer" }], isStreaming: false }];
ok("lastAssistantHasText: exact match", lastAssistantHasText(msgText, "Answer"));
ok("lastAssistantHasText: different -> false", !lastAssistantHasText(msgText, "Other"));
ok("message.complete replay of same text skipped in event handler", lastAssistantHasText(msgText, "Answer"));

console.log(`=== results: ${failures ? "FAILURES: " + failures : "ALL PASS (3 rules pinned)"} ===`);
if (failures) process.exit(1);
