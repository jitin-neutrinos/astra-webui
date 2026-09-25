// astra-webui server: static dist + password-only auth API. ponytail: one file, zero deps.
import { createServer, request } from "node:http";
import { handleHxProxy, handleWsUpgrade } from "./hermes-proxy.mjs";

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve, sep, normalize } from "node:path";

const HERMES_PASSWORD = process.env.ASTRA_HERMES_PASSWORD;
if (!HERMES_PASSWORD) {
  console.error("astra-webui: ASTRA_HERMES_PASSWORD not set; refusing to start.");
  process.exit(1);
}
const PASSWORD = process.env.ASTRA_WEBUI_PASSWORD;
if (!PASSWORD) {
  console.error("astra-webui: ASTRA_WEBUI_PASSWORD not set; refusing to start.");
  process.exit(1);
}
const SECRET = process.env.ASTRA_WEBUI_SECRET || randomBytes(32).toString("hex");
const PORT = Number(process.env.ASTRA_WEBUI_PORT || 3011);
const DIST = resolve(import.meta.dirname, "..", "dist");
const COOKIE = "astra_session";
const TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days ("maintain persistent uplink")

// --- auth (mirrors the dashboard login: server-side verify + HttpOnly session cookie) ---
function sign(payload) {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}
function makeToken() {
  const exp = String(Date.now() + TTL_MS);
  return `${exp}.${sign(exp)}`;
}
function validToken(token) {
  if (typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const exp = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(exp));
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return false;
  return Number(exp) > Date.now();
}
function checkPassword(candidate) {
  // ponytail: hash both sides so lengths never leak through timingSafeEqual
  const a = createHmac("sha256", "astra-webui").update(String(candidate ?? "")).digest();
  const b = createHmac("sha256", "astra-webui").update(PASSWORD).digest();
  return timingSafeEqual(a, b);
}

// --- rate limit: 8 attempts / 10 min / IP (CF-Connecting-IP behind the tunnel) ---
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const attempts = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_ATTEMPTS) { attempts.set(ip, list); return true; }
  list.push(now);
  attempts.set(ip, list);
  return false;
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".json": "application/json", ".map": "application/json",
};

function readBody(req) {
  return new Promise((resolveBody) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; if (data.length > 1024) req.destroy(); });
    req.on("end", () => resolveBody(data));
    req.on("error", () => resolveBody(""));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  const ip = req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "?";

  if (path === "/api/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"ok":true}');
  }

  if (path === "/api/login" && req.method === "POST") {
    if (rateLimited(ip)) {
      res.writeHead(429, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Too many attempts. Wait 10 minutes." }));
    }
    let password = "";
    try { password = JSON.parse(await readBody(req)).password ?? ""; } catch { /* treat as bad */ }
    if (!checkPassword(password)) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Access denied. Invalid security key." }));
    }
    attempts.delete(ip);
    res.setHeader("set-cookie",
      `${COOKIE}=${makeToken()}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${TTL_MS / 1000}`);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"ok":true}');
  }

  if (path === "/api/chat" && req.method === "POST") {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    if (!validToken(cookies[COOKIE])) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":"unauthenticated"}');
    }
    let message = "";
    try { message = String(JSON.parse(await readBody(req)).message || ""); } catch { /* empty */ }
    // ponytail: echo responder until the Hermes backend lands
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      reply: message
        ? `Uplink acknowledged: "${message}". Agent backend not wired yet — this channel is scaffolded for Hermes.`
        : "Empty transmission received.",
    }));
  }

  if (path === "/api/logout" && req.method === "POST") {
    res.setHeader("set-cookie", `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"ok":true}');
  }

  if (path === "/api/me") {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    const ok = validToken(cookies[COOKIE]);
    res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ authenticated: ok }));
  }

  if (path.startsWith("/api/beacon/")) {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    if (!validToken(cookies[COOKIE])) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":"unauthenticated"}');
    }
    const targetUrl = new URL(req.url.replace("/api/beacon/", "/api/"), "http://127.0.0.1:8789");
    const proxyReq = request(targetUrl, {
      method: req.method,
      headers: { ...req.headers, host: targetUrl.host },
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on("error", () => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end('{"error":"tokenbeacon unreachable"}');
    });
    req.pipe(proxyReq);
    return;
  }

  if (path.startsWith("/api/hx/")) {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    if (!validToken(cookies[COOKIE])) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":"unauthenticated"}');
    }
    return handleHxProxy(req, res);
  }

  if (path.startsWith("/api/")) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end('{"error":"not found"}');
  }

  // --- static dist, SPA fallback ---
  let file = join(DIST, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, "index.html");
  } catch {
    file = join(DIST, "index.html"); // SPA fallback
  }
  if (!file.startsWith(DIST + sep) && file !== join(DIST, "index.html")) {
    res.writeHead(403); return res.end();
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file)] || "application/octet-stream",
      "cache-control": file.includes(`${sep}assets${sep}`) ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});


server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/hx/ws") {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    if (!validToken(cookies[COOKIE])) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.destroy();
      return;
    }
    handleWsUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`astra-webui listening on 127.0.0.1:${PORT}`));
