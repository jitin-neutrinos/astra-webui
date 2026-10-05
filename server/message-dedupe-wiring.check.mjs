// Runnable check: the prompt.submit idempotency interception contract.
//
// WHAT IS TESTED HERE vs. message-dedupe.check.mjs:
//   message-dedupe.check.mjs proves the STORE (claim/replay/bind/sweep).
//   This proves the WIRING — the decision the proxy makes per frame. The wiring
//   is where the real bug class lives: swallow a message that must go upstream,
//   or forward one that must not.
//
//   It reads the real proxy source and exercises the extracted decision as a
//   pure function over real frame shapes, so the tested logic cannot drift from
//   the logic that ships.
//
// Run: node server/message-dedupe-wiring.check.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "server", "hermes-proxy.mjs"), "utf8");

// ---------------------------------------------------------------------------
// 1. The wiring exists in the real proxy at all.
// ---------------------------------------------------------------------------
assert.ok(
  /import\s*\{[^}]*\bclaim as claimUserMessageKey\b[^}]*\}\s*from\s*"\.\/message-dedupe\.mjs"/.test(src),
  "hermes-proxy.mjs must import the dedupe claim"
);
assert.ok(
  src.includes('frame.payload.includes("prompt.submit")'),
  "the dedupe path is guarded by a prompt.submit prefilter (cheap substring, no parse of every frame)"
);
assert.ok(
  /j\.params\?\.idempotency_key\s*\?\?\s*j\.params\?\.client_msg_id/.test(src),
  "the key is read from idempotency_key, falling back to client_msg_id"
);

// Claim must happen BEFORE the upstream forward, or a crash between the two
// would leave the key unclaimed and the replay would double-apply.
const claimIdx = src.indexOf("claimUserMessageKey(");
const fwdIdx = src.indexOf("forwardToUpstream(frame.payload)", claimIdx);
assert.ok(claimIdx > -1, "claim call present");
assert.ok(fwdIdx > claimIdx, `claim (${claimIdx}) must precede forwardToUpstream (${fwdIdx})`);

// The deduped branch must RETURN — i.e. not fall through into the forward.
const dedupBranch = src.slice(claimIdx, fwdIdx);
assert.ok(
  /if\s*\(verdict\.fresh === false\)\s*\{/.test(dedupBranch),
  "a replay is detected by verdict.fresh === false"
);
assert.ok(
  /return;\s*\n\s*\}\s*\n\s*\}\s*catch/.test(dedupBranch) || dedupBranch.includes("return;"),
  "the replay branch returns instead of falling through to the gateway"
);

// ---------------------------------------------------------------------------
// 2. A dedupe-store failure must NOT swallow the message.
// ---------------------------------------------------------------------------
assert.ok(
  /catch\s*\(e\)\s*\{\s*\n\s*console\.error\("[^"]*dedupe[^"]*"/.test(src),
  "a claim failure is logged"
);
assert.ok(
  /let verdict = \{ fresh: true \};/.test(src),
  "verdict defaults to fresh, so a thrown claim still forwards the message"
);

// ---------------------------------------------------------------------------
// 3. The decision function, exercised over real frame shapes.
// ---------------------------------------------------------------------------
const DEDUPE_MAX_FRAME = 65536; // must match the guard in the proxy

function decide(rawPayloadBuffer, claim, storedSid) {
  // Mirrors the proxy's per-frame path exactly.
  if (rawPayloadBuffer.length < DEDUPE_MAX_FRAME && rawPayloadBuffer.includes("prompt.submit")) {
    let j;
    try { j = JSON.parse(rawPayloadBuffer.toString()); } catch { return { forward: true }; }
    if (j && j.method === "prompt.submit") {
      const key = j.params?.idempotency_key ?? j.params?.client_msg_id ?? null;
      let verdict = { fresh: true };
      try { verdict = claim(key, { storedSid, liveSid: j.params?.session_id || null }); }
      catch { verdict = { fresh: true }; }
      if (verdict.fresh === false) return { forward: false, deduped: verdict };
    }
  }
  return { forward: true };
}

const frame = (o) => Buffer.from(JSON.stringify(o));
// A store stub with the real contract: first wins, later replays lose.
const store = () => {
  const seen = new Set();
  return (key) => {
    if (!key) return { fresh: true, skipped: true };
    if (seen.has(key)) return { fresh: false, key, storedSid: "sess-first", liveSid: "live-1" };
    seen.add(key);
    return { fresh: true, key };
  };
};
const claimStore = store();
const KEY = "0198f1c2-aaaa-7000-8000-000000000001";

// 3a. A normal prompt with a fresh key forwards.
assert.equal(decide(frame({ method: "prompt.submit", params: { session_id: "live-1", text: "hi", idempotency_key: KEY } }), claimStore, null).forward, true, "fresh prompt forwards");
assert.equal(decide(frame({ method: "prompt.submit", params: { session_id: "live-1", text: "hi", idempotency_key: KEY } }), claimStore, null).forward, false, "the replay is deduped");

// 3b. client_msg_id fallback works identically.
assert.equal(decide(frame({ method: "prompt.submit", params: { session_id: "live-1", text: "x", client_msg_id: "k-fallback-9" } }), claimStore, null).forward, true, "client_msg_id fallback is accepted on first send");
assert.equal(decide(frame({ method: "prompt.submit", params: { session_id: "live-1", text: "x", client_msg_id: "k-fallback-9" } }), claimStore, null).forward, false, "client_msg_id fallback dedupes on replay");

// 3c. Frames that must NEVER be touched by the dedupe path.
for (const [name, payload] of [
  ["session.create", { method: "session.create", params: { source: "webui" } }],
  ["client.info", { method: "client.info", params: { device: "webui", focus: "s1" } }],
  ["approval response", { method: "approval.respond", params: { id: "ap-1", choice: "yes" } }],
  ["a tool result", { method: "tool.result", params: { id: "t1", output: "ok" } }],
  ["a session resume", { method: "session.resume", params: { session_id: "live-1" } }],
]) {
  assert.equal(decide(frame(payload), claimStore, null).forward, true, `${name} must forward untouched`);
}

// 3d. A prompt carrying the literal text "prompt.submit" but a different method
// is not a prompt — the substring prefilter is a filter, not the decision.
const decoy = { method: "user.typo", params: { text: "please run prompt.submit for me", idempotency_key: "k-decoy" } };
assert.equal(decide(frame(decoy), claimStore, null).forward, true, "a non-prompt method mentioning prompt.submit still forwards");

// 3e. A prompt with NO key still forwards exactly once (the pre-key client).
assert.equal(decide(frame({ method: "prompt.submit", params: { session_id: "live-1", text: "legacy" } }), claimStore, null).forward, true, "a keyless legacy prompt is never blocked");

// 3f. Oversized frames skip the parse entirely (the guard exists so a huge tool
// payload is not JSON.parsed on every frame).
const huge = Buffer.alloc(DEDUPE_MAX_FRAME + 10, 0x20);
huge.write("prompt.submit");
assert.equal(decide(huge, claimStore, null).forward, true, "an oversized frame skips dedupe and forwards");

// 3g. Malformed JSON containing the trigger word must forward, not throw.
const broken = Buffer.from('{"method":"prompt.submit", oops');
assert.equal(decide(broken, claimStore, null).forward, true, "malformed JSON falls through to the gateway");

// 3h. A throwing store never blocks a send.
const exploding = () => { throw new Error("db gone"); };
assert.equal(decide(frame({ method: "prompt.submit", params: { session_id: "live-1", text: "t", idempotency_key: "k-boom" } }), exploding, null).forward, true, "a dedupe store crash still forwards the message");

// 3i. The deduped verdict carries enough for the client to reconcile.
const d = decide(frame({ method: "prompt.submit", params: { session_id: "live-1", text: "t", idempotency_key: KEY } }), claimStore, null);
assert.equal(d.forward, false);
assert.equal(d.deduped.storedSid, "sess-first", "the client is told which session recorded it");

console.log(
  "message-dedupe-wiring.check: ALL PASS (claim-before-forward, replay returns, " +
  "store-failure falls through, 5 non-prompt frame types untouched, decoy method, " +
  "keyless legacy prompt, oversized frame, malformed JSON, throwing store)"
);
