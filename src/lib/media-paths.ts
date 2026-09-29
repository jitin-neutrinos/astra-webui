import { CARD_EXTS, needsTranscode, kindInfo, mediaKind } from "./media-kinds.ts";

// Paths inside fenced code blocks or inline backticks do NOT become cards (R2):
// code that references /home/x/a.png is prose, not media.
export const MEDIA_RE: RegExp = new RegExp(
  String.raw`(?<![\w:])(?<!/)(?:~|/)[\w./-]*\.(?:` + CARD_EXTS.join("|") + String.raw`)\b`,
  "gi",
);

export function stripCode(text: string): string {
  // fenced ``` / ~~~ blocks (unterminated → to end), then `inline` spans
  let out = text.replace(/(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\3[ \t]*(?=\n|$)|$)/g, "$1 ");
  out = out.replace(/`[^`\n]*`/g, " ");
  return out;
}

export function mediaPaths(text: string) {
  // MEDIA:<path> markers carry a colon before the path — the URL guard would reject them, so strip the marker first
  const stripped = stripCode(text).replace(/\bMEDIA:\s*(?=[~/])/g, "");
  return [...new Set(stripped.match(MEDIA_RE) ?? [])];
}

export const mediaRefs = mediaPaths; // alias used by new code (old name kept: verify-chat-timeline.ts imports it)

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

// ── URL + item helpers for the media grid/viewer (proxy → transcode chain) ──
// Classification lives in media-kinds.ts (single table); server set drift is
// checked by scripts/verify-media.check.ts.

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

export type MediaItem = { path: string | null; url?: string; name: string; size?: number };

// `path` query param for /api/hx/… URLs (RichText <img> click), else null.
export function pathFromApiUrl(url: string): string | null {
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://x");
    if (!u.pathname.startsWith("/api/")) return null;
    return u.searchParams.get("path");
  } catch {
    return null;
  }
}

function baseName(p: string): string {
  return p.split("/").pop() || p;
}

export function toItem(path: string, name?: string): MediaItem {
  const base = baseName(path);
  const label = name || (/\/uploads\//.test(path) ? stripSuffix(base) : base);
  return { path, name: label };
}

// display name for uploads: strip the -<8hex> collision suffix
function stripSuffix(base: string): string {
  return base.replace(/-[0-9a-f]{8}(?=\.[^./]+$|$)/, "");
}

export function imageSrc(it: MediaItem): string {
  if (it.url && !it.path) return it.url;
  return needsTranscode(it.path ?? "") ? transcodeUrl(it.path!) : downloadUrl(it.path ?? "");
}

export function videoSrc(it: MediaItem): string {
  if (it.url && !it.path) return it.url;
  const info = kindInfo(it.path ?? "");
  return needsTranscode(it.path ?? "") ? transcodeUrl(it.path!) : info.streamable ? streamUrl(it.path!) : downloadUrl(it.path!);
}

export function audioSrc(it: MediaItem): string {
  if (it.url && !it.path) return it.url;
  const info = kindInfo(it.path ?? "");
  return info.streamable ? streamUrl(it.path!) : downloadUrl(it.path!);
}

export function canTranscode(name: string): boolean {
  return kindInfo(name).transcodable;
}

export { needsTranscode, mediaKind };
