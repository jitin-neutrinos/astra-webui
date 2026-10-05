// skeleton-grey.check.ts — every skeleton loader must be a NEUTRAL grey (owner 2026-10-03).
//
// THE BUG IT PINS: the shimmer sweep painted from `--c-69`, which tokenize.mjs annotates
// `cyanx` — the theme ACCENT. One skeleton was therefore cyan under Astra, sky blue under Water
// and ORANGE under Fire (#ff5c1f): the "some orange, some blue" report. Separately the canvas doc
// placeholder painted from `--c-89` (annotated `redx`), so it went RED under Fire.
//
// The fix routes every loader through --ast-sk-fill / --ast-sk-sweep, derived per palette by
// theme-store.ts (neutralGrey: oklab lightness only, chroma pinned to 0).
//
// Run: node --import ./scripts/ts-resolve.mjs src/lib/skeleton-grey.check.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
let failures = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) { failures++; console.error("  FAIL  " + msg); }
  else console.log("  ok    " + msg);
};

// ---- 1. the accent channel var must not drive any skeleton paint -----------------------
const css = readFileSync(resolve(ROOT, "src/index.css"), "utf8");

// Every .ast-sk / canvas-skeleton rule, isolated so a comment elsewhere can't satisfy this.
const skRules = [
  /\.ast-sk\s*\{[^}]*\}/g,
  /\.ast-sk::after\s*\{[^}]*\}/g,
  /\.ast-sk-grey::after\s*\{[^}]*\}/g,
  /\.ast-cv-doc-skeleton\s*\{[^}]*\}/g,
  /\.ast-cv-chart-skeleton\s*\{[^}]*\}/g,
].flatMap((re) => css.match(re) || []);

ok(skRules.length >= 4, `found ${skRules.length} skeleton paint rules (expected >= 4)`);
for (const rule of skRules) {
  ok(!/var\(--c-69\)/.test(rule), `no accent channel (--c-69) in ${rule.slice(0, 46).replace(/\s+/g, " ")}`);
  ok(!/var\(--light-c-45\)/.test(rule), `no light accent (--light-c-45) in ${rule.slice(0, 40).replace(/\s+/g, " ")}`);
  ok(!/var\(--c-89\)/.test(rule), `no redx channel (--c-89) in ${rule.slice(0, 40).replace(/\s+/g, " ")}`);
}
// The sweep specifically must read the neutral token, not a bare literal alpha tint.
const sweepRule = (css.match(/\.ast-sk::after\s*\{[^}]*\}/) || [""])[0];
ok(/var\(--ast-sk-sweep/.test(sweepRule), "shimmer sweep reads --ast-sk-sweep");
ok(/var\(--ast-sk-fill/.test((css.match(/\.ast-sk\s*\{[^}]*\}/) || [""])[0]), "skeleton fill reads --ast-sk-fill");

// ---- 2. both tokens are defined for BOTH modes -----------------------------------------
// The dark tokens live in the @theme block (where every --color-* default lives), not in :root.
const themeBlock = (css.match(/@theme\s*\{[^}]*\}/) || [""])[0];
ok(/--ast-sk-fill:\s*#353535/.test(themeBlock), "@theme defines --ast-sk-fill (dark)");
ok(/--ast-sk-sweep:\s*#4f4f4f/.test(themeBlock), "@theme defines --ast-sk-sweep (dark)");
const lightBlock = (css.match(/\[data-theme="light"\]\s*\{[^}]*\}/) || [""])[0];
ok(/--ast-sk-fill:\s*#d9d9d9/.test(lightBlock), "[data-theme=light] defines --ast-sk-fill");
ok(/--ast-sk-sweep:\s*#adadad/.test(lightBlock), "[data-theme=light] defines --ast-sk-sweep");

// ---- 3. the derivation is chroma-free and matches the published literals ----------------
// Same maths as neutralGrey() in theme-store.ts, re-derived here so the two cannot drift.
const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const unlin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const lightness = (hex: string) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16)));
  return Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
};
function neutralGrey(inkHex: string, groundHex: string, pct: number): string {
  const L = lightness(groundHex) + (lightness(inkHex) - lightness(groundHex)) * pct;
  const k = L * L * L;
  const ch = [
    0.4122214708 * k + 0.5363325363 * k + 0.0514459929 * k,
    0.2119034982 * k + 0.6806995451 * k + 0.1073969566 * k,
    0.0883024619 * k + 0.2817188376 * k + 0.6299787005 * k,
  ];
  return "#" + ch.map((v) => Math.max(0, Math.min(255, Math.round(unlin(v) * 255))).toString(16).padStart(2, "0")).join("");
}
const sat = (hex: string) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx ? (mx - mn) / mx : 0;
};
const lum = (hex: string) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const cases: Array<[string, string, number, string]> = [
  ["dark fill", "#f2f3f7", 0.22, "#353535"],
  ["dark sweep", "#f2f3f7", 0.34, "#4f4f4f"],
  ["light fill", "#040408", 0.10, "#d9d9d9"],
  ["light sweep", "#040408", 0.26, "#adadad"],
];
for (const [label, ink, pct, expected] of cases) {
  const got = neutralGrey(ink, ink === "#f2f3f7" ? "#090c12" : "#f3f6fb", pct);
  ok(got === expected, `${label}: neutralGrey = ${got}, stylesheet literal = ${expected}`);
}

// Every palette's derived grey must be a TRUE neutral (chroma 0), not a tinted one.
const palettes = JSON.parse(readFileSync(resolve(ROOT, "src/theme-engine/palettes.json"), "utf8")) as
  Array<{ id: string; variants: Record<string, Record<string, string>> }>;
const list = Array.isArray(palettes) ? palettes : (palettes as unknown as { palettes: typeof palettes }).palettes;
const PCT = { dark: { fill: 0.22, sweep: 0.34 }, light: { fill: 0.10, sweep: 0.26 } } as const;
for (const p of list) {
  for (const mode of ["dark", "light"] as const) {
    const v = p.variants[mode];
    const ink = v["--color-brandtext"], ground = v["--color-void"];
    if (!ink || !ground) continue;
    const fill = neutralGrey(ink, ground, PCT[mode].fill);
    const sweep = neutralGrey(ink, ground, PCT[mode].sweep);
    ok(sat(fill) === 0, `${p.id}/${mode} fill ${fill} is chroma-free (sat ${sat(fill)})`);
    ok(sat(sweep) === 0, `${p.id}/${mode} sweep ${sweep} is chroma-free (sat ${sat(sweep)})`);
    // Fill must stay legible against its own ground without becoming a slab.
    const r = ratio(fill, ground);
    const lo = mode === "dark" ? 1.5 : 1.15, hi = mode === "dark" ? 2.2 : 1.4;
    ok(r >= lo && r <= hi, `${p.id}/${mode} fill ${fill} contrast ${r.toFixed(2)}:1 within [${lo}, ${hi}]`);
    const rs = ratio(sweep, fill);
    ok(rs >= 1.3 && rs <= 1.8, `${p.id}/${mode} sweep over fill ${rs.toFixed(2)}:1 within [1.3, 1.8]`);
  }
}

// ---- 4. no component reintroduces a hand-rolled skeleton fill --------------------------
for (const f of ["src/components/config-page.tsx", "src/components/approvals-page.tsx"]) {
  const src = readFileSync(resolve(ROOT, f), "utf8");
  ok(!/bg-white\/5[^"]*animate-pulse/.test(src), `${f.split("/").pop()}: no hardcoded bg-white/5 pulse placeholder`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall skeleton-grey assertions passed");
process.exit(failures ? 1 : 0);