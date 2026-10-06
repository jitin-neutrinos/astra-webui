#!/usr/bin/env node
// ws-probe.mjs — reusable AUTHENTICATED WebSocket probe for the Astra proxy.
//
// WHY THIS EXISTS: debugging the relay previously meant hand-rolling a raw TCP
// upgrade + the repo's frame codec (see server/ws-codec.mjs) in a throwaway
// scratch file, because Node's global WebSocket cannot send an auth cookie and
// `ws` was not a dependency. That hand-rolled path also could not see
// FRAGMENTED frames (the codec refuses them: "fragmentation unsupported"), so a
// bug in a fragmented frame was invisible to the probe. `ws` handles masking,
// fragmentation, ping/pong and close codes natively — use it.
//
// Usage:
//   node tools/ws-probe.mjs                       # watch frames for 20s
//   node tools/ws-probe.mjs --create --prompt "hi"  # start a turn, then watch
//   node tools/ws-probe.mjs --watch message.start   # exit on first match
//   node tools/ws-probe.mjs --json                  # one JSON object per frame
//
// Auth: the password is read from the systemd EnvironmentFile and is NEVER
// printed. Override with ASTRA_WEBUI_PASSWORD or ASTRA_ENV.

import { readFileSync } from "node:fs";
import WebSocket from "ws";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : (args[i + 1] ?? true);
};
const has = (name) => args.includes(name);

const BASE = process.env.ASTRA_BASE || "http://127.0.0.1:3011";
const WS_BASE = BASE.replace(/^http/, "ws");
const ENV_FILE = process.env.ASTRA_ENV || `${process.env.HOME}/.config/astra-webui/env`;
const WATCH = flag("--watch", null);
const CREATE = has("--create");
const PROMPT = flag("--prompt", null);
const JSON_OUT = has("--json");
const MS = Number(flag("--ms", 20_000));

// ---- auth -----------------------------------------------------------------
let password = process.env.ASTRA_WEBUI_PASSWORD || "";
if (!password) {
  try {
    for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
      const m = line.match(/^\s*ASTRA_WEBUI_PASSWORD\s*=\s*(.*)\s*$/);
      if (m) { password = m[1].replace(/^["']|["']$/g, ""); break; }
    }
  } catch { /* reported below */ }
}
if (!password) {
  console.error(`ws-probe: no password (set ASTRA_WEBUI_PASSWORD or check ${ENV_FILE})`);
  process.exit(2);
}

const login = await fetch(`${BASE}/api/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password }),
});
const cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ")
  || (login.headers.get("set-cookie") || "").split(";")[0];
if (!cookie) { console.error(`ws-probe: login failed (${login.status})`); process.exit(2); }
console.error(`ws-probe: authenticated (${login.status}) → ${WS_BASE}/api/hx/ws`);

// ---- connect --------------------------------------------------------------
const ws = new WebSocket(`${WS_BASE}/api/hx/ws`, { headers: { cookie } });
const counts = new Map();
let matched = false;

const stop = (code = 0) => {
  try { ws.close(); } catch { /* already gone */ }
  if (!JSON_OUT) {
    console.error("\n--- frames ---");
    for (const [k, v] of [...counts.entries()].sort()) console.error(`  ${k}: ${v}`);
  }
  process.exit(code);
};

const send = (method, params, id) =>
  ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));

ws.on("open", () => {
  console.error("ws-probe: open");
  if (CREATE) send("session.create", { source: "webui" }, "probe-create");
});

ws.on("message", (buf) => {
  let m;
  try { m = JSON.parse(String(buf)); } catch { return; }

  if (m.id === "probe-create") {
    if (m.error) { console.error("create failed:", JSON.stringify(m.error)); return stop(1); }
    const live = m.result?.session_id;
    console.error(`created live=${live} stored=${m.result?.session_key || m.result?.stored_session_id || "-"}`);
    if (PROMPT) setTimeout(() => send("prompt.submit",
      { session_id: live, text: PROMPT, surface: "webui" }, "probe-prompt"), 300);
    return;
  }

  const p = m.params;
  if (!p?.type) return;
  counts.set(p.type, (counts.get(p.type) || 0) + 1);
  if (JSON_OUT) console.log(JSON.stringify({ type: p.type, session_id: p.session_id, payload: p.payload ?? null }));

  if (WATCH && p.type === WATCH) {
    matched = true;
    if (!JSON_OUT) console.error(`\nmatched ${WATCH}: ${JSON.stringify({ session_id: p.session_id, payload: p.payload ?? null })}`);
    return stop(0);
  }
});

ws.on("error", (e) => { console.error("ws-probe: error", e?.message); stop(1); });
ws.on("close", (code, reason) => console.error(`ws-probe: closed ${code} ${reason || ""}`));
setTimeout(() => stop(WATCH && !matched ? 1 : 0), MS);
