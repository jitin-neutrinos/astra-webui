// ntfy-notify.mjs — posts a push when the gateway mints a server→client
// request (approval / clarify / srq-*). Wired into hermes-proxy.mjs upstream
// decoder; every session on every device funnels through that relay, so a gate
// raised from a telegram/cli/dashboard session pushes to the phone too.
//
// Reads config from env (loaded at service start from ~/.config/astra-webui/env):
//   NTFY_URL        e.g. https://ntfy.jitinnair.com
//   NTFY_TOPIC      topic name (unguessable)
//   NTFY_AUTH       value for Authorization header ("Basic <b64>" or "Bearer <token>")
// Fire-and-forget: never blocks the WS relay, never throws.
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const NTFY_URL = process.env.NTFY_URL || "";
const NTFY_TOPIC = process.env.NTFY_TOPIC || "";
const NTFY_AUTH = process.env.NTFY_AUTH || "";
const NTFY_ENABLED = !!(NTFY_URL && NTFY_TOPIC);
const quiet = {};
// Pending gates the phone can fetch + answer (GET/POST /api/gate/:id). In-memory,
// TTL 30 min; a restart drops them and the in-app card still works.
const pending = new Map();
const GATE_TTL_MS = 30 * 60 * 1000;
export function getPendingGate(id) {
  const g = pending.get(id);
  if (!g) return null;
  if (Date.now() - g.at > GATE_TTL_MS) { pending.delete(id); return null; }
  return g;
}
export function markGateAnswered(id) { const g = pending.get(id); if (g) g.answered = true; }
function gatherQuestions(inner) {
  if (Array.isArray(inner.questions) && inner.questions.length) {
    return inner.questions.map(q => ({
      qid: q.qid || "", question: String(q.question || ""),
      choices: Array.isArray(q.choices) ? q.choices.map(String) : [], multi_select: !!q.multi_select,
    }));
  }
  return [{ qid: "", question: String(inner.question || "A question for you"),
    choices: Array.isArray(inner.choices) ? inner.choices.map(String) : [], multi_select: !!inner.multi_select }];
}

export function notifyGateRequest(frame) {
  if (!NTFY_ENABLED) return;
  try {
    // hermes-proxy passes the raw WS payload (a UTF-8 Buffer); accept objects
    // too so unit tests / other callers can pass a parsed frame directly.
    const raw = frame && frame.payload !== undefined ? frame.payload : frame;
    let data;
    if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
      data = JSON.parse(Buffer.from(raw).toString("utf8"));
    } else if (typeof raw === "string") {
      data = JSON.parse(raw);
    } else {
      data = raw;
    }
    if (!data || typeof data !== "object") return;
    // approval/clarify frames arrive as method:"approval"/"clarify", or with a
    // generic srq-* id (session_scoping fix). Batches ride params.questions[].
    const method = String(data.method || "").toLowerCase();
    const isGate =
      method === "approval" ||
      method === "clarify" ||
      /^(srq-)/i.test(String(data.id || ""));
    if (!isGate) return;
    // never double-notify the same request id
    const id = String(data.id || "");
    if (!id || quiet[id]) return;
    quiet[id] = true;
    if (Object.keys(quiet).length > 200) {
      for (const k of Object.keys(quiet).slice(0, 100)) delete quiet[k];
    }

    const inner = data.params && typeof data.params === "object" ? data.params : {};
    const sid = String(inner.session_id || data.session_id || "");
    const q = String(
      inner.question ||
      (Array.isArray(inner.questions) && inner.questions.map(q => q?.question).filter(Boolean).join(" | ")) ||
      inner.description ||
      inner.command ||
      "Approval needed"
    ).slice(0, 180);

    const click = (sid
      ? `https://astra.jitinnair.com/c/${sid}`
      : "https://astra.jitinnair.com/") + `?gate=${encodeURIComponent(id)}`;
    const isClarify = method === "clarify" || (method !== "approval" && !inner.command);
    pending.set(id, {
      id, kind: isClarify ? "clarify" : "approval", sid, at: Date.now(), answered: false,
      title: isClarify ? "Astra has a question" : "Astra needs approval",
      command: String(inner.command || ""), description: String(inner.description || ""),
      choices: Array.isArray(inner.choices) && inner.choices.length ? inner.choices.map(String) : ["once", "deny"],
      questions: isClarify ? gatherQuestions(inner) : [],
    });
    if (pending.size > 100) pending.delete(pending.keys().next().value);

    // Extras carry the request identity to the Android shell so the card can
    // deep-link into the right chat (astra://open?path=/c/<sid>) without
    // re-parsing the body.
    postNtfy({
      topic: NTFY_TOPIC,
      message: q,
      title: method === "clarify" ? "Astra has a question" : "Astra needs approval",
      tags: ["bell"],
      priority: 4,
      click,
      extras: {
        astra_kind: method || "approval",
        astra_sid: sid,
        astra_reqid: id,
      },
    });
  } catch { /* never throw */ }
}

function postNtfy(body) {
  const url = new URL(`${NTFY_URL.replace(/\/$/, "")}/`);
  const payload = JSON.stringify(body);
  const headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) };
  if (NTFY_AUTH) headers["Authorization"] = NTFY_AUTH;
  const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
    { hostname: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80), path: url.pathname, method: "POST", headers, timeout: 8000 },
    r => { r.resume(); }
  );
  req.on("error", () => {});
  req.write(payload);
  req.end();
}
