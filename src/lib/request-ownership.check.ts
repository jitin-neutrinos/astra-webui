// Approval/clarify session-ownership check (repo assert pattern, no framework).
// Guards the "approvals leaking into the wrong chat" bug class:
//   https://astra.jitinnair.com — the proxy broadcasts every upstream frame to
//   every tab, so server→client requests MUST be gated on params.session_id
//   === liveIdRef.current (exact match, fail-closed).
import { requestBelongsToLive } from "./hermes-ws";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

const A = "aaaa1111", B = "bbbb2222";

// exact match passes
assert(requestBelongsToLive({ session_id: A }, A) === true, "own session must pass");
// foreign session is rejected (THE leak)
assert(requestBelongsToLive({ session_id: A }, B) === false, "foreign session must be rejected");
// null live id (fresh tab, no session yet) matches nothing — no vacuous pass
assert(requestBelongsToLive({ session_id: A }, null) === false, "null live id must reject");
// missing session_id tag fails closed (gateway always stamps; absence = malformed)
assert(requestBelongsToLive({}, A) === false, "missing sid must reject");
assert(requestBelongsToLive(null, A) === false, "null params must reject");
// empty-string sid is not a valid owner
assert(requestBelongsToLive({ session_id: "" }, "") === false, "empty sid must reject");

console.log("PASS: request-ownership checks");
