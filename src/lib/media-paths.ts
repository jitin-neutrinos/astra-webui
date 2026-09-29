export const MEDIA_RE = /(?<![\w:])(?<!\/)(?:~|\/)[\w./-]*\.(?:png|jpe?g|gif|webp|mp4|webm|mov|mkv|avi|mp3|wav|ogg|flac|m4a|opus)\b/gi;

export function mediaPaths(text: string) {
  // MEDIA:<path> markers carry a colon before the path — the URL guard would reject them, so strip the marker first
  return [...new Set(text.replace(/\bMEDIA:\s*(?=[~/])/g, "").match(MEDIA_RE) ?? [])];
}

export function stripMediaLines(t: string) {
  return t.replace(/^\s*MEDIA:\s*\S+\s*$/gm, "").trim();
}

export function extractAttachments(content: string) {
  const files: { name: string; path: string }[] = [];
  const lines = content.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const m = line.match(/^Attached file:\s*(.*)$/);
    if (m) {
      const path = m[1].trim();
      const name = path.split('/').pop() || path;
      files.push({ name, path });
    } else {
      kept.push(line);
    }
  }
  return { text: kept.join('\n').trim(), files };
}

// ── URL + type helpers for the media cards/viewer (proxy → transcode chain) ──
// The four format lists contract (client regex, getFileKind, transcode sets,
// gateway allowlist) is documented in the astra-webui skill: edit together.

export function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

// Encodes a host path for the astra proxy's download/stream endpoints.
function encoded(path: string): string {
  return encodeURIComponent(path.replace(/^~(?=\/)/, ""));
}

export function downloadUrl(path: string): string {
  return `/api/hx/files/download?path=${encoded(path)}`;
}

export function streamUrl(path: string): string {
  return `/api/hx/files/stream?path=${encoded(path)}`;
}

export function transcodeUrl(path: string): string {
  return `/api/media/transcode?path=${encoded(path)}`;
}

// Mirror of server/transcode.mjs VIDEO_TRANSCODE/IMAGE_TRANSCODE sets: which
// side of "browser-native vs ffmpeg" a name falls on.
const TRANSCODE_VIDEO = new Set(["avi", "wmv", "flv", "mpg", "mpeg", "3gp", "mts", "m2ts", "vob", "ogv", "mkv", "mov", "m4v", "ts"]);
const TRANSCODE_IMAGE = new Set(["heic", "heif", "tiff", "tif", "avif", "bmp", "psd"]);

export function needsTranscode(name: string): boolean {
  const e = ext(name);
  return TRANSCODE_VIDEO.has(e) || TRANSCODE_IMAGE.has(e);
}

export function mediaMime(name: string): string {
  const map: Record<string, string> = {
    mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", mkv: "video/x-matroska",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", m4a: "audio/mp4", opus: "audio/ogg",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  };
  return map[ext(name)] || "application/octet-stream";
}
