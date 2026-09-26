// Mobile header auto-hide behavior, distilled as a pure decision function.
//
// SPEC (Jitin, 2026-09-26):
//   - About 10s after the chat initializes, the mobile header hides.
//   - It reappears when the user scrolls UP from the chat — and only then.
//   - Scrolling down does not reveal it; it hides again as the user scrolls on.
//   - EDGE CASE: when there is nothing to scroll up from (transcript shorter
//     than the viewport, or already pinned at the very top), the header
//     PERSISTS indefinitely — hiding it would strand it with no way back.

export const HEADER_AUTO_HIDE_MS = 10_000;

export type HeaderDecision =
  | { action: "wait" }                                    // timer running, nothing to do
  | { action: "hide" }                                    // 10s elapsed, scroll-up is possible
  | { action: "show" }                                    // explicit reveal
  | { action: "persist"; reason: "no-overflow" | "at-top" }; // cannot scroll up → never hide

// scrollable: transcript taller than viewport (overflow exists at all).
// atTop: pinned at scrollTop <= threshold — scrolling up is impossible RIGHT NOW.
// elapsed: ms since header timer started.
// revealRequested: a genuine upward scroll gesture happened after hiding.
export function headerDecision(
  elapsed: number,
  scrollable: boolean,
  atTop: boolean,
  revealRequested: boolean,
): HeaderDecision {
  // Reveal is always honored — but only AFTER a hide ever happened, which the
  // caller guarantees by only setting revealRequested on post-hide scroll-up.
  if (revealRequested) return { action: "show" };

  // No overflow at all: nothing to scroll up from, ever → persist.
  if (!scrollable) return { action: "persist", reason: "no-overflow" };

  // Already at the very top: an upward gesture is impossible → persist.
  if (atTop) return { action: "persist", reason: "at-top" };

  // Scroll-up is possible but the grace period hasn't elapsed → keep visible.
  if (elapsed < HEADER_AUTO_HIDE_MS) return { action: "wait" };

  return { action: "hide" };
}

// 4px slop: sub-pixel scroll jitter on mobile must not read as intent.
export const SCROLL_UP_SLOP_PX = 4;

export function isScrollUp(prevTop: number, nextTop: number): boolean {
  return nextTop < prevTop - SCROLL_UP_SLOP_PX;
}
