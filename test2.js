process.env.NTFY_URL = "http://127.0.0.1:9"; process.env.NTFY_TOPIC = "t"; process.env.NTFY_AUTH = "Basic x";
const { notifyGateRequest, getPendingGate } = await import("./server/ntfy-notify.mjs");
notifyGateRequest({ method: "clarify", id: "srq-1", params: { session_id: "s1", questions: [{ qid: "q1", question: "Which?", choices: ["A", "B"] }] } });
console.log(getPendingGate("srq-1"));
