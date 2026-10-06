// color-chip.check.ts — the colour-value detector behind table/key-value
// swatches. PURE module: node, no DOM. The accept/reject sets encode the
// ticket-reference collision guard — if a change loosens detection,
// "issue #123456" must stay text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cssColorOf, wcagRatio, contrastVerdict } from "./color-chip.ts";

test("cssColorOf accepts the colour forms a report actually contains", () => {
  for (const s of [
    "#fff",
    "#FFF",
    "#020C1B",
    "#ffffff",
    "#ffffffff",
    "rgb(1 2 3)",
    "rgba(1,2,3,0.5)",
    "hsl(120 50% 50%)",
    "hsla(120,50%,50%,.5)",
    "hwb(120 30% 40%)",
    "lab(50% 20 -30)",
    "lch(50% 30 120)",
    "oklch(0.7 0.1 30)",
    "oklab(0.7 0.05 -0.03)",
    "color(display-p3 1 0 0)",
    "color(display-p3 1 0 0 / .5)",
  ]) {
    assert.equal(cssColorOf(s), s.trim(), `${s} is a colour`);
  }
  assert.equal(cssColorOf("  #abcdef  "), "#abcdef", "whitespace is trimmed, not carried");
});

test("cssColorOf rejects everything that only LOOKS like a colour", () => {
  for (const s of [
    "",
    "   ",
    "red",
    "teal",
    "issue #123456",
    "#12345g",
    "#12345",
    "#1234",
    "#12",
    "#fff;",
    "#fff #eee",
    "rgb(1,2,3) extra",
    "rgb(1,2,",
    "5px",
    "var(--color-accent)",
    "color-mix(in srgb, red 50%, blue)",
    "color(bogus)",
  ]) {
    assert.equal(cssColorOf(s), null, `${JSON.stringify(s)} is not a colour value`);
  }
  assert.equal(cssColorOf(42), null, "non-strings are never colours");
  assert.equal(cssColorOf(null), null);
  assert.equal(cssColorOf(undefined), null);
});

test("the renderer paints colour values as swatches (source pin)", () => {
  const src = readFileSync(
    new URL("../components/canvas/canvas-blocks.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(src.includes("<CellValue value={cell} />"), "table cells route through CellValue");
  assert.ok(src.includes("<CellValue value={it.value} />"), "key/value values route through CellValue");
  assert.ok(
    src.includes("style={{ background: color }}"),
    "the swatch dot paints the authored colour (data, not a theme token)",
  );
});


test("wcagRatio works for valid hex colors", () => {
  assert.equal(wcagRatio("#000000", "#ffffff"), 21);
  assert.equal(wcagRatio("#ffffff", "#ffffff"), 1);
  assert.equal(wcagRatio("invalid", "#ffffff"), null);
});

test("contrastVerdict works for valid hex colors", () => {
  assert.deepEqual(contrastVerdict("#000000", "#ffffff"), { wcag: 21, level: "AAA" });
  assert.deepEqual(contrastVerdict("#ffffff", "#ffffff"), { wcag: 1, level: "Fail" });
  assert.equal(contrastVerdict("invalid", "#ffffff"), null);
});
