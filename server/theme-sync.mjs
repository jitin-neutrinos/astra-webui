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
    // Transient sync state. Origin-side hygiene — the CF zone on
    // astra.jitinnair.com has measured-OVERRIDDEN origin cache-control in the
    // past, so the client also minute-busts the poll URL (_r=) and never relies
    // on this header holding (see theme-store.ts stateUrl()).
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
          // A per-tab blob/data URL is unresolvable on every other device. Storing one
          // here is how a background set on the phone became invisible on the iPad: the
          // client that created it held it in memory, and every other device faithfully
          // adopted a dead string. The clients already refuse to push one; the server
          // refuses to accept one, so a STALE client (an app left open across a deploy)
          // cannot poison shared state either. This is the last line of defence.
          bg: body.bg === null
            ? null
            : (body.bg && typeof body.bg === "object"
              ? (/^(blob:|data:)/i.test(String(body.bg.src || "")) ? prev.bg : body.bg)
              : prev.bg),
          custom: body.custom && typeof body.custom === "object" ? body.custom : prev.custom,
          // Owner requirement: themes built in the UI are available on EVERY
          // device and app, so the full list syncs. Shape-validated here rather
          // than trusted: this file is the one place a malformed theme could
          // reach every client, and a theme missing a variant is unusable.
          userThemes: Array.isArray(body.userThemes)
            ? body.userThemes.filter(
                (t) =>
                  t && typeof t.id === "string" && typeof t.name === "string" &&
                  t.variants?.dark && t.variants?.light &&
                  Object.keys(t.variants.dark).length > 0 && Object.keys(t.variants.light).length > 0
              )
            : prev.userThemes,
          // Shape: validated against the closed set, and `null` (unset) is a
          // real value that must survive the merge — otherwise one device
          // clearing its shape could never be undone by another.
          shape: body.shape === null
            ? null
            : (body.shape === "sharp" || body.shape === "rounded" || body.shape === "circle"
              ? body.shape
              : prev.shape),
          // Fonts: an OBJECT MAP role -> {family,url,variable,source}, because a
          // base64 font would blow the 64KB body cap below — and a blob: URL is
          // unresolvable on every other device, which is exactly the bug the
          // chat backdrop had (set on the phone, invisible on the iPad). Only a
          // same-origin /api/theme/font URL is accepted.
          fonts: (body.fonts && typeof body.fonts === "object" && !Array.isArray(body.fonts))
            ? Object.fromEntries(
                ["sans", "display", "mono"]
                  .filter((r) => {
                    const p = body.fonts[r];
                    return p && typeof p.family === "string" && typeof p.url === "string"
                      && p.url.startsWith("/api/theme/font/");
                  })
                  .map((r) => [r, {
                    family: String(body.fonts[r].family).slice(0, 80),
                    url: body.fonts[r].url,
                    variable: !!body.fonts[r].variable,
                    source: body.fonts[r].source === "upload" ? "upload" : "google",
                  }])
              )
            : (prev.fonts ?? null),
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
