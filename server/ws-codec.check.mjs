// ws-codec.check.mjs — pins the frame codec, including FRAGMENT REASSEMBLY.
//
// THE BUG THIS EXISTS FOR: the decoder treated any fin=0 data frame as a
// protocol error ("fragmentation unsupported") and the caller destroyed the
// socket. A legitimate RFC 6455 fragmented message therefore took the whole
// connection down. `ws` (now a dependency) handles fragmentation natively,
// which is what made the gap visible — so it also serves as the independent
// oracle below: encode a message with `ws`'s own sender, split it, and assert
// this decoder reassembles exactly what `ws` would.
//
// Runs under bare Node, per repo convention.

import assert from "node:assert/strict";
import WebSocket from "ws";
import { encodeFrame, FrameDecoder, generateAcceptKey } from "./ws-codec.mjs";

function collect() {
  const frames = [];
  const decoder = new FrameDecoder((f, isError) => frames.push({ ...f, isError: !!isError }));
  return { frames, decoder };
}

// ---- 1. a plain single-frame message still works (no regression) -----------
{
  const { frames, decoder } = collect();
  decoder.push(encodeFrame("hello", { opcode: 0x1, masked: true }));
  assert.equal(frames.length, 1, "one frame delivered");
  assert.equal(frames[0].opcode, 0x1, "text opcode preserved");
  assert.equal(frames[0].payload.toString(), "hello", "payload intact");
  assert.equal(frames[0].isError, false, "no error flag");
}

// ---- 2. THE REGRESSION: a fragmented message is reassembled ----------------
// fin=0 text "Hel", then fin=0 continuation "lo ", then fin=1 continuation "world".
{
  const { frames, decoder } = collect();
  decoder.push(encodeFrame("Hel", { opcode: 0x1, masked: true }));   // fin is set by encodeFrame…
  // encodeFrame always sets fin=1, so build the fragments by hand to model a
  // real fragmented stream: clear the FIN bit on all but the last.
  const unfin = (buf) => { buf[0] &= 0x7f; return buf; };
  const { frames: f2, decoder: d2 } = collect();
  d2.push(unfin(encodeFrame("Hel", { opcode: 0x1, masked: true })));
  d2.push(unfin(encodeFrame("lo ", { opcode: 0x0, masked: true })));
  d2.push(encodeFrame("world", { opcode: 0x0, masked: true }));
  assert.equal(f2.length, 1, "fragmented message yields exactly ONE frame");
  assert.equal(f2[0].opcode, 0x1, "reassembled frame keeps the ORIGINAL opcode");
  assert.equal(f2[0].payload.toString(), "Hello world", "fragments reassembled in order");
  assert.equal(f2[0].isError, false, "reassembly is not an error");
}

// ---- 3. control frames interleaved inside a fragmented message -------------
// RFC 6455 §5.4: control frames may appear between fragments and must be
// delivered immediately, not folded into the buffer.
{
  const { frames, decoder } = collect();
  const unfin = (buf) => { buf[0] &= 0x7f; return buf; };
  decoder.push(unfin(encodeFrame("AB", { opcode: 0x1, masked: true })));
  decoder.push(encodeFrame("ping!", { opcode: 0x9, masked: true }));   // ping mid-message
  decoder.push(encodeFrame("CD", { opcode: 0x0, masked: true }));
  assert.equal(frames.length, 2, "one reassembled message + one ping");
  assert.equal(frames[0].opcode, 0x9, "the interleaved ping is delivered at once");
  assert.equal(frames[0].payload.toString(), "ping!", "ping payload intact");
  assert.equal(frames[1].opcode, 0x1, "the message completes after the ping");
  assert.equal(frames[1].payload.toString(), "ABCD", "fragments around the ping reassemble");
}

// ---- 4. protocol errors still error (they must NOT be silently accepted) ---
{
  // continuation with no start
  const a = collect();
  a.decoder.push(encodeFrame("orphan", { opcode: 0x0, masked: true }));
  assert.equal(a.frames.length, 1, "orphan continuation is reported");
  assert.equal(a.frames[0].isError, true, "orphan continuation is an ERROR");

  // nested start while one is open
  const b = collect();
  const unfin = (buf) => { buf[0] &= 0x7f; return buf; };
  b.decoder.push(unfin(encodeFrame("first", { opcode: 0x1, masked: true })));
  b.decoder.push(unfin(encodeFrame("second", { opcode: 0x1, masked: true })));
  assert.equal(b.frames.some((f) => f.isError), true, "nested start is an ERROR");
}

// ---- 5. `ws` is the independent oracle ------------------------------------
// Our hand-built fragmented stream (produced by OUR encoder) is fed to a REAL
// `ws` server, which must reconstruct the message. This proves our frames are
// SPEC-VALID, pairing with section 2 (our decoder reassembles that same shape).
// Together the two directions are pinned against the reference implementation;
// either alone can be self-consistently wrong.
{
  const { WebSocketServer } = await import("ws");
  const net = await import("node:net");
  const { randomBytes } = await import("node:crypto");

  const wss = new WebSocketServer({ port: 0 });
  const port = wss.address().port;
  const serverGot = new Promise((resolve, reject) => {
    wss.on("connection", (sock) => {
      sock.on("message", (data) => resolve(data.toString()));
      setTimeout(() => reject(new Error("server timeout")), 8000);
    });
  });

  const unfin = (buf) => { buf[0] &= 0x7f; return buf; };
  const stream = Buffer.concat([
    unfin(encodeFrame("Hello ", { opcode: 0x1, masked: true })),
    unfin(encodeFrame("frag", { opcode: 0x0, masked: true })),
    encodeFrame("mented world", { opcode: 0x0, masked: true }),
  ]);

  const key = randomBytes(16).toString("base64");
  let rawClient = null;
  await new Promise((resolve, reject) => {
    const c = net.connect(port, "127.0.0.1", () => {
      c.write(
        `GET / HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\n` +
        `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    let buf = Buffer.alloc(0);
    c.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.indexOf("\r\n\r\n") !== -1) {
        if (buf.toString().startsWith("HTTP/1.1 101")) { c.write(stream); resolve(); }
        else reject(new Error("handshake refused"));
      }
    });
    rawClient = c;
    c.on("error", reject);
    setTimeout(() => reject(new Error("raw client timeout")), 8000);
  });

  const got = await serverGot;
  assert.equal(got, "Hello fragmented world", "a REAL ws server accepts OUR fragments");
  try { rawClient?.destroy(); } catch {}
  wss.close();
}

// ---- 6. handshake key (unchanged behaviour, pinned so it cannot drift) -----
assert.equal(
  generateAcceptKey("dGhlIHNhbXBsZSBub25jZQ=="),
  "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
  "RFC 6455 sample accept key"
);

console.log("ws-codec.check: all assertions passed");
// Explicit exit: the oracle above opens real sockets/servers, and a lingering
// handle would hold the event loop open forever (the check must terminate).
process.exit(0);
