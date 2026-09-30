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
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { enrichGate } from "./gate-enrich.mjs";

const NTFY_URL = process.env.NTFY_URL || "";
const NTFY_TOPIC = process.env.NTFY_TOPIC || "";
const NTFY_AUTH = process.env.NTFY_AUTH || "";
const NTFY_ENABLED = !!(NTFY_URL && NTFY_TOPIC);
const quiet = {};
// Pending gates the phone can fetch + answer (GET/POST /api/gate/:id). In-memory,
// TTL 30 min; a restart drops them and the in-app card still works.
const pending = new Map();
const GATE_TTL_MS = 30 * 60 * 1000;

const LEDGER_FILE = process.env.ASTRA_GATE_LEDGER || join(process.cwd(), "data", "gate-ledger.jsonl");

function appendToLedger(obj) {
  const line = JSON.stringify(obj) + "\n";
  mkdir(dirname(LEDGER_FILE), { recursive: true }).then(() => appendFile(LEDGER_FILE, line)).catch(() => {});
}

export async function listGates({ kind, since, limit = 200 } = {}) {
  try {
    const content = await readFile(LEDGER_FILE, "utf8");
    const lines = content.split("\n").filter(l => l.trim());
    const gates = new Map();
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "gate") {
          gates.set(obj.id, obj);
        } else if (obj.type === "answered") {
          const g = gates.get(obj.id);
          if (g) {
            g.answered = true;
            g.by = obj.by;
            g.answeredAt = obj.at;
            g.result = obj.result;
          }
        }
      } catch { }
    }
    let arr = Array.from(gates.values());
    if (kind) arr = arr.filter(g => g.kind === kind);
    if (since) arr = arr.filter(g => g.at > since);
    arr.sort((a, b) => b.at - a.at);
    if (limit) arr = arr.slice(0, limit);
    return arr;
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

export async function gateStats() {
  const gates = await listGates({ limit: 0 });
  let total = gates.length;
  let answered = 0;
  let pending = 0;
  let approved = 0;
  let denied = 0;
  for (const g of gates) {
    if (g.answered) {
      answered++;
      if (g.result && g.result.choice === "once") approved++;
      if (g.result && g.result.choice === "deny") denied++;
    } else {
      pending++;
    }
  }
  return {
    total, pending, answered, approved, denied,
    answeredPct: total ? Math.round((answered / total) * 100) : 0
  };
}

export function getPendingGate(id) {
  const g = pending.get(id);
  if (!g) return null;
  if (Date.now() - g.at > GATE_TTL_MS) { pending.delete(id); return null; }
  return g;
}

export function markGateAnswered(id) {
  const g = pending.get(id);
  if (g) g.answered = true;
}

export function answerGateHelper(g, b, by) {
    let result = null;
    if (g.kind === "approval") {
      if (typeof b.choice === "string" && g.choices.includes(b.choice)) result = { choice: b.choice };
    } else if (b.answers && typeof b.answers === "object") {
      result = { answers: Object.fromEntries(Object.entries(b.answers).map(([k, v]) => [String(k), String(v)])) };
    } else if (typeof b.answer === "string") {
      result = { answer: b.answer };
    }
    if (!result) { return { error: "bad answer", status: 400 }; }
    
    markGateAnswered(g.id);
    appendToLedger({ type: "answered", id: g.id, at: Date.now(), by, result });
    return { result };
}

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

function maskCommand(cmd) {
  if (!cmd) return cmd;
  if (/password|token|secret|api[_-]?key/i.test(cmd)) {
    if (cmd.includes("=")) {
      return cmd.replace(/=([^\s]+)/g, "=•••");
    }
    const parts = cmd.split(/\s+/);
    if (parts.length > 2) {
      return parts.slice(0, 2).join(" ") + " •••";
    }
  }
  return cmd;
}

export function notifyGateRequest(frame) {
  if (!NTFY_ENABLED) return;
  try {
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
    const method = String(data.method || "").toLowerCase();
    const isGate =
      method === "approval" ||
      method === "clarify" ||
      /^(srq-)/i.test(String(data.id || ""));
    if (!isGate) return;
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
    
    let command = maskCommand(String(inner.command || ""));
    let description = String(inner.description || "");
    let choices = Array.isArray(inner.choices) && inner.choices.length ? inner.choices.map(String) : ["once", "deny"];
    let questions = isClarify ? gatherQuestions(inner) : [];
    
    // Call enrichGate
    const enriched = enrichGate({ command, description, question: inner.question, questions: inner.questions }, isClarify ? "clarify" : "approval");

    const gateData = {
      id, kind: isClarify ? "clarify" : "approval", sid, at: Date.now(), answered: false,
      title: isClarify ? "Astra has a question" : "Astra needs approval",
      command, description,
      choices,
      questions,
      ...enriched
    };

    pending.set(id, gateData);
    if (pending.size > 100) pending.delete(pending.keys().next().value);

    // Ledger
    appendToLedger({ type: "gate", ...gateData });

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
  } catch (e) { console.error(e); }
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
