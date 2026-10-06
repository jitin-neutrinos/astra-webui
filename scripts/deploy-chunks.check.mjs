// deploy-chunks.check.mjs — a DEPLOY must ship every lazy chunk the entry
// bundle references.
//
// WHY THIS FILE EXISTS (2026-10-05, owner report): the canvas stopped rendering
// after a reload. Nothing in the code was wrong — the parser produced all 17
// blocks, the sanitizer kept them, the render switch handled every type. The
// deployed index.html loaded 4 entry files fine, and every LAZY chunk the entry
// referenced returned 404. The card's shell painted, the dynamic import inside
// it failed, and the Suspense fallback parked on a skeleton forever. Seven
// canvas chunks were missing; so were media-viewer and pdf-view.
//
// Nothing in the repo detected it: `vite build` exits 0, the served HTML looks
// healthy, and a spot-check of the entry file returns 200. The only place the
// mismatch is visible is a full cross-reference of the built entry against the
// built asset directory — which is exactly what a stale or partial `dist`
// upload produces and nothing else catches.
//
// Run: node scripts/deploy-chunks.check.mjs [distDir]

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const DIST = resolve(process.argv[2] ?? "dist");
if (!existsSync(DIST)) {
  console.error(`dist not found: ${DIST}`);
  process.exit(2);
}

const ASSETS = join(DIST, "assets");
const files = readdirSync(ASSETS);
const onDisk = new Set(files.filter((f) => f.endsWith(".js") || f.endsWith(".css")));

// Every entry <script> in index.html.
const html = readFileSync(join(DIST, "index.html"), "utf8");
const entryRefs = [...html.matchAll(/\/assets\/([A-Za-z0-9._-]+\.(?:js|css))/g)].map((m) => m[1]);

// Every dynamic import inside every emitted JS file: the preload manifest plus
// the literal "assets/…" and "./name.js" spellings the bundler emits.
//
// EXCLUSION — wasm-bindgen thread workers. The pdf.js wasm bundle embeds a
// module map whose key is `qcms_bg.js`: that is a RUNTIME worker URL handed to
// `new Worker()`, resolved by the browser against the page, never fetched as a
// build artifact and never present in dist/assets. It is matched WITHOUT the
// "./" prefix too — the same key appears both ways in the bundle, and anchoring
// on one spelling flagged a perfectly good build, which is how a gate gets
// ignored.
const WORKER_RUNTIME = /^(?:\.\/)?qcms_bg\.js$/;
const emitted = [];
for (const f of files.filter((x) => x.endsWith(".js"))) {
  const src = readFileSync(join(ASSETS, f), "utf8");
  for (const m of src.matchAll(/"(?:\.\/|assets\/)([A-Za-z0-9._-]+\.(?:js|css))"/g)) {
    if (WORKER_RUNTIME.test(m[1])) continue;
    emitted.push({ from: f, ref: m[1] });
  }
}

const missing = [];
for (const ref of entryRefs) {
  if (!onDisk.has(ref)) missing.push({ from: "index.html", ref });
}
for (const { from, ref } of emitted) {
  if (!onDisk.has(ref)) missing.push({ from, ref });
}

const refs = new Set([...entryRefs, ...emitted.map((e) => e.ref)]);
console.log(`dist: ${DIST}`);
console.log(`  assets on disk : ${onDisk.size}`);
console.log(`  entry refs     : ${entryRefs.length} (index.html)`);
console.log(`  lazy refs      : ${emitted.length} across ${files.filter((f) => f.endsWith(".js")).length} bundles`);
console.log(`  distinct refs  : ${refs.size}`);

if (missing.length) {
  console.error(`\nFAIL — ${missing.length} referenced asset(s) are NOT in dist/assets:`);
  const seen = new Set();
  for (const m of missing) {
    const k = m.ref;
    if (seen.has(k)) continue;
    seen.add(k);
    console.error(`  ${m.ref}   (referenced by ${m.from})`);
  }
  console.error("\nThis is the exact 404 shape that parked every canvas card on its");
  console.error("skeleton. A partial/stale dist upload is the only usual cause.");
  process.exit(1);
}

console.log("\nOK — every referenced asset is present in dist/assets.");
