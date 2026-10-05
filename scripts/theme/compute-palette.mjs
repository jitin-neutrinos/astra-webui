// compute-palette.mjs — derive the Astra UI v2 palette in OKLCH, emit sRGB hex,
// enforce WCAG (text 4.5:1, AAA body 7:1, accents 3:1 dark / 4.5:1 light), write palette.json.
// OKLCH→sRGB via standard matrices (no deps).
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));

// ---- oklab / oklch <-> srgb ----
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function srgbToOklab(r, g, b) {
  [r, g, b] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function oklabToSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3];
  return [
    unlin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    unlin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    unlin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function oklchToHex(L, C, H) {
  const rad = (H * Math.PI) / 180;
  const [r, g, b] = oklabToSrgb(L, C * Math.cos(rad), C * Math.sin(rad));
  // gamut map: pull chroma down until in-gamut (keeps hue+lightness)
  if ([r, g, b].some((v) => v < -0.001 || v > 1.001)) {
    for (let c = C - 0.005; c >= 0; c -= 0.005) return oklchToHex(L, c, H);
  }
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}
function hexToOklch(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const [L, a, bb] = srgbToOklab(r, g, b);
  return { L, C: Math.hypot(a, bb), H: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 };
}

// ---- WCAG ----
const lumOf = (hex) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [l1, l2] = [lumOf(a), lumOf(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
// adjust L (keep C,H) until contrast(target) vs bg passes
function fit(hex, bg, target, dir) {
  let { L, C, H } = hexToOklch(hex);
  let out = hex, guard = 0;
  while (contrast(out, bg) < target && guard++ < 200) {
    L += dir === "up" ? 0.004 : -0.004;
    if (L <= 0.03 || L >= 0.99) break;
    out = oklchToHex(L, C, H);
  }
  return out;
}

// ---- the palette (hue family 264 = brand blue world; brand accent hue ~222 retained-blue) ----
const HUE = 264;
const spec = {
  dark: {
    void:    [0.155, 0.014, HUE],
    midnight:[0.195, 0.017, HUE],
    depth:   [0.240, 0.021, HUE],
    surface: [0.290, 0.026, HUE],
    brandtext:[0.965, 0.005, HUE],
    muted:   [0.660, 0.018, HUE],
    accent:  [0.775, 0.135, 222],  // brand blue: retained family, slightly more azure than #22d3ee
    violetx: [0.720, 0.120, 275],  // indigo — now distinct from emerald (was a duplicate of it)
    fuchsiax:[0.700, 0.185, 330],
    redx:    [0.680, 0.170, 25],
    emerald: [0.760, 0.140, 162],
    amber:   [0.790, 0.130, 80],
  },
  light: {
    void:    [0.972, 0.008, HUE],  // cool near-white paper, same hue world as dark (was warm cream)
    midnight:[0.988, 0.005, HUE],
    depth:   [0.945, 0.011, HUE],
    surface: [0.905, 0.015, HUE],
    brandtext:[0.175, 0.018, HUE], // near-black navy ink (premium-light convention, keeps hue family)
    muted:   [0.470, 0.024, HUE],
    accent:  [0.470, 0.140, 252],  // saturated readable blue (replaces muddy dark cyan)
    violetx: [0.450, 0.130, 275],
    fuchsiax:[0.440, 0.160, 330],
    redx:    [0.500, 0.170, 25],
    emerald: [0.470, 0.115, 162],
    amber:   [0.530, 0.115, 70],
  },
};

const pal = {};
for (const mode of ["dark", "light"]) {
  pal[mode] = {};
  for (const [role, [L, C, Hh]] of Object.entries(spec[mode])) pal[mode][role] = oklchToHex(L, C, Hh);
  // enforce: text AAA vs void, muted AA, accents per mode floor
  const bg = pal[mode].void;
  pal[mode].brandtext = fit(pal[mode].brandtext, bg, 7, mode === "dark" ? "up" : "down");
  pal[mode].muted = fit(pal[mode].muted, bg, 4.6, mode === "dark" ? "up" : "down");
  const floor = mode === "dark" ? 3 : 4.5;
  for (const a of ["accent", "violetx", "fuchsiax", "redx", "emerald", "amber"]) {
    pal[mode][a] = fit(pal[mode][a], bg, floor, mode === "dark" ? "up" : "down");
  }
}

// ---- verify + report ----
let fail = 0;
const row = (label, darkHex, lightHex) => {
  const cd = contrast(darkHex, pal.dark.void), cl = contrast(lightHex, pal.light.void);
  return { label, darkHex, lightHex, cd: +cd.toFixed(2), cl: +cl.toFixed(2) };
};
const table = [
  row("void", pal.dark.void, pal.light.void),
  row("midnight", pal.dark.midnight, pal.light.midnight),
  row("depth", pal.dark.depth, pal.light.depth),
  row("surface", pal.dark.surface, pal.light.surface),
  row("brandtext", pal.dark.brandtext, pal.light.brandtext),
  row("muted", pal.dark.muted, pal.light.muted),
  row("accent", pal.dark.accent, pal.light.accent),
  row("violetx", pal.dark.violetx, pal.light.violetx),
  row("fuchsiax", pal.dark.fuchsiax, pal.light.fuchsiax),
  row("redx", pal.dark.redx, pal.light.redx),
  row("emerald", pal.dark.emerald, pal.light.emerald),
  row("amber", pal.dark.amber, pal.light.amber),
];
console.log("role      dark      (vs void)  light     (vs void)");
for (const r of table)
  console.log(`${r.label.padEnd(9)} ${r.darkHex}  ${String(r.cd).padStart(6)}     ${r.lightHex}  ${String(r.cl).padStart(6)}`);

// assertions (the one runnable check)
const assert = (cond, msg) => { if (!cond) { fail++; console.error("FAIL:", msg); } };
for (const r of table) {
  if (r.label === "brandtext") { assert(r.cd >= 7 && r.cl >= 7, `brandtext AAA ${r.cd}/${r.cl}`); continue; }
  if (r.label === "muted") { assert(r.cd >= 4.5 && r.cl >= 4.5, `muted AA ${r.cd}/${r.cl}`); continue; }
  if (["void","midnight","depth","surface"].includes(r.label)) continue;
  assert(r.cd >= 3, `dark ${r.label} >=3 (${r.cd})`);
  assert(r.cl >= 4.5, `light ${r.label} >=4.5 (${r.cl})`);
}
// light slate-500 worst case (ink 55% over void) >= 4.5 — mirrors a11y-pass logic.
// If it fails, deepen brandtext (keep C,H) — same correction a11y-pass.mjs applies.
const mix = (a, b, ka) => {
  const pa = a.replace("#",""), pb = b.replace("#","");
  return [0,2,4].map(i => Math.round(parseInt(pa.slice(i,i+2),16)*ka + parseInt(pb.slice(i,i+2),16)*(1-ka)));
};
const slate5Of = (ink) => "#" + mix(ink, pal.light.void, 0.55).map(v => v.toString(16).padStart(2,"0")).join("");
let deepGuard = 0;
while (contrast(slate5Of(pal.light.brandtext), pal.light.void) < 4.5 && deepGuard++ < 100) {
  const { L, C, H } = hexToOklch(pal.light.brandtext);
  pal.light.brandtext = oklchToHex(L - 0.004, C, H);
}
const slate5 = slate5Of(pal.light.brandtext);
console.log("light slate-500 worst case:", slate5, contrast(slate5, pal.light.void).toFixed(2), "ink:", pal.light.brandtext);
assert(contrast(slate5, pal.light.void) >= 4.5, "light slate ramp worst case >= 4.5");
// dark slate-600 (keep 54%) >= 4.5 per theme-store ramp comment
const dslate6 = "#" + mix(pal.dark.brandtext, pal.dark.void, 0.54).map(v => v.toString(16).padStart(2,"0")).join("");
console.log("dark slate-600 (keep54):", dslate6, contrast(dslate6, pal.dark.void).toFixed(2));
assert(contrast(dslate6, pal.dark.void) >= 4.5, "dark slate-600 >= 4.5");
// accent hue retention: dark accent within brand-cyan/azure band
const acc = hexToOklch(pal.dark.accent);
console.log("dark accent oklch:", acc.L.toFixed(3), acc.C.toFixed(3), acc.H.toFixed(1));
assert(acc.H > 200 && acc.H < 240, `accent hue retained blue/azure (${acc.H.toFixed(1)})`);
// skeleton greys via the exact theme-store formula (first-paint literals)
function neutralGrey(inkHex, groundHex, pct) {
  const lightness = (hex) => {
    const h = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
    return Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  };
  const L = lightness(groundHex) + (lightness(inkHex) - lightness(groundHex)) * pct;
  const k = L ** 3;
  const ch = [k, k, k]; // equal cone responses = achromatic
  const ch2 = [
    0.4122214708 * ch[0] + 0.5363325363 * ch[0] + 0.0514459929 * ch[0],
    0.2119034982 * ch[0] + 0.6806995451 * ch[0] + 0.1073969566 * ch[0],
    0.0883024619 * ch[0] + 0.2817188376 * ch[0] + 0.6299787005 * ch[0],
  ];
  return "#" + ch2.map((v) => Math.max(0, Math.min(255, Math.round(unlin(v) * 255))).toString(16).padStart(2, "0")).join("");
}
const skel = {
  dark: { fill: neutralGrey(pal.dark.brandtext, pal.dark.void, 0.22), sweep: neutralGrey(pal.dark.brandtext, pal.dark.void, 0.34) },
  light: { fill: neutralGrey(pal.light.brandtext, pal.light.void, 0.10), sweep: neutralGrey(pal.light.brandtext, pal.light.void, 0.26) },
};
console.log("skeleton greys:", JSON.stringify(skel));
if (fail) { console.error(`${fail} FAILURES`); process.exit(1); }

mkdirSync("/home/notjitin/.hermes/cache/scratch/astra-theme-v2", { recursive: true });
writeFileSync(
  resolve(HERE, "../../scratch/palette-latest.json"),
  JSON.stringify({ pal, skel }, null, 2) + "\n"
);
console.log("\nOK — wrote palette.json");
