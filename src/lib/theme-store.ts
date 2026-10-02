// theme-store.ts — runtime theme engine. Applies a palette (subset or full) by
// writing channel variables onto :root (dark) / the light scope; persists the
// selection; broadcasts the existing astra-theme-change event so every existing
// listener (tubes canvas, shell bars, toggle) keeps working.
// Channel vars come from the tokenized CSS (295 defs); roles resolve per mode.

import rawPalettes from "../theme-engine/palettes.json";

export interface PaletteVariant { [token: string]: string } // "--color-void": "#0a0a0f"
export interface Palette {
  id: string; name: string; source: string; license: string;
  variants: { dark: PaletteVariant; light: PaletteVariant };
}
export const palettes = (rawPalettes as unknown as { palettes: Palette[] }).palettes;
export type ThemeMode = "dark" | "light";

const LS_KEY = "astra-palette";
const LS_CUSTOM = "astra-palette-custom";
const LS_BG = "astra-chat-bg";

export const getMode = (): ThemeMode =>
  document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";

/** Read a role's channel triple from a palette variant ("34 211 238" form). */
function channels(variant: PaletteVariant, token: string): string {
  const hex = variant[token] || "";
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return "";
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");
}

// Token -> generated channel var suffixes produced by tokenize.mjs.
// We discover them from the live stylesheet instead of hardcoding: any
// definition comment block carries them; simpler: we re-derive by scanning CSSOM once.
let roleVars: { dark: Map<string, string[]>; light: Map<string, string[]> } | null = null;
function discoverRoleVars() {
  if (roleVars) return roleVars;
  const dark = new Map(), light = new Map();
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const txt = rule.style;
      for (let i = 0; i < txt.length; i++) {
        const prop = txt[i];
        if (!prop.startsWith("--c-") && !prop.startsWith("--light-c-")) continue;
        const val = txt.getPropertyValue(prop).trim(); // "r g b"
        const m = val.match(/^(\d+)\s+(\d+)\s+(\d+)$/);
        if (!m) continue;
        (prop.startsWith("--light-c-") ? light : dark).set(m.slice(1, 4).join(","), [prop, val]);
      }
    }
  }
  roleVars = { dark, light };
  return roleVars;
}

/** Apply palette `p` for the current (or given) mode: rewrites every generated
 *  channel var whose default equals one of Astra UI's current mode colors. */
export function applyPalette(p: Palette, mode: ThemeMode = getMode()) {
  const { dark, light } = discoverRoleVars();
  const source = mode === "light" ? p.variants.light : p.variants.dark;
  const astraMode = (mode === "light" ? palettes[0].variants.light : palettes[0].variants.dark);
  const table = mode === "light" ? light : dark;
  const root = document.documentElement;
  let n = 0;
  // Direct @theme overrides: tailwind utilities (text-brandtext, bg-void, …) reference
  // var(--color-*) — set them straight from the palette for this mode.
  for (const [token, hex] of Object.entries(source)) {
    if (token.startsWith("--color-") && /^#[0-9a-fA-F]{6}$/.test(hex)) root.style.setProperty(token, hex);
  }
  for (const [token] of Object.entries(source)) {
    const ch = channels(source, token);
    if (!ch) continue;
    // every generated var whose default triple == astra's canonical triple for this
    // token in this mode gets retargeted
    const canon = channels(astraMode, token);
    if (!canon) continue;
    for (const [rgbKey, [prop]] of table) {
      if (rgbKey !== canon) continue;
      root.style.setProperty(prop, ch);
      n++;
    }
  }
  return n;
}

export function currentPaletteId(): string {
  try { return localStorage.getItem(LS_KEY) || "astra-ui"; } catch { return "astra-ui"; }
}

export function setPalette(id: string): number {
  const p = palettes.find((x) => x.id === id);
  if (!p) return -1;
  try { localStorage.setItem(LS_KEY, id); } catch { /* private mode */ }
  const n = applyPalette(p);
  window.dispatchEvent(new CustomEvent("astra-palette-change", { detail: id }));
  return n;
}

export function resetToAstra(): number {
  try { localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_CUSTOM); } catch { /* noop */ }
  const n = applyPalette(palettes[0]);
  window.dispatchEvent(new CustomEvent("astra-palette-change", { detail: "astra-ui" }));
  return n;
}

/** Token-level edit: overrides one role for one palette in one mode, persisted. */
export type CustomEdits = Record<string, { dark?: Record<string, string>; light?: Record<string, string> }>; // paletteId -> mode -> token -> hex
export function readCustom(): CustomEdits {
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM) || "{}"); } catch { return {}; }
}
export function setToken(paletteId: string, mode: ThemeMode, token: string, hex: string): boolean {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return false;
  const all = readCustom();
  (all[paletteId] ||= {})[mode] ||= {};
  all[paletteId][mode][token] = hex;
  try { localStorage.setItem(LS_CUSTOM, JSON.stringify(all)); } catch { return false; }
  if (paletteId === currentPaletteId()) {
    const p = palettes.find((x) => x.id === paletteId);
    if (p) {
      const merged = mergeCustom(p);
      applyPalette(merged, mode);
    }
  }
  return true;
}
export function clearCustom(paletteId: string) {
  const all = readCustom();
  delete all[paletteId];
  try { localStorage.setItem(LS_CUSTOM, JSON.stringify(all)); } catch { /* noop */ }
}
/** Palette with user edits layered on top. */
export function mergeCustom(p: Palette): Palette {
  const all = readCustom();
  const mine = all[p.id];
  if (!mine) return p;
  return {
    ...p,
    variants: {
      dark: { ...p.variants.dark, ...(mine.dark || {}) },
      light: { ...p.variants.light, ...(mine.light || {}) },
    },
  };
}

/** Boot-time restore: called once from main.tsx AFTER first paint prep, BEFORE app render. */
export function restorePalette() {
  const id = currentPaletteId();
  if (id === "astra-ui") return;
  const p = palettes.find((x) => x.id === id);
  if (!p) return;
  applyPalette(mergeCustom(p));
}

/** Chat backdrop preference (URL or uploaded path; empty = off). */
export interface ChatBg { kind: "image" | "video" | "youtube"; src: string; blur?: number; dim?: number }
export function readChatBg(): ChatBg | null {
  try {
    const raw = localStorage.getItem(LS_BG);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function writeChatBg(bg: ChatBg | null) {
  try {
    if (bg) localStorage.setItem(LS_BG, JSON.stringify(bg));
    else localStorage.removeItem(LS_BG);
  } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent("astra-chat-bg-change", { detail: bg }));
}

/** Parse a YouTube URL -> video id (watch, youtu.be, shorts, embed). */
export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}
