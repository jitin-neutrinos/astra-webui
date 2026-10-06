// font-store.ts — dynamic font roles for the theme engine.
//
// Three roles: sans (body), display (headings), mono (code). Each holds one
// pick, and a pick is EITHER a Google family (self-hosted through our own
// /api/theme/font/google/ proxy) or an uploaded file (served from
// /api/theme/font/:name). Both arrive as a family name plus a URL, so the
// renderer only ever writes ONE CSS variable per role and never learns where
// the face came from.
//
// WHY A CSS VARIABLE AND NOT A FONT-FAMILY RULE PER COMPONENT: Tailwind v4
// emits `.font-sans{font-family:var(--font-sans)}` — a var() REFERENCE, not a
// baked value — and @theme declarations sit in a cascade layer, which an
// unlayered inline custom property outranks. So writing --font-sans on :root
// moves all 157 .font-* utilities plus all 146 var(--font-sans) reads in
// index.css with zero component edits. Verified against the compiled bundle.

import { useEffect, useState } from "react";

export type FontRole = "sans" | "display" | "mono";

export interface FontPick {
  /** The family string to put in font-family — the FILE's own name, never the filename's. */
  family: string;
  /** Same-origin URL the @font-face src points at. */
  url: string;
  /** True when the face carries a weight axis. */
  variable: boolean;
  /** Where it came from, so the picker can label and delete it. */
  source: "google" | "upload";
}

export interface FontRoleState {
  sans: FontPick | null;
  display: FontPick | null;
  mono: FontPick | null;
}

const LS_FONTS = "astra-fonts";
const LS_UPLOADS = "astra-font-uploads";

const FALLBACK: Record<FontRole, string> = {
  sans: "ui-sans-serif, system-ui, sans-serif",
  display: "Georgia, serif",
  mono: "ui-monospace, monospace",
};

/** The stylesheet's current defaults — the value `reset` restores. */
const DEFAULTS: Record<FontRole, string> = {
  sans: '"DM Sans"',
  display: '"Playfair Display"',
  mono: '"JetBrains Mono"',
};

const isRole = (v: unknown): v is FontRole => v === "sans" || v === "display" || v === "mono";
const isPick = (v: unknown): v is FontPick =>
  !!v && typeof v === "object" && typeof (v as FontPick).family === "string"
  && typeof (v as FontPick).url === "string";

export function readFonts(): FontRoleState {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_FONTS) || "{}");
    const out: FontRoleState = { sans: null, display: null, mono: null };
    for (const role of ["sans", "display", "mono"] as FontRole[]) {
      if (isPick(raw?.[role])) out[role] = raw[role];
    }
    return out;
  } catch { return { sans: null, display: null, mono: null }; }
}

export function writeFonts(state: FontRoleState) {
  try { localStorage.setItem(LS_FONTS, JSON.stringify(state)); } catch { /* private mode */ }
}

/** Uploads the user made, so the picker can list and delete them. */
export function readUploads(): FontPick[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_UPLOADS) || "[]");
    return Array.isArray(raw) ? raw.filter(isPick) : [];
  } catch { return []; }
}
export function writeUploads(list: FontPick[]) {
  try { localStorage.setItem(LS_UPLOADS, JSON.stringify(list)); } catch { /* private mode */ }
}

/** The font-family value one role resolves to, given its pick. */
function familyFor(role: FontRole, pick: FontPick | null): string {
  if (!pick) return DEFAULTS[role];
  // A family name with a space must be quoted, and a name that already carries
  // quotes must not be double-quoted or the whole declaration is invalid —
  // which would fall the whole app back to the browser default mid-session.
  const name = /^["'].*["']$/.test(pick.family) ? pick.family : `"${pick.family.replace(/"/g, "'")}"`;
  return `${name}, ${FALLBACK[role]}`;
}

/** The @font-face rule for one pick. */
function faceRule(pick: FontPick): string {
  const name = /^["'].*["']$/.test(pick.family) ? pick.family : `"${pick.family.replace(/"/g, "'")}"`;
  const format = /\.woff2$/i.test(pick.url) ? "woff2" : /\.woff$/i.test(pick.url) ? "woff" : /\.otf$/i.test(pick.url) ? "opentype" : "truetype";
  // A variable face gets a weight RANGE so the browser can interpolate; a
  // static one gets a single weight. Getting this wrong on a variable face
  // pins every weight to the default and the picker looks like it did nothing.
  const weight = pick.variable ? "font-weight: 100 900;" : "";
  return `@font-face{font-family:${name};src:url(${pick.url}) format("${format}");font-display:swap;${weight}}`;
}

/** Write one role's variable + its @font-face. Idempotent, and exported so the
 *  sync layer can apply a REMOTE pick without going through the UI. */
export function applyRoleFont(role: FontRole, pick: FontPick | null) {
  const root = document.documentElement;
  root.style.setProperty(`--font-${role}`, familyFor(role, pick));
  const marker = `astra-face-${role}`;
  document.querySelector(`style[data-${marker}]`)?.remove();
  if (!pick) return;
  const style = document.createElement("style");
  style.setAttribute(`data-${marker}`, "");
  style.textContent = faceRule(pick);
  document.head.appendChild(style);
}

/** Set one role and persist. */
export function setFontRole(role: FontRole, pick: FontPick | null) {
  if (!isRole(role)) return false;
  const next = { ...readFonts(), [role]: pick } as FontRoleState;
  writeFonts(next);
  applyRoleFont(role, pick);
  window.dispatchEvent(new CustomEvent("astra-font-change", { detail: { role, pick } }));
  return true;
}

/** Boot-time restore, called from main.tsx before render (no flash). */
export function restoreFonts() {
  const state = readFonts();
  for (const role of ["sans", "display", "mono"] as FontRole[]) applyRoleFont(role, state[role]);
}

/** Pre-paint form of the same thing: what index.html's inline script sets. */
export function prePaintFamilies(): Record<FontRole, string> {
  const state = readFonts();
  return {
    sans: familyFor("sans", state.sans),
    display: familyFor("display", state.display),
    mono: familyFor("mono", state.mono),
  };
}

/**
 * Load a Google family through our own proxy and return a pick.
 *
 * The proxy returns CSS whose url() points at our origin, so nothing is fetched
 * from Google by the browser. We parse the first woff2 out of that CSS purely to
 * learn the local path — the face itself is registered by the browser when the
 * @font-face rule is injected.
 */
export async function loadGoogleFont(family: string): Promise<FontPick> {
  const res = await fetch(`/api/theme/font/google/${encodeURIComponent(family)}.css`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`font not available (${res.status})`);
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  const css = await res.text();
  // The proxy's own answer may also carry a subset comment before the first
  // @font-face, so this scans for one anywhere rather than prefix-matching.
  if (!ctype.includes("text/css") || !/@font-face/i.test(css)) {
    throw new Error("no such font family");
  }
  const m = /url\(([^)]+\.woff2[^)]*)\)/.exec(css);
  const variable = /font-weight:\s*\d{3}\s+\d{3}/.test(css);
  return { family, url: m ? m[1]! : "", variable, source: "google" };
}

/** Upload a font file and return a pick, validating the response shape. */
export async function uploadFont(file: File): Promise<FontPick> {
  const res = await fetch("/api/theme/font", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
    body: file,
  });
  if (!res.ok) {
    let msg = `upload failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  const data = await res.json();
  if (!isPick(data)) throw new Error("server returned no usable font");
  const pick: FontPick = { family: data.family, url: data.url, variable: !!data.variable, source: "upload" };
  const list = [...readUploads().filter((p) => p.url !== pick.url), pick];
  writeUploads(list);
  return pick;
}

/** Remove an uploaded face from every role that uses it, and forget it. */
export function forgetUpload(pick: FontPick) {
  writeUploads(readUploads().filter((p) => p.url !== pick.url));
  const state = readFonts();
  for (const role of ["sans", "display", "mono"] as FontRole[]) {
    if (state[role]?.url === pick.url) setFontRole(role, null);
  }
}

/** React binding so the picker re-renders when any role changes. */
export function useFonts(): [FontRoleState, (role: FontRole, pick: FontPick | null) => void] {
  const [state, setState] = useState<FontRoleState>(readFonts);
  useEffect(() => {
    const on = () => setState(readFonts());
    window.addEventListener("astra-font-change", on);
    return () => window.removeEventListener("astra-font-change", on);
  }, []);
  return [state, setFontRole];
}
