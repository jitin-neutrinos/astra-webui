import { useEffect, useRef, useState } from "react";

/**
 * ComposerTrace — the running accent line on the composer's border.
 *
 * WHY SVG: a straight bar travelling an offset-path cannot trace a tight corner.
 * Over an arc of radius r a bar of length L leaves the path by r(1-cos(L/2r));
 * at L=170, r=12 that is >7 radians, i.e. a chord that flies off the corner. A
 * stroked <rect rx> is different in kind: the dash IS the rounded path, so the
 * lit run bends through the corners exactly.
 *
 * The comet is a stack of NON-OVERLAPPING BANDS on that one path, each band
 * painting only its own slice of the tail. A gradient along a curve can't come
 * from a linearGradient — it can't follow the path — so it is banded, and the
 * bands must NOT overlap: overlapping translucent strokes COMPOSITE, so the
 * alpha at a point becomes the SUM of every faint band covering it, which
 * renders as a flat plateau with a cliff at the end (reads as "bright line +
 * dimmer line"). Band count sets the smoothness — don't reduce BANDS.
 *
 * dasharray is DASH-then-GAP, so a band at [a, b) needs a LEADING ZERO-DASH to
 * force the gap on: `0 a (b-a) rest`. Omitting that zero makes the pattern start
 * with a dash of length `a`, which paints the head end of the whole border at
 * full brightness — a hard bright plateau, the exact artefact being fixed.
 *
 * pathLength=100 normalises the dash maths: band length is a constant share of
 * the perimeter (identical on every edge) and the -100 dashoffset sweep is
 * exactly one lap, so the loop is seamless.
 */
const BANDS = 28;
const TAIL = 16;   // comet length in path units of 100 (~290px ≈ 35% of the box
                   // width). The ramp is steep enough that the faint part dies
                   // inside the comet rather than trailing off as a separate
                   // dim line — lengthen the comet, not the visible tail.
const STROKE = 1.25;

/** Tile the comet into bands, brightest at the LEADING end.
 *
 * Orientation: a clockwise sweep paints band [a, b) at [a+t, b+t) as t grows, so
 * the band's HIGHER path position (b) is the FRONT and its lower position (a) is
 * the BACK. The falloff therefore rises with band index — peak on the last band.
 * With the falloff the other way up the comet still travels clockwise but its
 * glow trails at the back, which reads as the whole thing running backwards.
 */
function cometBands() {
  const out: { dash: string; op: number; w: number }[] = [];
  for (let i = 0; i < BANDS; i++) {
    const a = (TAIL * i) / BANDS;
    const b = (TAIL * (i + 1)) / BANDS;
    const x = ((a + b) / 2) / TAIL;                 // 0 at the tail end → 1 at the head
    out.push({
      dash: `0 ${a} ${b - a} ${100 - b}`,         // zero-dash forces the gap first
      op: Math.pow(x, 2.1),                          // faint tail → bright leading head
      w: 1.0 + 0.8 * x,                              // thickens toward the head
    });
  }
  return out;
}
const BANDS_DATA = cometBands();

export function ComposerTrace() {
  const ref = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<{ w: number; h: number; r: number } | null>(null);

  useEffect(() => {
    const svg = ref.current;
    const host = svg?.parentElement;
    if (!host) return;
    // Read the REAL radius from the host instead of hardcoding 12 — the trace
    // must track the border it is replacing, whatever that radius becomes.
    const measure = () => {
      const r = parseFloat(getComputedStyle(host).borderTopLeftRadius) || 12;
      setBox({ w: host.offsetWidth, h: host.offsetHeight, r });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const { w, h, r } = box ?? { w: 0, h: 0, r: 12 };
  const ready = w > 40 && h > 20;
  const half = STROKE / 2;
  const geom = {
    x: half,
    y: half,
    width: Math.max(0, w - STROKE),
    height: Math.max(0, h - STROKE),
    // the stroke is centred on the border path, so pull the rect radius in by
    // half the stroke width or the corners sit a hair proud of the CSS radius
    rx: Math.max(0, r - half),
    pathLength: 100,
    fill: "none" as const,
  };

  return (
    <svg
      ref={ref}
      className="composer-trace"
      aria-hidden="true"
      width={w || undefined}
      height={h || undefined}
      viewBox={`0 0 ${w} ${h}`}
      style={ready ? undefined : { display: "none" }}
    >
      {BANDS_DATA.map((band, i) => (
        <rect
          key={i}
          className={`composer-trace-step${i === BANDS - 1 ? " composer-trace-head" : ""}`}
          {...geom}
          style={{ strokeDasharray: band.dash, opacity: band.op, strokeWidth: `${band.w}px` }}
        />
      ))}
    </svg>
  );
}
