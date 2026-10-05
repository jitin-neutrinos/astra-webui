// theme-store.ts — runtime theme engine. Applies a palette (subset or full) by
// writing channel variables onto :root (dark) / the light scope; persists the
// selection; broadcasts the existing astra-theme-change event so every existing
// listener (tubes canvas, shell bars, toggle) keeps working.
// Channel vars come from the tokenized CSS (295 defs); roles resolve per mode.

import rawPalettes from "../theme-engine/palettes.json";
import { readUserThemes, writeUserThemes, type UserTheme } from "./color-engine";

export interface PaletteVariant { [token: string]: string } // "--color-void": "#0a0a0f"
export interface Palette {
  id: string; name: string; source: string; license: string;
  variants: { dark: PaletteVariant; light: PaletteVariant };
}
export const palettes = (rawPalettes as unknown as { palettes: Palette[] }).palettes;
export type ThemeMode = "dark" | "light";

/**
 * Every selectable palette: the shipped ones plus the user's saved themes.
 *
 * User themes are STORED SEPARATELY from palettes.json on purpose — the shipped
 * list is a generated artefact (build-palette.mjs rewrites it, so a hand-edit
 * there is erased), while user themes are runtime data that must survive both a
 * rebuild and a `hermes update`. They are merged HERE, at the single lookup
 * seam, so every existing consumer (picker, applyPalette, mergeCustom,
 * currentPaletteId, the sync layer) sees both without being rewritten.
 */
export function allPalettes(): Palette[] {
  const user = readUserThemes().map(
    (t: UserTheme): Palette => ({
      id: t.id,
      name: t.name,
      source: "user",
      license: t.license,
      variants: { dark: t.variants.dark, light: t.variants.light },
    })
  );
  // A user theme may shadow a shipped id (re-deriving "astra-ui"); the user's wins.
  const shadowed = new Set(user.map((u) => u.id));
  return [...palettes.filter((p) => !shadowed.has(p.id)), ...user];
}

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
/** Sync the browser-chrome color (theme-color meta) with the active palette's void, and
 *  re-derive the slate ramp from the palette's own ink so `text-slate-*` utilities stay
 *  readable on ANY theme's ground, in BOTH modes.
 *
 *  Why this matters: the chat surface uses `text-slate-300..700` in ~10 places (sidebar
 *  section labels, composer hint, timestamps). Those utilities resolve from @theme at BUILD
 *  time, so they carry Tailwind's stock slate values and completely bypass the palette. Stock
 *  slate-600 (#475569) is only 2.4:1 on a dark ground — below even the 3:1 non-text minimum —
 *  which is what reads as "muddy, hard-to-read secondary text". Deriving the ramp from the
 *  palette's ink + void makes every step a tint of THAT theme's own colours. */
function syncThemeColorMeta(mode: ThemeMode) {
  const p = mergeCustom(allPalettes().find((x) => x.id === currentPaletteId()) || palettes[0]);
  const v = p.variants[mode] || {};
  const voidHex = v["--color-void"];
  if (/^#[0-9a-fA-F]{6}$/.test(voidHex || "")) {
    const meta = document.querySelector('meta[name="theme-color"]:not([media])');
    meta?.setAttribute("content", voidHex);
  }
  const root = document.documentElement;
  const ink = v["--color-brandtext"] || (mode === "light" ? "#040408" : "#f2f3f7");
  const ground = voidHex || (mode === "light" ? "#f5f2ec" : "#0a0a0f");
  // keep% = how much INK remains after mixing toward the ground.
  // Light (ink is dark): lighter steps keep LESS ink. Dark (ink is light): lighter steps keep MORE.
  const ramp: Array<[string, number]> = mode === "light"
    ? [["--color-slate-200", 82], ["--color-slate-300", 68], ["--color-slate-400", 55], ["--color-slate-500", 45], ["--color-slate-600", 40], ["--color-slate-700", 30]]
    // keep% tuned per step so slate-600 clears 4.5:1 (real labels) and slate-700 clears 3:1
    // (the dimmest step, used for hairlines/meta) on every palette's own ground.
    : [["--color-slate-200", 78], ["--color-slate-300", 66], ["--color-slate-400", 59], ["--color-slate-500", 55], ["--color-slate-600", 54], ["--color-slate-700", 44]];
  for (const [name, keep] of ramp) {
    root.style.setProperty(name, `color-mix(in oklab, ${ink} ${keep}%, ${ground})`);
  }
  // Skeleton greys. Same idea as the slate ramp — re-derived from the ACTIVE palette so a
  // skeleton is never left carrying the previous theme's grey (and never carries the accent,
  // which is what made some of them orange and others blue). Set here rather than in the
  // stylesheet so a palette swap that only rewrites inline --color-* props still moves them.
  const pct = SKEL_PCT[mode];
  root.style.setProperty("--ast-sk-fill", neutralGrey(ink, ground, pct.fill));
  root.style.setProperty("--ast-sk-sweep", neutralGrey(ink, ground, pct.sweep));
}

// hex -> [r,g,b]
const rgbOfHex = (h: string): [number, number, number] => {
  const x = h.replace("#", "");
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
};
// Retarget a derived shade (gradient bottoms, dim glows): keep each channel's
// ratio to the old accent, scaled onto the new accent.
function deriveShade(oldChannels: string, oldAccent: [number, number, number], newAccent: [number, number, number]): string {
  // Accept either separator — callers have passed both historically, and splitting the wrong
  // one silently produced a single NaN token.
  const ch = oldChannels.split(/[\s,]+/).map(Number);
  if (ch.length !== 3 || ch.some((x) => !Number.isFinite(x))) return newAccent.join(" ");
  return [0, 1, 2].map((i) => Math.max(0, Math.min(255, Math.round(newAccent[i] * (ch[i] / (oldAccent[i] || 1)))))).join(" ");
}

/** A hue-free grey at a given fraction of the way from a palette's ground to its ink.
 *
 *  WHY THIS EXISTS (owner 2026-10-03): every skeleton loader painted its shimmer from `--c-69`,
 *  which the tokenizer annotates `cyanx` — the theme ACCENT. So one skeleton was cyan under
 *  Astra, sky blue under Water and ORANGE under Fire (#ff5c1f): exactly the "some orange, some
 *  blue" report. The fills were already neutral; only the sweep carried hue.
 *
 *  WHY NOT color-mix ALONE: mixing void with brandtext still leaves each palette's cast
 *  (measured sat 0.13 Fire, 0.29 Water in dark). So interpolate in oklab, take ONLY the
 *  lightness component, and rebuild as an achromatic colour of that lightness (chroma pinned 0).
 *  The result is a true neutral that still sits at the right contrast against that palette's
 *  ground — see SKEL_PCT for the tuned percentages and .ast-sk in index.css for the measured ratios. */
function neutralGrey(inkHex: string, groundHex: string, pct: number): string {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const unlin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  // oklab cone lightness = cbrt(linear RGB . LMS matrix)
  const lightness = (hex: string) => {
    const [r, g, b] = rgbOfHex(hex).map(lin) as [number, number, number];
    return Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  };
  const L = lightness(groundHex) + (lightness(inkHex) - lightness(groundHex)) * pct;
  // Rebuild as achromatic: for a grey all three cone responses are equal, so feed L^3 back
  // through the linear-RGB matrix on every channel. That pins chroma to exactly 0.
  const k = L * L * L;
  const ch = [
    0.4122214708 * k + 0.5363325363 * k + 0.0514459929 * k,
    0.2119034982 * k + 0.6806995451 * k + 0.1073969566 * k,
    0.0883024619 * k + 0.2817188376 * k + 0.6299787005 * k,
  ];
  return "#" + ch.map((v) => Math.max(0, Math.min(255, Math.round(unlin(v) * 255))).toString(16).padStart(2, "0")).join("");
}

// Ink percentages for the skeleton scale. Dark needs more ink than light to reach the same
// visual weight; the sweep is a fixed step further along the same axis.
const SKEL_PCT = { dark: { fill: 0.22, sweep: 0.34 }, light: { fill: 0.10, sweep: 0.26 } } as const;

export function applyPalette(p: Palette, mode: ThemeMode = getMode()) {
  const source = mode === "light" ? p.variants.light : p.variants.dark;
  const astraMode = (mode === "light" ? palettes[0].variants.light : palettes[0].variants.dark);
  const root = document.documentElement;
  // astra-ui IS the stylesheet's own default: :root holds its dark values and the
  // [data-theme="light"] scope holds its light ones. Writing 280 inline overrides for it made the
  // toggle path diverge from the reload path (boot deliberately skips astra-ui, so it showed 5
  // inline props against the toggle's 282). Clear our overrides and let the cascade supply it.
  const isDefault = p.id === palettes[0].id;
  if (isDefault) {
    for (const name of [...root.style]) {
      if (name.startsWith("--") && name !== "--i") root.style.removeProperty(name);
    }
    return 0;
  }
  let n = 0;
  // Direct @theme overrides: tailwind utilities (text-brandtext, bg-void, …)
  // `--color-accent` is the ROLE every component consumes and is derived from
  // whichever palette is active — so a palette switch must move it explicitly,
  // or a non-Astra palette paints Astra's cyan everywhere the accent is used.
  for (const [token, hex] of Object.entries(source)) {
    if (token.startsWith("--color-") && /^#[0-9a-fA-F]{6}$/.test(hex)) root.style.setProperty(token, hex);
  }
  root.style.setProperty("--color-accent", source["--color-cyanx"] || astraMode["--color-cyanx"] || "#2bc8f3");
  // Non-color tokens the palettes carry (--glow-accent, --glow-accent-strong, --bg-url,
  // --bg-video). These differ per MODE — dark defines a glow, light sets "none" — so skipping
  // them left dark-mode glows burning on light paper after a toggle. Write them verbatim.
  for (const token of ["--glow-accent", "--glow-accent-strong", "--bg-url", "--bg-video"]) {
    const v = source[token];
    if (typeof v === "string") root.style.setProperty(token, v);
  }
  // role map from the --r-N annotations tokenize.mjs emits: chanProp -> role.
  // ALSO collect every channel var prop+default (the triple-keyed table collapses
  // props that share a triple — iterating the rule list directly hits each one).
  const roleOf = new Map<string, string>();
  const chans: [string, string][] = []; // [prop, defaultTriple]
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const txt = rule.style;
      for (let i = 0; i < txt.length; i++) {
        const prop = txt[i];
        if (prop.startsWith("--r-")) { roleOf.set("--" + prop.replace("--r-", ""), txt.getPropertyValue(prop).trim()); continue; }
        if (/^--(light-)?c-\d+$/.test(prop)) {
          const val = txt.getPropertyValue(prop).trim();
          // SPACE-joined everywhere: channels() and the astraAccentCh comparison below both use
          // spaces. Storing commas here made `rgbKey !== astraAccentCh` always true and made
          // deriveShade split a comma-joined string into one token -> NaN channels.
          if (/^\d+\s+\d+\s+\d+$/.test(val)) chans.push([prop, val.split(/\s+/).join(" ")]);
        }
      }
    }
  }
  // accent = the theme's brand color (cyanx slot)
  const accentNew = rgbOfHex(source["--color-cyanx"]);
  const accentAstra = rgbOfHex(astraMode["--color-cyanx"]);
  const astraAccentCh = channels(astraMode, "--color-cyanx");
  for (const [prop, rgbKey] of chans) {
    // `--light-c-N` and `--c-N` are INDEPENDENT props with their own colors and roles: the
    // light scope's `--light-c-4` is paper while `--c-4` is cyanx. Do NOT alias their roles —
    // only the prop's own --r-N annotation is authoritative. Props the tokenizer left unroled
    // are deliberately theme-stable own-channel literals; inventing a role for them made the
    // toggle path write values the reload path never does, which is the divergence we're fixing.
    const role = roleOf.get(prop);
    if (role) {
      // Role → palette slot. The accent role is named for what it IS (the theme's
      // accent), while the storage slot in palettes.json keeps its original key
      // (`--color-cyanx`) so the 5 palette files stay untouched — map here
      // instead of renaming the palette schema under every consumer.
      const hex = role === "accent" ? source["--color-cyanx"] : source["--color-" + role];
      if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) { root.style.setProperty(prop, rgbOfHex(hex).join(" ")); n++; continue; }
    }
    // derived accent-family shades (not the accent itself): keep the shade ratio.
    // Compare against BOTH astra accents: a prop holding the light accent (e.g. the light-only
    // login glow wash) must be recognized as "the accent" even when applied in dark mode, or the
    // toggle path scales it while the reload path skips it.
    if (astraAccentCh && rgbKey !== astraAccentCh && rgbKey !== channels(palettes[0].variants.dark, "--color-cyanx") && rgbKey !== channels(palettes[0].variants.light, "--color-cyanx")) {
      const [r, g, b] = rgbKey.split(/[\s,]+/).map(Number);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const inFamily = Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && mx - mn > 30 && (Math.abs(r - accentAstra[0]) + Math.abs(g - accentAstra[1]) + Math.abs(b - accentAstra[2])) < 420;
      if (inFamily) { root.style.setProperty(prop, deriveShade(rgbKey, accentAstra, accentNew)); n++; }
    }
  }
  return n;
}

export function currentPaletteId(): string {
  // A stored id for a removed palette (the pre-2026-10-03 multi-theme store) must not leave the
  // UI pointing at a theme that no longer exists — fall back to Astra UI and drop the stale key.
  try {
    const id = localStorage.getItem(LS_KEY);
    if (!id) return palettes[0].id;
    if (allPalettes().some((p) => p.id === id)) return id;
    localStorage.removeItem(LS_KEY);
    return palettes[0].id;
  } catch { return palettes[0].id; }
}

export function setPalette(id: string): number {
  const p = allPalettes().find((x) => x.id === id);
  if (!p) return -1;
  try { localStorage.setItem(LS_KEY, id); } catch { /* private mode */ }
  const n = applyPalette(p);
  syncThemeColorMeta(getMode());
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
    const p = allPalettes().find((x) => x.id === paletteId);
    if (p) {
      const merged = mergeCustom(p);
      applyPalette(merged, mode);
    }
  }
  schedulePush({ custom: readCustom() });
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
  if (id !== "astra-ui") {
    const p = allPalettes().find((x) => x.id === id);
    if (p) {
      applyPalette(mergeCustom(p));
      window.dispatchEvent(new CustomEvent("astra-palette-change", { detail: id })); // drives sync push
    }
  }
  syncThemeColorMeta(getMode());
}
// default palette too: browser chrome should carry Astra's void per mode
try {
  const m = getMode();
  syncThemeColorMeta(m);
  window.addEventListener("astra-theme-change", () => {
    // sidebar dark/light flip: re-apply the ACTIVE palette for the NEW mode (channel vars +
    // @theme overrides + chrome meta) so the switch is instant — no reload (owner 10-02 bug).
    const id = currentPaletteId();
    const p = allPalettes().find((x) => x.id === id);
    if (p) applyPalette(mergeCustom(p), getMode());
    syncThemeColorMeta(getMode());
  });
} catch { /* pre-DOM safety */ }

// ---- realtime cross-device sync (server is truth; local edits push) ----
let syncRev = 0;
let applyingRemote = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
type SyncState = { palette?: string; mode?: ThemeMode; bg?: ChatBg | null; custom?: CustomEdits; userThemes?: UserTheme[]; rev?: number };

async function pushSync(patch: Partial<SyncState>) {
  try {
    const res = await fetch("/api/theme/state", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const data = await res.json().catch(() => ({}));
    if (typeof data.rev === "number") syncRev = data.rev;
  } catch { /* offline: local stands, next push retries */ }
}
function schedulePush(patch: Partial<SyncState>) {
  if (applyingRemote) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; void pushSync(patch); }, 400);
}
function applyRemote(st: SyncState) {
  applyingRemote = true;
  try {
    if (typeof st.rev === "number") syncRev = st.rev;
    if (st.palette && st.palette !== currentPaletteId()) {
      try { localStorage.setItem(LS_KEY, st.palette); } catch { /* noop */ }
      const p = allPalettes().find((x) => x.id === st.palette);
      if (p) applyPalette(mergeCustom(p), st.mode || getMode());
      window.dispatchEvent(new CustomEvent("astra-palette-change", { detail: st.palette }));
    }
    if (st.custom) {
      try { localStorage.setItem(LS_CUSTOM, JSON.stringify(st.custom)); } catch { /* noop */ }
      const p = allPalettes().find((x) => x.id === currentPaletteId());
      if (p) applyPalette(mergeCustom(p));
    }
    if (st.userThemes) {
      // Owner requirement: a saved theme is available on EVERY device and app.
      // Remote wins wholesale (last-write-wins) rather than merging per-id, so a
      // delete on one device propagates instead of being resurrected by a merge.
      if (JSON.stringify(readUserThemes()) !== JSON.stringify(st.userThemes)) {
        writeUserThemes(st.userThemes);
        // If the ACTIVE theme was one the remote just deleted, fall back cleanly.
        const p = allPalettes().find((x) => x.id === currentPaletteId());
        if (p) applyPalette(mergeCustom(p), st.mode || getMode());
      }
    }
    if (st.bg !== undefined) {
      const cur = readChatBg();
      if (JSON.stringify(cur) !== JSON.stringify(st.bg)) {
        try { st.bg ? localStorage.setItem(LS_BG, JSON.stringify(st.bg)) : localStorage.removeItem(LS_BG); } catch { /* noop */ }
        window.dispatchEvent(new CustomEvent("astra-chat-bg-change", { detail: st.bg }));
      }
    }
  } finally { applyingRemote = false; }
}
/** Boot the sync loop: pull now, poll every 5s, push local changes. */
export function startThemeSync() {
  void (async () => {
    try {
      const res = await fetch("/api/theme/state", { credentials: "same-origin" });
      if (res.ok) { const st = await res.json(); if (st.rev > 0) applyRemote(st); }
    } catch { /* offline */ }
  })();
  window.setInterval(async () => {
    if (document.hidden) return;
    try {
      const res = await fetch("/api/theme/state", { credentials: "same-origin" });
      if (!res.ok) return;
      const st = await res.json();
      if (typeof st.rev === "number" && st.rev !== syncRev) applyRemote(st);
    } catch { /* offline */ }
  }, 5000);
  window.addEventListener("astra-palette-change", (e) => schedulePush({ palette: (e as CustomEvent).detail }));
  // A created/edited/deleted theme is broadcast so every other device and the
  // Android app gain it without a reload.
  window.addEventListener("astra-user-themes-change", () => schedulePush({ userThemes: readUserThemes() }));
  window.addEventListener("astra-chat-bg-change", (e) => {
    const detail = (e as CustomEvent<ChatBg | null>).detail;
    // Never broadcast a per-tab blob: it would poison every other device with a
    // value only this tab can resolve (owner bug: phone-only background, invisible
    // on the iPad). A `null` (background OFF) is a global decision and does push.
    if (detail && !isDurableBgSrc(detail.src)) return;
    schedulePush({ bg: detail });
  });
  window.addEventListener("astra-theme-change", (e) => {
    const m = (e as CustomEvent).detail;
    if (m === "light" || m === "dark") schedulePush({ mode: m });
  });
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

/**
 * Is this src durable, i.e. fetchable by another device?
 *
 * A `blob:` (or bare object-URL) src is a handle into ONE browser tab's memory. It
 * renders on the tab that created it and is unresolvable everywhere else. Pushing one
 * to the shared server makes every OTHER device adopt a dead value — which is exactly
 * how a background set on the phone ended up invisible on the iPad (owner 2026-10-04).
 * Local-only backdrops are kept on the device that owns them and never broadcast.
 */
export function isDurableBgSrc(src: string | undefined | null): boolean {
  if (!src) return false;
  return !/^(blob:|data:)/i.test(src.trim());
}

/** Parse a YouTube URL -> video id (watch, youtu.be, shorts, embed). */
export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}
