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
// Light mode: metal tubes take their visible color from the LIGHTS reflecting
// off them, so pastel lights on white wash everything out (owner: "barely
// visible"). Deep saturated accent LIGHTS paint the tubes azure/emerald against
// the warm ground; tube material colors stay mid-deep so reflections carry hue.
// Ground = deeper warm paper — bloom lifts it to ~paper white in the frame.
const LIGHT_TUBES = ["#0369A1", "#047857"];
const LIGHT_LIGHTS = ["#0369A1", "#047857", "#0284C7", "#059669"];
const LIGHT_BG = "#ECE8DF";
// Light bloom: strength 0.35 + threshold 0.88 — enough glow halo, not enough to
// bleach the frame (0.8 strength dropped visible tube color 4x). Light
// intensity 120 (down from vendor 200): strong enough to carry the accent
// reflections, cool enough that they don't white-out against the paper.
const LIGHT_BLOOM = { strength: 0.35, threshold: 0.88, radius: 0.45, intensity: 120 };
const DARK_BLOOM = { strength: 1.5, threshold: 0, radius: 0.5, intensity: 200 };

function paletteFor(theme: "dark" | "light") {
  return theme === "light"
    ? { tubes: LIGHT_TUBES, lights: LIGHT_LIGHTS, bg: LIGHT_BG }
    : { tubes: DARK_TUBES, lights: [...DARK_TUBES, ...DARK_TUBES], bg: DARK_BG };
}

// The vendor engine's postprocessing (bloom) composites an OPAQUE black ground
// no matter the clear alpha, so a transparent canvas trick fails. Ground control
// = clear COLOR: light mode paints the warm paper INTO the WebGL clear (bloom
// lifts it to ~white, tubes read as brand-tinted strokes on paper); dark keeps
// the engine's own black for the neon look.
function applyGround(app: TubesApp | null, theme: "dark" | "light") {
  if (!app?.three?.renderer) return;
  // Color ctor isn't reachable from the module namespace; a live Color instance
  // from an existing material is the vehicle for setClearColor.
  const vehicle = app.tubes.tubes[0]?.material.color;
  if (!vehicle) return;
  const groundHex = theme === "light" ? 0xece8df : 0x0a0a0f;
  const keep = { r: vehicle.r, g: vehicle.g, b: vehicle.b };
  vehicle.set?.(groundHex);
  app.three.renderer.setClearColor(vehicle, 1);
  vehicle.set?.(keep); // restore the tube's own color
  // bloom profile per theme (see LIGHT_BLOOM/DARK_BLOOM notes above)
  if (app.bloomPass) {
    const b = theme === "light" ? LIGHT_BLOOM : DARK_BLOOM;
    app.bloomPass.strength.value = b.strength;
    app.bloomPass.threshold.value = b.threshold;
    app.bloomPass.radius.value = b.radius;
  }
  // point-light intensity per theme (vendor default 200 is tuned for black)
  const intensity = theme === "light" ? LIGHT_BLOOM.intensity : DARK_BLOOM.intensity;
  app.tubes.lights.forEach((light) => { light.intensity = intensity; });
}

const MODULE_URL =
  "https://cdn.jsdelivr.net/npm/threejs-components@0.0.19/build/cursors/tubes1.min.js";

type Color = { r: number; g: number; b: number; set?(hex: number | Color): Color };
type TubesApp = {
  tubes: {
    setColors(colors: string[]): void;
    setLightsColors(colors: string[]): void;
    tubes: { material: { color: Color } }[];
    lights: { color: Color; intensity: number }[];
  };
  bloomPass?: { strength: { value: number }; threshold: { value: number }; radius: { value: number } };
  three: {
    camera: { position: { x: number; y: number; z: number } };
    onAfterRender?: ((...args: unknown[]) => void) | { add(fn: () => void): void };
    renderer?: { setClearColor(color: unknown, alpha?: number): void; setClearAlpha(alpha?: number): void };
  };
  dispose(): void;
};

const randomOf = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randomPalette = (n: number, pool: string[]) =>
  Array.from({ length: n }, () => hexToRgb(randomOf(pool)));
// stable starting look: the vendor engine hue-drifts everything toward its own
// cyan orbit no matter what we set at runtime, so the CONSTRUCTOR palette is the
// strongest lever — seed it with deep azure/emerald (light-mode accents).
const START_TUBES = ["#0369A1", "#047857", "#0284C7"];
const START_LIGHTS = ["#0369A1", "#047857", "#0284C7", "#059669"];

const lerpColor = (c: Color, t: Color, k: number) => {
  c.r += (t.r - c.r) * k;
  c.g += (t.g - c.g) * k;
  c.b += (t.b - c.b) * k;
};
const hexToRgb = (hex: string): Color => ({
  set: undefined,
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
  const haloCanvasRef = useRef<HTMLCanvasElement>(null);
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
      applyGround(appRef.current, t);
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
        // ground + bloom: warm paper w/ gentle glow in light mode; engine
        // black + full neon bloom in dark mode
        applyGround(app, themeRef.current);

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

        // light-mode tube halo. The WebGL canvas is unreadable (vendor renders
        // without preserveDrawingBuffer — drawImage/getImageData see zeros) and
        // vendor bloom only ADDS light, which vanishes on paper. So the glow is
        // SYNTHESIZED from our own motion model: we drive the camera drift, so
        // the tube bundle's on-screen position is a known function of time —
        // paint soft azure/emerald blobs at exactly that position on a 2D
        // canvas above the scene. The glow moves WITH the tubes. Multiply blend
        // tints the paper; normal blend adds the bright core.
        let haloCtx: CanvasRenderingContext2D | null = null;
        let haloW = 0, haloH = 0;
        const paintHalo = (tMs: number) => {
          if (themeRef.current !== "light") return;
          const halo = haloCanvasRef.current;
          if (!halo) return;
          if (!haloCtx || halo.width !== haloW || halo.height !== haloH) {
            haloW = halo.width; haloH = halo.height;
            haloCtx = halo.getContext("2d");
            if (!haloCtx) return;
          }
          const ctx = haloCtx;
          const t = tMs / 1000;
          // mirror the camera-drift formula (same periods/phases as cam.x/y)
          const cx = 0.5 + Math.sin(t * 0.13) * 0.10;   // fraction of width
          const cy = 0.5 + Math.sin(t * 0.101 + 1.3) * 0.12;
          const cx2 = 0.5 - Math.sin(t * 0.13) * 0.13;
          const cy2 = 0.5 - Math.sin(t * 0.101 + 1.3) * 0.10;
          ctx.clearRect(0, 0, haloW, haloH);
          const blob = (x: number, y: number, r: number, rgb: string, a: number, comp: GlobalCompositeOperation) => {
            const g = ctx.createRadialGradient(x * haloW, y * haloH, 0, x * haloW, y * haloH, r * haloW);
            g.addColorStop(0, `rgba(${rgb},${a})`);
            g.addColorStop(1, `rgba(${rgb},0)`);
            ctx.globalCompositeOperation = comp;
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, haloW, haloH);
          };
          // dark-tint penumbra (multiply): reads on paper
          blob(cx, cy, 0.34, "3, 105, 161", 0.34, "source-over");
          blob(cx2, cy2, 0.30, "4, 120, 87", 0.26, "source-over");
          // bright core (lighter): the light source inside the tint
          blob(cx, cy, 0.16, "147, 197, 253", 0.5, "lighter");
          blob(cx2, cy2, 0.14, "110, 231, 183", 0.38, "lighter");
        };
        // size the halo with the main canvas, at quarter resolution
        const syncHaloSize = () => {
          const halo = haloCanvasRef.current;
          if (canvasRef.current && halo) {
            halo.width = Math.max(1, canvasRef.current.width >> 2);
            halo.height = Math.max(1, canvasRef.current.height >> 2);
          }
        };
        syncHaloSize();
        app.three.onAfterRender = () => {
          paintHalo(performance.now());
        };
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
        style={{ touchAction: "none" }}
      />
      {/* tube glow (light mode), two layers:
          1. halo canvas — soft azure/emerald blobs driven by the camera-drift
             formula, so the glow MOVES WITH the tube bundle
          2. ambient wash — faint static blue-green field so the glow reads
             even where the tubes aren't (the vendor bloom is invisible on
             paper; both layers are the light-mode replacement for it) */}
      <canvas
        ref={haloCanvasRef}
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 z-[1] h-full w-full tubes-halo",
          theme !== "light" && "hidden",
        )}
      />
      <div
        aria-hidden="true"
        className={cn("pointer-events-none absolute inset-0 z-[1] tubes-glow-wash", theme !== "light" && "hidden")}
        style={theme === "light" ? { opacity: 0.45 } : undefined}
      />
      <div className="pointer-events-none relative z-10 h-full w-full">{children}</div>
    </div>
  );
}

export default TubesBackground;
