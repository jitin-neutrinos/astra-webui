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
import { request as httpRequest } from "node:http";

// sessionId -> { at, text }
const cache = new Map();
const inflight = new Map();
const CACHE_CAP = 400;

// Window size for the "latest response" scan. A single tool-heavy turn can fill
// 8 rows with tool-call/tool-result pairs (assistant rows there carry
// tool_calls and EMPTY content), so a narrow window finds no prose at all and
// the preview silently falls back. 40 rows clears realistic turns; the body cap
// bounds the worst case, and "" (→ client falls back to `preview`) is a fine
// answer for a chat that is 40 rows of pure tool output.
const MSG_WINDOW = 40;
const MAX_BODY = 4 * 1024 * 1024;

const SCAFFOLD = /^\[(surface|system|runtime note|context compaction)\b/i;
// The auto-greet kickoff is a UI convention, mirrors src/lib/notify.ts GREET_RE.
const GREET = /^New chat just started\./;

/** Assistant-or-user text that is a real message, not scaffolding/tool/thinking.
 *  Owner 10-06 ("a lot of them still show empty"): the scan used to take only
 *  ASSISTANT rows. A chat whose 40-row window is tool-call/tool-result rows
 *  (or one where the USER spoke last — interrupted turn, queued follow-up)
 *  found nothing, fell back to the gateway preview = the greet kickoff = a
 *  BLANK row. The owner's spec is "the last message from Astra or me": scan
 *  both roles, newest first. */
function responseText(m) {
  if (!m || (m.role !== "assistant" && m.role !== "user")) return "";
  const raw = typeof m.text === "string" ? m.text
    : typeof m.content === "string" ? m.content
    : typeof m.display_content === "string" ? m.display_content
    : "";
  let t = (raw || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (/^\[tool_(call|result)\b/i.test(t)) return "";
  if (SCAFFOLD.test(t)) return "";
  // The greet itself never counts as the last reply (either side)
  if (GREET.test(t)) return "";
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
    if (t && !GREET.test(t)) return t.length > 220 ? t.slice(0, 219) + "…" : t;
  }
  return "";
}

function fetchLatest(sid, cookie) {
  const path = `/api/sessions/${encodeURIComponent(sid)}/messages?order=latest&limit=${MSG_WINDOW}`;
  return new Promise((resolve) => {
    const req = httpRequest(`${HERMES_URL}${path}`, { headers: { Cookie: cookie } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(""); }
      let body = "";
      let overflow = false;
      res.on("data", (c) => {
        if (overflow) return;
        body += c;
        if (body.length > MAX_BODY) { overflow = true; res.destroy(); }
      });
      res.on("error", () => resolve(""));
      res.on("end", () => {
        if (overflow) return resolve("");
        try { resolve(lastResponseFrom(JSON.parse(body).messages)); }
        catch { resolve(""); }
      });
    });
    req.on("error", () => resolve(""));
    req.end();
  });
}

/**
 * Last response text for a session, or "" when unknown/unavailable.
 * `activityAt` is the row's last-activity stamp — a change invalidates the cache.
 */
export async function lastResponse(sid, activityAt, cookie = "") {
  if (!sid || !cookie) return "";
  const hit = cache.get(sid);
  if (hit && hit.at === activityAt) return hit.text;
  if (inflight.has(sid)) return inflight.get(sid);

  const p = fetchLatest(sid, cookie).then((text) => {
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
 *
 * `cookie` is the caller's existing upstream session cookie — reusing it avoids
 * a second login and keeps this module free of an import cycle with the proxy.
 */
export async function enrichLastReplies(rows, { max = 16, cookie = "" } = {}) {
  if (!Array.isArray(rows) || !rows.length || !cookie) return rows;
  const slice = rows.slice(0, max);
  await Promise.all(slice.map(async (r) => {
    if (!r || typeof r !== "object") return;
    const key = r.session_id || r.id;
    if (!key) return;
    const at = typeof r.last_activity_at === "number" ? r.last_activity_at
      : (typeof r.last_active === "number" ? r.last_active : null);
    const text = await lastResponse(key, at, cookie);
    if (text) r.last_reply = text;
  }));
  return rows;
}

// test hook
export const _test = { cache, reset: () => { cache.clear(); inflight.clear(); }, responseText, lastResponseFrom };
