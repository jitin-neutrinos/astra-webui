// Last-RESPONSE preview for the chat sidebar (2026-10-02).
//
// Why this exists: the gateway's session row `preview` is the FIRST user message
// (`_PREVIEW_RAW_SUBQUERY_SQL` orders ASC, LIMIT 1) — useless once a chat has
// more than one exchange. The owner wants the LATEST assistant RESPONSE, and
// explicitly NOT tool calls / thinking / system rows.
//
// We cannot fix the gateway (astra-webui ships ZERO edits to the hermes-agent
// checkout so `hermes update` can never erase them), so the proxy derives it:
// one `GET /api/sessions/<id>/messages?order=latest&limit=8` per session, take
// the newest assistant row that carries real response text.
//
// Cost control: results are cached in-memory per session id and invalidated by
// the row's activity stamp, so a re-render of an unchanged chat costs nothing.
// Only the rows the browser actually asked for are ever fetched.

const HERMES_URL = process.env.HERMES_URL || "http://127.0.0.1:9119";
import httpRequest from "node:http";

// sessionId -> { at, text }
const cache = new Map();
const inflight = new Map();
const CACHE_CAP = 400;

const SCAFFOLD = /^\[(surface|system|runtime note|context compaction)\b/i;

/** Assistant text that is a real response, not scaffolding / tool / thinking. */
function responseText(m) {
  if (!m || m.role !== "assistant") return "";
  const raw = typeof m.text === "string" ? m.text
    : typeof m.content === "string" ? m.content
    : typeof m.display_content === "string" ? m.display_content
    : "";
  const t = (raw || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (SCAFFOLD.test(t)) return "";
  // tool-call-only assistant rows serialize their calls, not prose
  if (/^\[tool_(call|result)\b/i.test(t)) return "";
  return t;
}

/**
 * Newest real assistant response from a messages page.
 *
 * The host returns `order=latest` pages back from the newest row but in
 * CHRONOLOGICAL order (`hermes_state_messages.get_messages`: "latest pages back
 * from the newest but returns chronological order"), so the newest message is
 * the LAST element — iterate from the end. Rows lacking a timestamp are held in
 * their given order, which is also chronological.
 */
export function lastResponseFrom(messages) {
  const rows = Array.isArray(messages) ? messages : [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const t = responseText(rows[i]);
    if (t) return t.length > 220 ? t.slice(0, 219) + "…" : t;
  }
  return "";
}

function fetchLatest(sid) {
  const path = `/api/sessions/${encodeURIComponent(sid)}/messages?order=latest&limit=8`;
  return new Promise((resolve) => {
    getHermesCookie().then((cookie) => {
      const req = httpRequest(`${HERMES_URL}${path}`, { headers: { Cookie: cookie } }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(""); }
        let body = "";
        res.on("data", (c) => { body += c; });
        res.on("end", () => {
          try { resolve(lastResponseFrom(JSON.parse(body).messages)); }
          catch { resolve(""); }
        });
      });
      req.on("error", () => resolve(""));
      req.end();
    }).catch(() => resolve(""));
  });
}

/**
 * Last response text for a session, or "" when unknown/unavailable.
 * `activityAt` is the row's last-activity stamp — a change invalidates the cache.
 */
export async function lastResponse(sid, activityAt) {
  if (!sid) return "";
  const hit = cache.get(sid);
  if (hit && hit.at === activityAt) return hit.text;
  if (inflight.has(sid)) return inflight.get(sid);

  const p = fetchLatest(sid).then((text) => {
    inflight.delete(sid);
    if (cache.size >= CACHE_CAP) {
      // drop the oldest insertion — Map preserves insertion order
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(sid, { at: activityAt, text });
    return text;
  });
  inflight.set(sid, p);
  return p;
}

/**
 * Fill `last_reply` on session rows, bounded to the first `max` rows so a
 * 100-row page never fans out into 100 upstream calls. Rows beyond the bound
 * keep whatever the gateway sent (client falls back to `preview`).
 */
export async function enrichLastReplies(rows, { max = 12, cookieFn } = {}) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  const slice = rows.slice(0, max);
  await Promise.all(slice.map(async (r) => {
    if (!r || typeof r !== "object") return;
    const key = r.session_id || r.id;
    if (!key) return;
    const at = typeof r.last_activity_at === "number" ? r.last_activity_at
      : (typeof r.last_active === "number" ? r.last_active : null);
    const text = await lastResponse(key, at);
    if (text) r.last_reply = text;
  }));
  return rows;
}

// test hook
export const _test = { cache, reset: () => { cache.clear(); inflight.clear(); }, responseText, lastResponseFrom };
