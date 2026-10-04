// sharp-rectangle ban (owner 2026-10-04): no visible 0/1/2/3px radii left on canvas blocks.
// Heat-map cells are the one deliberate rounded-at-4px exception (a grid must read as cells).
// Run: node --import ./scripts/ts-resolve.mjs src/lib/rounding.check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

// 1) no 0/1/2/3px border-radius on any .ast-cv-* rule (matches across lines)
const sharp = [...css.matchAll(/\.ast-cv-[a-z-]+[^{]*\{[^}]*?border-radius:\s*(?:0|1|2|3)px/g)]
  .filter((m) => !m[0].includes(".ast-cv-heat-step"));
assert.equal(sharp.length, 0, `canvas has ${sharp.length} sharp rectangle(s): ${sharp.map((m) => m[0].split("{")[0].trim()).join(", ")}`);

// 2) the fill/track/dot controls ended up pills or circles
for (const sel of ["ast-cv-progress-track", "ast-cv-progress-fill", "ast-cv-dot", "ast-cv-tl-dot", "ast-cv-callout-dot"]) {
  const i = css.indexOf(sel + " {") >= 0 ? css.indexOf(sel + " {") : css.indexOf(sel + " {".slice(0, 1));
  const j = css.indexOf("}", css.indexOf(sel, Math.max(0, css.indexOf("." + sel))));
  const seg = css.slice(css.indexOf("." + sel), j);
  assert.ok(/border-radius:\s*(?:9999px|50%)/.test(seg), sel + " must be pill/circle");
}

console.log("rounding.check: all canvas radii rounded (pill/circle/rounded-rect)");
