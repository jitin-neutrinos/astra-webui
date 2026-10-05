// Regression guard: doc/xlsx previews must fill their container.
//
// Symptom this prevents (found 2026-10-05): opening an .xlsx/.docx/.pptx from
// chat left the preview floating in a narrow column — .mv-doc carried
// `max-width:960px` and the doc slide added 12px side padding, so a wide sheet
// never used the available width.
//
// Three assertions:
//   1. .mv-doc has no max-width cap (max-width:none or absent).
//   2. .mv-slide-doc strips horizontal padding.
//   3. base .mv-slide KEEPS its 12px padding — audio/video slides must not
//      change when the doc variant is added. This is the assertion that fails
//      first if someone edits the shared rule instead of the modifier.
//
// Assert against the COMPILED css in dist/, parsing rules as SETS because
// lightningcss reorders declarations and expands color-mix() into an
// @supports var() form.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const norm = (s) => s.replace(/\s+/g, "").replace(/;/g, "");

const distCss = join(process.cwd(), "dist", "assets");
if (!existsSync(distCss)) {
  console.error(
    "FAIL: dist/assets not found — run `npm run build` before this check " +
      "(this guard asserts against compiled CSS, not the source).",
  );
  process.exit(1);
}

const src = readdirSync(distCss)
  .filter((f) => f.endsWith(".css"))
  .map((f) => readFileSync(join(distCss, f), "utf8"))
  .join("\n");

const rules = [];
for (const m of src.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
  const sels = m[1].split(",").map(norm).filter(Boolean);
  const decls = new Set(m[2].split(";").map(norm).filter(Boolean));
  rules.push({ sels, decls });
}
const find = (sel) => rules.find((r) => r.sels.includes(norm(sel)));

const mvDoc = find(".mv-doc");
const mvDocVariant = find(".mv-slide-doc");
const mvSlide = find(".mv-slide");

let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failed++;
};

check(!!mvDoc, ".mv-doc rule exists in compiled CSS");
if (mvDoc) {
  const capped = [...mvDoc.decls].some((d) => /^max-width:(?!none)/.test(d));
  check(!capped, ".mv-doc has no pixel max-width cap (doc preview fills container)");
}

check(!!mvDocVariant, ".mv-slide-doc modifier exists");
if (mvDocVariant) {
  check(
    mvDocVariant.decls.has("padding-left:0") && mvDocVariant.decls.has("padding-right:0"),
    ".mv-slide-doc strips horizontal padding",
  );
  check(mvDocVariant.decls.has("align-items:stretch"), ".mv-slide-doc stretches the preview vertically");
}

check(!!mvSlide, "base .mv-slide still exists (audio/video slides intact)");
if (mvSlide) {
  const padded = [...mvSlide.decls].some((d) => d.startsWith("padding:") && d.includes("12px"));
  check(padded, "base .mv-slide keeps its 12px side padding (audio/video unchanged)");
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll doc-preview fill assertions passed.");