// one runnable check: gate registry captures approval + clarify frames
process.env.NTFY_URL = "http://127.0.0.1:9"; process.env.NTFY_TOPIC = "t"; process.env.NTFY_AUTH = "Basic x";
const { notifyGateRequest, getPendingGate } = await import("./ntfy-notify.mjs");
import assert from "node:assert/strict";
notifyGateRequest({ method: "approval", id: "a1", params: { session_id: "s1", command: "rm -rf x", description: "Delete build", choices: ["once", "deny"] } });
notifyGateRequest({ method: "clarify", id: "srq-1", params: { session_id: "s1", questions: [{ qid: "q1", question: "Which?", choices: ["A", "B"] }] } });
const a = getPendingGate("a1"), c = getPendingGate("srq-1");
assert.equal(a.kind, "approval"); assert.equal(a.command, "rm -rf x"); assert.deepEqual(a.choices, ["once", "deny"]);
assert.equal(c.kind, "clarify"); assert.equal(c.questions[0].qid, "q1"); assert.deepEqual(c.questions[0].choices, ["A", "B"]);
assert.equal(getPendingGate("nope"), null);
console.log("gate-api.check: PASS");
process.exit(0);
