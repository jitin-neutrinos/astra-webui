// TubesBackground — WebGL neon-tubes login background (threejs-components tubes1).
// Brand accents ONLY: emerald #34D399 + cyan #22D3EE on void #0A0A0F (dark) /
// warm paper #F5F2EC (light) with deepened light-safe accent tubes (owner:
// light mode needs its own contrast-adjusted palette, not neon-on-white).
// Ambient mode: vendor pointer input is blocked (capture-phase stopPropagation on
// body) so the engine never enters cursor-follow and keeps playing its own idle
// Lissajous orbit; we add slow camera drift + a smooth brand-color morph.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const DARK_TUBES = ["#34D399", "#22D3EE"];
const DARK_BG = "#0A0A0F";
// light: azure + deeper emerald tubes read on warm paper; washed-teal + soft
// spring-green lights stay visible without glare. Background swaps to paper.
const LIGHT_TUBES = ["#0369A1", "#047857"];
const LIGHT_LIGHTS = ["#7DD3FC", "#6EE7B7", "#0369A1", "#047857"];
const LIGHT_BG = "#F5F2EC";

function paletteFor(theme: "dark" | "light") {
  return theme === "light"
    ? { tubes: LIGHT_TUBES, lights: LIGHT_LIGHTS, bg: LIGHT_BG }
    : { tubes: DARK_TUBES, lights: [...DARK_TUBES, ...DARK_TUBES], bg: DARK_BG };
}

const MODULE_URL =
  "https://cdn.jsdelivr.net/npm/threejs-components@0.0.19/build/cursors/tubes1.min.js";

type Color = { r: number; g: number; b: number };
type TubesApp = {
  tubes: {
    setColors(colors: string[]): void;
    setLightsColors(colors: string[]): void;
    tubes: { material: { color: Color } }[];
    lights: { color: Color }[];
  };
  three: { camera: { position: { x: number; y: number; z: number } } };
  dispose(): void;
};

const randomOf = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randomPalette = (n: number, pool: string[]) =>
  Array.from({ length: n }, () => hexToRgb(randomOf(pool)));
// stable starting look: emerald tubes, mixed lights
const START_TUBES = ["#34D399", "#22D3EE", "#34D399"];
const START_LIGHTS = ["#34D399", "#22D3EE", "#22D3EE", "#34D399"];

const lerpColor = (c: Color, t: Color, k: number) => {
  c.r += (t.r - c.r) * k;
  c.g += (t.g - c.g) * k;
  c.b += (t.b - c.b) * k;
};
const hexToRgb = (hex: string): Color => ({
  r: parseInt(hex.slice(1, 3), 16) / 255,
  g: parseInt(hex.slice(3, 5), 16) / 255,
  b: parseInt(hex.slice(5, 7), 16) / 255,
});

interface TubesBackgroundProps {
  children?: ReactNode;
  className?: string;
}

export function TubesBackground({ children, className }: TubesBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<TubesApp | null>(null);
  // morph targets, ref (not state): stepped by interval, never re-renders
  const tubeTargets = useRef<Color[]>(START_TUBES.map(hexToRgb));
  const lightTargets = useRef<Color[]>(START_LIGHTS.map(hexToRgb));
  // theme-reactive: the whole palette (tubes, lights, page ground) re-targets
  // when the login toggle rotates light/dark (owner: light needs its own look).
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  const themeRef = useRef(theme);
  useEffect(() => {
    const onChange = (e: Event) => {
      const t = (e as CustomEvent<"dark" | "light">).detail;
      if (t !== "dark" && t !== "light") return;
      setTheme(t);
      themeRef.current = t;
      const pal = paletteFor(t);
      tubeTargets.current = pal.tubes.map(hexToRgb);
      lightTargets.current = pal.lights.map(hexToRgb);
      if (canvasRef.current) canvasRef.current.style.backgroundColor = pal.bg;
    };
    window.addEventListener("astra-theme-change", onChange);
    return () => window.removeEventListener("astra-theme-change", onChange);
  }, []);

  useEffect(() => {
    let mounted = true;
    let app: TubesApp | null = null;
    const timers: ReturnType<typeof setInterval>[] = [];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // starve the vendor engine of pointer input -> it stays in its autonomous
    // idle orbit instead of following the cursor (login card is a sibling of
    // the background div, so a listener there would leak moves over the card)
    const blockPointer = (e: Event) => e.stopPropagation();

    (async () => {
      if (!canvasRef.current) return;
      try {
        // @ts-ignore runtime CDN module, no type declarations
        const module = await import(/* @vite-ignore */ MODULE_URL);
        if (!mounted) return;
        app = module.default(canvasRef.current, {
          tubes: {
            colors: START_TUBES,
            lights: { intensity: 200, colors: START_LIGHTS },
          },
        }) as TubesApp;
        appRef.current = app;
        // QA handle: lets live tests read the engine's motion target
        (window as unknown as Record<string, unknown>).__tubesApp = app;

        document.body.addEventListener("pointermove", blockPointer, { capture: true });
        document.body.addEventListener("pointerleave", blockPointer, { capture: true });

        // slow camera drift (incommensurate periods -> path never repeats)
        if (!reduced) {
          const t0 = performance.now();
          timers.push(
            setInterval(() => {
              const cam = app?.three.camera.position;
              if (!cam) return;
              const t = (performance.now() - t0) / 1000;
              cam.x = Math.sin(t * 0.13) * 0.25;
              cam.y = Math.sin(t * 0.101 + 1.3) * 0.18;
            }, 50),
          );
        }

        // smooth color morph: step live colors toward targets ~8%/tick
        timers.push(
          setInterval(() => {
            const a = appRef.current;
            if (!a) return;
            a.tubes.tubes.forEach((tube, i) => {
              const t = tubeTargets.current[i % tubeTargets.current.length];
              if (t) lerpColor(tube.material.color, t, 0.08);
            });
            a.tubes.lights.forEach((light, i) => {
              const t = lightTargets.current[i % lightTargets.current.length];
              if (t) lerpColor(light.color, t, 0.08);
            });
          }, 100),
        );

        // retarget the palette every 9s (always both accents present, from the
        // CURRENT theme's pool)
        timers.push(
          setInterval(() => {
            const pal = paletteFor(themeRef.current);
            tubeTargets.current = randomPalette(3, pal.tubes);
            lightTargets.current = randomPalette(4, pal.lights);
          }, 9000),
        );
      } catch (err) {
        console.error("Failed to load TubesCursor:", err);
      }
    })();

    return () => {
      mounted = false;
      timers.forEach(clearInterval);
      document.body.removeEventListener("pointermove", blockPointer, { capture: true });
      document.body.removeEventListener("pointerleave", blockPointer, { capture: true });
      app?.dispose();
      appRef.current = null;
    };
  }, []);

  const handleClick = () => {
    const pal = paletteFor(themeRef.current);
    tubeTargets.current = randomPalette(3, pal.tubes);
    lightTargets.current = randomPalette(4, pal.lights);
  };

  return (
    <div
      className={cn("relative h-full w-full overflow-hidden bg-void", className)}
      onClick={handleClick}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 block h-full w-full"
        style={{ touchAction: "none", backgroundColor: theme === "light" ? LIGHT_BG : DARK_BG }}
      />
      <div className="pointer-events-none relative z-10 h-full w-full">{children}</div>
    </div>
  );
}

export default TubesBackground;
