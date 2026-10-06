// theme-font.mjs — font asset surface for the theme engine.
//
// Routes (cookie-gated via validToken, same as every other API here):
//   POST /api/theme/font                      raw body + x-file-name -> saves, returns {url,family,...}
//   GET  /api/theme/font/:name                streams a stored face (Range supported)
//   GET  /api/theme/font/google/:family.css   fetches the css2 @font-face block, caches every
//                                             woff2 locally, rewrites url() to our own origin
//                                             and returns the rewritten CSS
//
// WHY THE GOOGLE PROXY EXISTS: fonts.googleapis.com is a third-party origin. A
// perf pass already removed the render-blocking <link> to it in favour of
// self-hosted faces, and a dynamic <link> would put that cost straight back.
// Fetching server-side with a MODERN User-Agent is also required for the right
// file format: css2 silently degrades to .ttf for an old UA (verified with
// Mozilla/4.0), so a client-side fetch with an unrecognised UA would cache a
// 10x-larger file and never know.
//
// Zero dependencies, stdlib only.
import { createWriteStream, createReadStream, existsSync, mkdirSync, statSync, readFileSync } from "node:fs";
import { join, resolve, extname, basename } from "node:path";
import { readFontMeta } from "./font-meta.mjs";

const FONT_DIR = resolve(import.meta.dirname, "..", "data", "theme-font");
const GOOGLE_DIR = join(FONT_DIR, "google");

// 4 MB: a text face is 30-150 KB as woff2, and a CJK face tops out around
// 10 MB. The backdrop's 95 MB cap is for VIDEO and would be a DoS surface here.
const MAX_BYTES = 4 * 1024 * 1024;

// .eot is deliberately absent — IE <= 8 only, and it is a script-execution
// surface. Rejecting it is better than sanitising it.
const ALLOWED = new Set([".woff2", ".woff", ".ttf", ".otf"]);
const MIME = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

// A modern Chrome UA. Required: css2 returns .ttf for anything it does not
// recognise as supporting woff2.
const MODERN_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function authed(req, validToken) {
  const cookies = {};
  (req.headers.cookie || "").split(";").forEach((c) => {
    const i = c.indexOf("=");
    if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
  });
  return validToken(cookies.astra_session);
}

/** Family name -> a filesystem-safe, collision-free stem. */
function slug(family) {
  const s = String(family || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "font";
}

/** Reject anything that is not a real font container, by magic bytes. */
function sniff(buf) {
  const head = buf.subarray(0, 4);
  const four = head.toString("latin1");
  // TrueType: 0x00010000 or "true"/"ttcf"
  if (head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0) return ".ttf";
  if (four === "true" || four === "ttcf") return ".ttf";
  if (four === "wOF2") return ".woff2";
  if (four === "wOFF") return ".woff";
  if (four === "OTTO") return ".otf";
  return null;
}

/** POST /api/theme/font — raw body (like the backdrop) with x-file-name. */
export function handleFontUpload(req, res, validToken) {
  if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); return res.end(); }
  if (!authed(req, validToken)) { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":"unauthenticated"}'); }

  const rawName = decodeURIComponent(req.headers["x-file-name"] || "");
  if (!rawName) { res.writeHead(400, { "content-type": "application/json" }); return res.end('{"error":"x-file-name required"}'); }
  const ext = extname(rawName).toLowerCase();
  if (!ALLOWED.has(ext)) {
    res.writeHead(415, { "content-type": "application/json" });
    return res.end('{"error":"unsupported font type (woff2, woff, ttf, otf)"}');
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
    const buf = Buffer.concat(chunks);
    const sniffed = sniff(buf);
    if (!sniffed) {
      res.writeHead(415, { "content-type": "application/json" });
      return res.end('{"error":"not a recognised font file (bad magic bytes)"}');
    }

    // Read the family's own name out of the file. stdlib only, no fontTools.
    // The NAME TABLE is the authority: a file called "Inter-Bold.woff2" that
    // actually contains something else must not be labelled Inter.
    let meta = null;
    try { meta = readFontMeta(buf); } catch { /* keep going: upload still valid */ }

    const family = meta?.family || basename(rawName, ext);
    const stem = `${slug(family)}-${Date.now().toString(36)}`;
    mkdirSync(FONT_DIR, { recursive: true });
    const stored = `${stem}${sniffed}`;
    createWriteStream(join(FONT_DIR, stored)).end(buf);

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      url: `/api/theme/font/${stored}`,
      bytes: buf.length,
      // The FILE's own family string, not the filename's: DM Sans ships as
      // "DM Sans 9pt", so a picker inferring from the filename would mislabel it.
      family,
      variable: !!meta?.variable,
      axes: meta?.axes ?? [],
      format: sniffed.slice(1),
    }));
  });
}

/** GET /api/theme/font/:name — serve a stored face, Range supported. */
export function handleFontServe(req, res, validToken, name) {
  if (!authed(req, validToken)) { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":"unauthenticated"}'); }
  const clean = basename(name); // no traversal
  const file = join(FONT_DIR, clean);
  if (!file.startsWith(FONT_DIR) || !existsSync(file)) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":"not found"}'); }
  const ext = extname(clean).toLowerCase();
  const size = statSync(file).size;
  const type = MIME[ext] || "application/octet-stream";
  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m && m[1] ? parseInt(m[1]) : 0;
    let end = m && m[2] ? parseInt(m[2]) : size - 1;
    if (isNaN(start) || start >= size) { res.writeHead(416, { "content-range": `bytes */${size}` }); return res.end(); }
    if (isNaN(end) || end >= size) end = size - 1;
    res.writeHead(206, {
      "content-type": type, "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${size}`,
      "accept-ranges": "bytes",
      // private: the response is cookie-gated, so a shared proxy must not cache it
      "cache-control": "private, max-age=86400",
      "access-control-allow-origin": "*",
    });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, {
    "content-type": type, "content-length": size, "accept-ranges": "bytes",
    "cache-control": "private, max-age=86400",
    // ACAO is cheap and makes a self-hosted face usable from a CDN origin later.
    "access-control-allow-origin": "*",
  });
  createReadStream(file).pipe(res);
}

/**
 * GET /api/theme/font/google/:family.css — a self-hosted Google font.
 *
 * Fetches the css2 @font-face block with a modern UA, downloads each woff2 to
 * data/theme-font/google/, and returns the CSS with every url() repointed at
 * our own /api/theme/font/google/... path. The browser then never contacts
 * Google at runtime, which is the whole point.
 *
 * FAIL-THROUGH IS DELIBERATE: if the fetch or a download fails, the ORIGINAL
 * css2 text is returned with its googleapis url() intact. A font that loads
 * late beats a card that renders broken because a CDN was briefly down.
 */
export async function handleGoogleFontCss(req, res, validToken, family) {
  if (!authed(req, validToken)) { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":"unauthenticated"}'); }
  const fam = String(family || "").trim().slice(0, 64);
  if (!/^[\w .'-]{1,64}$/.test(fam)) {
    res.writeHead(400, { "content-type": "application/json" });
    return res.end('{"error":"bad family name"}');
  }

  const cacheKey = `${slug(fam)}.css`;
  const cached = join(GOOGLE_DIR, cacheKey);
  if (existsSync(cached)) {
    res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "private, max-age=86400" });
    return res.end(readFileSync(cached, "utf8"));
  }

  // css2 wants spaces as '+'. Axis tuples are omitted deliberately: a wrong
  // axis 400s (verified), and the static-weight form works for every family
  // whether or not it is variable.
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, "+")}:wght@300;400;500;600;700&display=swap`;
  let css, ctype = "";
  try {
    const r = await fetch(url, { headers: { "user-agent": MODERN_UA } });
    if (!r.ok) { res.writeHead(r.status, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: `css2 returned ${r.status}` })); }
    ctype = (r.headers.get("content-type") || "").toLowerCase();
    css = await r.text();
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: `font fetch failed: ${String(e?.message || e).slice(0, 120)}` }));
  }

  // css2's answer starts with a SUBSET COMMENT — "/* devanagari */" — before the
  // first @font-face, so a naive startsWith("@font-face") rejects every perfectly
  // good response. That bug made all six Google families 404 while curl and
  // fetch both returned 200 with valid CSS.
  //
  // The reliable discriminator is the CONTENT TYPE plus a scan for @font-face
  // anywhere: a bad family comes back as text/html, which has no @font-face at all.
  const looksCss = ctype.includes("text/css") && /@font-face/i.test(css);
  if (!looksCss) {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end('{"error":"no such font family"}');
  }

  // Download every referenced woff2 and repoint the url().
  const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]))];
  mkdirSync(GOOGLE_DIR, { recursive: true });
  const map = new Map();
  for (const u of urls) {
    const tail = u.split("/").pop().replace(/[^\w.-]/g, "_");
    const local = join(GOOGLE_DIR, `${slug(fam)}-${tail}`);
    if (!existsSync(local)) {
      try {
        const fr = await fetch(u, { headers: { "user-agent": MODERN_UA } });
        if (!fr.ok) continue; // leave the original url in place; fail-through
        createWriteStream(local).end(Buffer.from(await fr.arrayBuffer()));
      } catch { continue; }
    }
    map.set(u, `/api/theme/font/google/${slug(fam)}-${tail}`);
  }
  let out = css;
  for (const [from, to] of map) out = out.split(from).join(to);

  try { mkdirSync(GOOGLE_DIR, { recursive: true }); (await import("node:fs")).writeFileSync(cached, out); } catch { /* cache is an optimisation */ }
  res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "private, max-age=86400" });
  res.end(out);
}

/** GET /api/theme/font/google/<file> — a cached woff2 from the proxy above. */
export function handleGoogleFontFile(req, res, validToken, name) {
  const clean = basename(name);
  const file = join(GOOGLE_DIR, clean);
  if (!file.startsWith(GOOGLE_DIR) || !existsSync(file)) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":"not found"}'); }
  const size = statSync(file).size;
  const type = MIME[extname(clean).toLowerCase()] || "font/woff2";
  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m && m[1] ? parseInt(m[1]) : 0;
    let end = m && m[2] ? parseInt(m[2]) : size - 1;
    if (isNaN(start) || start >= size) { res.writeHead(416, { "content-range": `bytes */${size}` }); return res.end(); }
    if (isNaN(end) || end >= size) end = size - 1;
    res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "cache-control": "private, max-age=31536000", "access-control-allow-origin": "*" });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes", "cache-control": "private, max-age=31536000", "access-control-allow-origin": "*" });
  createReadStream(file).pipe(res);
}
