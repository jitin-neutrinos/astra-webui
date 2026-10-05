// `math` block contract (canvas v1 expansion).
//
// Two properties, and the second is the one that decides whether this block is
// safe to ship at all:
//
//   1. LAZY. katex is ~75 kB gz plus a stylesheet and ~20 webfonts — more than a
//      whole ordinary card. It must be reachable only through a dynamic import.
//   2. FAIL-SOFT. `throwOnError:false` is what keeps one unparseable formula from
//      throwing inside React's render and blanking the WHOLE card. Measured: bad
//      TeX returns html carrying a `katex-error` marker rather than raising.
//
// The katex logic itself is verified by RUNNING it in the browser-free probe
// below (bare Node cannot load the .css side-effect import, which is exactly why
// the CSS import must stay a bundler concern and never a unit-test concern).
//
// Run: npx tsx --test src/lib/canvas-math.check.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

test("the katex renderer is LAZY and side-effect-imports its stylesheet", () => {
  const cb = readFileSync(join(here, "../components/canvas/canvas-blocks.tsx"), "utf8");
  assert.doesNotMatch(cb, /^\s*import[^\n]*canvas-math/m, "canvas-math must not be statically imported");
  assert.match(cb, /import\(["']\.\/canvas-math["']\)/, "katex is reached through a dynamic import()");

  const m = readFileSync(join(here, "../components/canvas/canvas-math.ts"), "utf8");
  // `import … from "…css"` has NO default export and fails the build; the sheet is
  // imported for its side effect only.
  assert.match(m, /import\s+["']katex\/dist\/katex\.min\.css["']/, "the stylesheet is a side-effect import");
  assert.doesNotMatch(m, /import\s+\w+\s+from\s+["'][^"']*\.css["']/, "a default import of a .css fails the build");
  // The single most important option: without it a bad formula throws and blanks
  // the card it lives in.
  assert.match(m, /throwOnError:\s*false/, "throwOnError:false is the fail-soft contract");
  assert.match(m, /catch\s*\{/, "the wrapper catches anything katex itself throws");
});

test("katex's stylesheet carries no hex colours (the theme contract holds by construction)", () => {
  const css = readFileSync(join(here, "../../node_modules/katex/dist/katex.min.css"), "utf8");
  const hex = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)];
  assert.deepEqual(hex.map((m) => m[0]), [], `katex.min.css must paint no literal colour (found ${hex.length})`);
  // Which is why the canvas only needs one rule: every glyph inherits brandtext.
  const index = readFileSync(join(here, "../index.css"), "utf8");
  assert.match(index, /\.ast-cv-math\s+\.katex\s*\{\s*color:\s*var\(--color-brandtext\)/, "math inherits brand text");
});

test("bad TeX degrades to katex-error html instead of throwing (measured, real katex)", async () => {
  // Run the REAL library with the SAME options the module uses. Importing the
  // module itself is impossible under bare Node (it side-effect-imports CSS),
  // so the options are mirrored here — the assertion above pins that they match.
  const { default: katex } = await import("katex");
  const render = (tex: string, display: boolean) =>
    katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "htmlAndMathml" });

  const ok = render("\\int_0^\\infty x^2\\,dx", true);
  assert.ok(ok.includes("katex"), "valid TeX renders");
  assert.ok(ok.includes("katex-display"), "display math wraps in katex-display");
  assert.ok(!render("x^2", false).includes("katex-display"), "inline math does NOT wrap as display");

  // The fail-soft proof: this is invalid TeX, and it returns html (carrying
  // katex's error markup) instead of raising.
  const bad = render("\\frac{1}{", true);
  assert.equal(typeof bad, "string", "invalid TeX returns a string, never throws");
  assert.ok(bad.includes("katex-error"), "the failure is visible as katex-error markup");

  // Pathological input stays contained.
  assert.ok(render("x".repeat(5000), true).length > 0, "a 5 kB formula still renders");
  assert.ok(render("", true).length > 0, "empty TeX renders to nothing rather than throwing");
});