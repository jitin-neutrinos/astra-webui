/**
 * Easing for the day↔night theme flip.
 *
 * Standard CSS `cubic-bezier(0.4, 0, 0.2, 1)` — the "standard" curve behind
 * every Material/premium motion spec: gentle on both ends, no hard start or
 * stop, so the artwork eases in and out rather than snapping. The first flip
 * used a quadratic, which read violent because it hit its fastest point at the
 * midpoint — exactly while the artwork was changing most.
 *
 * x(t) for this curve is monotonic, so bisection on x is correct and cheaper
 * than Newton's method at the resolution a rAF loop needs.
 *
 * Lives apart from the component so it stays importable without the asset.
 */
const EASE_X1 = 0.4, EASE_Y1 = 0, EASE_X2 = 0.2, EASE_Y2 = 1;

/** Bezier basis curve with implicit (0,0) and (1,1) endpoints. */
function cubic(p1: number, p2: number, t: number) {
  const mt = 1 - t;
  return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
}

export function easeFlip(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (cubic(EASE_X1, EASE_X2, mid) < p) lo = mid;
    else hi = mid;
  }
  return cubic(EASE_Y1, EASE_Y2, (lo + hi) / 2);
}