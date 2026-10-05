import { request as httpRequest } from "node:http";
import { claim as claimUserMessageKey, sweep as sweepDedupeKeys, bindStoredForLive } from "./message-dedupe.mjs";
import { recordEvent as recordStreamEvent, flushNow as flushStreamLog, closeStreamDb } from "./stream-log.mjs";
import { handleStreamRoutes } from "./stream-routes.mjs";
import { handleSessionTitle } from "./session-title.mjs";
import { trimHistoryPayload } from "./history-trim.mjs";
import { startRetentionSweeper } from "./retention.mjs";
import { randomBytes } from "node:crypto";
import { generateAcceptKey, encodeFrame, FrameDecoder } from "./ws-codec.mjs";

import { notifyGateRequest, noteWebChatAnswer } from "./ntfy-notify.mjs";
import { markRead, getMark, enrichSessions } from "./read-state.mjs";
import { enrichLastReplies } from "./last-reply.mjs";
import { getCommandRegistry } from "./command-registry.mjs";

const HERMES_URL = "http://127.0.0.1:9119";
const PASSWORD = process.env.ASTRA_HERMES_PASSWORD;

/**
 * Resolve one session's TITLE from the gateway's session list (RCA fix 2).
 *
 * The list is the cheap endpoint: it carries titles for every session and is
 * already fetched by the app on open. The expensive one — /api/sessions/<sid> —
 * returns 154 KiB, of which 153 KiB are system_prompt and tool_names that no
 * client ever reads. This exists so the header can show a title without paying
 * that cost on every chat open.
 *
 * A short memo avoids re-fetching the list when two surfaces ask for titles in
 * the same moment. It is deliberately tiny and time-boxed; on a miss it simply
 * re-fetches, so a stale memo can never show a wrong title.
 *
 * Strategy, cheapest first:
 *   1. The session LIST (limit=100 — the gateway 422s above 100, measured) when
 *      the session is among the newest hundred. The list is already being fetched
 *      by the app on open, so this is usually free.
 *   2. Otherwise the single-session endpoint, whose 154 KiB stays on the loopback
 *      and never crosses the tunnel. Necessary because the account has 621
 *      sessions: a 100-row list cannot see an older one, and returning null there
 *      would blank the header on exactly the chats most likely to be reopened.
 */
const TITLE_MEMO_MS = 1500;
let titleMemo = { at: 0, rows: null };

function gatewayGetJson(path, cookie) {
  return new Promise((resolve, reject) => {
    const r = httpRequest(`${HERMES_URL}${path}`, { headers: { Cookie: cookie } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        // A non-2xx must not throw into the caller: resolve to null and let the
        // route degrade to a title-less answer.
        if (res.statusCode && res.statusCode >= 400) { resolve(null); return; }
        try { resolve(JSON.parse(raw || "{}")); } catch { resolve(null); }
      });
      res.on("error", reject);
    });
    r.on("error", reject);
    r.end();
  });
}

async function gatewaySessionTitle(sid) {
  const now = Date.now();
  const cookie = await getHermesCookie();

  if (!titleMemo.rows || now - titleMemo.at > TITLE_MEMO_MS) {
    // limit=100 is the gateway's ceiling (measured: 200 -> 422).
    const data = await gatewayGetJson("/api/sessions?limit=100&order=recent", cookie);
    titleMemo = {
      at: now,
      rows: Array.isArray(data?.sessions) ? data.sessions.slice() : [],
    };
  }
  const hit = titleMemo.rows.find((r) => String(r?.id || r?.session_id || "") === String(sid));
  if (hit) return hit?.title ?? null;

  // Older than the newest hundred — ask for that one session directly.
  const one = await gatewayGetJson(`/api/sessions/${encodeURIComponent(sid)}`, cookie);
  if (one && typeof one === "object" && one.title) {
    // Cache it so a second surface asking in the same window is free.
    titleMemo.rows.push(one);
  }
  return one?.title ?? null;
}

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

// Cookie access for sibling modules (training worker): reuse the proxy's login
// cache/reauth instead of a parallel login path that could race or diverge.
// Errors are LOGGED, not swallowed — a silent null sent a training worker into
// a 401 loop that took a full debug session to trace (2026-10-01).
export async function hermesCookieOrNull() {
  try { return await getHermesCookie(); } catch (e) {
    console.error("[training] gateway cookie unavailable:", e && e.message);
    return null;
  }
}

// Public re-export of the internal clear (training's 401-retry path needs it).
export { clearHermesCookie };

// REST Proxy
export async function handleHxProxy(req, res) {
  // path prefix is /api/hx. Map to /api/...
  let targetPath = req.url.replace(/^\/api\/hx/, "/api");

  // ---- title-only session lookup (RCA fix 2, 2026-10-05) ----
  // The client's title fetch used /api/hx/sessions/<sid>, which returns the whole
  // session record: 61 keys, 154 KiB, of which 153 KiB are system_prompt (90.8)
  // and tool_names (62.7) — neither is read by any client. This returns tens of
  // bytes. Auth is applied by the caller before this runs.
  if (req.method === "GET" && req.url.startsWith("/api/hx/session-title/")) {
    try {
      const u = new URL(req.url, "http://x");
      if (await handleSessionTitle(req, res, u, (sid) => gatewaySessionTitle(sid))) return;
    } catch (e) {
      console.error("[session-title] failed:", e?.message || e);
      try {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ title: null, error: "title unavailable" }));
      } catch { /* client gone */ }
      return;
    }
  }

  // ---- durable stream-log reads (Phase 3) ----
  // Served from Astra's own disk, never forwarded: the gateway has no such
  // route and cannot resume a stream (its ring is in-process memory, and the
  // HTTP stream route emits no `id:` line so Last-Event-ID is impossible).
  // Placed FIRST so it wins before the generic forwarding below. Auth is applied
  // by the caller (server.mjs) before this runs.
  try {
    if (req.url.startsWith("/api/hx/stream")) {
      const u = new URL(req.url, "http://x");
      if (await handleStreamRoutes(req, res, u)) return;
    }
  } catch (e) {
    console.error("[stream-routes] failed:", e?.message || e);
    try {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ events: [], truncated: true, error: "stream log unavailable" }));
    } catch { /* client gone */ }
    return;
  }

  // ---- live slash-command registry (dynamic command palette, 2026-10-02) ----
  // Served from the upstream Hermes CLI registry, never forwarded: the gateway
  // has no such route, so without this the palette would 404 and fall back to
  // a hardcoded list that drifts on every `hermes update`.
  if (req.method === "GET" && /^\/api\/hx\/commands\/?(\?|$)/.test(req.url)) {
    const { commands, source } = await getCommandRegistry();
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ commands, source, count: commands.length }));
    return;
  }

  // ---- read-marker intercepts (cross-device unread, 2026-10-01) ----
  // PATCH /api/hx/sessions/<storedKey> {unread:false} → stamp watermark locally
  // (gateway ignores the field), broadcast session.read, never forward upstream.
  const readPatch = req.method === "PATCH" && /^\/api\/hx\/sessions\/[^/]+$/.test(req.url);
  if (readPatch) {
    let body = "";
    for await (const c of req) body += c;
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* empty body: still a no-op read */ }
    if (parsed && parsed.unread === false) {
      // /api/hx/sessions/<storedKey> → ["", "api", "hx", "sessions", "<key>"]
      const storedKey = decodeURIComponent(new URL(req.url, "http://x").pathname.split("/")[4] || "");
      const rec = markRead(storedKey);
      if (rec) {
        broadcastSessionRead(storedKey, rec.last_read_at, deviceFromUrl(req));
      }
      // ALSO keep the gateway's own native watermark fresh (it tracks unread too;
      // other consumers may read it) — response discarded, never touches res.
      void forwardRestOnly(targetPath, Buffer.from(body)).catch(() => {});
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, last_read_at: rec ? rec.last_read_at : (getMark(storedKey)?.last_read_at ?? null) }));
      return;
    }
    // other PATCH bodies (pin/rename): replay upstream with the buffered body
    return proxyRest(req, res, targetPath, Buffer.from(body));
  }
  await proxyRest(req, res, targetPath, null, true);
}

function deviceFromUrl(req) {
  // ?device=<surface> from the client (webui tab / android / ipad) — advisory only.
  try {
    return new URL(req.url, "http://x").searchParams.get("device") || null;
  } catch { return null; }
}

/** Fire-and-forget upstream REST call whose response is discarded (keeps the
 *  gateway's native read watermark in sync without touching our response). */
async function forwardRestOnly(targetPath, bodyBuf) {
  const cookie = await getHermesCookie();
  await new Promise((resolve, reject) => {
    const req = httpRequest(`${HERMES_URL}${targetPath}`, {
      method: "PATCH",
      headers: { "Cookie": cookie, "content-type": "application/json", "content-length": String(bodyBuf.length) }
    }, (res) => { res.resume(); resolve(); });
    req.on("error", reject);
    req.end(bodyBuf);
  });
}

function proxyRest(req, res, targetPath, replayBody, enrich = false) {
  return new Promise(async (resolve) => {
    let cookie;
    try {
      cookie = await getHermesCookie();
    } catch (err) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return resolve();
    }

    // targetPath carries the query string — match routes on pathname only.
    let pathOnly = targetPath;
    try { pathOnly = new URL(targetPath, "http://x").pathname; } catch { /* keep raw */ }
    const isSessionsList = enrich && req.method === "GET" && /^\/api\/sessions\/?$/.test(pathOnly);
    const isSearch = enrich && req.method === "GET" && /^\/api\/sessions\/search/.test(pathOnly);

    const doReq = (pipeBody, bodyBuf) => new Promise((resolve2, reject) => {
      const headers = { "Cookie": cookie };
      if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
      if (bodyBuf) {
        headers["content-length"] = String(bodyBuf.length);
      } else if (req.headers["content-length"]) {
        headers["content-length"] = req.headers["content-length"];
      }
      if (req.headers["range"]) headers["range"] = req.headers["range"];
      const proxyReq = httpRequest(`${HERMES_URL}${targetPath}`, {
        method: req.method,
        headers
      }, resolve2);
      proxyReq.on("error", reject);
      if (bodyBuf) {
        proxyReq.end(bodyBuf);
      } else if (pipeBody) {
        req.pipe(proxyReq);
      } else {
        proxyReq.end();
      }
    });

    try {
      // Pipe the body whenever the request can carry one. A multipart upload
      // arrives CHUNKED (XHR/FormData sets no Content-Length), so if we forward
      // headers without piping, the upstream waits forever for a body that never
      // arrives — the request hangs until the client gives up. That was the
      // upload failure on BOTH web and android (same JS path).
      const mayHaveBody = req.method !== "GET" && req.method !== "HEAD";
      let proxyRes = await doReq(mayHaveBody && !replayBody, replayBody);
      if (proxyRes.statusCode === 401) {
        clearHermesCookie();
        if (replayBody) {
          res.writeHead(503, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "reauth" }));
          return resolve();
        }
        cookie = await getHermesCookie();
        proxyRes = await doReq(true, null);
      }

      // History page: buffer, strip fields the client never reads, re-serialize
      // (RCA fix 3, 2026-10-05). Saves ~20 KB per 100-row page.
      //
      // The URL is matched up to the QUERY STRING, not end-anchored. Every real
      // history request carries one (`?order=latest&limit=100&offset=0`), so a
      // `$`-anchored pattern never matches and the trim silently does nothing —
      // which is exactly what happened before this was caught by a live check
      // rather than by the unit test.
      const isHistoryPage =
        req.method === "GET" && /^\/api\/hx\/sessions\/[^/]+\/messages\/?(\?|$)/.test(req.url);
      if (isHistoryPage && proxyRes.statusCode === 200) {
        const chunks = [];
        for await (const c of proxyRes) chunks.push(c);
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const trimmed = trimHistoryPayload(data);
          const body = Buffer.from(JSON.stringify(trimmed.payload));
          res.writeHead(200, {
            "content-type": "application/json",
            "content-length": String(body.length),
          });
          res.end(body);
          return resolve();
        } catch (e) {
          console.error("[history-trim] re-serialize failed, passing through:", e?.message || e);
          const raw = Buffer.concat(chunks);
          res.writeHead(200, {
            "content-type": "application/json",
            "content-length": String(raw.length),
          });
          res.end(raw);
          return resolve();
        }
      }

      // Sessions list/search: buffer, enrich with read markers, re-serialize.
      if ((isSessionsList || isSearch) && proxyRes.statusCode === 200) {
        const chunks = [];
        for await (const c of proxyRes) chunks.push(c);
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const rows = data.sessions || data.results || null;
          if (Array.isArray(rows)) {
            enrichSessions(rows);
            // Sidebar wants the LATEST response, not the gateway's first-user-message
            // preview. Cached per session + invalidated by activity (see last-reply.mjs).
            // Reuses the cookie this request already authenticated with.
            await enrichLastReplies(rows, { cookie });
            const out = JSON.stringify(data);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(out);
            return resolve();
          }
        } catch (err) {
          // Never silent: a swallowed throw here ships a half-enriched row set
          // (this exact bug — a bad import — looked like "feature just doesn't fire").
          console.error("[hx] sessions enrich failed, serving raw rows:", err?.message || err);
          /* fall through raw */
        }
        const raw = Buffer.concat(chunks);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(raw);
        return resolve();
      }

      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
      resolve();
    } catch (err) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "proxy connect error" }));
      resolve();
    }
  });
}

/** Broadcast a session.read event to every connected client (all legs). */
function broadcastSessionRead(storedKey, lastReadAt, device = null) {
  const msg = JSON.stringify({
    method: "event",
    params: {
      type: "session.read",
      session_id: storedKey,
      payload: { stored_session_id: storedKey, last_read_at: lastReadAt, ...(device ? { device } : {}) }
    }
  });
  const frame = encodeFrame(msg, { opcode: 0x1, masked: false });
  for (const s of browserSockets.keys()) {
    try { s.write(frame); } catch { /* error handler destroys */ }
  }
  // recovery ring: remember so late/reconnecting clients catch up (no history gap)
  pushReadEvent(storedKey, lastReadAt, device);
}

// ---------------------------------------------------------------------------
// Centrifugo-style extras (ported, self-hosted, zero new services):
//   presence  — who's connected (surface + focused chat), join/leave events
//   recovery  — bounded ring buffer of session.read + presence events; a socket
//               reconnecting with ?since=<version> gets ONLY what it missed
//               (Centrifugo's history/recovery model, one buffer, no Redis).
// ---------------------------------------------------------------------------
const presence = new Map(); // socket -> { device, focus, since, joinedAt }
const READ_RING_CAP = 200;
const readRing = []; // { v: readStateVersion, ...event }
let presenceSeq = 0;

function pushReadEvent(storedKey, lastReadAt, device) {
  readRing.push({ v: ++ringVersion, storedKey, lastReadAt, device, at: Date.now() });
  if (readRing.length > READ_RING_CAP) readRing.shift();
}
let ringVersion = 0;

function presenceSnapshot() {
  const byDevice = new Map();
  for (const info of presence.values()) {
    if (!info.device) continue;
    const cur = byDevice.get(info.device) || { device: info.device, focus: null, focuses: new Set(), connections: 0 };
    // A device name covers MANY sockets (every browser tab reports "webui"), and
    // each can be on a different chat. `focus` (last-writer-wins) collapsed them,
    // so a second tab silently erased the first tab's focus and its chat went
    // unread. Collect the full set; `focus` stays for back-compat.
    if (info.focus) { cur.focus = info.focus; cur.focuses.add(info.focus); }
    cur.connections++;
    byDevice.set(info.device, cur);
  }
  return {
    devices: [...byDevice.values()].map((d) => ({ ...d, focuses: [...d.focuses] })),
    count: presence.size,
    v: ++presenceSeq,
  };
}

function broadcastPresence() {
  const snap = presenceSnapshot();
  const msg = JSON.stringify({
    method: "event",
    params: { type: "presence.snapshot", payload: snap }
  });
  const frame = encodeFrame(msg, { opcode: 0x1, masked: false });
  for (const s of browserSockets.keys()) {
    try { s.write(frame); } catch { /* ignore */ }
  }
  return snap;
}

function pushPresenceEvent(kind, device, focus) {
  readRing.push({ v: ++ringVersion, presence: { kind, device, focus }, at: Date.now() });
  if (readRing.length > READ_RING_CAP) readRing.shift();
}

function handleClientInfo(payload, socket) {
  // browser → proxy "client.info" JSON (not an RPC upstream): device + focused chat.
  try {
    const j = typeof payload === "string" ? JSON.parse(payload) : payload;
    const prev = presence.get(socket) || {};
    const entry = {
      device: j?.device || prev.device || null,
      focus: j?.focus !== undefined ? j.focus : prev.focus,
      since: j?.since ?? prev.since ?? null,
      joinedAt: prev.joinedAt || Date.now()
    };
    presence.set(socket, entry);
    // Focus IS a read signal, device-wide (owner mandate): whoever has the chat
    // open has read it, so stamp the shared watermark and let the normal
    // session.read broadcast clear the pill on every other surface. This is the
    // single point that makes "focused anywhere ⇒ read everywhere" true across
    // web/android/tabs — and it survives restart (marks persist to disk).
    // focus===null (switched away) stamps nothing.
    if (j?.focus) {
      const rec = markRead(String(j.focus), undefined, entry.device);
      if (rec) broadcastSessionRead(String(j.focus), rec.last_read_at, entry.device);
    }
    // recovery replay: only events with v > since
    if (entry.since != null) {
      const missed = readRing.filter(e => e.v > entry.since);
      for (const e of missed) {
        const msg = e.storedKey
          ? { method: "event", params: { type: "session.read", session_id: e.storedKey, payload: { stored_session_id: e.storedKey, last_read_at: e.lastReadAt } } }
          : { method: "event", params: { type: "presence.update", payload: e.presence } };
        try { socket.write(encodeFrame(JSON.stringify(msg), { opcode: 0x1, masked: false })); } catch { /* gone */ }
      }
    }
    broadcastPresence();
  } catch { /* malformed client.info: ignore */ }
}

export function presenceInfo() {
  return presenceSnapshot();
}

export function readRingVersion() {
  return ringVersion;
}

// ---------------------------------------------------------------------------
// CONTRACT (multi-client, plan R6b): the proxy never evicts, dedupes or caps
// concurrent sockets per session — every connection is an independent
// broadcast client. The page renders ONLY from frames on its own socket; the
// Android background service consumes frames natively and never injects them
// into the WebView, so two legs of one session can never double-render.
// Sid-tagged sockets (?sid=<session_id> on the upgrade URL — background chat
// leg) get ONLY message.complete / message.error events for that session
// (+ keepalive pings/status), so a backgrounded phone is not woken by every
// broadcast delta. Envelope shape upstream: {method:"event",params:{type,
// session_id,...}} — the filter keys off params.type, NOT msg.method.
const browserSockets = new Map(); // socket -> { sid: string|null, lastPong: number }
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

export function forwardToUpstream(payload) {
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
  for (const s of browserSockets.keys()) {
    try { s.write(frame); } catch { /* ignore */ }
  }
}

// live transport id -> stored session key, learned from session.resume /
// session.create RPC replies relayed through here (the web client's own
// resumes teach it). The Android chat leg consumes the mapping via the
// stored_session_id stamp on message.complete/error frames so its title
// fetch + deep link hit ids the history API can actually resolve.
export const sidMap = new Map();
export function recordSidMapping(liveSid, storedKey) {
  if (liveSid && storedKey && liveSid !== storedKey) {
    sidMap.set(String(liveSid), String(storedKey));
    // Idempotency keys claimed under this live session were recorded with
    // `stored_sid = NULL` (the client only knows the live id). Now that the
    // mapping is known, backfill them so a replay ack names the right chat.
    // Never throws: a dedupe write must not break session bookkeeping.
    try { bindStoredForLive(String(liveSid), String(storedKey)); } catch { /* best effort */ }
  }
}

// Clean shutdown: flush the chunk-log buffer and checkpoint its WAL. Without
// this the last ≤33ms of chunks would sit unwritten, and `closeStreamDb` would be
// an unused export — the exact dead-code trap called out for src/lib/outbox.ts.
// `once` so it cannot double-register; never let it throw on the way out.
if (typeof process !== "undefined" && typeof process.once === "function") {
  process.once("exit", () => { try { closeStreamDb(); } catch { /* best effort */ } });
}

// 14-day retention sweeper (Phase 6). Started HERE rather than in server.mjs
// because server.mjs is shared with other in-flight work; this file is not.
// It runs in DRY-RUN by design — the daily tick reports what it would delete and
// removes nothing until ASTRA_RETENTION_ENABLED=1 is set deliberately.
// Never let a retention failure stop the service from serving chat.
try {
  startRetentionSweeper();
} catch (e) {
  console.error("[retention] sweeper failed to start:", e?.message || e);
}

export function broadcastFrame(payload, opcode) {
  // Durable stream capture (Phase 2, D9). BEFORE the socket write on purpose:
  // the gateway coalesces token deltas at ~30fps and then DISCARDS them, so this
  // is the only durable copy of an interrupted answer. If the socket write below
  // fails, the log still has the chunk.
  //
  // recordEvent never throws and only logs frames that carry the gateway's own
  // per-session `seq`, so this costs a substring test on frames that match and
  // nothing at all on transport chatter.
  if (opcode === 0x1) {
    try {
      const text = payload.toString();
      if (text.includes("message.delta") || text.includes("thinking.delta")
          || text.includes("reasoning.delta") || text.includes("tool.")
          || text.includes("message.complete") || text.includes("message.error")) {
        const msg = JSON.parse(text);
        if (msg && msg.method === "event" && msg.params) recordStreamEvent(msg.params);
      }
    } catch { /* a bad frame is relayed anyway; never break the relay */ }
  }
  let frame = encodeFrame(payload, { opcode, masked: false });
  // Filter leg: only when at least one sid-tagged or filter=complete socket is connected
  // do we pay for a JSON.parse. Untagged sockets are relayed opaquely (unchanged).
  let passForTagged = false;
  let parsedSid = null;
  let anyTagged = false;
  let anyCompleteFilter = false;
  let parsedType = null;
  
  for (const info of browserSockets.values()) {
    if (info.sid) anyTagged = true;
    if (info.filter) anyCompleteFilter = true;
  }
  
  if ((anyTagged || anyCompleteFilter) && opcode === 0x1) {
    try {
      const msg = JSON.parse(payload.toString());
      // RPC replies ride the same relay: session.resume/create results
      // carry {result:{session_id, session_key|stored_session_id}} —
      // record the live→stored mapping whenever one passes through.
      const r = msg && msg.result;
      if (r && r.session_id) {
        const stored = r.session_key || r.stored_session_id;
        if (stored) recordSidMapping(r.session_id, stored);
      }
      // Envelope: {method:"event", params:{type, session_id, payload}}
      const p = msg && msg.params;
      if (p) {
        parsedType = p.type;
        // A turn boundary is the natural flush point: everything buffered for
        // this turn is on disk the moment the turn ends, so a crash seconds
        // later cannot lose the final chunk. Cost: one write per turn.
        if (p.type === "message.complete" || p.type === "message.error") {
          try { flushStreamLog(); } catch { /* never break the relay */ }
        }
        if (p.type === "message.complete" || p.type === "message.error") {
          passForTagged = true;
          parsedSid = p.session_id;
          const stored = sidMap.get(parsedSid);
          if (stored && p.payload && typeof p.payload === "object") {
            p.payload.stored_session_id = stored;
            payload = Buffer.from(JSON.stringify(msg));
            frame = encodeFrame(payload, { opcode, masked: false });
          }
        }
      }
    } catch { /* unparseable: tagged sockets just don't get this frame */ }
  }
  
  for (const [s, info] of browserSockets) {
    if (opcode === 0x1) {
      if (info.sid) {
        if (!passForTagged || parsedSid !== info.sid) continue;
      } else if (info.filter) {
        if (parsedType !== "message.complete" && parsedType !== "message.error") continue;
      }
    }
    try { s.write(frame); } catch { /* error handler destroys the socket */ }
  }
}

// R2: 25s app tick — proves transport liveness to every browser (the client
// treats ANY incoming frame as alive). Cheap enough to never need a reason.
const TICK_MS = 25_000;
const PING_MS = 30_000;
const PING_PAYLOAD = Buffer.from("kp"); // keepalive
let tickTimer = null;
function startTick() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    broadcastStatus("tick");
  }, TICK_MS);
}

// R8: ONE shared 25s interval pings every browser socket and reaps zombies.
// A browser always pongs invisibly; a socket that hasn't ponged since the
// previous round is dead (Doze-killed WebView, gone NAT) — terminate() it so
// the close fires and the slot is reclaimed. The 30s no-pong threshold means
// a socket survives exactly one missed round before eviction.
let pingTimer = null;
function startSharedPingLoop() {
  if (pingTimer) return;
  pingTimer = setInterval(() => {
    const now = Date.now();
    for (const [s, info] of browserSockets) {
      if (now - info.lastPong > 30_000) {
        console.log(`ws-reap peers=${browserSockets.size - 1}${info.sid ? ` sid=${info.sid}` : ""} at=${new Date().toISOString()}`);
        try { s.destroy(); } catch { /* gone */ }
        continue;
      }
      try { s.write(encodeFrame(PING_PAYLOAD, { opcode: 0x9, masked: false })); }
      catch { try { s.destroy(); } catch { /* gone */ } }
    }
  }, PING_MS);
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
      } else if (frame.opcode === 0xA) {
        // R1: unsolicited pongs from upstream are proxy↔gateway bookkeeping —
        // never broadcast to browsers.
      } else {
        // Gate notifications ride the same relay frames (proxy broadcasts every
        // upstream text frame to every browser). Fire-and-forget — never delays
        // the relay or throws.
        // Learn live→stored session ids even when no filtered socket is
        // connected (cheap probe: small frames mentioning session_key only).
        if (frame.payload.length < 8192 && frame.payload.includes("\"session_key\"")) {
          try {
            const r = JSON.parse(frame.payload.toString()).result;
            const stored = r && (r.session_key || r.stored_session_id);
            if (r && r.session_id && stored) recordSidMapping(r.session_id, stored);
          } catch { /* not an RPC reply */ }
        }
        // Gate deep links must carry the STORED session key — the live transport
        // sid 404s in /api/hx ("unable to load history"). Same fix class as the
        // v1.8.0 sid-bridge: consult sidMap before the click URL is minted.
        try { notifyGateRequest(frame.payload, { resolveSid: (live) => sidMap.get(String(live || "")) || null }); } catch { /* never throws */ }
        broadcastFrame(frame.payload, frame.opcode);
      }
    });

    socket.on("data", chunk => {
      try { decoder.push(chunk); }
      catch (e) { socket.destroy(); }
    });

    // R1: keep the CF tunnel from idle-killing the upstream leg too.
    const upstreamPing = setInterval(() => {
      try { socket.write(encodeFrame(PING_PAYLOAD, { opcode: 0x9, masked: true })); }
      catch { clearInterval(upstreamPing); }
    }, PING_MS);

    socket.on("close", () => {
      clearInterval(upstreamPing);
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
  const url = new URL(req.url, "http://x");
  const sid = url.searchParams.get("sid") || null; // ?sid= → filtered background leg
  const filterComplete = url.searchParams.get("filter") === "complete";
  const info = { sid, filter: filterComplete, lastPong: Date.now() };
  const since = url.searchParams.get("since");
  const device = url.searchParams.get("device") || null;
  
  const key = req.headers["sec-websocket-key"];
  const accept = generateAcceptKey(key);
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  
  browserSockets.set(socket, info);
  // presence + recovery registration (join)
  presence.set(socket, { device, focus: sid, since: since ? Number(since) : null, joinedAt: Date.now() });
  if (device) pushPresenceEvent("join", device, sid);
  console.log(`ws-open peers=${browserSockets.size}${sid ? ` sid=${sid}` : ""} at=${new Date().toISOString()}`);
  connectUpstream();
  startTick(); // R2: global 25s liveness broadcast
  startSharedPingLoop(); // R1: shared pings + zombie reap, keeps CF tunnel alive on every leg
  
  // recovery replay on (re)connect: everything newer than ?since=
  if (since != null && !Number.isNaN(Number(since))) {
    const missed = readRing.filter(e => e.v > Number(since));
    for (const e of missed) {
      const msg = e.storedKey
        ? { method: "event", params: { type: "session.read", session_id: e.storedKey, payload: { stored_session_id: e.storedKey, last_read_at: e.lastReadAt } } }
        : { method: "event", params: { type: "presence.update", payload: e.presence } };
      try { socket.write(encodeFrame(JSON.stringify(msg), { opcode: 0x1, masked: false })); } catch { /* gone */ }
    }
    // catch-up snapshot so the joiner also sees who's here now
    try { socket.write(encodeFrame(JSON.stringify({ method: "event", params: { type: "presence.snapshot", payload: presenceSnapshot() } }), { opcode: 0x1, masked: false })); } catch { /* gone */ }
  }
  if (device) broadcastPresence();
  
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
    } else if (frame.opcode === 0xA) {
      info.lastPong = Date.now();
    } else if (frame.opcode === 0x9) {
      try { socket.write(encodeFrame(frame.payload, { opcode: 0xA, masked: false })); } catch {}
    } else if (frame.opcode === 0x1) {
      // client.info is proxy-local (presence focus updates); never forwarded.
      let handledLocally = false;
      if (frame.payload.length < 512 && frame.payload.includes("client.info")) {
        try {
          const j = JSON.parse(frame.payload.toString());
          if (j && j.method === "client.info") { handleClientInfo(j.params || {}, socket); handledLocally = true; }
        } catch { /* fall through to upstream */ }
      }
      if (handledLocally) return;
      // Idempotency for outgoing user messages (Phase 1, D5). A client that
      // flushed its outbox durably can replay prompt.submit after a crash or a
      // retry; the client cannot tell "accepted, response lost" from "never
      // arrived", so the SERVER decides. Claim BEFORE forwarding upstream — that
      // ordering is what makes an at-least-once client safe. A replay is dropped
      // and acknowledged locally, never re-applied upstream.
      if (frame.payload.length < 65536 && frame.payload.includes("prompt.submit")) {
        try {
          const j = JSON.parse(frame.payload.toString());
          if (j && j.method === "prompt.submit") {
            const key = j.params?.idempotency_key ?? j.params?.client_msg_id ?? null;
            // A dedupe-store failure must NEVER cost the user their message:
            // on any error we fall through and forward normally. Losing
            // idempotency is recoverable (a rare duplicate); losing a send is not.
            let verdict = { fresh: true };
            try {
              // Resolve live->stored BEFORE claiming. In the real flow the client
              // creates or resumes its session FIRST, so by the time the first
              // prompt is submitted this mapping is already known and the ack can
              // name the chat immediately. `bindStoredForLive` in
              // recordSidMapping remains the backfill for the rarer case where the
              // mapping is learned after the claim.
              const liveSid = j.params?.session_id || null;
              const resolvedStored = sid || (liveSid ? sidMap.get(String(liveSid)) || null : null);
              verdict = claimUserMessageKey(key, {
                storedSid: resolvedStored,
                liveSid,
              });
              sweepDedupeKeys();
            } catch (e) {
              console.error("[dedupe] claim failed, forwarding anyway:", e?.message || e);
            }
            if (verdict.fresh === false) {
              // Already accepted. Tell the client its message landed (with the
              // session we recorded) so it can drop the outbox row and stop
              // showing a pending chip — but do NOT forward it upstream.
              try {
                socket.write(encodeFrame(JSON.stringify({
                  method: "event",
                  params: {
                    type: "message.deduped",
                    session_id: j.params?.session_id || sid || null,
                    payload: {
                      idempotency_key: verdict.key,
                      stored_session_id: verdict.storedSid ?? null,
                      live_session_id: verdict.liveSid ?? null,
                    },
                  },
                }), { opcode: 0x1, masked: false }));
              } catch { /* gone */ }
              return;
            }
          }
        } catch { /* fall through to upstream — never block a send on a parse */ }
      }
      // forward to upstream if connected, else buffer until it is
      // Chat-card gate answers ride this same path as JSON-RPC results —
      // feed the gate ledger before forwarding (fire-and-forget, never throws).
      if (frame.payload.length < 4096 && frame.payload.includes("\"result\"")) {
        try { noteWebChatAnswer(frame.payload); } catch { /* never throws */ }
      }
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
    const p = presence.get(socket);
    presence.delete(socket);
    if (p && p.device) {
      pushPresenceEvent("leave", p.device, p.focus);
      broadcastPresence();
    }
    console.log(`ws-close peers=${browserSockets.size}${sid ? ` sid=${sid}` : ""} at=${new Date().toISOString()}`);
  });
  
  socket.on("error", () => {
    socket.destroy();
  });
  
  if (head && head.length > 0) decoder.push(head);
}
