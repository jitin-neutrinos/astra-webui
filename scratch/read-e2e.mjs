// E2E probe: login → WS connect → PATCH read → expect session.read broadcast.
// Run: node scratch/read-e2e.mjs
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";

const base = "http://127.0.0.1:3011";
const pw = process.env.ASTRA_WEBUI_PASSWORD;

const post = (path, body) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(data ? { "content-length": String(data.length) } : {}) }
  }, res => {
    const cookie = (res.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; ");
    let chunks = []; res.on("data", c => chunks.push(c)); res.on("end", () => resolve({ status: res.statusCode, cookie, body: Buffer.concat(chunks).toString() }));
  });
  req.on("error", reject);
  if (data) req.write(data);
  req.end();
});

const login = await post("/api/login", { password: pw });
console.log("login:", login.status, login.body);

const key = crypto.randomBytes(16).toString("base64");
const sock = net.connect(3011, "127.0.0.1", () => {
  sock.write("GET /api/hx/ws HTTP/1.1\r\nHost: 127.0.0.1:3011\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
    `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nCookie: ${login.cookie}\r\n\r\n`);
});

let stage = "handshake"; let buf = Buffer.alloc(0);
const timer = setTimeout(() => { console.log("RESULT session.read: NOT RECEIVED"); sock.destroy(); process.exit(1); }, 4000);

sock.on("data", d => {
  buf = Buffer.concat([buf, d]);
  if (stage === "handshake") {
    const idx = buf.indexOf("\r\n\r\n");
    if (idx === -1) return;
    const head = buf.slice(0, idx).toString();
    if (!head.includes("101")) { console.log("handshake failed:", head.split("\r\n")[0]); sock.destroy(); process.exit(1); }
    buf = buf.slice(idx + 4); stage = "frames";
    console.log("ws: connected");
  }
  while (buf.length >= 2) {
    const len = buf[1] & 0x7f; let off = 2; let n = len;
    if (len === 126) { if (buf.length < 4) break; n = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (buf.length < 10) break; n = Number(buf.readBigUInt64BE(2)); off = 10; }
    if (buf.length < off + n) break;
    const payload = buf.slice(off, off + n).toString(); buf = buf.slice(off + n);
    if (!payload) continue;
    try {
      const m = JSON.parse(payload);
      const p = m.params || {};
      if (p.type === "session.read") {
        clearTimeout(timer);
        console.log("RESULT session.read:", JSON.stringify(p));
        sock.destroy(); process.exit(0);
      }
    } catch {}
  }
});

await new Promise(r => setTimeout(r, 300));
const SID = process.argv[2] || "20261001_130736_54ccf7";
const patch = await fetch(base + "/api/hx/sessions/" + SID, { method: "PATCH", headers: { "content-type": "application/json", cookie: login.cookie }, body: JSON.stringify({ unread: false }) });
console.log("PATCH:", patch.status, await patch.text());
