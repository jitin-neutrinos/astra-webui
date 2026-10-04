// theme-assets.mjs — theme-engine server surface: backdrop uploads + serving.
// Routes (all cookie-gated via validToken, same as every other API here):
//   POST /api/theme/bg      multipart {file} -> saves under data/theme-bg/, returns {url}
//   GET  /api/theme/bg/:name  -> streams a stored backdrop (Range supported for video)
// Zero-dep multipart parse (single file, buffer-capped 95MB — Cloudflare tunnel cap is 100MB).
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve, extname, basename } from "node:path";
import { createReadStream } from "node:fs";

const BG_DIR = resolve(import.meta.dirname, "..", "data", "theme-bg");
const MAX_BYTES = 95 * 1024 * 1024;
const ALLOWED = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".mp4", ".webm", ".mov", ".m4v"]);
const MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".avif": "image/avif", ".mp4": "video/mp4", ".webm": "video/webm",
  ".mov": "video/quicktime", ".m4v": "video/x-m4v",
};

function authed(req, validToken) {
  const cookies = {};
  (req.headers.cookie || "").split(";").forEach((c) => {
    const i = c.indexOf("=");
    if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
  });
  return validToken(cookies.astra_session);
}

/** POST /api/theme/bg — parse multipart, save, answer {url}. */
export function handleBgUpload(req, res, validToken) {
  if (req.method !== "POST") { res.writeHead(405, { allow: "POST" }); return res.end(); }
  if (!authed(req, validToken)) { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":"unauthenticated"}'); }
  const ct = req.headers["content-type"] || "";
  const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  // RAW upload: the client sends the file as the whole body with its real
  // content-type plus the filename in a header. FormData's multipart encoding
  // is ~30% overhead on a 95MB video and forces the server into a hand-rolled
  // parser, so a single-file upload takes the simpler path. Multipart is still
  // accepted so nothing that already posts FormData breaks.
  const rawName = decodeURIComponent(req.headers["x-file-name"] || "");
  if (!m && rawName) {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BYTES) { tooBig = true; req.destroy(); return; }
      chunks.push(c);
    });
    req.on("error", () => { if (!res.headersSent) { res.writeHead(400); res.end(); } });
    req.on("end", () => {
      if (tooBig) { res.writeHead(413, { "content-type": "application/json" }); return res.end('{"error":"file too large (95MB cap)"}'); }
      const ext = extname(rawName).toLowerCase();
      if (!ALLOWED.has(ext)) { res.writeHead(415, { "content-type": "application/json" }); return res.end('{"error":"unsupported type"}'); }
      const content = Buffer.concat(chunks);
      mkdirSync(BG_DIR, { recursive: true });
      const stamp = Date.now().toString(36);
      const safe = basename(rawName).replace(/[^\w.\- ]+/g, "_");
      const stored = `${stamp}-${safe}`;
      createWriteStream(join(BG_DIR, stored)).end(content);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ url: `/api/theme/bg/${stored}`, bytes: content.length }));
    });
    return;
  }
  if (!m) { res.writeHead(400, { "content-type": "application/json" }); return res.end('{"error":"multipart boundary missing"}'); }
  const boundary = "--" + (m[1] || m[2]);
  const chunks = [];
  let size = 0;
  let tooBig = false;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BYTES) { tooBig = true; req.destroy(); return; }
    chunks.push(c);
  });
  req.on("error", () => { if (!res.headersSent) { res.writeHead(400); res.end(); } });
  req.on("end", async () => {
    if (tooBig) { res.writeHead(413, { "content-type": "application/json" }); return res.end('{"error":"file too large (95MB cap)"}'); }
    const buf = Buffer.concat(chunks);
    // extract first file part: headers \r\n\r\n content \r\n--boundary
    const head = buf.indexOf("\r\n\r\n");
    const fnLine = buf.subarray(0, head).toString("utf8").match(/filename="([^"]+)"/);
    if (head === -1 || !fnLine) { res.writeHead(400, { "content-type": "application/json" }); return res.end('{"error":"no file part"}'); }
    const name = basename(fnLine[1]).replace(/[^\w.\- ]+/g, "_");
    const ext = extname(name).toLowerCase();
    if (!ALLOWED.has(ext)) { res.writeHead(415, { "content-type": "application/json" }); return res.end('{"error":"unsupported type"}'); }
    let content = buf.subarray(head + 4);
    const tail = content.lastIndexOf(`\r\n${boundary}`);
    if (tail !== -1) content = content.subarray(0, tail);
    mkdirSync(BG_DIR, { recursive: true });
    const stamp = Date.now().toString(36);
    const stored = `${stamp}-${name}`;
    createWriteStream(join(BG_DIR, stored)).end(content);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ url: `/api/theme/bg/${stored}`, bytes: content.length }));
  });
}

/** GET /api/theme/bg/:name — serve with Range support (video seeking). */
export async function handleBgServe(req, res, validToken, name) {
  if (!authed(req, validToken)) { res.writeHead(401, { "content-type": "application/json" }); return res.end('{"error":"unauthenticated"}'); }
  const clean = basename(name); // no traversal
  const file = join(BG_DIR, clean);
  if (!file.startsWith(BG_DIR) || !existsSync(file)) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":"not found"}'); }
  const ext = extname(clean).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const size = statSync(file).size;
  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m && m[1] ? parseInt(m[1]) : 0;
    let end = m && m[2] ? parseInt(m[2]) : size - 1;
    if (isNaN(start) || start >= size) { res.writeHead(416, { "content-range": `bytes */${size}` }); return res.end(); }
    if (isNaN(end) || end >= size) end = size - 1;
    res.writeHead(206, {
      "content-type": type,
      "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${size}`,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=86400",
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes", "cache-control": "private, max-age=86400" });
  createReadStream(file).pipe(res);
}
