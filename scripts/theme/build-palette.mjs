#!/usr/bin/env node
// build-palette.mjs — generate src/theme-engine/palettes.json from MIT base16 YAML sources.
// Re-runnable: upstream YAML edits -> rerun -> palettes.json regenerated. No hand-edits.
// Role mapping is HUE-based (ponytail: 8 deterministic rules cover every Astra token),
// because base16 slot semantics drift between schemes (tokyo-night-dark base08 is a fg tint).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const YAML_DIR = process.argv[2] || resolve(HERE, "palettes-yaml");
const OUT = resolve(HERE, "../../src/theme-engine/palettes.json");

// ---------- tiny YAML reader (flat palette files only; 2-space indent, quoted values) ----------
function parsePaletteYaml(text) {
  const meta = {};
  const pal = {};
  let inPalette = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, ""); // strip trailing comments
    if (!line.trim()) continue;
    if (/^palette:\s*$/.test(line)) { inPalette = true; continue; }
    if (inPalette && /^\S/.test(line)) inPalette = false;
    const m = inPalette
      ? line.match(/^\s+(base[0-9A-F]{2}):\s*"?([#0-9a-fA-F]{6,7})"?/) // tolerate stray '#'
      : line.match(/^([a-zA-Z_]+):\s*"?([^"\n]*)"?\s*$/);
    if (!m) continue;
    if (inPalette) pal[m[1].toLowerCase()] = normalize(m[2]);
    else if (["system", "name", "author", "variant"].includes(m[1])) meta[m[1]] = m[2];
  }
  if (Object.keys(pal).length !== 16) throw new Error(`expected 16 base slots, got ${Object.keys(pal).length}`);
  return { meta, pal };
}
function normalize(v) {
  let s = String(v).replace(/[^#0-9a-fA-F]/g, "");
  if (!s.startsWith("#")) s = "#" + s;
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) throw new Error(`bad color ${v}`);
  return s.toLowerCase();
}

// ---------- color math (hand-rolled; no dependency) ----------
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lumOf = (rgb) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function hueSat(hex) {
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2, d = max - min;
  let h = 0;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h, s, l };
}
const satOf = (hex) => hueSat(hex).s;
const lumOfHex = (h) => lumOf(rgbOf(h));
const contrast = (a, b) => { const l1 = lumOf(a), l2 = lumOf(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
// rotate hex hue by deg (used to split one accent into the pair family)
function rotateHue(hex, deg) {
  const { h, s, l } = hueSat(hex);
  return hslToHex(((h + deg) % 360 + 360) % 360, s, l);
}
function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
// darken/lighten toward black/white keeping hue (for light-mode accent deepening)
function adjustL(hex, dl) {
  const { h, s, l } = hueSat(hex);
  return hslToHex(h, s, Math.min(1, Math.max(0, l + dl)));
}
// hue family classify
const FAMILY = (h) =>
  h.s < 0.12 ? "neutral" :
  h.h < 20 || h.h >= 330 ? "red" :
  h.h < 45 ? "orange" :
  h.h < 70 ? "yellow" :
  h.h < 170 ? "green" :
  h.h < 200 ? "teal" :
  h.h < 260 ? "blue" :
  h.h < 300 ? "violet" : "magenta";

function pickByFamily(pal, family, { exclude = new Set() } = {}) {
  let best = null;
  for (const slot of ["BASE08", "BASE09", "BASE0A", "BASE0B", "BASE0C", "BASE0D", "BASE0E", "BASE0F"]) {
    if (exclude.has(slot)) continue;
    const c = pal[slot];
    const h = hueSat(c);
    if (FAMILY(h) !== family) continue;
    const score = h.s + (h.l > 0.25 && h.l < 0.85 ? 0.5 : 0);
    if (!best || score > best.score) best = { slot, c, score };
  }
  return best;
}

// ---------- Astra UI (canonical; must equal current index.css values) ----------
const ASTRA_UI = {
  id: "astra-ui", name: "Astra UI", source: "owner", license: "—",
  variants: {
    dark: {
      "--color-void": "#0a0a0f", "--color-midnight": "#12121a", "--color-depth": "#1a1a2e", "--color-surface": "#252538",
      "--color-brandtext": "#f8fafc", "--color-muted": "#6b7280",
      "--color-cyanx": "#22d3ee", "--color-violetx": "#34d399", "--color-fuchsiax": "#d946ef", "--color-redx": "#f87171",
      "--color-emerald": "#34d399", "--color-amber": "#fbbf24",
      "--glow-accent": "0 0 10px rgba(34,211,238,.25)", "--glow-accent-strong": "0 0 16px rgba(34,211,238,.4)",
      "--bg-url": "", "--bg-video": "",
    },
    light: {
      "--color-void": "#f5f2ec", "--color-midnight": "#fdfcf9", "--color-depth": "#ece8df", "--color-surface": "#e1dcd1",
      "--color-brandtext": "#0f172a", "--color-muted": "#5b6472",
      "--color-cyanx": "#0369a1", "--color-violetx": "#047857", "--color-fuchsiax": "#a21caf", "--color-redx": "#b91c1c",
      "--color-emerald": "#047857", "--color-amber": "#b45309",
      "--glow-accent": "none", "--glow-accent-strong": "none",
      "--bg-url": "", "--bg-video": "",
    },
  },
};

// ---------- base16 -> Astra token mapping (HUE rules) ----------
function fromBase16(id, name, meta, pal) {
  const up = (s) => pal[s.toLowerCase()];
  for (const slot of ["base00","base01","base02","base03","base04","base05","base08","base09","base0A","base0B","base0C","base0D","base0E","base0F"]) {
    if (!up(slot)) throw new Error(`${id}: missing slot ${slot} (got ${Object.keys(pal).join(",")})`);
  }
  pal = Object.fromEntries(Object.keys(pal).map((k) => [k.toUpperCase(), pal[k]]));
  const isLight = (meta.variant === "light") || lumOfHex(pal.BASE00) > 0.45;
  const hexLum = (h) => lumOfHex(h);
  // surfaces: BASE00 (deepest) -> BASE01 -> BASE02 -> BASE03 by luminance order
  const ordered = ["BASE00", "BASE01", "BASE02", "BASE03", "BASE04", "BASE05"].sort((a, b) => hexLum(pal[a]) - hexLum(pal[b]));
  const surfaces = isLight ? [ordered[5], ordered[4], ordered[3], ordered[2]] : [ordered[0], ordered[1], ordered[2], ordered[3]];
  // accents: primary = the theme's identity color. Terminal themes are known by
  // their blue/cyan/violet; score those families up, saturation breaks ties.
  let best = null;
  for (const slot of ["BASE0A", "BASE0C", "BASE0D", "BASE0B", "BASE0E", "BASE09"]) {
    const c = pal[slot], h = hueSat(c);
    if (h.s < 0.2) continue;
    const fam = FAMILY(h);
    const famBonus = fam === "teal" ? 0.9 : fam === "blue" ? 0.8 : fam === "violet" ? 0.5 : fam === "magenta" ? 0.2 : 0;
    const score = h.s * 0.5 + famBonus + (isLight ? (0.5 - Math.abs(0.3 - h.l)) : (h.l > 0.45 && h.l < 0.85 ? 0.4 : 0));
    if (!best || score > best.score) best = { slot, c, score };
  }
  const primary = best ? best.c : (isLight ? "#0369a1" : "#22d3ee");
  // error/red: reddest accent slot; fallback rotate
  const redPick = pickByFamily(pal, "red", { exclude: new Set([best?.slot]) });
  const redx = redPick ? redPick.c : rotateHue(primary, 180);
  // emerald: green/teal family; amber: yellow/orange family
  const emPick = pickByFamily(pal, "green") || pickByFamily(pal, "teal") || pickByFamily(pal, "orange");
  const ambPick = pickByFamily(pal, "yellow") || pickByFamily(pal, "orange");
  // text + muted
  const textHex = isLight ? pal.BASE01 : pal.BASE05;
  const muted = pal.BASE04;
  const deep = (c, dl) => adjustL(c, isLight ? -(0.32 + dl) : dl); // light mode: deepen accents for AA
  // dark variant: if the scheme is light-origin, its "dark" surfaces are just inverted order —
  // text must be the LIGHTEST slot (BASE05 family) and must actually contrast with void.
  let darkVoid = pal.BASE00;
  // light-origin schemes: BASE00 is paper, not a dark ground. Force a genuinely dark void.
  let darkGuard = 0;
  while (lumOf(rgbOf(darkVoid)) > 0.09 && darkGuard++ < 40) darkVoid = adjustL(darkVoid, -0.05);
  const darkText = lumOf(rgbOf(textHex)) > lumOf(rgbOf(darkVoid)) && contrast(rgbOf(textHex), rgbOf(darkVoid)) >= 4.5 ? textHex : adjustL(darkVoid, 0.78);
  const darkMuted = contrast(rgbOf(muted), rgbOf(darkVoid)) >= 4.5 ? muted : adjustL(darkVoid, 0.42);
  const dark = {
    "--color-void": darkVoid, "--color-midnight": surfaces[1], "--color-depth": surfaces[2], "--color-surface": surfaces[3],
    "--color-brandtext": darkText, "--color-muted": darkMuted,
    "--color-cyanx": primary, "--color-violetx": rotateHue(primary, 60), "--color-fuchsiax": rotateHue(primary, -50),
    "--color-redx": redx,
    "--color-emerald": emPick ? emPick.c : rotateHue(primary, 120),
    "--color-amber": ambPick ? ambPick.c : rotateHue(primary, -100),
    "--glow-accent": `0 0 10px ${alpha(primary, 0.25)}`, "--glow-accent-strong": `0 0 16px ${alpha(primary, 0.4)}`,
    "--bg-url": "", "--bg-video": "",
  };
  // light variant: paper = LIGHTEST of the six neutral slots (by measured luminance),
  // ink = darkest usable. For dark-origin schemes the light counterpart is synthesized.
  const byLum = [...ordered].sort((a, b) => lumOf(rgbOf(pal[a])) - lumOf(rgbOf(pal[b])));
  // paper: the scheme's identity hue as a REAL tint (sat 10-20% by family, l 0.93-0.965 by
  // warmth) so every light theme reads distinct, like its dark sibling does.
  // identity hue: average hue of the scheme's accent slots (falls back to paper hue)
  const accSlots = ["BASE0A","BASE0C","BASE0D","BASE0B","BASE0E","BASE09"].map(k=>hueSat(pal[k])).filter(x=>x.s>0.15);
  const paperH = hueSat(byLum[5]).h;
  let accH = paperH;
  if (accSlots.length) {
    // circular mean of accent hues
    let sx=0, sy=0;
    for (const a of accSlots) { sx += Math.cos(a.h*Math.PI/180); sy += Math.sin(a.h*Math.PI/180); }
    accH = (Math.atan2(sy, sx) * 180/Math.PI + 360) % 360;
  }
  // blend paper hue 30% + identity hue 70% → unmistakably "that theme" while staying papery
  let dh = Math.abs(accH - paperH); if (dh > 180) dh = 360 - dh;
  const tintH = (paperH + dh * 0.7 * ((accH - paperH + 360) % 360 < 180 ? 1 : -1) + 360) % 360;
  const tintS = 0.10 + Math.min(0.10, accSlots.reduce((m,a)=>Math.max(m,a.s),0) * 0.12);
  const tintL = (tintH < 70 || tintH >= 300) ? 0.945 : tintH < 160 ? 0.955 : 0.935; // warm lighter, cool deeper
  const lightVoid = hslToHex(tintH, tintS, tintL);
  const lightMid  = hslToHex(tintH, tintS * 0.8, Math.min(0.985, tintL + 0.025));
  const lightDepth = hslToHex(tintH, tintS * 1.15, tintL - 0.032);
  const lightSurf = hslToHex(tintH, tintS * 1.3, tintL - 0.07);
  const lightText = lumOf(rgbOf(pal.BASE01)) < lumOf(rgbOf(lightVoid)) && contrast(rgbOf(pal.BASE01), rgbOf(lightVoid)) >= 4.5 ? pal.BASE01 : adjustL(lightVoid, -0.74);
  const light = {
    "--color-void": lightVoid, "--color-midnight": lightMid, "--color-depth": lightDepth, "--color-surface": lightSurf,
    "--color-brandtext": lumOf(rgbOf(lightText)) < lumOf(rgbOf(lightVoid)) ? lightText : adjustL(lightVoid, -0.72),
    "--color-muted": contrast(rgbOf(muted), rgbOf(lightVoid)) >= 4.5 ? muted : adjustL(lightVoid, -0.45),
    "--color-cyanx": deep(primary, 0), "--color-violetx": deep(rotateHue(primary, 60), 0.05), "--color-fuchsiax": deep(rotateHue(primary, -50), 0.05),
    "--color-redx": deep(redx, 0.05),
    "--color-emerald": emPick ? deep(emPick.c, 0.05) : deep(rotateHue(primary, 120), 0.05),
    "--color-amber": ambPick ? deep(ambPick.c, 0.05) : deep(rotateHue(primary, -100), 0.05),
    "--glow-accent": "none", "--glow-accent-strong": "none",
    "--bg-url": "", "--bg-video": "",
  };
  return { id, name, source: `tinted-theming/schemes (${meta.author || "unknown"})`, license: "MIT", variants: { dark, light } };
}
function alpha(hex, a) {
  const [r, g, b] = rgbOf(hex).map((c) => Math.round(c * 255));
  return `rgba(${r},${g},${b},${a})`;
}

// ---------- run ----------
// Astra UI is the ONLY theme (owner 2026-10-03): the multi-theme store was removed so the
// product ships one brand theme with a dark and a light variant. The base16 YAML sources and
// the fromBase16 mapper below are kept for reference/re-derivation but are no longer wired in —
// re-adding a palette means adding an id here AND a UI entry, deliberately.
const SOURCES = {};
const palettes = [ASTRA_UI];
for (const [id, file] of Object.entries(SOURCES)) {
  const text = readFileSync(join(YAML_DIR, file), "utf8");
  const { meta, pal } = parsePaletteYaml(text);
  palettes.push(fromBase16(id, meta.name || id, meta, pal));
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ version: 1, generated: "scripts/theme/build-palette.mjs", palettes }, null, 1) + "\n");
console.log(`wrote ${OUT} with ${palettes.length} palettes`);
for (const p of palettes) console.log(`  ${p.id.padEnd(22)} ${Object.keys(p.variants).join(",")}  cyanx(dark)=${p.variants.dark["--color-cyanx"]} void=${p.variants.dark["--color-void"]}`);
