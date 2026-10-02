import { useEffect, useRef, useState } from "react";

/**
 * ComposerTrace — the running accent line on the composer's border.
 *
 * WHY SVG, after a BorderBeam attempt: a straight bar travelling an offset-path
 * cannot trace a tight corner. Over an arc of radius r a bar of length L leaves
 * the path by r(1-cos(L/2r)); at L=170, r=12 that is >7 radians, i.e. the "line"
 * is a chord that flies off the corner. A stroked <rect rx> is different in kind:
 * the dash IS the rounded path, so the lit run bends through the corners exactly.
 *
 * pathLength=100 normalises the dash maths, so the lit run is a constant
 * PERCENTAGE of the perimeter — identical length on every edge, and the
 * dashoffset sweep of -100 is exactly one lap (seamless, no jump).
 *
 * The composer's own idle border is transparent, so this stroke is the border —
 * never a second line beside it.
 */
const STROKE = 1.25;

export function ComposerTrace() {
  const ref = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<{ w: number; h: number; r: number } | null>(null);

  useEffect(() => {
    const svg = ref.current;
    const host = svg?.parentElement;
    if (!host) return;
    // Read the REAL radius from the host instead of hardcoding 12 — the beam
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
      {/* tail first, head second: both start at path position 0 and share one
          dashoffset timeline, so the head leads and the tail fades out behind
          it — one continuous comet on ONE path, never two parallel lines. */}
      <rect className="composer-trace-tail" {...geom} />
      <rect className="composer-trace-head" {...geom} />
    </svg>
  );
}
