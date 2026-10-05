// stream-routes.mjs — the READ side of the durable stream log (Phase 3).
//
// WHAT THIS IS FOR:
//   The gateway cannot resume a stream. Its replay ring is in-process memory
//   (512 events / 4 MiB per session) that dies with a restart, and the HTTP
//   stream route emits no `id:` line so `Last-Event-ID` is structurally
//   impossible. So when a client reconnects mid-turn — phone locked, tab closed,
//   Android WebView killed — Astra has no way to learn what it missed, and the
//   partially streamed answer is simply lost.
//
//   This module is the durable counterpart: `GET /api/hx/stream/<sid>?since=<seq>`
//   returns everything the gateway flushed after a cursor, from Astra's own disk.
//
// THE CURSOR CONTRACT (D8):
//   Keyed on the GATEWAY's own per-session monotonic `seq`, never on a client
//   clock. Same shape as OpenAI's `starting_after=cursor` and Slack's `ts`.
//   Reconnect is a plain `WHERE seq > $cursor` read.
//
// THE `truncated` FLAG IS NOT OPTIONAL:
//   A `truncated: true` answer means "there IS a hole between your cursor and
//   what I am sending you". The client must then refetch full history rather
//   than splice a partial answer onto a gap. Splicing onto a gap would render a
//   transcript that looks complete and is missing text — the worst failure this
//   whole feature exists to prevent. A missing flag is worse than a missing
//   feature, so it is computed from BOTH the retained window and the purge
//   watermark (see stream-log.isTruncated).
//
// COST SHAPE (D2):
//   Prose chunks come back with their payload inline. Tool chunks come back as a
//   REFERENCE (`ref_sid` + `ref_row` + `headline`) and the body is fetched from
//   the gateway on demand. This is what keeps a large replay small.

import { eventsSince, latestSeq, isTruncated, streamStats, flushNow } from "./stream-log.mjs";

// Sessions keys are gateway session ids, but the client may hand us a STORED
// archive key (the durable one) or a LIVE transport id (the ephemeral one). Be
// permissive about shape and strict about length: this value reaches a prepared
// statement, so a bound parameter already prevents injection, but an unbounded
// key would still let one client ask the server to scan the whole table.
const MAX_KEY_LEN = 128;

function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Handle a stream-log read. Returns true when it owned the request.
 * Callers must have already authenticated.
 */
export async function handleStreamRoutes(req, res, url) {
  const path = url.pathname;

  // ORDER MATTERS. `/stats` and the cursor-only `/stream` probe must be tested
  // BEFORE `/stream/<sid>`, or the `<sid>` pattern happily matches the literal
  // "stats" as a session id and answers a session read to a stats request.
  // (That was a real bug: GET /api/hx/stream/stats returned session_id:"stats".)
  if (path === "/api/hx/stream/stats" && req.method === "GET") {
    return json(res, 200, streamStats()) || true;
  }

  // GET /api/hx/stream  -> cheap cursor/status probe, no payload
  if ((path === "/api/hx/stream" || path === "/api/hx/stream/") && req.method === "GET") {
    const sid = (url.searchParams.get("session_id") || "").slice(0, MAX_KEY_LEN);
    const since = Math.max(0, Number(url.searchParams.get("since") ?? 0) || 0);
    if (!sid) return json(res, 400, { error: "missing session_id" }) || true;
    try { flushNow(); } catch { /* best effort */ }
    return json(res, 200, {
      session_id: sid,
      latest_seq: latestSeq(sid),
      truncated: isTruncated(sid, since),
    }) || true;
  }

  // GET /api/hx/stream/<sid>?since=<seq>&limit=<n>
  const m = path.match(/^\/api\/hx\/stream\/([^/]+)$/);
  if (m && req.method === "GET") {
    // A reserved word is never a session id; treating it as one is how the
    // routing bug above happened.
    const raw = decodeURIComponent(m[1] || "");
    if (raw === "stats") return json(res, 400, { error: "reserved path segment" }) || true;
    const sid = raw.slice(0, MAX_KEY_LEN);
    if (!sid) return json(res, 400, { error: "missing session id" }) || true;

    const sinceRaw = url.searchParams.get("since");
    const since = Number(sinceRaw ?? 0);
    if ((sinceRaw !== null && !Number.isFinite(since)) || since < 0) {
      return json(res, 400, { error: "`since` must be a non-negative integer" }) || true;
    }
    const limitRaw = Number(url.searchParams.get("limit") ?? 5000);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 20000)) : 5000;

    // Anything still buffered belongs in the answer: a client asking "what did I
    // miss" must not be told "nothing" while the last few chunks sit in memory.
    try { flushNow(); } catch { /* never fail the read */ }

    let events;
    try {
      events = eventsSince(sid, since, { limit });
    } catch {
      // A read must degrade to a refetch signal, never a 500 the client cannot
      // interpret. `truncated: true` tells it exactly what to do.
      return json(res, 200, {
        session_id: sid, since, events: [], latest_seq: 0,
        truncated: true, error: "stream log unavailable",
      }) || true;
    }

    const head = latestSeq(sid);
    // More to come: the caller hit `limit` before reaching the head.
    const more = events.length >= limit && head > (events[events.length - 1]?.seq ?? since);
    return json(res, 200, {
      session_id: sid,
      since,
      events,
      latest_seq: head,
      // The client resumes from here next time.
      next_cursor: events.length ? events[events.length - 1].seq : since,
      truncated: isTruncated(sid, since),
      more,
    }) || true;
  }

  return false;
}

export const _test = { MAX_KEY_LEN };
