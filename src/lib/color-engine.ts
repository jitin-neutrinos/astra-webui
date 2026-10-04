// color-engine.ts — pure colour maths for the theme builder.
//
// WHY A SEPARATE MODULE: the theme builder's contrast checker and auto-palette
// generator are the only place that decides whether a user-created theme is
// USABLE. A wrong contrast verdict ships an unreadable theme to every device,
// so this file is pure functions with no React/DOM and carries its own check
// file (color-engine.check.ts). The UI reads these; the UI never re-derives.
//
// Colour space: all mixing/derivation happens in OKLab, which is perceptually
// uniform — a 20-point lightness step LOOKS like 20 points at every hue, unlike
// sRGB where yellow needs far more of a delta than blue to read as "lighter".

export type Mode = "dark" | "light";
export interface ThemeColors { [token: string]: string }

// ---- hex <-> rgb -------------------------------------------------------

export function hexToRgb(hex: string): [number, number, number] | null {
  const h = String(hex || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// ---- OKLab -------------------------------------------------------------

const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const unlin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToOklabFull(hex: string): [number, number, number] | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(lin) as [number, number, number];
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

export function oklabToHex([L, a, b]: [number, number, number]): string {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  return rgbToHex([unlin(r) * 255, unlin(g) * 255, unlin(bb) * 255]);
}

// ---- WCAG contrast -----------------------------------------------------

/** WCAG 2.1 relative luminance (sRGB, the spec's own formula). */
function relLum(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(lin) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. null for an unparseable colour. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relLum(a), lb = relLum(b);
  if (la === null || lb === null) return null;
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA verdict for text. 4.5 normal, 3.0 for large (>=24px or >=19px bold). */
export function wcagAA(hex: string, ground: string, large = false): { ratio: number | null; pass: boolean; need: number } {
  const ratio = contrastRatio(hex, ground);
  const need = large ? 3 : 4.5;
  return { ratio, pass: ratio !== null && ratio >= need, need };
}

// ---- OKLab mix + lightness stepping ------------------------------------

/** Mix two colours in OKLab. t=0 -> a, t=1 -> b. */
export function mixOklab(a: string, b: string, t: number): string {
  const A = hexToOklabFull(a), B = hexToOklabFull(b);
  if (!A || !B) return a;
  const k = Math.max(0, Math.min(1, t));
  return oklabToHex([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k]);
}

/** Shift a colour's OKLab lightness by `delta` (-1..1 scale-ish), clamping to gamut. */
export function shiftLightness(hex: string, delta: number): string {
  const lab = hexToOklabFull(hex);
  if (!lab) return hex;
  return oklabToHex([Math.max(0, Math.min(1, lab[0] + delta)), lab[1], lab[2]]);
}

/**
 * Nudge a colour's OKLab chroma toward `targetC` — used to keep a derived shade
 * in the accent family without letting saturation run away on a dark ground.
 */
export function withChroma(hex: string, targetC: number): string {
  const lab = hexToOklabFull(hex);
  if (!lab) return hex;
  const a = lab[1] * 0.5, b = lab[2] * 0.5; // keep hue, rescale chroma
  const k = targetC / Math.max(1e-6, Math.hypot(a, b));
  return oklabToHex([lab[0], a * k, b * k]);
}

// ---- auto-palette generation -------------------------------------------

/** The 16-token contract every variant must satisfy (see references/css-tokenize-codemod.md). */
export const CONTRACT_TOKENS = [
  "--color-void", "--color-midnight", "--color-depth", "--color-surface",
  "--color-brandtext", "--color-muted", "--color-cyanx", "--color-violetx",
  "--color-fuchsiax", "--color-redx", "--color-emerald", "--color-amber",
] as const;

/** Roles whose text must clear WCAG AA against the CARD surface (--color-midnight). */
export const TEXT_ROLES = ["--color-brandtext", "--color-muted"] as const;

export interface GeneratedVariant {
  tokens: ThemeColors;
  /** Token -> contrast ratio against --color-midnight, for the checker UI. */
  ratios: Record<string, number>;
  failing: string[];
}

/**
 * Build one mode's 12 tokens from a primary + secondary accent.
 *
 * Design rules (all verified by color-engine.check.ts):
 *  - The GROUND ramp (void/midnight/depth/surface) is a lightness ladder from the
 *    mode's own accent, so each theme's surface reads as that theme's identity.
 *    Grounding in the accent is what stops every theme reading as "the same grey app".
 *  - The GROUND ramp keeps chroma low (target ~0.02-0.04) — a saturated ground reads
 *    as brown/espresso on dark and as a stain on light. Saturation belongs in the accents.
 *  - Accents keep the PRIMARY's hue; SECONDARY drives the supporting slots
 *    (violetx/emerald/fuchsiax). Status colours (redx/amber) stay near-neutral so
 *    "error" reads as error on every theme.
 *  - INK (brandtext) is pushed to the mode's far end so it clears AA on the card.
 *  - Every generated text role is CONTRAST-CHECKED and reported back, not assumed.
 */
export function generateVariant(primary: string, secondary: string, mode: Mode): GeneratedVariant {
  const P = hexToOklabFull(primary);
  const S = hexToOklabFull(secondary) || P;
  if (!P || !S) return { tokens: {}, ratios: {}, failing: ["invalid primary or secondary"] };

  const dark = mode === "dark";
  // Ground ladder: dark goes near-black -> lighter; light goes paper -> deeper.
  const groundL = dark
    ? [0.16, 0.22, 0.28, 0.35]
    : [0.965, 0.945, 0.915, 0.875];
  // Ink: dark mode ink is light, light mode ink is dark.
  const inkL = dark ? 0.98 : 0.22;
  const mutedL = dark ? 0.70 : 0.48;
  // Accents need to be legible ON the ground, so dark-mode accents sit HIGHER
  // lightness than light-mode accents (which must stay dark enough for paper).
  const accentL = dark ? 0.78 : 0.52;

  const tokens: ThemeColors = {};
  // --- ground ramp, grounded in the primary's hue at very low chroma ---
  // A GROUND must carry a trace of the theme's hue (else every theme is the same
  // neutral grey app) but must NOT be saturated (a saturated dark ground reads as
  // brown/espresso). So: keep the accent's HUE, rescale its CHROMA down a long way.
  const hueDir = (a: number, b: number): [number, number] => {
    const k = Math.max(1e-6, Math.hypot(a, b));
    return [a / k, b / k];
  };
  const [ha, hb] = hueDir(P[1], P[2]);
  for (let i = 0; i < 4; i++) {
    const c = dark ? 0.020 : 0.026; // chroma ceiling for a ground
    tokens[CONTRACT_TOKENS[i]] = oklabToHex([groundL[i], ha * c, hb * c]);
  }
  // --- ink + muted ---
  tokens["--color-brandtext"] = oklabToHex([inkL, P[1] * 0.06, P[2] * 0.06]);
  tokens["--color-muted"] = oklabToHex([mutedL, P[1] * 0.18, P[2] * 0.18]);

  // --- accents ---
  tokens["--color-cyanx"] = oklabToHex([accentL, P[1], P[2]]);      // primary accent
  tokens["--color-violetx"] = oklabToHex([accentL + (dark ? 0.02 : -0.02), S[1], S[2]]); // secondary
  tokens["--color-fuchsiax"] = mixOklab(oklabToHex([accentL, P[1], P[2]]), oklabToHex([accentL, S[1], S[2]]), 0.5);
  tokens["--color-emerald"] = mixOklab(oklabToHex([accentL, S[1], S[2]]), oklabToHex([accentL + 0.04, 0, 0]), 0.35);
  // --- status: pinned near-neutral, hue from status not from the accent ---
  tokens["--color-redx"] = oklabToHex([dark ? 0.70 : 0.55, 0.16, 0.09]);
  tokens["--color-amber"] = oklabToHex([dark ? 0.80 : 0.60, 0.10, 0.14]);

  // --- glow: dark gets a glow, light stays flat (per the theme contract) ---
  tokens["--glow-accent"] = dark ? `0 0 10px ${alphaOf(tokens["--color-cyanx"], 0.25)}` : "none";
  tokens["--glow-accent-strong"] = dark ? `0 0 16px ${alphaOf(tokens["--color-cyanx"], 0.4)}` : "none";

  // --- contrast audit against the CARD surface ---
  const card = tokens["--color-midnight"];
  const ratios: Record<string, number> = {};
  const failing: string[] = [];
  for (const role of TEXT_ROLES) {
    const r = contrastRatio(tokens[role], card);
    if (r !== null) ratios[role] = r;
    if (r === null || r < 4.5) failing.push(role);
  }
  // Accents are used for borders/icons too, so they only owe the 3:1 non-text minimum.
  for (const role of ["--color-cyanx", "--color-violetx", "--color-redx", "--color-emerald", "--color-amber"] as const) {
    const r = contrastRatio(tokens[role], card);
    if (r !== null) ratios[role] = r;
    if (r === null || r < 3) failing.push(role);
  }
  return { tokens, ratios, failing };
}

/** Hex with an alpha suffix, for the glow strings. */
export function alphaOf(hex: string, a: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

// ---- user theme storage ------------------------------------------------

export interface UserTheme {
  id: string;
  name: string;
  /** Always BOTH modes — a user theme that is dark-only or light-only is not constructible. */
  variants: { dark: ThemeColors; light: ThemeColors };
  /** Set when the palette came from the builder rather than a shipped palette. */
  source: "user";
  license: string;
  createdAt: number;
}

const USER_THEMES_KEY = "astra-user-themes";

/** Read every saved user theme. Shape-validated: a corrupt entry is dropped, not fatal. */
export function readUserThemes(): UserTheme[] {
  try {
    const raw = JSON.parse(localStorage.getItem(USER_THEMES_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((t): t is UserTheme =>
      !!t && typeof t.id === "string" && typeof t.name === "string" &&
      !!t.variants?.dark && !!t.variants?.light && Object.keys(t.variants.dark).length > 0 &&
      Object.keys(t.variants.light).length > 0
    );
  } catch { return []; }
}

export function writeUserThemes(list: UserTheme[]): boolean {
  try { localStorage.setItem(USER_THEMES_KEY, JSON.stringify(list)); return true; } catch { return false; }
}

/** Append a theme, replacing any existing one with the same id. */
export function saveUserTheme(t: UserTheme): UserTheme[] {
  const next = [...readUserThemes().filter((x) => x.id !== t.id), t];
  writeUserThemes(next);
  window.dispatchEvent(new CustomEvent("astra-user-themes-change"));
  return next;
}

export function deleteUserTheme(id: string): UserTheme[] {
  const next = readUserThemes().filter((x) => x.id !== id);
  writeUserThemes(next);
  window.dispatchEvent(new CustomEvent("astra-user-themes-change"));
  return next;
}

/** id -> name, lowercase and hyphenated, unique. Used for both dirs and storage keys. */
export function slugifyThemeName(name: string): string {
  const base = String(name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "theme";
}
