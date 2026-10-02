/**
 * Theme-wipe geometry (pure, so it can be pinned by tests).
 *
 * The wipe must ALWAYS begin from the centre of the toggle button that was
 * clicked. The bug this fixes: the origin was read from
 * `document.activeElement`, which is unrelated to the button whenever focus has
 * moved (touch taps, after clicking into the chat, after any other control) —
 * so the circle expanded from screen centre or from whatever last had focus.
 * Only the button's own rect may be passed in; there is deliberately no
 * activeElement fallback.
 */

/** Circle radius percentages resolve against hypot(w,h)/√2 of the snapshot box
 *  (Magic UI #989 note) — compute the exact % for full coverage. */
export function radiusPct(x: number, y: number, w: number, h: number): number {
  const r = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
  return (r / (Math.hypot(w, h) / Math.SQRT2)) * 100;
}

export interface Rect { left: number; top: number; width: number; height: number }

/** Wipe origin + clip keyframes from the triggering button's rect. */
export function wipeClipFromRect(
  rect: Rect | null | undefined,
  w: number,
  h: number,
): { x: number; y: number; clip: [string, string] } {
  // Fall back to screen centre only when the rect is genuinely unusable
  // (detached/hidden). Never document.activeElement.
  const usable = !!rect && rect.width > 0 && rect.height > 0;
  const x = usable ? rect!.left + rect!.width / 2 : w / 2;
  const y = usable ? rect!.top + rect!.height / 2 : h / 2;
  const pct = radiusPct(x, y, w, h);
  return { x, y, clip: [`circle(0% at ${x}px ${y}px)`, `circle(${pct}% at ${x}px ${y}px)`] };
}
