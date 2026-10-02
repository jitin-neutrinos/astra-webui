import { useEffect, useRef } from "react";

/**
 * ComposerTrace — the running accent line on the composer's border.
 *
 * WHY SVG: a straight bar travelling an offset-path cannot trace a tight corner.
 * Over an arc of radius r a bar of length L leaves the path by r(1-cos(L/2r));
 * at L=170, r=12 that is >7 radians, i.e. a chord that flies off the corner. A
 * stroked <rect rx> is different in kind: the dash IS the rounded path, so the
 * lit run bends through the corners exactly.
 *
 * The comet is a stack of NON-OVERLAPPING BANDS on that one path, each painting
 * only its own slice. A gradient along a curve can't come from a linearGradient
 * (it can't follow the path). The bands must NOT overlap: overlapping
 * translucent strokes COMPOSITE, so alpha becomes the SUM of every faint band
 * covering a point — a flat plateau with a cliff (reads as "a dim second line").
 *
 * Orientation: a clockwise sweep paints band [a, b) at [a+t, b+t) as t grows, so
 * the band's HIGHER path position (b) is the FRONT. The falloff therefore RISES
 * with band index — peak on the last band. The other way up, the comet still
 * travels clockwise but its glow trails at the back, which reads as backwards.
 *
 * dasharray is DASH-then-GAP, so a band at [a, b) needs a LEADING ZERO-DASH to
 * force the gap on: `0 a (b-a) rest`. Omitting that zero makes the pattern start
 * with a dash of length `a`, painting the head end of the whole border at full
 * brightness — a hard plateau, the exact artefact that fixed.
 *
 * pathLength=100 normalises the dash maths: band length is a constant share of
 * the perimeter (identical on every edge) and the -100 dashoffset sweep is
 * exactly one lap, so the loop is seamless.
 *
 * ── LOW-SPEC DEVICES ────────────────────────────────────────────────────────
 * This used to re-render through React on every composer resize — and the
 * composer resizes on EVERY LINE typed. Reconciling 28 <rect> nodes plus running
 * an SVG drop-shadow filter (a separate GPU pass, brutal in a mobile WebView) on
 * each keystroke is what made typing and the running line stutter on android.
 * So:
 *   1. geometry is written IMPERATIVELY to refs — React renders these rects
 *      once and never re-reconciles them;
 *   2. `bands` drops on low-memory / low-core devices (see isLowSpec);
 *   3. the drop-shadow is disabled there via the `.astra-lowspec` class.
 */
const STROKE = 1.25;
export const TRACE_TAIL = 16;   // comet length in path units of 100 (~290px)

/** True on devices that can't afford the full-quality comet. */
export function isLowSpec(): boolean {
  if (typeof navigator === "undefined") return false;
  const mem = (navigator as any).deviceMemory;
  const cores = navigator.hardwareConcurrency;
  // deviceMemory is Chromium-only and missing on some WebViews — treat absent
  // as "unknown", not low, so non-Chromium browsers keep full quality.
  if (typeof mem === "number" && mem <= 4) return true;
  if (typeof cores === "number" && cores <= 4) return true;
  // A touch viewport is a phone by definition. This is the reliable signal for
  // WebViews that report no deviceMemory/hardwareConcurrency at all — without
  // it a weak phone would silently get the full-cost comet.
  try {
    const touchPhone = typeof matchMedia === "function"
      && matchMedia("(pointer: coarse)").matches
      && (typeof window === "undefined" || window.innerWidth <= 820);
    if (touchPhone) return true;
  } catch { /* matchMedia unavailable */ }
  return false;
}

function cometBands(count: number) {
  const out: { dash: string; op: number; w: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = (TRACE_TAIL * i) / count;
    const b = (TRACE_TAIL * (i + 1)) / count;
    const x = ((a + b) / 2) / TRACE_TAIL;         // 0 at the tail end → 1 at the head
    out.push({
      dash: `0 ${a} ${b - a} ${100 - b}`,       // zero-dash forces the gap first
      op: Math.pow(x, 2.1),                        // faint tail → bright leading head
      w: 1.0 + 0.8 * x,                             // thickens toward the head
    });
  }
  return out;
}

export function ComposerTrace({ bands = 28 }: { bands?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const rectsRef = useRef<(SVGGeometryElement & SVGGraphicsElement)[]>([]);
  const data = cometBands(bands);

  useEffect(() => {
    const svg = svgRef.current;
    const host = svg?.parentElement;
    if (!host) return;

    // Geometry goes straight to the DOM nodes. The getComputedStyle read is the
    // one forced style read and it only happens on RESIZE — never on a
    // keystroke, because React no longer re-renders this subtree at all.
    const paint = () => {
      const r = parseFloat(getComputedStyle(host).borderTopLeftRadius) || 12;
      const w = host.offsetWidth;
      const h = host.offsetHeight;
      const visible = w > 40 && h > 20;
      svg.style.display = visible ? "" : "none";
      if (!visible) return;
      const half = STROKE / 2;
      svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
      svg.setAttribute("width", String(w + 2));
      svg.setAttribute("height", String(h + 2));
      const geo = {
        x: half,
        y: half,
        width: Math.max(0, w - STROKE),
        height: Math.max(0, h - STROKE),
        // stroke is centred on the border path: pull the rect radius in by half
        // the stroke width or the corners sit proud of the CSS radius
        rx: Math.max(0, r - half),
      };
      for (const el of rectsRef.current) {
        if (!el) continue;
        for (const k of Object.keys(geo)) el.setAttribute(k, String((geo as any)[k]));
      }
    };

    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return (
    <svg ref={svgRef} className="composer-trace" aria-hidden="true" style={{ display: "none" }}>
      {data.map((band, i) => (
        <rect
          key={i}
          ref={(el) => { if (el) rectsRef.current[i] = el; }}
          className={`composer-trace-step${i === data.length - 1 ? " composer-trace-head" : ""}`}
          pathLength={100}
          fill="none"
          style={{ strokeDasharray: band.dash, opacity: band.op, strokeWidth: `${band.w}px` }}
        />
      ))}
    </svg>
  );
}
