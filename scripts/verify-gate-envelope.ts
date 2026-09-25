import { strict as assert } from "node:assert";
import { parseGate, serializeReply, draftKey, supersedes, parseArchivedGate } from "../src/components/gates/gate-envelope.ts";
// need to compile to test or run with tsx, assuming they are run with tsx or equivalent

function runTests() {
  console.log("Testing parseGate...");
  const valid = "Some thought\n<!--astra-gate/1\n" + JSON.stringify({
    v: 1, gate_id: "g1", version: 1, title: "Test", kind: "plan", actions: [], body: { content: "test" }
  }) + "\n-->";
  const parsed = parseGate(valid);
  assert.ok(parsed);
  assert.equal(parsed.env.gate_id, "g1");
  assert.equal(parsed.summary, "Some thought");

  const invalid = "Some thought\n<!--astra-gate/1\n{bad_json}\n-->";
  assert.equal(parseGate(invalid), null);

  console.log("Testing draftKey...");
  assert.equal(draftKey("sess1", "g1"), "astra-gate-draft:sess1:g1");
  assert.equal(draftKey(null, "g1"), "astra-gate-draft:global:g1");

  console.log("Testing supersedes...");
  const g1v1 = { gate_id: "g1", version: 1 } as any;
  const g1v2 = { gate_id: "g1", version: 2 } as any;
  const g2v1 = { gate_id: "g2", version: 1 } as any;
  
  assert.equal(supersedes(g1v1, g1v2), true);
  assert.equal(supersedes(g1v2, g1v1), false); // v1 does not supersede v2
  assert.equal(supersedes(g1v1, g2v1), false); // different ID

  console.log("Testing serializeReply...");
  const reply = serializeReply("g1", 1, { action: "approve" });
  assert.equal(reply, JSON.stringify({ astra_gate: 1, gate_id: "g1", version: 1, action: "approve" }));

  console.log("Testing parseArchivedGate...");
  const archived = "<!--astra-gate/1\n" + JSON.stringify({
    v: 1, gate_id: "g1", version: 1, title: "Test", kind: "plan", actions: [], body: { content: "test" }, resolved: "approve"
  }) + "\n-->";
  const parsedArch = parseArchivedGate(archived);
  assert.ok(parsedArch);
  assert.equal(parsedArch.gate_id, "g1");
  assert.equal(parsedArch.resolved, "approve");

  console.log("verify-gate-envelope.ts: all pass");
}

runTests();
