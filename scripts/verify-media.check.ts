// verify-media: assertions for the media overhaul libs (plan §11).
// Run: node scripts/verify-media.check.ts  → "verify-media: N assertions passed", exit 0.
import { strict as assert } from "node:assert";
import {
  mediaKind, needsTranscode, isNativeVideo, badgeLabel, kindInfo, extOf,
  TRANSCODABLE_EXTS,
} from "../src/lib/media-kinds.ts";
import { mediaPaths, MEDIA_RE, downloadUrl, streamUrl, transcodeUrl } from "../src/lib/media-paths.ts";
import { bentoLayout, AREAS } from "../src/lib/bento.ts";
import { uniqueUploadName, displayName, newId } from "../src/lib/upload-names.ts";
import { loadDraft, saveDraft, clearDraft, moveDraft, draftKey, type KV } from "../src/lib/drafts.ts";

let n = 0;
const ok = (cond: boolean, msg: string) => { assert.ok(cond, msg); n++; };

// ── R1 kinds ──
ok(mediaKind("a.HEIC") === "image", "heic is image");
ok(needsTranscode("a.heic"), "heic needs transcode");
ok(!needsTranscode("a.webp"), "webp native (transcode fallback only)");
ok(mediaKind("x.ts") === "text", "ts is TEXT (TypeScript), not MPEG-TS");
ok(mediaKind("x.csv") === "xlsx", "csv maps to xlsx kind");
ok(mediaKind("x.zip") === "archive", "zip is archive");
ok(mediaKind("noext") === "other", "no ext → other");
ok(isNativeVideo("a.mp4"), "mp4 native video");
ok(!isNativeVideo("a.avi"), "avi not native");
ok(badgeLabel("r.pdf") === "PDF", "pdf badge");
ok(badgeLabel("noext") === "FILE", "no-ext badge FILE");
ok(extOf("a.png?query=1") === "png", "extOf strips query");
ok(needsTranscode("a.mov") === false, "mov native-FIRST (fallback only)");
ok(kindInfo("a.heic").card === true, "heic carded");
ok(kindInfo("x.py").card === false, "code files not carded");

// ── R1 drift vs server sets ──
const { VIDEO_TRANSCODE, IMAGE_TRANSCODE } = await import("../server/transcode.mjs");
const server = new Set<string>([...VIDEO_TRANSCODE, ...IMAGE_TRANSCODE]);
for (const e of TRANSCODABLE_EXTS) ok(server.has(e), `client transcodable ${e} must be in server sets`);
const drift = [...server].filter((e) => !TRANSCODABLE_EXTS.includes(e));
ok(drift.length === 1 && drift[0] === "ts", `server − client must be exactly ["ts"], got ${JSON.stringify(drift)}`);

// ── R2 detection ──
ok(JSON.stringify(mediaPaths("MEDIA:/home/x/a.png")) === JSON.stringify(["/home/x/a.png"]), "MEDIA: marker");
ok(mediaPaths("see /home/x/r.pdf and ~/b.docx, /h/c.xlsx").length === 3, "docs detected");
ok(mediaPaths("see /home/x/r.pdf and ~/b.docx, /h/c.xlsx")[0] === "/home/x/r.pdf", "order preserved");
ok(mediaPaths("image at https://x.com/a.pdf end").length === 0, "URL rejected");
ok(mediaPaths("```\n/home/x/a.pdf\n```").length === 0, "fenced excluded");
ok(mediaPaths("```\nunterminated /home/x/a.pdf").length === 0, "unterminated fence excluded");
ok(mediaPaths("`/home/x/a.png`").length === 0, "inline backticks excluded");
ok(JSON.stringify(mediaPaths("real /h/a.png and `/h/b.png`")) === JSON.stringify(["/h/a.png"]), "mixed keeps real");
ok(mediaPaths("edited /h/src/x.ts").length === 0, "code file not carded");
ok(JSON.stringify(mediaPaths("dup /h/a.png /h/a.png")) === JSON.stringify(["/h/a.png"]), "dedupe");
ok(mediaPaths("see ~/.hermes/images/a.png and /home/x/uploads/b.png plus /home/x/uploads/b.png again, ~/c.mp4").length === 3, "existing case 15 inputs");
ok(MEDIA_RE.source.includes("heic"), "MEDIA_RE built from CARD_EXTS (heic present)");
ok(mediaPaths("watch /h/v.avi and /h/v.wmv").length === 2, "transcodable videos carded");
ok(mediaPaths("read /h/notes.md and /h/data.json and /h/sheet.csv").length === 3, "text/doc carded");

// ── R3 bento ──
const clses = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => bentoLayout(i).cls);
ok(JSON.stringify(clses) === JSON.stringify(["mg-0", "mg-1", "mg-2", "mg-3", "mg-4", "mg-5", "mg-5", "mg-5", "mg-5", "mg-5"]), "bento cls");
const overflows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => bentoLayout(i).overflow);
ok(JSON.stringify(overflows) === JSON.stringify([0, 0, 0, 0, 0, 0, 1, 2, 3, 4]), "bento overflow");
ok([0, 3, 5, 9].every((i) => bentoLayout(i).visible === Math.min(i, 5)), "visible = min(n,5)");
ok(AREAS.length === 5, "five areas");

// ── R8c names ──
{
  const names = new Set<string>();
  for (let i = 0; i < 1000; i++) names.add(uniqueUploadName("image.png"));
  ok(names.size === 1000, "1000 unique names");
  ok([...names].every((s) => /^image-[0-9a-f]{8}\.png$/.test(s)), "name shape image-<8hex>.png");
}
ok(uniqueUploadName("my file (1).tar.gz", "abcd1234") === "my_file_1_.tar-abcd1234.gz", "sanitize + split ext");
ok(uniqueUploadName("", "abcd1234") === "file-abcd1234", "empty stem → file");
ok(displayName("image-abcd1234.png") === "image.png", "displayName strips suffix");
ok(displayName("Makefile-abcd1234") === "Makefile", "displayName no-ext");
ok(displayName("notes.txt") === "notes.txt", "displayName plain untouched");
{
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i++) ids.add(newId());
  ok(ids.size === 1000, "newId distinct");
}

// ── R8f drafts ──
{
  const store = new Map<string, string>();
  const kv: KV = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
  saveDraft(kv, "s1", "hello world");
  ok(loadDraft(kv, "s1") === "hello world", "draft round-trip");
  saveDraft(kv, "s1", "   ");
  ok(loadDraft(kv, "s1") === "", "blank draft removes key");
  ok(draftKey(null) === "astra:draft:new", "null sid → new");
  saveDraft(kv, null, "typed on new chat");
  moveDraft(kv, null, "s2");
  ok(loadDraft(kv, "s2") === "typed on new chat", "moveDraft moves");
  ok(loadDraft(kv, null) === "", "moveDraft removes source");
  clearDraft(kv, "s2");
  ok(loadDraft(kv, "s2") === "", "clearDraft");
  const throwing: KV = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
  ok(loadDraft(throwing, "s") === "", "throwing KV → empty string");
}

// ── tilde paths must reach the server intact (regression: `~/uploads/a.png` became `/uploads/a.png`) ──
ok(downloadUrl("~/uploads/a.png") === "/api/hx/files/download?path=~%2Fuploads%2Fa.png", "download keeps ~/");
ok(streamUrl("~/uploads/a.mp4") === "/api/hx/files/stream?path=~%2Fuploads%2Fa.mp4", "stream keeps ~/");
ok(transcodeUrl("~/a.heic") === "/api/media/transcode?path=~%2Fa.heic", "transcode keeps ~/");
ok(downloadUrl("/home/x/a.png") === "/api/hx/files/download?path=%2Fhome%2Fx%2Fa.png", "absolute path unchanged");

console.log(`verify-media: ${n} assertions passed`);
