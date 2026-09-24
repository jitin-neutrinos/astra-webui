import { request as httpRequest } from "node:http";
import { randomBytes } from "node:crypto";
import { generateAcceptKey, encodeFrame, FrameDecoder } from "./ws-codec.mjs";

const HERMES_URL = "http://127.0.0.1:9119";
const PASSWORD = process.env.ASTRA_HERMES_PASSWORD;

let hermesCookie = null;
let loginPromise = null;

async function getHermesCookie() {
  if (hermesCookie) return hermesCookie;
  if (loginPromise) return loginPromise;
  loginPromise = (async () => {
    try {
      const res = await new Promise((resolve, reject) => {
        // Dashboard login is POST /auth/password-login (NOT /api/login — that
        // answers unauthenticated-before-cookie and the proxy loops 503).
        const req = httpRequest(`${HERMES_URL}/auth/password-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        }, resolve);
        req.on("error", reject);
        req.write(JSON.stringify({ provider: "basic", username: "jitin", password: PASSWORD }));
        req.end();
      });
      // ignore body, just want cookie
      res.resume();
      if (res.statusCode !== 200) {
        throw new Error(`Hermes login failed: ${res.statusCode}`);
      }
      // Login sets the session as SEVERAL cookies (hermes_session_at/_rt/
      // _provider/hermes_session) — ALL must be forwarded or Hermes answers
      // unauthenticated downstream.
      const cookies = res.headers["set-cookie"] || [];
      const sessionCookies = cookies
        .filter(c => c.startsWith("hermes_session"))
        .map(c => c.split(";")[0]);
      if (!sessionCookies.length) throw new Error("No hermes_session cookies returned");
      hermesCookie = sessionCookies.join("; ");
      return hermesCookie;
    } finally {
      loginPromise = null;
    }
  })();
  return loginPromise;
}

function clearHermesCookie() {
  hermesCookie = null;
}

// WS upgrades need a single-use ticket (cookie alone 403s); 30s TTL, mint per connect
let wsTicket = null;
let ticketPromise = null;
async function getWsTicket() {
  if (wsTicket) return wsTicket;
  if (ticketPromise) return ticketPromise;
  ticketPromise = (async () => {
    try {
      const cookie = await getHermesCookie();
      const res = await new Promise((resolve, reject) => {
        const req = httpRequest(`${HERMES_URL}/api/auth/ws-ticket`, {
          method: "POST",
          headers: { "Cookie": cookie }
        }, resolve);
        req.on("error", reject);
        req.end();
      });
      res.resume();
      if (res.statusCode !== 200) throw new Error(`ws-ticket failed: ${res.statusCode}`);
      const chunks = [];
      for await (const c of res) chunks.push(c);
      const ticket = JSON.parse(Buffer.concat(chunks).toString()).ticket;
      if (!ticket) throw new Error("empty ticket");
      wsTicket = ticket;
      return ticket;
    } finally {
      ticketPromise = null;
    }
  })();
  return ticketPromise;
}

function clearWsTicket() {
  wsTicket = null;
}

// REST Proxy
export async function handleHxProxy(req, res) {
  // path prefix is /api/hx. Map to /api/...
  const targetPath = req.url.replace(/^\/api\/hx/, "/api");
  
  let cookie;
  try {
    cookie = await getHermesCookie();
  } catch (err) {
    res.writeHead(503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: err.message }));
  }

  const contentLength = parseInt(req.headers["content-length"] || "0", 10);
  const hasBody = contentLength > 0;

  const makeReq = (pipeBody) => new Promise((resolve, reject) => {
    const headers = { "Cookie": cookie };
    if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
    if (req.headers["content-length"]) headers["content-length"] = req.headers["content-length"];
    // media streaming: forward Range so Hermes can answer 206 (video seeking needs it)
    if (req.headers["range"]) headers["range"] = req.headers["range"];

    const proxyReq = httpRequest(`${HERMES_URL}${targetPath}`, {
      method: req.method,
      headers
    }, resolve);
    proxyReq.on("error", reject);
    if (hasBody && pipeBody) {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  });

  try {
    let proxyRes = await makeReq(true);
    if (proxyRes.statusCode === 401) {
      clearHermesCookie();
      if (hasBody) {
        res.writeHead(503, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "reauth" }));
      } else {
        cookie = await getHermesCookie();
        proxyRes = await makeReq(false);
      }
    }
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  } catch (err) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "proxy connect error" }));
  }
}

// WS Relay
const browserSockets = new Set();
let upstreamWs = null;
let reconnecting = false;
let backoffStep = 0;
const BACKOFF_TABLE = [1000, 2000, 4000, 8000];

// Browser frames that arrived while the upstream connection was still being
// minted (cookie + single-use ticket are async). Without buffering, the
// browser's client.capabilities + session.resume — sent the instant its
// socket opens — are silently dropped, the gateway never learns this client
// answers server→client requests, and every clarify/approval fast-fails with
// "the attached client predates server→client requests". Capped; oldest
// dropped if upstream never comes up (ordering is preserved for the cap).
const pendingBrowserFrames = [];
const PENDING_FRAME_CAP = 100;

function forwardToUpstream(payload) {
  if (!upstreamWs) return false;
  try {
    upstreamWs.write(encodeFrame(payload, { opcode: 0x1, masked: true }));
    return true;
  } catch {
    return false;
  }
}

function bufferBrowserFrame(payload) {
  pendingBrowserFrames.push(payload);
  if (pendingBrowserFrames.length > PENDING_FRAME_CAP) pendingBrowserFrames.shift();
}

function flushPendingFrames() {
  while (pendingBrowserFrames.length && upstreamWs) {
    const payload = pendingBrowserFrames.shift();
    if (!forwardToUpstream(payload)) break;
  }
}

function broadcastStatus(state) {
  const msg = JSON.stringify({
    method: "event",
    params: { type: "proxy.status", payload: { state } }
  });
  const frame = encodeFrame(msg, { opcode: 0x1, masked: false });
  for (const s of browserSockets) {
    try { s.write(frame); } catch { /* ignore */ }
  }
}

function broadcastFrame(payload, opcode) {
  const frame = encodeFrame(payload, { opcode, masked: false });
  for (const s of browserSockets) {
    try { s.write(frame); } catch { /* ignore */ }
  }
}

async function connectUpstream() {
  if (upstreamWs || reconnecting) return;
  reconnecting = true;
  
  let cookie;
  try {
    cookie = await getHermesCookie();
  } catch (e) {
    scheduleReconnect();
    return;
  }

  let ticket;
  try {
    ticket = await getWsTicket();
  } catch (e) {
    scheduleReconnect();
    return;
  }

  const key = randomBytes(16).toString("base64");
  // Hermes WS auth: the ticket rides the Sec-WebSocket-Protocol header
  // ("hermes-gateway-ticket.<ticket>" + "hermes-gateway-v1") — a ?ticket=
  // query param is NOT accepted (verified: silent close, no create reply).
  const req = httpRequest(`${HERMES_URL}/api/ws`, {
    headers: {
      "Connection": "Upgrade",
      "Upgrade": "websocket",
      "Sec-WebSocket-Key": key,
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Protocol": `hermes-gateway-ticket.${ticket}, hermes-gateway-v1`,
      "Cookie": cookie
    }
  });

  req.on("upgrade", (res, socket, head) => {
    const wantAccept = generateAcceptKey(key);
    if (res.headers["sec-websocket-accept"] !== wantAccept) {
      socket.destroy();
      scheduleReconnect();
      return;
    }
    if (res.statusCode === 401) {
      socket.destroy();
      clearHermesCookie();
      scheduleReconnect();
      return;
    }
    if (res.headers["upgrade"]?.toLowerCase() !== "websocket") {
      socket.destroy();
      scheduleReconnect();
      return;
    }
    
    upstreamWs = socket;
    reconnecting = false;
    backoffStep = 0;
    wsTicket = null; // single-use
    flushPendingFrames(); // deliver frames the browser sent while we were connecting
    broadcastStatus("online");

    const decoder = new FrameDecoder((frame, isError) => {
      if (isError) {
        socket.destroy();
        return;
      }
      if (frame.opcode === 0x8) {
        socket.destroy();
      } else if (frame.opcode === 0x9) {
        // respond to ping with pong
        try { socket.write(encodeFrame(frame.payload, { opcode: 0xA, masked: true })); } catch {}
      } else {
        broadcastFrame(frame.payload, frame.opcode);
      }
    });

    socket.on("data", chunk => {
      try { decoder.push(chunk); }
      catch (e) { socket.destroy(); }
    });

    socket.on("close", () => {
      upstreamWs = null;
      scheduleReconnect();
    });
    
    socket.on("error", () => {
      upstreamWs = null;
      socket.destroy();
    });
    
    if (head && head.length > 0) decoder.push(head);
  });

  req.on("response", (res) => {
    clearHermesCookie();
    clearWsTicket();
    scheduleReconnect();
  });

  req.on("error", () => {
    scheduleReconnect();
  });

  req.end();
}

function scheduleReconnect() {
  if (reconnecting && upstreamWs) return;
  reconnecting = true;
  upstreamWs = null;
  broadcastStatus("reconnecting");
  const delay = BACKOFF_TABLE[Math.min(backoffStep, BACKOFF_TABLE.length - 1)];
  backoffStep++;
  setTimeout(() => {
    reconnecting = false;
    connectUpstream();
  }, delay);
}

// Called by server.js on upgrade
export function handleWsUpgrade(req, socket, head) {
  const key = req.headers["sec-websocket-key"];
  const accept = generateAcceptKey(key);
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  
  browserSockets.add(socket);
  connectUpstream();
  
  if (reconnecting) {
    // let them know right away
    const msg = JSON.stringify({ method: "event", params: { type: "proxy.status", payload: { state: "reconnecting" } } });
    try { socket.write(encodeFrame(msg, { opcode: 0x1, masked: false })); } catch {}
  } else if (upstreamWs) {
    const msg = JSON.stringify({ method: "event", params: { type: "proxy.status", payload: { state: "online" } } });
    try { socket.write(encodeFrame(msg, { opcode: 0x1, masked: false })); } catch {}
  }

  const decoder = new FrameDecoder((frame, isError) => {
    if (isError) {
      socket.destroy();
      return;
    }
    if (frame.opcode === 0x8) {
      socket.destroy();
    } else if (frame.opcode === 0x9) {
      try { socket.write(encodeFrame(frame.payload, { opcode: 0xA, masked: false })); } catch {}
    } else if (frame.opcode === 0x1) {
      // forward to upstream if connected, else buffer until it is
      if (!forwardToUpstream(frame.payload)) {
        bufferBrowserFrame(frame.payload);
      }
    }
  });

  socket.on("data", chunk => {
    try { decoder.push(chunk); } catch { socket.destroy(); }
  });

  socket.on("close", () => {
    browserSockets.delete(socket);
  });
  
  socket.on("error", () => {
    socket.destroy();
  });
  
  if (head && head.length > 0) decoder.push(head);
}
