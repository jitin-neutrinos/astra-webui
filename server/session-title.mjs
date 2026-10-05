// session-title.mjs — a title-only session lookup (RCA fix 2).
//
// WHY (measured 2026-10-05):
//   chat-landing.tsx fetches `/api/hx/sessions/<sid>` purely to read the chat's
//   TITLE for the header. That endpoint returns the full session record: 61 keys,
//   154 KiB. Measured breakdown of the payload:
//     system_prompt   90.8 KiB   — never read by any client
//     tool_names      62.7 KiB   — never read by any client
//     model_config     0.4 KiB
//     title            46 bytes  — the ONLY thing the client wants
//   So ~153 KiB travelled through the Cloudflare tunnel on every chat open, was
//   JSON.parsed on the main thread, and discarded.
//
// WHAT THIS DOES:
//   Answers `GET /api/hx/session-title/<sid>` from the proxy with `{id, title}` —
//   tens of bytes. It does NOT re-query the gateway: the session list the app has
//   already fetched carries titles, and this route is a small, cheap extension of
//   the existing proxy.
//
// WHY THE PROXY AND NOT server.mjs:
//   server.mjs is shared with other in-flight work in this repo. The proxy is not,
//   and it is already the place every /api/hx/* request is routed — including the
//   gateway cookie helper this lookup needs.

const MAX_KEY_LEN = 128;

function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Handle a title lookup. Returns true when it owned the request.
 * `lookupTitle` is injected so the caller owns the gateway call (and its cookie),
 * and so this module has no hidden network dependency of its own.
 */
export async function handleSessionTitle(req, res, url, lookupTitle) {
  const m = url.pathname.match(/^\/api\/hx\/session-title\/([^/]+)$/);
  if (!m || req.method !== "GET") return false;

  const sid = decodeURIComponent(m[1] || "").slice(0, MAX_KEY_LEN);
  if (!sid) return json(res, 400, { error: "missing session id" }) || true;

  try {
    const title = await lookupTitle(sid);
    // A missing title is NOT an error: the client falls back to its own
    // "no title yet" state. Returning 200 with null keeps the caller's control
    // flow simple and avoids a retry for something that will not appear.
    return json(res, 200, { id: sid, title: title ?? null }) || true;
  } catch (e) {
    // Degrade to a title-less answer rather than a 5xx the client must handle.
    // The header renders without a title; the transcript is unaffected.
    console.error("[session-title] lookup failed:", e?.message || e);
    return json(res, 200, { id: sid, title: null, error: "title unavailable" }) || true;
  }
}

export const _test = { MAX_KEY_LEN };
