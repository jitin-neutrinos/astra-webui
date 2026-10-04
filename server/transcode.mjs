// Server-side transcode-on-demand: files the browser can't decode (avi/wmv/heic/
// tiff/mpeg...) are re-encoded with ffmpeg to h264 mp4 / jpg and cached on disk.
// Same-origin with the app, authenticated by the same astra_session cookie.
// ponytail: child_process + fs, zero deps; sync pipe is fine for a single-user app.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const CACHE_DIR = process.env.ASTRA_TRANSCODE_DIR || join(tmpdir(), "astra-transcode-cache");
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const MAX_INPUT_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB — ffmpeg input cap
const MAX_CACHE_BYTES = parseInt(process.env.ASTRA_TRANSCODE_MAX_BYTES || String(512 * 1024 * 1024), 10);
const FFMPEG_TIMEOUT_MS = 1000 * 60 * 10; // kill runaway jobs

// Extensions this endpoint serves, and what each becomes.
export const VIDEO_TRANSCODE = new Set(["avi", "wmv", "flv", "mpg", "mpeg", "3gp", "mts", "m2ts", "vob", "ogv", "mkv", "mov", "m4v", "ts"]);
export const IMAGE_TRANSCODE = new Set(["heic", "heif", "tiff", "tif", "avif", "bmp", "psd", "webp"]);

const MIME_OUT = { video: "video/mp4", image: "image/jpeg" };

// In-process locks so two tabs requesting the same file don't run two ffmpegs.
const inflight = new Map();

function cachePath(kind, src, mtimeMs) {
  const key = createHash("sha256").update(`${src}:${mtimeMs}:${kind}`).digest("hex").slice(0, 24);
  return join(CACHE_DIR, `${kind}-${key}.${kind === "video" ? "mp4" : "jpg"}`);
}

function evictStale() {
  try {
    const now = Date.now();
    for (const f of readdirCache()) {
      if (now - statSync(f).mtimeMs > CACHE_TTL_MS) { try { unlinkSync(f); } catch { /* gone */ } }
    }
  } catch { /* cache dir unreadable — ignore */ }
}

// LRU size cap: when total cache size exceeds MAX_CACHE_BYTES, delete
// oldest-atime files until back under. `protect` (the file just written) is
// never evicted here — a single oversized output is removed by the caller's
// failure path instead, so a >cap file can never 410 its own request.
function evictSize(protect) {
  try {
    let total = 0;
    const files = [];
    for (const f of readdirCache()) {
      try {
        const st = statSync(f);
        total += st.size;
        files.push({ path: f, atimeMs: st.atimeMs, size: st.size });
      } catch { /* gone */ }
    }
    if (total <= MAX_CACHE_BYTES) return;
    files.sort((a, b) => a.atimeMs - b.atimeMs); // oldest first
    for (const f of files) {
      if (total <= MAX_CACHE_BYTES) break;
      if (protect && f.path === protect) continue;
      try {
        unlinkSync(f.path);
        total -= f.size;
      } catch { /* gone */ }
    }
  } catch { /* ignore */ }
}

function readdirCache() {
  try { return (readdirSync(CACHE_DIR) || []).map(f => join(CACHE_DIR, f)); }
  catch { return []; }
}

function cleanupCb(output) {
  return () => { try { if (existsSync(output)) unlinkSync(output); } catch { /* gone */ } };
}

// Run ffmpeg to produce `output`; resolves on success, rejects on failure.
// `args` must NOT include the output path — it is appended here (single source of truth).
function runFfmpeg(args, output, timeoutMs = FFMPEG_TIMEOUT_MS) {
  if (process.env.ASTRA_TRANSCODE_DEBUG) console.error("[transcode] argv:", JSON.stringify(["ffmpeg", ...args, output]));
  return new Promise((res, rej) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, output], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", d => { stderr = (stderr + d).slice(-4000); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); rej(new Error("transcode timeout")); }, timeoutMs);
    child.on("error", e => { clearTimeout(timer); rej(e); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0 && existsSync(output) && statSync(output).size > 0) res();
      else {
        const why = stderr.trim() || `exit=${code} output=${existsSync(output) ? "exists" : "missing"}`;
        rej(new Error(why.split("\n").filter(Boolean).pop() || `ffmpeg exited ${code}`));
      }
    });
  });
}

function transcodeVideo(input, output) {
  // ponytail: fixed 720p ceiling + faststart; crf 23 keeps quality sane without measuring
  return runFfmpeg(["-i", input, "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"], output);
}

function transcodeImage(input, output) {
  return runFfmpeg(["-i", input, "-frames:v", "1", "-q:v", "2"], output);
}

function cookieOk(req, validToken) {
  const cookies = {};
  (req.headers.cookie || "").split(";").forEach(c => {
    const i = c.indexOf("=");
    if (i > 0) cookies[c.slice(0, i).trim()] = c.slice(i + 1).trim();
  });
  return validToken(cookies["astra_session"]);
}

// Entry point called from server.mjs for GET /api/media/transcode?path=...
export async function handleTranscode(req, res, validToken) {
  if (!cookieOk(req, validToken)) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end('{"error":"unauthenticated"}');
  }
  const url = new URL(req.url, "http://x");
  const src = url.searchParams.get("path") || "";

  // Path-safety: only absolute-canonical paths under an allowed root. The
  // existing /api/hx/files/* proxy already serves any path with this same
  // cookie (Hermes policy governs), so this guard is defense-in-depth against
  // traversal tricks, not the primary boundary.
  // `~` / `~/x` mean the user's home (same expansion the Hermes files API does); path.resolve alone
  // would treat "~" as a relative directory name and resolve it against the server's cwd.
  const resolved = resolve(src === "~" || src.startsWith("~/") ? homeRoot() + src.slice(1) : src);
  const roots = [homeRoot(), "/tmp", "/media"];
  if (!roots.some(r => resolved === r || resolved.startsWith(r + sep))) {
    res.writeHead(403, { "content-type": "application/json" });
    return res.end('{"error":"forbidden path"}');
  }
  const e = (resolved.split(".").pop() || "").toLowerCase();
  const kind = VIDEO_TRANSCODE.has(e) ? "video" : IMAGE_TRANSCODE.has(e) ? "image" : null;
  if (!kind) {
    res.writeHead(415, { "content-type": "application/json" });
    return res.end('{"error":"unsupported media type"}');
  }
  let st;
  try { st = statSync(resolved); } catch {
    res.writeHead(404, { "content-type": "application/json" });
    return res.end('{"error":"file not found"}');
  }
  if (!st.isFile() || st.size > MAX_INPUT_BYTES) {
    res.writeHead(413, { "content-type": "application/json" });
    return res.end('{"error":"file too large"}');
  }

  const output = cachePath(kind, resolved, st.mtimeMs);
  mkdirSync(CACHE_DIR, { recursive: true });

  try {
    if (!existsSync(output)) {
      if (inflight.has(output)) {
        await inflight.get(output);
      } else {
        const job = (kind === "video" ? transcodeVideo : transcodeImage)(resolved, output)
          .finally(() => inflight.delete(output));
        inflight.set(output, job);
        evictStale();
        await job;
        evictSize(output);
      }
    }
  } catch (err) {
    cleanupCb(output)(); // never keep a half-written transcode
    res.writeHead(500, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "transcode failed", detail: String(err?.message || err) }));
  }

  // Serve — failures here must NOT delete the good cached file above.
  let outStat;
  try {
    outStat = statSync(output);
  } catch {
    res.writeHead(410, { "content-type": "application/json" });
    return res.end('{"error":"cache entry evicted"}');
  }
  const range = req.headers.range;
  const headers = {
    "content-type": MIME_OUT[kind],
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=86400",
  };
  // Range support so <video> can seek inside transcoded mp4s.
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : outStat.size - 1;
    if (isNaN(start) || start >= outStat.size) start = 0;
    if (isNaN(end) || end >= outStat.size) end = outStat.size - 1;
    res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${outStat.size}`, "content-length": end - start + 1 });
    if (req.method === "HEAD") return res.end();
    return createReadStream(output, { start, end }).on("error", () => res.destroy()).pipe(res);
  }
  headers["content-length"] = outStat.size;
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  return createReadStream(output).on("error", () => res.destroy()).pipe(res);
}

function homeRoot() {
  // Transcodeable sources must live under the user's home (same surface the
  // agent writes to); resolve once per call — cheap, and survives HOME changes.
  return resolve(process.env.HOME || "/");
}
