import assert from 'node:assert';

function mockFrameContext() {
  const sockets = new Map();
  let framesWritten = [];

  const mockSocket = (id, sid, filter) => {
    const s = {
      id,
      write: (f) => framesWritten.push({ id, frame: f.toString() })
    };
    sockets.set(s, { sid, filter, lastPong: Date.now() });
    return s;
  };

  const broadcastFrame = (payload, opcode) => {
    const frame = "ENCODED_" + payload;
    let passForTagged = false;
    let parsedSid = null;
    let anyTagged = false;
    let anyCompleteFilter = false;
    let parsedType = null;
    
    for (const info of sockets.values()) {
      if (info.sid) anyTagged = true;
      if (info.filter) anyCompleteFilter = true;
    }
    
    if ((anyTagged || anyCompleteFilter) && opcode === 0x1) {
      try {
        const msg = JSON.parse(payload.toString());
        const p = msg && msg.params;
        if (p) {
          parsedType = p.type;
          if (p.type === "message.complete" || p.type === "message.error") {
            passForTagged = true;
            parsedSid = p.session_id;
          }
        }
      } catch { }
    }
    
    for (const [s, info] of sockets) {
      if (opcode === 0x1) {
        if (info.sid) {
          if (!passForTagged || parsedSid !== info.sid) continue;
        } else if (info.filter) {
          if (parsedType !== "message.complete" && parsedType !== "message.error") continue;
        }
      }
      try { s.write(frame); } catch { }
    }
  };

  return { sockets, mockSocket, broadcastFrame, getWritten: () => {
    const w = [...framesWritten];
    framesWritten = [];
    return w;
  }};
}

const ctx = mockFrameContext();
ctx.mockSocket('untagged', null, false);
ctx.mockSocket('tagged_s1', 's1', false);
ctx.mockSocket('tagged_s2', 's2', false);
ctx.mockSocket('filter_comp', null, true);

// 1. message.complete for s1
const msgCompleteS1 = JSON.stringify({ method: "event", params: { type: "message.complete", session_id: "s1", payload: {} } });
ctx.broadcastFrame(msgCompleteS1, 0x1);
let w = ctx.getWritten();
assert.ok(w.some(x => x.id === 'untagged'));
assert.ok(w.some(x => x.id === 'tagged_s1'));
assert.ok(!w.some(x => x.id === 'tagged_s2'));
assert.ok(w.some(x => x.id === 'filter_comp'));

// 2. message.error for s2
const msgErrorS2 = JSON.stringify({ method: "event", params: { type: "message.error", session_id: "s2", payload: {} } });
ctx.broadcastFrame(msgErrorS2, 0x1);
w = ctx.getWritten();
assert.ok(w.some(x => x.id === 'untagged'));
assert.ok(!w.some(x => x.id === 'tagged_s1'));
assert.ok(w.some(x => x.id === 'tagged_s2'));
assert.ok(w.some(x => x.id === 'filter_comp'));

// 3. message.delta for s1
const msgDeltaS1 = JSON.stringify({ method: "event", params: { type: "message.delta", session_id: "s1", payload: {} } });
ctx.broadcastFrame(msgDeltaS1, 0x1);
w = ctx.getWritten();
assert.ok(w.some(x => x.id === 'untagged'));
assert.ok(!w.some(x => x.id === 'tagged_s1'));
assert.ok(!w.some(x => x.id === 'tagged_s2'));
assert.ok(!w.some(x => x.id === 'filter_comp'));

// 4. other payload
const msgStatus = JSON.stringify({ method: "event", params: { type: "proxy.status", payload: {} } });
ctx.broadcastFrame(msgStatus, 0x1);
w = ctx.getWritten();
assert.ok(w.some(x => x.id === 'untagged'));
assert.ok(!w.some(x => x.id === 'tagged_s1'));
assert.ok(!w.some(x => x.id === 'tagged_s2'));
assert.ok(!w.some(x => x.id === 'filter_comp'));

console.log("ws-filter.check.mjs passed");
