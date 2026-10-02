import { useEffect, useRef } from "react";
import { easeFlip } from "@/lib/theme-ease";
// Vite ?raw: the artwork stays a single source file and is injected as-is so we
// can hold a ref to its <svg> and drive SMIL ourselves.
import artSvg from "@/assets/theme-cycle.svg?raw";

/**
 * ThemeArtwork — the owner's animated day↔night pill.
 *
 * The file is an 8.017s SMIL loop with `repeatCount="indefinite"`: t=0 is DAY
 * (sky-blue pill, clouds, sun), t≈4 is NIGHT (navy pill, cratered moon, stars).
 * Dropped into an <img> it therefore plays FOREVER on its own — which is the
 * "it's in a loop" report: the artwork was flipping day/night by itself,
 * unrelated to any click.
 *
 * Fix: inline it, pause SMIL, and own the playhead. It tweens between the two
 * states ONLY when the theme changes, so the flip is driven by interaction.
 */
const LIGHT_T = 0;    // day
const DARK_T = 4.0;   // night
const FLIP_MS = 1150; // one flip, front to back

interface SmilSvg extends SVGSVGElement {}

export function ThemeArtwork({ dark }: { dark: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const svg = hostRef.current?.querySelector("svg") as SmilSvg | null;
    if (!svg) return;
    svg.pauseAnimations();            // stop the self-playing loop for good

    const from = Number(svg.dataset.t ?? LIGHT_T);
    const to = dark ? DARK_T : LIGHT_T;
    if (from === to) return;

    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / FLIP_MS);
      const t = from + (to - from) * easeFlip(p);
      svg.dataset.t = String(t);
      svg.setCurrentTime(t);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [dark]);

  return (
    <div
      ref={hostRef}
      className="theme-art"
      aria-hidden="true"
      // owner-supplied static asset from our own origin; SMIL is paused above
      dangerouslySetInnerHTML={{ __html: artSvg }}
    />
  );
}
