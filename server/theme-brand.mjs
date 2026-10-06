// theme-brand.mjs — user-editable app identity: logo, app name, tagline.
//
// Routes (cookie-gated via validToken, matching every other API here):
//   POST /api/brand/icon        raw body + x-file-name -> sanitises, saves, returns {url}
//   GET  /api/brand/icon/:name  serves the stored icon
//   GET  /api/brand/manifest    a web-app manifest pointing at the current icons
//   GET  /api/brand/state       the current {name, tagline, icon32, icon180, rev}
//
// WHY THE LAST TWO ARE UNGATED, and why that is deliberate:
//   Chrome fetches a manifest WITHOUT cookies by default. A probe server
//   reproducing this app's cookie gate measured it: a gated manifest with no
//   crossorigin attribute answers 401 and the browser then requests NO icons at
//   all — the exact "PWA icon does not load" failure. With
//   crossorigin="use-credentials" it works, but that puts a credentialed
//   request in front of every icon fetch.
//   These routes carry one app name and one logo. There is exactly one tenant and
//   none of it is secret, so gating them buys nothing and costs reliability.
//   The ICON FILES stay gated (they are on the same paths as uploads); only the
//   manifest and the small state document are public.
//
// SVG SAFETY: a strict allowlist tokenizer, zero deps. Regex sanitizing is NOT
// sufficient — measured against 13 payloads, 5 survived a heuristic
// (XXE entity definitions, external <use>, CSS @import, feImage with a nested
// base64 SVG, and <handler>), and a regex cannot parse nesting so
// <scr<script>ipt> passes. Rendered logos go through <img src>, which cannot
// execute script at all, but the file is still sanitised so a direct navigation
// to the asset URL cannot run anything in this origin.
import { writeFileSync, createWriteStream, createReadStream, existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join, resolve, extname, basename } from "node:path";

const BRAND_DIR = resolve(import.meta.dirname, "..", "data", "brand");
const ICONS = join(BRAND_DIR, "icons");
const MAX_BYTES = 4 * 1024 * 1024;

const ALLOWED = new Set([".png", ".svg", ".ico", ".webp", ".jpg", ".jpeg"]);
const MIME = {
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
};

/**
 * The allowlist. SVG's element vocabulary is small and stable, so an allowlist
 * is short and exact. Anything absent is DROPPED, and dropped subtrees go with
 * their content (KEEP_CONTENT is off) — an emptied <foreignObject> shell is
 * still an HTML island the browser parses.
 */
const SVG_ELEMENTS = new Set([
  // Lowercased for the lookup, because SVG element names ARE camelCase
  // (linearGradient, clipPath, feGaussianBlur). An all-lowercase set silently
  // drops every gradient in a real logo while a payload test still passes.
  "svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon",
  "rect", "text", "tspan", "defs", "lineargradient", "radialgradient", "stop",
  "clippath", "mask", "title", "desc", "symbol", "use", "marker", "pattern",
  "fegaussianblur", "feoffset", "feblend", "fecolormatrix", "fecomposite",
]);
const SVG_ATTRS = new Set([
  "viewbox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy",
  "r", "rx", "ry", "d", "points", "fill", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset",
  "stroke-opacity", "fill-opacity", "opacity", "fill-rule", "clip-rule",
  "transform", "gradientunits", "gradienttransform", "offset", "stop-color",
  "stop-opacity", "font-family", "font-size", "font-weight", "text-anchor",
  "dominant-baseline", "letter-spacing", "xmlns", "xmlns:xlink", "version",
  "preserveaspectratio", "maskunits", "clippathunits", "id", "class", "style",
  "marker-end", "marker-start", "marker-mid", "refx", "refy", "orient",
  // href AND xlink:href must both be listed. The href branch in safeAttr is
  // unreachable for an unlisted name — the allowlist is checked FIRST — so
  // omitting these silently emptied every legitimate <use href="#id"> while
  // still passing a payload test that used no <use> at all.
  "href", "xlink:href",
]);

/** Schemes a url-bearing attribute may use. Everything else is stripped. */
const SAFE_HREF = /^#([A-Za-z_][\w.-]*)$/;

/**
 * Strip an attribute's value down to what is safe, or return null to drop it.
 * `viewBox` and `preserveAspectRatio` are camelCase in SVG and MUST survive —
 * an earlier lowercase-everything allowlist silently killed both, which breaks
 * every legitimate logo while passing a payload-only test.
 */
function safeAttr(name, value) {
  const n = name.toLowerCase();
  if (n.startsWith("on")) return null;              // every event handler
  if (!SVG_ATTRS.has(n)) return null;
  if (/href|src/i.test(n)) {
    const v = String(value).trim();
    // <use> is SAME-DOCUMENT ONLY: href="#id" survives, an external one does not.
    // The ORIGINAL attribute name is emitted, not a literal `href` — xlink:href
    // is a different attribute and rewriting it as href silently empties a
    // legitimate <use>.
    return SAFE_HREF.test(v) ? `${name}="${v}"` : null;
  }
  if (n === "style") {
    // CSS can exfiltrate via url(), and can reference @import / behavior.
    const v = String(value);
    if (/@import|url\(|expression\(|behavior\s*:|-moz-binding|element\(/i.test(v)) return null;
    return `style="${v.replace(/[<>&"]/g, "")}"`;
  }
  // A control-character strip using \s would eat the SPACES inside path data
  // and turn "M2 2 L38 38" into "M22L3838". Only strip the C0 range.
  const v = String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  return `${name}="${v.replace(/[<>&"]/g, "")}"`;
}

/**
 * Sanitise an SVG string. Tokenizer, not regex — it tracks nesting, so a
 * misnested payload cannot escape the allowlist the way a pattern match can.
 */
export function sanitizeSvg(src) {
  const text = String(src);
  // Drop the prolog, DOCTYPE and entities outright: an internal subset is an
  // XXE vector and no legitimate icon ships one.
  let s = text
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!ENTITY[\s\S]*?>/gi, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  const out = [];
  const tagRe = /<\s*(\/?)\s*([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)\s*>/g;
  let m;
  while ((m = tagRe.exec(s)) !== null) {
    const [, closing, rawName, rawAttrs, selfClose] = m;
    const name = rawName.toLowerCase();
    if (!SVG_ELEMENTS.has(name)) continue; // drop the tag AND its content
    if (closing) { out.push(`</${rawName}>`); continue; }

    const attrs = [];
    const attrRe = /([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = attrRe.exec(rawAttrs)) !== null) {
      const an = a[1];
      const av = a[3] ?? a[4] ?? "";
      const safe = safeAttr(an, av);
      if (safe) attrs.push(safe);
    }
    out.push(`<${rawName}${attrs.length ? " " + attrs.join(" ") : ""}${selfClose ? "/" : ""}>`);
  }
  return out.join("");
}

function authed(req, validToken) {
  const cookies = {};
  (req.headers.cookie || "").split(";").forEach((c) => {
    const i = c.indexOf("=");
    if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
  });
  return validToken(cookies.astra_session);
}

/** The current identity. Stored as JSON beside the icons. */
function readState() {
  try { return JSON.parse(readFileSync(join(BRAND_DIR, "state.json"), "utf8")); }
  catch { return { name: "Astra", tagline: "Command Center", rev: 0 }; }
}
/**
 * Persist the state atomically, SYNCHRONOUSLY.
 *
 * WHY NOT A STREAM: `createWriteStream(tmp).end(json, cb)` returns before the
 * bytes are flushed and before the rename, so any read in the next tick sees the
 * PREVIOUS state. That is not theoretical — the e2e caught it: a rename saved,
 * then an immediate ungated GET returned the old name. A brand write is rare
 * and tiny, so correctness beats throughput here; writeFileSync + renameSync is
 * two syscalls and leaves no torn file for a reader to see.
 */
function writeState(s) {
  mkdirSync(BRAND_DIR, { recursive: true });
  const p = join(BRAND_DIR, "state.json");
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(s));
  renameSync(tmp, p);
}

/** POST /api/brand/icon — upload the logo. Cookie-gated. */
export function handleBrandUpload(req, res, validToken) {
  if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); return res.end(); }
  if (!authed(req, validToken)) { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":"unauthenticated"}'); }

  const rawName = decodeURIComponent(req.headers["x-file-name"] || "");
  const ext = extname(rawName).toLowerCase();
  if (!ALLOWED.has(ext)) {
    res.writeHead(415, { "content-type": "application/json" });
    return res.end('{"error":"unsupported image type (png, svg, ico, webp, jpg)"}');
  }

  const chunks = [];
  let size = 0, tooBig = false;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BYTES) { tooBig = true; req.destroy(); return; }
    chunks.push(c);
  });
  req.on("error", () => { if (!res.headersSent) { res.writeHead(400); res.end(); } });
  req.on("end", () => {
    if (tooBig) { res.writeHead(413, { "content-type": "application/json" }); return res.end('{"error":"file too large (4MB cap)"}'); }
    let buf = Buffer.concat(chunks);

    if (ext === ".svg") {
      const clean = sanitizeSvg(buf.toString("utf8"));
      // A payload-only sanitizer leaves a file that is EMPTY of shapes — that
      // is a broken logo, not a safe one. Refuse rather than paint nothing.
      if (!/<(path|circle|rect|ellipse|polygon|polyline|line|text|image)\b/i.test(clean)) {
        res.writeHead(422, { "content-type": "application/json" });
        return res.end('{"error":"that SVG has no drawable content left after sanitising"}');
      }
      buf = Buffer.from(clean, "utf8");
    }

    const state = readState();
    const rev = (state.rev || 0) + 1;
    mkdirSync(ICONS, { recursive: true });
    const stored = `icon-r${rev}${ext}`;
    createWriteStream(join(ICONS, stored)).end(buf);
    writeState({ ...state, rev, icon: stored, name: state.name, tagline: state.tagline });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, url: `/api/brand/icon/${stored}`, rev }));
  });
}

/** POST /api/brand/text — set the app name and tagline. Cookie-gated. */
export function handleBrandText(req, res, validToken) {
  if (req.method !== "POST" && req.method !== "PUT") { res.writeHead(405, { allow: "POST, PUT" }); return res.end(); }
  if (!authed(req, validToken)) { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":"unauthenticated"}'); }
  const chunks = [];
  let size = 0;
  req.on("data", (c) => { size += c.length; if (size > 8192) { req.destroy(); return; } chunks.push(c); });
  req.on("end", () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const state = readState();
      // Bounded length: an unbounded name breaks the sidebar layout, and the
      // wordmark auto-scale has a floor it cannot go below.
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : state.name;
      const tagline = typeof body.tagline === "string" ? body.tagline.trim().slice(0, 40) : state.tagline;
      const next = { ...state, name: name || "Astra", tagline, rev: (state.rev || 0) + 1 };
      writeState(next);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, ...next }));
    } catch { res.writeHead(400, { "content-type": "application/json" }); res.end('{"error":"bad json"}'); }
  });
}

/** GET /api/brand/icon/:name — gated, like every other stored asset. */
export function handleBrandIcon(req, res, validToken, name) {
  if (!authed(req, validToken)) { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":"unauthenticated"}'); }
  const clean = basename(name);
  const file = join(ICONS, clean);
  if (!file.startsWith(ICONS) || !existsSync(file)) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":"not found"}'); }
  res.writeHead(200, {
    "content-type": MIME[extname(clean).toLowerCase()] || "application/octet-stream",
    // The ?v=<rev> on the URL already busts the cache; this keeps a stale one
    // from being reused between revs.
    "cache-control": "private, max-age=86400",
  });
  // createReadStream, NOT createWriteStream: the latter opens the file for
  // WRITING and is not readable, so piping it into res threw ERR_STREAM_CANNOT_PIPE
  // and killed the process. The write stream is for saving; this is a read.
  return createReadStream(file).pipe(res);
}

/** GET /api/brand/state — UNGATED (a name and a logo are not secrets). */
export function handleBrandState(req, res) {
  const s = readState();
  res.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify({
    name: s.name || "Astra",
    tagline: s.tagline || "",
    icon32: s.icon ? `/api/brand/icon/${s.icon}` : null,
    rev: s.rev || 0,
  }));
}

/**
 * GET /api/brand/manifest — UNGATED, and it is a DYNAMIC document so the icon
 * follows the app without a rebuild.
 *
 * icon src must be ROOT-RELATIVE: a relative path resolves against the
 * MANIFEST's own directory, which is the classic "PWA icon does not load".
 */
export function handleBrandManifest(req, res) {
  const s = readState();
  const icon = s.icon ? `/api/brand/icon/${s.icon}` : null;
  const entries = icon
    ? [
        { src: icon, sizes: "192x192", type: MIME[extname(s.icon).toLowerCase()] || "image/png", purpose: "any" },
        { src: icon, sizes: "512x512", type: MIME[extname(s.icon).toLowerCase()] || "image/png", purpose: "any" },
        // A maskable variant is a SEPARATE entry: writing purpose:"any maskable"
        // on one file makes Chrome warn.
        { src: icon, sizes: "512x512", type: MIME[extname(s.icon).toLowerCase()] || "image/png", purpose: "maskable" },
      ]
    : [];
  res.writeHead(200, {
    "content-type": "application/manifest+json",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify({
    name: s.name || "Astra",
    short_name: (s.name || "Astra").slice(0, 12),
    description: s.tagline || "",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0f",
    theme_color: "#0a0a0f",
    icons: entries,
  }));
}
