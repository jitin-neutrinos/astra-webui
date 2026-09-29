// Single classification table for every format decision in the app (R1).
// Pure: no DOM, no imports. Server-side set drift is checked by scripts/verify-media.check.ts.
export type MediaKind = "image" | "video" | "audio" | "pdf" | "docx" | "xlsx" | "pptx" | "text" | "archive" | "other";
export type KindInfo = { kind: MediaKind; native: boolean; transcodable: boolean; streamable: boolean; card: boolean };

// ext → [kind, native, transcodable, streamable, card]
// n=native (browser renders directly) · t=in a server transcode set · s=gateway /stream allowlist · c=getFileKind card
const TABLE: Record<string, [MediaKind, boolean, boolean, boolean, boolean]> = {
  // images
  png: ["image", true, false, false, true],
  jpg: ["image", true, false, false, true],
  jpeg: ["image", true, false, false, true],
  gif: ["image", true, false, false, true],
  webp: ["image", true, true, false, true],
  svg: ["image", true, false, false, true],
  avif: ["image", true, true, false, true],
  bmp: ["image", true, true, false, true],
  ico: ["image", true, false, false, true],
  heic: ["image", false, true, false, true],
  heif: ["image", false, true, false, true],
  tif: ["image", false, true, false, true],
  tiff: ["image", false, true, false, true],
  psd: ["image", false, true, false, true],
  // video — mov/mkv/m4v/ogv native-FIRST (one-shot transcode fallback), rest go straight to transcode
  mp4: ["video", true, false, true, true],
  webm: ["video", true, false, true, true],
  mov: ["video", true, true, true, true],
  mkv: ["video", true, true, true, true],
  m4v: ["video", true, true, false, true],
  ogv: ["video", true, true, false, true],
  avi: ["video", false, true, true, true],
  wmv: ["video", false, true, false, true],
  flv: ["video", false, true, false, true],
  mpg: ["video", false, true, false, true],
  mpeg: ["video", false, true, false, true],
  "3gp": ["video", false, true, false, true],
  mts: ["video", false, true, false, true],
  m2ts: ["video", false, true, false, true],
  vob: ["video", false, true, false, true],
  // audio (all native, all carded)
  mp3: ["audio", true, false, true, true],
  wav: ["audio", true, false, true, true],
  ogg: ["audio", true, false, true, true],
  flac: ["audio", true, false, true, true],
  m4a: ["audio", true, false, true, true],
  opus: ["audio", true, false, true, true],
  oga: ["audio", true, false, false, true],
  aac: ["audio", true, false, false, true],
  weba: ["audio", true, false, false, true],
  // documents
  pdf: ["pdf", false, false, false, true],
  docx: ["docx", false, false, false, true],
  xlsx: ["xlsx", false, false, false, true],
  xls: ["xlsx", false, false, false, true],
  ods: ["xlsx", false, false, false, true],
  csv: ["xlsx", false, false, false, true],
  pptx: ["pptx", false, false, false, true],
  // text — carded
  txt: ["text", false, false, false, true],
  md: ["text", false, false, false, true],
  log: ["text", false, false, false, true],
  json: ["text", false, false, false, true],
  // text — NOT carded (code/config files stay prose)
  markdown: ["text", false, false, false, false],
  jsonl: ["text", false, false, false, false],
  xml: ["text", false, false, false, false],
  yaml: ["text", false, false, false, false],
  yml: ["text", false, false, false, false],
  toml: ["text", false, false, false, false],
  ini: ["text", false, false, false, false],
  conf: ["text", false, false, false, false],
  env: ["text", false, false, false, false],
  html: ["text", false, false, false, false],
  htm: ["text", false, false, false, false],
  css: ["text", false, false, false, false],
  js: ["text", false, false, false, false],
  mjs: ["text", false, false, false, false],
  cjs: ["text", false, false, false, false],
  jsx: ["text", false, false, false, false],
  ts: ["text", false, false, false, false], // `ts` is TEXT here (TypeScript); server keeps it in its video set — verify-media allows exactly that one exception
  tsx: ["text", false, false, false, false],
  py: ["text", false, false, false, false],
  sh: ["text", false, false, false, false],
  rs: ["text", false, false, false, false],
  go: ["text", false, false, false, false],
  java: ["text", false, false, false, false],
  c: ["text", false, false, false, false],
  h: ["text", false, false, false, false],
  cpp: ["text", false, false, false, false],
  sql: ["text", false, false, false, false],
  tsv: ["text", false, false, false, false],
  // archives
  zip: ["archive", false, false, false, true],
  tar: ["archive", false, false, false, true],
  gz: ["archive", false, false, false, true],
  tgz: ["archive", false, false, false, true],
  bz2: ["archive", false, false, false, true],
  xz: ["archive", false, false, false, true],
  "7z": ["archive", false, false, false, true],
  rar: ["archive", false, false, false, true],
};

const UNKNOWN: KindInfo = { kind: "other", native: false, transcodable: false, streamable: false, card: false };

export function extOf(name: string): string {
  const base = name.split("?")[0];
  const i = base.lastIndexOf(".");
  return i === -1 ? "" : base.slice(i + 1).toLowerCase();
}

export function kindInfo(name: string): KindInfo {
  const row = TABLE[extOf(name)];
  if (!row) return UNKNOWN;
  const [kind, native, transcodable, streamable, card] = row;
  return { kind, native, transcodable, streamable, card };
}

export function mediaKind(name: string): MediaKind {
  return kindInfo(name).kind;
}

// (image|video) && !native && transcodable — i.e. the browser truly cannot show it.
// mov/mkv/m4v/ogv are native-FIRST: needsTranscode=false, transcode is only an onError fallback.
export function needsTranscode(name: string): boolean {
  const i = kindInfo(name);
  return (i.kind === "image" || i.kind === "video") && !i.native && i.transcodable;
}

export function isNativeImage(name: string): boolean {
  const i = kindInfo(name);
  return i.kind === "image" && i.native;
}

export function isNativeVideo(name: string): boolean {
  const i = kindInfo(name);
  return i.kind === "video" && i.native;
}

export function isVisual(k: MediaKind): boolean {
  return k === "image" || k === "video";
}

export function badgeLabel(name: string): string {
  const e = extOf(name);
  return e ? e.toUpperCase() : "FILE";
}

/** Extensions that produce a card, sorted by length desc (regex alternation source: longest-first match). */
export const CARD_EXTS: readonly string[] = Object.entries(TABLE)
  .filter(([, v]) => v[4])
  .map(([k]) => k)
  .sort((a, b) => b.length - a.length || (a < b ? -1 : 1));

/** Extensions the server can transcode. */
export const TRANSCODABLE_EXTS: readonly string[] = Object.entries(TABLE)
  .filter(([, v]) => v[2])
  .map(([k]) => k)
  .sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
