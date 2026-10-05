// color-chip.ts — is a string a CSS colour the canvas should show AS a colour?
//
// Whole-string only. A report cell or key/value holding a hex code renders as a
// swatch of that colour plus the code; anything else renders as text. The
// whole-string rule is the guard: "issue #123456" is a ticket reference, not a
// colour, and an inline scanner would paint it. 4-digit hex (#rgba) is rejected
// as the same collision class — a bare "#1234" is far more often an issue
// number than a transparent colour in a report.

const HEX_3_6_8 = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// rgb()/hsl()/hwb()/lab()/lch()/oklab()/oklch() — no nested parens needed
// inside any of these notations in practice.
const FUNC = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\(\s*[^()]+\s*\)$/i;
// color(display-p3 1 0 0 / .5) — space name then components, still one level.
const COLOR_SPACE = /^color\(\s*[a-z0-9-]+\s+[^()]+\s*\)$/i;

/** The CSS colour string if the WHOLE trimmed value is one, else null. */
export function cssColorOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s === "") return null;
  return HEX_3_6_8.test(s) || FUNC.test(s) || COLOR_SPACE.test(s) ? s : null;
}
