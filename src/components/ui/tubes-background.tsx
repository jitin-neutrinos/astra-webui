// TubesBackground — WebGL neon-tubes login background (threejs-components tubes1).
// Replaces the canvas neon-flow. Brand accents ONLY: emerald #34D399 + cyan #22D3EE
// on void #0A0A0F. Click on the background randomizes tube/light colors — drawn from
// the two brand accents, never off-palette.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const BRAND_TUBES = ["#34D399", "#22D3EE", "#34D399"];
const BRAND_LIGHTS = ["#34D399", "#22D3EE", "#22D3EE", "#34D399"];

const MODULE_URL =
  "https://cdn.jsdelivr.net/npm/threejs-components@0.0.19/build/cursors/tubes1.min.js";

type TubesApp = {
  tubes: {
    setColors(colors: string[]): void;
    setLightsColors(colors: string[]): void;
  };
  dispose(): void;
};

function pickBrandColors(): string[] {
  const accents = [BRAND_TUBES[0], BRAND_TUBES[1]];
  return [0, 1, 2].map(() => accents[Math.floor(Math.random() * 2)]);
}

interface TubesBackgroundProps {
  children?: ReactNode;
  className?: string;
  enableClickInteraction?: boolean;
}

export function TubesBackground({
  children,
  className,
  enableClickInteraction = true,
}: TubesBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const appRef = useRef<TubesApp | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;
    let app: TubesApp | null = null;

    (async () => {
      if (!canvasRef.current) return;
      try {
        // @ts-ignore runtime CDN module, no type declarations
        const module = await import(/* @vite-ignore */ MODULE_URL);
        if (!mounted) return;
        app = module.default(canvasRef.current, {
          tubes: {
            colors: BRAND_TUBES,
            lights: { intensity: 200, colors: BRAND_LIGHTS },
          },
        }) as TubesApp;
        appRef.current = app;
      } catch (err) {
        console.error("Failed to load TubesCursor:", err);
        if (mounted) setFailed(true);
      }
    })();

    return () => {
      mounted = false;
      app?.dispose();
      appRef.current = null;
    };
  }, []);

  const handleClick = () => {
    if (!enableClickInteraction || !appRef.current) return;
    appRef.current.tubes.setColors(pickBrandColors());
    appRef.current.tubes.setLightsColors(pickBrandColors().concat(pickBrandColors()));
  };

  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden bg-void",
        className,
      )}
      onClick={handleClick}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 block h-full w-full"
        style={{ touchAction: "none" }}
      />
      {failed && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-void"
        />
      )}
      <div className="pointer-events-none relative z-10 h-full w-full">
        {children}
      </div>
    </div>
  );
}

export default TubesBackground;
