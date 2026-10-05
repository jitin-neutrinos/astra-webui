// L2 (2026-05-10 → 2026-10-05) — never hand the renderer a half-revealed
// canvas fence.
//
// Why: TextRow reveals text a few characters at a time and passes the revealed
// PREFIX to the markdown renderer. When that cut lands inside an astra-canvas
// fence, the renderer receives a fence with no closer. The parser then rejects
// it, the fail-soft rule leaves it in the markdown, and the payload is painted
// as a code block.
//
// L1 (rich-html.ts) makes that paint impossible. This module removes the flash
// itself: the prefix is cut back to before the opener, so the card simply is not
// there yet and appears whole when the closer lands.
//
// Lives in lib/ rather than chat-timeline.tsx on purpose: Node cannot load a
// .tsx, so a check that imports this must reach a .ts (repo lesson, 2026-10-03:
// 22 of 50 checks were dead for exactly that reason).

const CANVAS_FENCE_RE = /`{3,}astra-canvas/g;

/**
 * Is the last astra-canvas fence in `s` still open?
 *
 * Used by the live incremental canvas (chat-timeline.tsx) to decide whether a
 * provisional card should be painted. A CLOSED fence must NOT be claimed here:
 * the turn planner deliberately leaves contained fences inline so following prose
 * stays below the card, and RichText splits them — so claiming a closed one too
 * renders the same card twice.
 *
 * Two rules that are easy to get wrong:
 *  - a closer counts ANYWHERE after the opener, because prose may follow it (an
 *    end-anchored test reports a closed fence as open);
 *  - the closer must be at least as long as the opener's backtick run, so a ```
 *    inside the JSON body is not mistaken for the real closer.
 */
export function openCanvasFence(s: string): { open: boolean; closed: boolean; at: number } {
  const at = s.lastIndexOf("astra-canvas");
  if (at === -1 || at < 1 || s.slice(0, at).trimEnd().slice(-1) !== "`") {
    return { open: false, closed: false, at: -1 };
  }
  let runStart = at;
  while (runStart > 0 && s[runStart - 1] === "`") runStart--;
  const runLen = at - runStart;

  // Scan the body STRING-AWARE: a ``` inside a JSON string value (a code block
  // in the card) is data, not the closer. Measured: counting raw runs reported
  // `closed:true` for a still-open fence whose card contained a code block.
  const body = s.slice(at + "astra-canvas".length);
  let inStr = false;
  let esc = false;
  let closed = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c !== "`") continue;
    let n = 0;
    while (i + n < body.length && body[i + n] === "`") n++;
    if (n >= Math.max(3, runLen)) { closed = true; break; }
    i += n - 1;
  }
  return { open: true, closed, at: runStart };
}
/**
 * If `shown` (a prefix of `full`) stops inside an astra-canvas fence, return the
 * prefix with that fence removed. Otherwise return `shown` unchanged.
 *
 * Fence-length aware: a 4-backtick fence is closed only by a run of >= 4, so a
 * ``` inside the JSON body cannot be mistaken for the closer.
 */
export function withholdOpenCanvasFence(full: string, shown: string): string {
  if (shown.length >= full.length) return shown; // fully revealed
  const openers = shown.match(CANVAS_FENCE_RE);
  if (!openers || openers.length === 0) return shown;

  // Work on the LAST opener: earlier fences in the prefix are already closed.
  const lastOpen = shown.lastIndexOf("astra-canvas");
  // Measure the opener's backtick run so we only accept a closer of equal length.
  let runStart = lastOpen;
  while (runStart > 0 && shown[runStart - 1] === "`") runStart--;
  const runLen = lastOpen - runStart;

  const tail = shown.slice(lastOpen + "astra-canvas".length);
  const closed = tail.match(/`{3,}/g)?.some((m) => m.length >= runLen) ?? false;
  if (closed) return shown; // this fence is complete within the prefix

  return shown.slice(0, runStart);
}