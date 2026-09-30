import { notifyGateRequest, getPendingGate } from "./server/ntfy-notify.mjs";
notifyGateRequest({ method: "clarify", id: "srq-1", params: { session_id: "s1", questions: [{ qid: "q1", question: "Which?", choices: ["A", "B"] }] } });
console.log(getPendingGate("srq-1"));
