// overflow-fit.ts — the measurement half of a Priority+ toolbar.
//
// WHY A SEPARATE MODULE: deciding which controls fit is the one piece of this
// feature that can be wrong in a way nobody notices. An off-by-one in the fit
// calculation does not throw — it silently hides a button the user needed, or
// leaves the row overflowing on a phone. So the decision is a PURE function over
// plain numbers, tested here, and the hook in composer-controls only does the DOM.
//
// PATTERN: Priority+ (Brad Frost, "Revisiting the Priority+ Pattern"; also
// CSS-Tricks "DIY Priority+ Navigation"). Fit as many items as the space allows in
// priority order, then collapse the remainder into an overflow menu — one at a time,
// as space shrinks. The key ordering rule: the LAST item to be collapsed is the one
// the user reaches for most, so it survives longest.
//
// Two strategies exist and the difference matters here:
//   - measure-and-truncate: render all, measure the overflow, hide from the end.
//     One layout pass, but it thrashes (every hide changes the available width).
//   - binary search: keep a candidate count, ask "does N fit?", bisect.
//     ~log2(n) layout passes and it converges on the exact fit.
// The bin values here are small (3-4 items), so the binary search costs at most two
// probes and is exact. That exactness is the point: a toolbar that shows one button
// fewer than it could is a bug the owner sees immediately.

/** One control's intrinsic width in px, plus whether it may be collapsed at all. */
export interface FitItem {
  key: string;
  width: number;
  /**
   * Pinned items NEVER collapse. Provider and model are pinned by the owner
   * ("on fully expandable conditions, the options button will only have provider
   * and model"), so they live in the menu unconditionally and are not part of the
   * space budget for the bar at all.
   */
  pinned?: boolean;
}

/**
 * Collapse ORDER, first = collapses first (safest to lose).
 *
 * This is a usage judgement, not a technical one, and it is the part most worth
 * changing later: yolo mode is a rarely-touched toggle, reasoning effort is changed
 * occasionally, and attach is used every time something needs uploading. So the bar
 * sheds the least-used control first and keeps the most-used one visible longest.
 */
export const COLLAPSE_ORDER = ["yolo", "effort", "attach"] as const;

/**
 * How many of `items` fit in `available` px?
 *
 * @param widths  intrinsic width of each collapsible item, in COLLAPSE_ORDER-aligned order
 * @param reserved  px that are NOT available to these items (the send button, the
 *                  hint text, the always-visible options trigger, and the gaps)
 * @returns the count that fits, from 0..widths.length
 *
 * Sums greedily in priority order. A single item wider than everything available
 * still consumes the whole budget and reports 0 visible, which is correct: it must
 * collapse rather than overflow the row.
 */
export function fitCount(widths: number[], available: number, reserved = 0): number {
  let budget = available - reserved;
  let used = 0;
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i];
    if (!Number.isFinite(w) || w <= 0) continue; // unmeasured: ignore, do not reserve
    if (used + w <= budget) {
      used += w;
    } else {
      return i; // this one and everything after it collapses
    }
  }
  return widths.length;
}

/**
 * Which items are visible, and which collapsed ones live in the overflow menu.
 *
 * Returns the visible keys in bar order (most important first) and the hidden keys in
 * menu order. The caller renders exactly these two lists — it never re-derives the
 * decision, so the tested function stays the single source of truth.
 */
export function splitVisible(
  items: FitItem[],
  available: number,
  reserved = 0
): { visible: string[]; hidden: string[] } {
  // Pinned items are excluded from the budget entirely: they are always in the menu.
  const collapsible = items
    .filter((it) => !it.pinned)
    .slice()
    .sort((a, b) => {
      const ia = (COLLAPSE_ORDER as readonly string[]).indexOf(a.key);
      const ib = (COLLAPSE_ORDER as readonly string[]).indexOf(b.key);
      // Unknown keys sort last (they collapse after every known control).
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

  const n = fitCount(collapsible.map((it) => it.width), available, reserved);
  return {
    visible: collapsible.slice(0, n).map((it) => it.key),
    hidden: collapsible.slice(n).map((it) => it.key),
  };
}

/**
 * The width to reserve for the non-item furniture of the row.
 *
 * Measured from the live DOM rather than hardcoded: the send button, the always-on
 * options trigger and the hint text all change with the theme and the breakpoint, so
 * a constant here is a guess that goes stale the first time one of them moves.
 */
export function reservedWidth(els: Array<HTMLElement | null | undefined>): number {
  let total = 0;
  for (const el of els) {
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0) total += r.width;
  }
  return total;
}
