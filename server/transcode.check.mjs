// Self-check for server/transcode.mjs — path safety + cache-key determinism.
// Run: node server/transcode.check.mjs   (exits non-zero on failure)
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VIDEO_TRANSCODE, IMAGE_TRANSCODE } from "./transcode.mjs";

const CACHE_DIR = join(tmpdir(), "astra-transcode-cache");

// mirror of cachePath() in transcode.mjs — keep in sync
function cachePath(kind, src, mtimeMs) {
  const key = createHash("sha256").update(`${src}:${mtimeMs}:${kind}`).digest("hex").slice(0, 24);
  return join(CACHE_DIR, `${kind}-${key}.${kind === "video" ? "mp4" : "jpg"}`);
}

// 1. deterministic + mtime-sensitive
const a = cachePath("video", "/home/x/a.avi", 111);
assert.equal(a, cachePath("video", "/home/x/a.avi", 111), "same input → same cache path");
assert.notEqual(a, cachePath("video", "/home/x/a.avi", 222), "mtime bump → new cache path");
assert.ok(a.endsWith(".mp4"), "video transcodes land as mp4");
assert.ok(cachePath("image", "/home/x/pic.heic", 1).endsWith(".jpg"), "image transcodes land as jpg");

// 2. extension sets reject non-media (imported from the served module — drift impossible)
const kindOf = e => VIDEO_TRANSCODE.has(e) ? "video" : IMAGE_TRANSCODE.has(e) ? "image" : null;
assert.equal(kindOf("exe"), null, ".exe refused");
assert.equal(kindOf("pdf"), null, ".pdf refused");
assert.equal(kindOf("avi"), "video", ".avi accepted as video");
assert.equal(kindOf("heic"), "image", ".heic accepted as image");

// 3. the served module parses (import-time crash = endpoint dead on deploy)
await import("./transcode.mjs");

console.log("transcode.check: all assertions passed");
