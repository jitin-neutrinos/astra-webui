// theme-sync.mjs — realtime cross-device sync of per-user theme state (palette,
// mode, chat backdrop). Cookie-gated; last-write-wins with an in-memory store.
// Routes: GET /api/theme/state, PUT /api/theme/state.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const STATE_FILE = resolve(import.meta.dirname, "..", "data", "theme-state.json");
let state = { palettes: {}, bgs: {} };
try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { /* first boot */ }
let saveTimer = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { mkdirSync(join(STATE_FILE, ".."), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(state)); } catch { /* best effort */ }
  }, 300);
}

function userKey(req) {
  // one account => one global theme profile (owner's product: all his devices)
  return "owner";
}

export function handleThemeState(req, res, validToken) {
  const cookies = {};
  (req.headers.cookie || "").split(";").forEach((c) => {
    const i = c.indexOf("=");
    if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
  });
  if (!validToken(cookies.astra_session)) { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":"unauthenticated"}'); }
  const key = userKey(req);
  if (req.method === "GET") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify(state.palettes[key] || {}));
  }
  if (req.method === "PUT" || req.method === "POST") {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => { size += c.length; if (size > 64 * 1024) { req.destroy(); return; } chunks.push(c); });
    req.on("end", () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        const prev = state.palettes[key] || {};
        // merge: partial updates allowed (e.g. only bg changed)
        state.palettes[key] = {
          palette: typeof body.palette === "string" ? body.palette : prev.palette,
          mode: body.mode === "light" || body.mode === "dark" ? body.mode : prev.mode,
          bg: body.bg === null ? null : (body.bg && typeof body.bg === "object" ? body.bg : prev.bg),
          custom: body.custom && typeof body.custom === "object" ? body.custom : prev.custom,
          rev: (prev.rev || 0) + 1,
          ts: Date.now(),
        };
        persist();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, rev: state.palettes[key].rev }));
      } catch { res.writeHead(400, { "content-type": "application/json" }); res.end('{"error":"bad json"}'); }
    });
    return;
  }
  res.writeHead(405, { allow: "GET, PUT, POST" });
  res.end();
}
