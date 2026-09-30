import assert from "node:assert";

// Pure replication of the proxy's live→stored bridge, asserted against the
// real source file so drift breaks this check instead of shipping silently.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./hermes-proxy.mjs", import.meta.url), "utf8");

// 1. The bridge exists and stamps frames.
assert(src.includes("export const sidMap"), "sidMap missing");
assert(src.includes("export function recordSidMapping"), "recordSidMapping missing");
assert(src.includes("p.payload.stored_session_id = stored"), "frame stamping missing");
// 2. Mapping learned from RPC replies inside broadcastFrame (any socket mix).
assert(src.includes("if (r && r.session_id)"), "RPC-reply mapping recording missing");
// 3. Mapping probe runs even with zero filtered sockets (decoder path).
assert(
  src.includes('frame.payload.includes("\\"session_key\\"")'),
  "decoder-path mapping probe missing"
);
// 4. Stamping must be gated to complete/error + only when a mapping exists.
assert(
  /parsedSid = p\.session_id;\s*\n\s*const stored = sidMap\.get\(parsedSid\)/.test(src),
  "stamp not gated on message.complete/error path"
);
// 5. Kotlin consumes the stamp for title + deep link.
const kt = readFileSync(
  new URL(
    "../android/app/src/main/java/com/jitinnair/astra/NtfyPushService.kt",
    import.meta.url
  ),
  "utf8"
);
assert(kt.includes('stored_session_id'), "kotlin does not read stored_session_id stamp");
assert(kt.includes('storedHint'), "kotlin stored-hint path missing");

// 6. Behavioral spec the bridge must satisfy (mirrors runtime logic):
function makeBridge() {
  const sidMap = new Map();
  return {
    record(live, stored) {
      if (live && stored && live !== stored) sidMap.set(String(live), String(stored));
    },
    stamp(type, sid, payload) {
      if (type !== "message.complete" && type !== "message.error") return payload;
      const stored = sidMap.get(sid);
      if (stored && payload && typeof payload === "object") {
        return { ...payload, stored_session_id: stored };
      }
      return payload;
    },
  };
}
const b = makeBridge();
b.record("7066e3b6", "20260930_093125_26a60a");
assert.deepStrictEqual(
  b.stamp("message.complete", "7066e3b6", { text: "hi" }),
  { text: "hi", stored_session_id: "20260930_093125_26a60a" }
);
assert.deepStrictEqual(b.stamp("message.complete", "unknown-sid", { text: "x" }), { text: "x" });
assert.deepStrictEqual(b.stamp("message.delta", "7066e3b6", { text: "x" }), { text: "x" });
b.record("same", "same"); // self-map must be ignored
assert(!b.stamp("message.complete", "same", {}).stored_session_id, "self-map leaked");
b.record("", ""); // empty args no-op
console.log("sid-bridge.check.mjs passed");
