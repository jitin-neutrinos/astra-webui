#!/usr/bin/env node
process.env.ASTRA_TRANSCODE_MAX_BYTES = "200000"; // 200 KB
// Temp files go to os.tmpdir() (TMPDIR → the session scratch dir here), and
// the input lives under real HOME so transcode's path-safety passes with no
// HOME override.
import os from "node:os";
import { mkdirSync, writeFileSync, statSync, readdirSync, rmSync } from "node:fs";
import { utimesSync } from "node:fs";
import { join } from "node:path";
const TMP = os.tmpdir();
process.env.ASTRA_TRANSCODE_DIR = join(TMP, "astra-transcode-check");
const { handleTranscode } = await import("../server/transcode.mjs");

rmSync(process.env.ASTRA_TRANSCODE_DIR, { recursive: true, force: true });
mkdirSync(process.env.ASTRA_TRANSCODE_DIR, { recursive: true });

const inputPath = join(TMP, "astra-test-image.bmp");
const bmp = Buffer.from("424d3a00000000000000360000002800000001000000010000000100180000000000040000000000000000000000000000000000000000000000", "hex");
writeFileSync(inputPath, bmp);

const fake1 = join(process.env.ASTRA_TRANSCODE_DIR, "image-fake1.jpg");
const fake2 = join(process.env.ASTRA_TRANSCODE_DIR, "image-fake2.jpg");
const blob = Buffer.alloc(150000); // 150 KB
writeFileSync(fake1, blob);
writeFileSync(fake2, blob);

const past = Date.now() / 1000 - 3600;
utimesSync(fake1, past, past);

const req = {
  url: `http://localhost/api/media/transcode?path=${inputPath}`,
  headers: { cookie: "astra_session=valid" },
  method: "GET"
};

const res = {
  writeHead: () => {},
  end: () => {},
  destroy: () => {},
  on: function() { return this; },
  once: function() { return this; },
  emit: () => {},
  write: () => true
};
res.pipe = function() {}

console.log("Triggering transcode...");
await handleTranscode(req, res, () => true);

// Wait a tiny bit for the file stream to finish closing
await new Promise(r => setTimeout(r, 100));

const files = readdirSync(process.env.ASTRA_TRANSCODE_DIR);
let total = 0;
for (const f of files) {
  total += statSync(join(process.env.ASTRA_TRANSCODE_DIR, f)).size;
}

console.log("Total bytes:", total, "Files:", files);

if (total > 200000) {
  console.error("Eviction failed: total > cap");
  process.exit(1);
}
if (files.includes("image-fake1.jpg")) {
  console.error("Eviction failed: oldest file not evicted");
  process.exit(1);
}
console.log("transcode-cap.check passed.");
