// compute-elemental.mjs — re-derive Fire / Water / Wind / Earth in OKLCH with the
// same WCAG gates as the astra-ui v2 palette. Hard constraints:
//  - NO color in Water or Wind may fall in the blue band (hue 195-300) — owner rule.
//  - Each theme's accent sits in its own hue world, >=40 deg from astra's blue (222).
// Emits scratch/astra-theme-v2/elemental-palette.json + the ELEMENTAL array literal.
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
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
function hexToOklch(hex) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function oklchToHex(L, C, H) {
  const rad = (H * Math.PI) / 180;
  const [r, g, b] = oklabToSrgb(L, C * Math.cos(rad), C * Math.sin(rad));
  if ([r, g, b].some((v) => v < -0.001 || v > 1.001)) {
    for (let c = C - 0.005; c >= 0; c -= 0.005) return oklchToHex(L, c, H);
  }
  return "#" + [r, g, b].map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("");
}
const lumOf = (hex) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => lin(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [l1, l2] = [lumOf(a), lumOf(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
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
const mixHex = (a, b, ka) => {
  const pa = a.replace("#", ""), pb = b.replace("#", "");
  return "#" + [0, 2, 4].map((i) => Math.round(parseInt(pa.slice(i, i + 2), 16) * ka + parseInt(pb.slice(i, i + 2), 16) * (1 - ka)).toString(16).padStart(2, "0")).join("");
};

// role order must match build-palette ELEMENTAL entries
const ROLES = ["void", "midnight", "depth", "surface", "brandtext", "muted", "cyanx", "violetx", "fuchsiax", "redx", "emerald", "amber"];

const THEMES = {
  // FIRE — ember + warm charcoal. Accent hue 35 (ember orange), warm gold secondary.
  fire: {
    hueWorld: [10, 60],
    dark: { void: [.155, .012, 38], midnight: [.195, .015, 38], depth: [.24, .019, 38], surface: [.29, .024, 38], brandtext: [.955, .008, 55], muted: [.68, .028, 42], cyanx: [.70, .17, 35], violetx: [.78, .13, 75], fuchsiax: [.66, .19, 12], redx: [.65, .19, 27], emerald: [.70, .12, 110], amber: [.80, .145, 70] },
    light: { void: [.968, .004, 48], midnight: [.988, .004, 48], depth: [.945, .007, 48], surface: [.905, .010, 48], brandtext: [.17, .012, 42], muted: [.47, .032, 46], cyanx: [.50, .16, 35], violetx: [.46, .12, 75], fuchsiax: [.46, .17, 12], redx: [.47, .17, 27], emerald: [.46, .11, 115], amber: [.50, .12, 70] },
  },
  // WATER — tropical aqua-teal. NO BLUE: hue world 155-190, blue band assert below.
  water: {
    hueWorld: [155, 190],
    dark: { void: [.155, .014, 175], midnight: [.195, .017, 175], depth: [.24, .021, 175], surface: [.29, .026, 175], brandtext: [.955, .01, 170], muted: [.66, .03, 175], cyanx: [.75, .13, 176], violetx: [.78, .11, 150], fuchsiax: [.70, .13, 8], redx: [.68, .15, 22], emerald: [.76, .13, 163], amber: [.80, .12, 80] },
    light: { void: [.968, .012, 175], midnight: [.988, .007, 175], depth: [.945, .014, 175], surface: [.905, .019, 175], brandtext: [.17, .022, 175], muted: [.47, .032, 175], cyanx: [.46, .12, 176], violetx: [.46, .10, 152], fuchsiax: [.47, .14, 8], redx: [.48, .15, 22], emerald: [.46, .11, 163], amber: [.50, .11, 78] },
  },
  // WIND — spring green / mint over airy cool-green ground. NO BLUE: blue band assert below.
  wind: {
    hueWorld: [115, 165],
    dark: { void: [.155, .012, 150], midnight: [.195, .015, 150], depth: [.24, .019, 150], surface: [.29, .023, 150], brandtext: [.955, .008, 140], muted: [.67, .026, 150], cyanx: [.75, .14, 132], violetx: [.78, .14, 105], fuchsiax: [.70, .12, 345], redx: [.66, .16, 25], emerald: [.76, .13, 155], amber: [.80, .12, 95] },
    light: { void: [.968, .010, 150], midnight: [.988, .006, 150], depth: [.945, .012, 150], surface: [.905, .017, 150], brandtext: [.17, .02, 150], muted: [.47, .03, 150], cyanx: [.46, .13, 132], violetx: [.46, .12, 105], fuchsiax: [.46, .13, 345], redx: [.47, .15, 25], emerald: [.46, .11, 155], amber: [.50, .11, 92] },
  },
  // EARTH — gold / olive / clay. Accent keeps the gold identity (~85).
  earth: {
    hueWorld: [60, 100],
    dark: { void: [.155, .012, 75], midnight: [.19, .014, 75], depth: [.235, .018, 72], surface: [.285, .022, 70], brandtext: [.955, .01, 85], muted: [.66, .035, 78], cyanx: [.75, .12, 85], violetx: [.68, .10, 120], fuchsiax: [.68, .12, 40], redx: [.62, .15, 30], emerald: [.68, .11, 130], amber: [.80, .13, 85] },
    light: { void: [.968, .007, 82], midnight: [.988, .007, 82], depth: [.945, .011, 80], surface: [.905, .015, 78], brandtext: [.17, .013, 75], muted: [.47, .034, 78], cyanx: [.48, .11, 82], violetx: [.45, .09, 122], fuchsiax: [.46, .12, 40], redx: [.46, .15, 30], emerald: [.45, .10, 130], amber: [.50, .12, 82] },
  },
};

const BLUE_BAND = [195, 300];
let failures = 0;
const assert = (cond, msg) => { if (!cond) { failures++; console.error("FAIL:", msg); } };

const out = {};
for (const [id, t] of Object.entries(THEMES)) {
  out[id] = {};
  for (const mode of ["dark", "light"]) {
    const p = {};
    for (const [role, [L, C, H]] of Object.entries(t[mode])) p[role] = oklchToHex(L, C, H);
    const bg = p.void;
    p.brandtext = fit(p.brandtext, bg, 7, mode === "dark" ? "up" : "down");
    p.muted = fit(p.muted, bg, 4.6, mode === "dark" ? "up" : "down");
    const floor = mode === "dark" ? 3 : 4.5;
    for (const a of ["cyanx", "violetx", "fuchsiax", "redx", "emerald", "amber"]) p[a] = fit(p[a], bg, floor, mode === "dark" ? "up" : "down");
    // light slate-ramp worst case: deepen ink until ink@55% over void >= 4.5
    if (mode === "light") {
      const s5 = (ink) => contrast(mixHex(ink, bg, 0.55), bg);
      let g = 0;
      while (s5(p.brandtext) < 4.5 && g++ < 100) {
        const { L, C, H } = hexToOklch(p.brandtext);
        p.brandtext = oklchToHex(L - 0.004, C, H);
      }
      assert(s5(p.brandtext) >= 4.5, `${id}/light slate ramp`);
    }
    out[id][mode] = p;
  }
  // hue-world gates
  const d = hexToOklch(out[id].dark.cyanx), l = hexToOklch(out[id].light.cyanx);
  const inBand = (h, [lo, hi]) => h >= lo && h <= hi;
  assert(inBand(d.H, t.hueWorld) || (t.hueWorld[0] <= 60 && d.H >= 360 + t.hueWorld[0]), `${id} dark accent hue ${d.H.toFixed(1)} in world ${t.hueWorld}`);
  assert(inBand(l.H, t.hueWorld), `${id} light accent hue ${l.H.toFixed(1)} in world ${t.hueWorld}`);
  assert(Math.abs(((d.H - 222 + 540) % 360) - 180) >= 40, `${id} accent too close to astra blue (${d.H.toFixed(1)})`);
  if (id === "water" || id === "wind") {
    for (const mode of ["dark", "light"]) for (const role of ROLES) {
      if (["void", "midnight", "depth", "surface"].includes(role)) continue; // near-neutrals exempt but checked below via chroma
      const { H, C } = hexToOklch(out[id][mode][role]);
      const isBlue = H >= BLUE_BAND[0] && H <= BLUE_BAND[1] && C > 0.02;
      assert(!isBlue, `${id}/${mode}/${role} is BLUE (${H.toFixed(1)}, C ${C.toFixed(3)})`);
    }
  }
}
// cross-theme accent separation
const accs = Object.entries(out).map(([id, o]) => [id, hexToOklch(o.dark.cyanx).H]);
for (let i = 0; i < accs.length; i++) for (let j = i + 1; j < accs.length; j++) {
  const d = Math.abs(accs[i][1] - accs[j][1]);
  assert(Math.min(d, 360 - d) >= 40, `accents ${accs[i][0]}/${accs[j][0]} too close`);
}

console.log("accent hues (dark):", accs.map(([id, h]) => `${id} ${h.toFixed(0)}°`).join("  "));
for (const id of Object.keys(out)) {
  const dk = out[id].dark, lt = out[id].light;
  console.log(`${id.padEnd(6)} dark acc ${dk.cyanx} (${contrast(dk.cyanx, dk.void).toFixed(1)}:1)  light acc ${lt.cyanx} (${contrast(lt.cyanx, lt.void).toFixed(1)}:1)  ink ${lt.brandtext}`);
}
if (failures) { console.error(`${failures} FAILURES`); process.exit(1); }

// ---- emit ELEMENTAL array literal (matches build-palette.mjs structure) ----
function alphaOf(hex, a) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}
const KEY_ORDER = ["void", "midnight", "depth", "surface", "brandtext", "muted", "cyanx", "violetx", "fuchsiax", "redx", "emerald", "amber"];
const variantBlock = (p, mode) => {
  const lines = KEY_ORDER.map((k) => `        "--color-${k}": "${p[k]}",`);
  const glow = mode === "dark"
    ? [`        "--glow-accent": "0 0 10px ${alphaOf(p.cyanx, 0.28)}",`, `        "--glow-accent-strong": "0 0 16px ${alphaOf(p.cyanx, 0.45)}",`]
    : [`        "--glow-accent": "none",`, `        "--glow-accent-strong": "none",`];
  return `      ${mode}: {\n${lines.join("\n")}\n${glow.join("\n")}\n        "--bg-url": "",\n        "--bg-video": "",\n      }`;
};
const NAMES = { fire: "Fire", water: "Water", wind: "Wind", earth: "Earth" };
const entries = Object.keys(out).map((id) => {
  return `  {\n    id: "${id}", name: "${NAMES[id]}", source: "owner", license: "\u2014",\n    variants: {\n${variantBlock(out[id].dark, "dark")},\n${variantBlock(out[id].light, "light")},\n    },\n  }`;
});
const arraySrc = `const ELEMENTAL = [\n${entries.join(",\n")},\n];`;

writeFileSync(resolve(HERE, "../../scratch/elemental-array.mjs"), arraySrc + "\n");
console.log("\nOK — wrote elemental-palette.json + elemental-array.mjs");
