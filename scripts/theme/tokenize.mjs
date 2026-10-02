#!/usr/bin/env node
// tokenize.mjs — ONE re-runnable pass over src/index.css:
//   every color literal in a *consumer* rule becomes rgb(var(--c-NN)/a)
//   (or rgb(var(--light-c-NN)/a) inside [data-theme="light"] rules);
//   token *definition* blocks (:root, @theme, the light token remap, --bubble-*)
//   are left as literals (they ARE the Astra UI canonical source of defaults);
//   adds --glow-accent/--glow-accent-strong definitions.
// Idempotent: run on already-tokenized CSS = no-op. `--reset` restores index.css.bak.
// Verify afterwards: scripts/theme/parity (build must stay visually identical).
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = resolve(HERE, "../../src/index.css");

if (process.argv.includes("--reset")) {
  copyFileSync(CSS + ".bak", CSS);
  console.log("restored index.css from index.css.bak");
  process.exit(0);
}

let css = readFileSync(CSS, "utf8");
if (process.argv.includes("--backup") || !existsSync(CSS + ".bak")) {
  copyFileSync(CSS, CSS + ".bak");
  console.log("backup -> index.css.bak");
}
if (css.includes("rgb(var(--c-")) { console.log("already tokenized; nothing to do"); process.exit(0); }

// defaults: Astra UI canonical (dark for --c-*, light for --light-c-*)
const { palettes } = JSON.parse(readFileSync(resolve(HERE, "../../src/theme-engine/palettes.json"), "utf8"));
const astra = palettes.find((p) => p.id === "astra-ui");
const hexChannels = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

// ---- parse flat rules (comments stripped) ----
const comments = [];
css = css.replace(/\/\*[\s\S]*?\*\//g, (m) => { comments.push(m); return `\u0000${comments.length - 1}\u0000`; });

const COLOR = /(rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b)/g;
const parseColor = (tok) => {
  if (tok.startsWith("#")) {
    let h = tok.slice(1);
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    return { rgb: hexChannels("#" + h), a: 1 };
  }
  const m = tok.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
};

const BLACK = [0, 0, 0], WHITE = [255, 255, 255];
// neutrals + astra surface/text literals resolve to the nearest canonical role so a
// theme swap re-tints them through the role token; everything else = own channel var.
const ROLE_DARK = {
  "10,10,15": "void", "18,18,26": "midnight", "26,26,46": "depth", "37,37,56": "surface",
  "248,250,252": "brandtext", "107,114,128": "muted", "34,211,238": "cyanx",
  "139,92,246": "violetx", "217,70,239": "fuchsiax", "248,113,113": "redx",
  "52,211,153": "emerald", "251,191,36": "amber",
};
const ROLE_LIGHT = {
  "245,242,236": "void", "253,252,249": "midnight", "236,232,223": "depth", "225,220,209": "surface",
  "15,23,42": "brandtext", "91,100,114": "muted", "3,105,161": "cyanx",
  "109,40,217": "violetx", "162,28,175": "fuchsiax", "185,28,28": "redx",
  "4,120,87": "emerald", "180,83,9": "amber",
};
// LIGHT-MODE-ONLY literals: hand-tuned deepened accents that exist ONLY inside
// [data-theme=light] rules (they already ARE the light-mode filter). If they also
// appeared in dark rules they'd have needed their own slot; they don't.
// 6,182,212 / 14,116,144 = nc-btn light gradient stops; 2,132,199 / 125,211,252 = wash auras.
const LIGHT_LITERAL = new Set([
  "6,182,212", "14,116,144", "2,132,199", "125,211,252",
]);
// reserved: definitions keep literals (single-token blocks + these property names in definition blocks)
const isDefinitionBlock = (sel, body) => {
  const s = sel.trim();
  if (/^:root$/.test(s) || /^@theme/.test(s)) return true;
  if (/^\[data-theme="light"\]$/.test(s) && !/--c-/.test(body)) return true; // token remap block
  return false;
};

const varSeq = []; // {key, default}
const seen = new Map(); // "role|light|a" -> varKey  /  "c|rgb|a" -> varKey

function keyFor(rgb, a, light) {
  const ks = rgb.join(",");
  // Context-aware roles: inside [data-theme=light] rules, only LIGHT-palette literals map to
  // roles. Dark-palette literals there (e.g. white text #f8fafc on a colored button) are
  // hand-picked overrides that stay stable across themes -> own-channel vars.
  const darkLit = ROLE_DARK[ks] != null;
  const lightLit = ROLE_LIGHT[ks] != null;
  let role = null;
  if (light) role = lightLit ? ROLE_LIGHT[ks] : null;
  else role = darkLit ? ROLE_DARK[ks] : null;
  if (LIGHT_LITERAL.has(ks)) role = null;
  const id = role ? `${role}${light ? ":L" : ""}` : `x${ks}${light ? ":L" : ""}`;
  const mapK = `${role ? "r" : "c"}|${id}|${a}`;
  if (seen.has(mapK)) return seen.get(mapK);
  const key = light ? `--light-c-${varSeq.filter((v) => v.light).length + 1}` : `--c-${varSeq.length + 1}`;
  // default value: for role vars -> the ROLE hex channels (same in both modes, values differ per mode);
  // for unknown colors -> own channels; alpha rides along
  const def = { key, role: role || null, rgb, a, light };
  seen.set(mapK, key);
  varSeq.push(def);
  return key;
}

let replaced = 0;
css = css.replace(/([^{}]+)\{([^{}]*)\}/g, (whole, sel, body) => {
  const light = /\[data-theme="light"\]/.test(sel);
  if (isDefinitionBlock(sel, body)) return whole;
  let n = 0;
  const nb = body.replace(/([a-zA-Z-]+)\s*:\s*([^;]*)/g, (d, prop, val) => {
    if (prop.startsWith("--") && !prop.startsWith("--yarl")) return d; // custom-prop definitions stay
    const nv = val.replace(COLOR, (tok) => {
      const { rgb, a } = parseColor(tok);
      const isNeutralShadow = (prop.includes("shadow") || prop.includes("mask")) && (rgb.every((c, i) => c === BLACK[i]) || rgb.every((c, i) => c === WHITE[i]));
      const target = isNeutralShadow ? null : rgb;
      let key;
      if (isNeutralShadow) {
        // keep pure black/white elevation/masks literal
        return tok;
      }
      key = keyFor(target, a, light);
      n++;
      const alphaSuffix = a === 1 ? "" : ` / ${a}`;
      return `rgb(var(${key})${alphaSuffix})`;
    });
    return nv === val ? d : `${prop}:${nv}`;
  });
  if (n) replaced += n;
  return `${sel}{${nb}}`;
});

// ---- emit definitions ----
const defs = varSeq.map((v) => {
  const ch = v.role ? hexChannels(astra.variants[v.light ? "light" : "dark"]["--color-" + v.role]) : v.rgb;
  // --r-N carries the role so the runtime engine can retarget every derived shade too
  const roleTag = v.role ? `  --r-${v.key.replace(/--(light-)?c-/, "")}: ${v.role};` : "";
  return roleTag ? `  ${v.key}: ${ch.join(" ")};\n${roleTag}` : `  ${v.key}: ${ch.join(" ")};`;
});
const GLOWS = [
  "  --glow-accent: 34 211 238;",
  "  --glow-accent-strong: 34 211 238;",
  "  --glow-accent-a: .25;",
  "  --glow-accent-strong-a: .4;",
];
const block = `\n/* ==== theme-engine token channels (generated by scripts/theme/tokenize.mjs — do not hand-edit) ==== */\n:root {\n${defs.join("\n")}\n${GLOWS.join("\n")}\n}\n`;
// insert after the last @theme block's closing (top of file is fine: :root after @theme)
css = css.replace(/(@theme\s*\{[^{}]*\})/, (m) => m + block);
css = css.replace(/\u0000(\d+)\u0000/g, (_, i) => comments[+i]);
writeFileSync(CSS, css);
console.log(`tokenized ${replaced} color literals -> ${varSeq.length} channel vars (${varSeq.filter((v) => v.light).length} light)`);
console.log(`wrote ${CSS}`);
