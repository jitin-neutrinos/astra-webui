import { handleSysinfo } from "./sysinfo.mjs";
// astra-webui server: static dist + password-only auth API. ponytail: one file, zero deps.
import { createServer, request } from "node:http";
import { handleHxProxy, handleWsUpgrade, forwardToUpstream, broadcastFrame, hermesCookieOrNull } from "./hermes-proxy.mjs";
import { getPendingGate, markGateAnswered, listGates, gateStats, answerGateHelper } from "./ntfy-notify.mjs";
import { handleTranscode } from "./transcode.mjs";
import { listVault, vaultValues, vaultDevices, VAULT_TTL, vaultSign, vaultVerify } from "./vault.mjs";
import { allMarks, readStateVersion } from "./read-state.mjs";
import {
  startEndSession, startTrainingSweeper, setGatewayCookieProvider,
  listTrainingSessions, getTrainingSession, listReviewJobs,
} from "./training.mjs";

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { readFile, stat, appendFile, mkdir } from "node:fs/promises";
import { join, extname, resolve, sep, normalize } from "node:path";
import { clearHermesCookie } from "./hermes-proxy.mjs";
import { handleBgUpload, handleBgServe } from "./theme-assets.mjs";
import { handleThemeState } from "./theme-sync.mjs";

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
const VCOOKIE = "astra_vault";
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
    req.on("data", (chunk) => { data += chunk; if (data.length > 16384) req.destroy(); });
    req.on("end", () => resolveBody(data));
    req.on("error", () => resolveBody(""));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  const ip = req.headers["cf-connecting-ip"] || req.socket.remoteAddress || "?";

  // Phone pop-up gate API. Auth = the ntfy credential the app already holds
  // (Authorization header == NTFY_AUTH), constant-time compared; not cookie-based.
  const gm = path.match(/^\/api\/gate\/([A-Za-z0-9_.:-]{1,80})$/);
  if (gm) {
    const want = Buffer.from(process.env.NTFY_AUTH || "\0");
    const got = Buffer.from(String(req.headers.authorization || ""));
    if (!process.env.NTFY_AUTH || got.length !== want.length || !timingSafeEqual(got, want)) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":"unauthorized"}');
    }
    const g = getPendingGate(gm[1]);
    if (!g) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":"gone"}'); }
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(g));
    }
    if (req.method === "POST") {
      if (g.answered) { res.writeHead(409, { "content-type": "application/json" }); return res.end('{"error":"already answered"}'); }
      let b = {};
      try { b = JSON.parse(await readBody(req)); } catch { /* bad */ }
      
      const ah = answerGateHelper(g, b, "phone");
      if (ah.error) { res.writeHead(ah.status, { "content-type": "application/json" }); return res.end(`{"error":"${ah.error}"}`); }
      
      const sent = forwardToUpstream(Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: g.id, result: ah.result })));
      if (!sent) { res.writeHead(503, { "content-type": "application/json" }); return res.end('{"error":"gateway offline"}'); }
      try {
        broadcastFrame(Buffer.from(JSON.stringify({ method: "event", params: { type: "request.answered",
          payload: { id: g.id, kind: g.kind, by: "phone", result: ah.result } } })), 0x1);
      } catch { /* best effort */ }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('{"ok":true}');
    }
    res.writeHead(405); return res.end();
  }

  if (path === "/api/gates" && req.method === "GET") {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    if (!validToken(cookies[COOKIE])) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":"unauthenticated"}');
    }
    const searchParams = url.searchParams;
    const kind = searchParams.get("kind") || "";
    const limit = parseInt(searchParams.get("limit") || "200", 10);
    const gates = await listGates({ kind, limit });
    const stats = await gateStats();
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ gates, stats }));
  }

  const gma = path.match(/^\/api\/gates\/([A-Za-z0-9_.:-]{1,80})\/answer$/);
  if (gma && req.method === "POST") {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    if (!validToken(cookies[COOKIE])) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":"unauthenticated"}');
    }
    const g = getPendingGate(gma[1]);
    if (!g) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":"gone"}'); }
    if (g.answered) { res.writeHead(409, { "content-type": "application/json" }); return res.end('{"error":"already answered"}'); }
    let b = {};
    try { b = JSON.parse(await readBody(req)); } catch { /* bad */ }
    
    const ah = answerGateHelper(g, b, "web");
    if (ah.error) { res.writeHead(ah.status, { "content-type": "application/json" }); return res.end(`{"error":"${ah.error}"}`); }
    
    const sent = forwardToUpstream(Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: g.id, result: ah.result })));
    if (!sent) { res.writeHead(503, { "content-type": "application/json" }); return res.end('{"error":"gateway offline"}'); }
    try {
      broadcastFrame(Buffer.from(JSON.stringify({ method: "event", params: { type: "request.answered",
        payload: { id: g.id, kind: g.kind, by: "web", result: ah.result } } })), 0x1);
    } catch { /* best effort */ }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end('{"ok":true}');
  }

  // Native-shell layout telemetry (what the phone ACTUALLY measures). Cookie-authed, append-only, tiny.
  if (path === "/api/diag" && req.method === "POST") {
    const ck = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) ck[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    if (!validToken(ck[COOKIE])) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":"unauthenticated"}');
    }
    try {
      const body = JSON.parse(await readBody(req));
      const dir = join(process.env.HOME || ".", ".hermes/cache/scratch");
      await mkdir(dir, { recursive: true });
      await appendFile(join(dir, "astra-diag.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...body }) + "\n");
    } catch { /* ignore bad payloads */ }
    res.writeHead(204);
    return res.end();
  }

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

  // --- vault: re-gated env-var registry (auth on EVERY visit — the vault
  // cookie is short-lived (10 min) and minted ONLY by re-verifying the same
  // password as login; GETs never refresh it, so every reload/revisit
  // re-challenges). Values are AES-256-GCM encrypted at rest in the registry.
  const vcookies = () => {
    const ck = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) ck[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    return ck;
  };
  const sessionOk = () => validToken(vcookies()[COOKIE]);
  const vaultUnlocked = () => {
    const ck = vcookies();
    return validToken(ck[COOKIE]) && vaultVerify(SECRET, ck[VCOOKIE]);
  };
  const vjson = (code, obj, headers) => {
    res.writeHead(code, { "content-type": "application/json", ...(headers || {}) });
    return res.end(JSON.stringify(obj));
  };

  if (path === "/api/vault/status") {
    if (!sessionOk()) return vjson(401, { error: "unauthenticated" });
    const list = await listVault();
    return vjson(200, { unlocked: vaultUnlocked(), ttlMs: VAULT_TTL, ...(list.ok ? { entries: list.entries.length } : { registry: false }) });
  }

  if (path === "/api/vault/unlock" && req.method === "POST") {
    if (!sessionOk()) return vjson(401, { error: "unauthenticated" });
    if (rateLimited(ip)) return vjson(429, { ok: false, error: "Too many attempts. Wait 10 minutes." });
    let password = "";
    try { password = JSON.parse(await readBody(req)).password ?? ""; } catch { /* treat as bad */ }
    if (!checkPassword(password)) return vjson(401, { ok: false, error: "Access denied. Invalid security key." });
    attempts.delete(ip);
    const exp = String(Date.now() + VAULT_TTL);
    const token = `${exp}.${vaultSign(SECRET, exp)}`;
    return vjson(200, { ok: true, ttlMs: VAULT_TTL }, {
      "set-cookie": `${VCOOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(VAULT_TTL / 1000)}`,
    });
  }

  if (path === "/api/vault/lock" && req.method === "POST") {
    if (!sessionOk()) return vjson(401, { error: "unauthenticated" });
    return vjson(200, { ok: true }, { "set-cookie": `${VCOOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0` });
  }

  if (path === "/api/vault/entries") {
    if (!vaultUnlocked()) return vjson(403, { error: "vault locked" });
    const list = await listVault();
    if (!list.ok) return vjson(500, { error: list.error });
    return vjson(200, list);
  }

  if (path === "/api/vault/values") {
    if (!vaultUnlocked()) return vjson(403, { error: "vault locked" });
    const vals = await vaultValues();
    if (!vals.ok) return vjson(500, { error: vals.error });
    return vjson(200, vals);
  }

  if (path === "/api/vault/devices") {
    if (!vaultUnlocked()) return vjson(403, { error: "vault locked" });
    const dev = await vaultDevices();
    if (!dev.ok) return vjson(500, { error: dev.error });
    return vjson(200, dev);
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

  // Push config for the native shells (Android app). Authenticated like every
  // other API; hands the ntfy topic + auth so the phone can subscribe without
  // the secret being bundled into the APK.
  if (path === "/api/ntfy-config") {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    if (!validToken(cookies[COOKIE])) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":"unauthenticated"}');
    }
    const nurl = process.env.NTFY_URL || "";
    const ntopic = process.env.NTFY_TOPIC || "";
    const nauth = process.env.NTFY_AUTH || "";
    if (!nurl || !ntopic) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('{"enabled":false}');
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ enabled: true, url: nurl, topic: ntopic, auth: nauth.replace(/^Basic\s+/i, "") }));
  }

  if (path === "/api/training/end-session" && req.method === "POST") {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    if (!validToken(cookies[COOKIE])) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":"unauthenticated"}');
    }
    let body = {};
    try { body = JSON.parse(await readBody(req)); } catch { /* treated as empty */ }
    const sid = typeof body.sid === "string" ? body.sid : "";
    if (!/^[A-Za-z0-9_-]+$/.test(sid)) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end('{"error":"sid required"}');
    }
    try {
      const { job, conflict } = startEndSession(sid, body.title ?? null, body.source ?? null);
      if (conflict) {
        res.writeHead(409, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "already active", job }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, job }));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // Retrieval contract (R6): transcripts live forever in the training DB.
  if (path === "/api/training/sessions" && req.method === "GET") {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    if (!validToken(cookies[COOKIE])) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":"unauthenticated"}');
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ sessions: listTrainingSessions(), jobs: listReviewJobs() }));
  }

  if (path === "/api/training/jobs" && req.method === "GET") {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    if (!validToken(cookies[COOKIE])) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":"unauthenticated"}');
    }
    const limit = Math.min(Number(new URL(req.url, "http://x").searchParams.get("limit")) || 20, 100);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ jobs: listReviewJobs(limit) }));
  }

  const trainingDetail = path.match(/^\/api\/training\/sessions\/([A-Za-z0-9_-]+)$/);
  if (trainingDetail && req.method === "GET") {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    if (!validToken(cookies[COOKIE])) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":"unauthenticated"}');
    }
    const detail = getTrainingSession(trainingDetail[1]);
    if (!detail) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end('{"error":"not found"}');
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(detail));
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

  if (path.startsWith("/api/sysinfo/")) {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => { const i = c.indexOf("="); if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim(); });
    if (!validToken(cookies[COOKIE])) { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":"unauthenticated"}'); }
    try { return await handleSysinfo(req, res, path); }
    catch (err) { console.error("[sysinfo]", err?.message || err); if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end('{"error":"sysinfo failed"}'); } }
  }

  if (path === "/api/media/transcode") {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); return res.end(); }
    // handleTranscode authenticates FIRST (astra_session cookie) — 401 before any path is read.
    return handleTranscode(req, res, validToken).catch((err) => {
      console.error("[transcode]", err?.message || err);
      if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end('{"error":"transcode failed"}'); }
      else res.destroy();
    });
  }

  if (path === "/api/read-state") {
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); return res.end(); }
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    if (!validToken(cookies[COOKIE])) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":"unauthenticated"}');
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ marks: allMarks(), v: readStateVersion() }));
  }

  if (path === "/api/theme/state") {
    try { return await handleThemeState(req, res, validToken); }
    catch (err) {
      console.error("[theme-sync]", err?.message || err);
      if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end('{"error":"theme state failed"}'); }
    }
  }

  if (path === "/api/theme/bg" || path.startsWith("/api/theme/bg/")) {
    if (path === "/api/theme/bg") return handleBgUpload(req, res, validToken);
    const name = path.slice("/api/theme/bg/".length);
    try { return await handleBgServe(req, res, validToken, name); }
    catch (err) {
      console.error("[theme-bg]", err?.message || err);
      if (!res.headersSent) { res.writeHead(500, { "content-type": "application/json" }); res.end('{"error":"bg serve failed"}'); }
    }
  }

  if (path.startsWith("/api/hx/session-info/")) {
    const cookies = {};
    (req.headers.cookie || "").split(";").forEach((c) => {
      const i = c.indexOf("=");
      if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
    });
    if (!validToken(cookies[COOKIE])) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end('{"error":"unauthenticated"}');
    }
    req.url = req.url.replace("/api/hx/session-info/", "/api/hx/sessions/");
    return handleHxProxy(req, res);
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

// Training pipeline: wire the gateway-cookie provider, then start the sweeper
// (retries due jobs, resumes ones a restart interrupted). DB opens lazily.
setGatewayCookieProvider(hermesCookieOrNull);
startTrainingSweeper();

server.listen(PORT, "127.0.0.1", () => console.log(`astra-webui listening on 127.0.0.1:${PORT}`));
