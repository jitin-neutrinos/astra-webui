// TeX rendering for `math` blocks — a LAZY chunk.
//
// katex is ~75 kB gz plus a stylesheet and ~20 webfont files, which is more than
// an entire ordinary card. `canvas-blocks.tsx` reaches this through
// `import("./canvas-math")`, so a report with no formula never fetches a byte.
//
// FAIL-SOFT IS THE WHOLE CONTRACT: `throwOnError:false` means katex renders bad
// TeX as red source text instead of raising. This wrapper adds the second half —
// even if the import itself fails (offline, chunk 404), the caller still gets
// something to paint. A formula that cannot be typeset is a degraded block, never
// a blank card and never an exception inside React's render.
//
// The stylesheet is imported for its SIDE EFFECT only (Vite/Rolldown hoist it into
// the chunk's CSS; `import … from` a .css has no default export and fails the
// build). Measured: katex.min.css contains ZERO hex colours, so every glyph
// inherits from --color-brandtext and the sheet is theme-agnostic by
// construction — importing it cannot break the theme contract.
import "katex/dist/katex.min.css";
import katex from "katex";

/**
 * Render TeX to HTML, or null when it cannot be done.
 * null means "paint the raw source in the danger role" — never a thrown card.
 */
export function renderMath(tex: string, display = true): string | null {
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      // The single most important option here: without it a single unparseable
      // formula raises and blanks the whole card.
      throwOnError: false,
      output: "htmlAndMathml",
    });
  } catch {
    return null;
  }
}