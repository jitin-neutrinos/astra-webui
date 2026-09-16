// Neon Flow — brand-colored canvas background for the Astra login screen.
// Original implementation (21st.dev vendor file is API-key-gated); same visual
// class: flowing glowing neon tubes on void, cursor-reactive. Brand tokens:
// cyan #22d3ee, violet #8b5cf6, fuchsia #d946ef on #0a0a0f.
// A11y: pure decoration — aria-hidden, pointer-events none; reduced-motion
// renders a static frame; rAF loop pauses when the tab is hidden.
import { useEffect, useRef } from "react";

type Tube = {
  pts: { x: number; y: number }[];
  hue: 0 | 1 | 2; // 0=cyan 1=violet 2=fuchsia
  width: number;
  speed: number;
  phase: number;
  drift: { x: number; y: number };
};

const COLORS = ["34,211,238", "139,92,246", "217,70,239"] as const;
const TUBE_COUNT = 14;
const SEGMENTS = 26;

function makeTube(w: number, h: number): Tube {
  // a tube = a wavy horizontal-ish spline drifting slowly across the field
  const y0 = Math.random() * h;
  const amp = h * (0.08 + Math.random() * 0.22);
  const freq = 1 + Math.random() * 2.2;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    pts.push({
      x: t * (w + 200) - 100,
      y: y0 + Math.sin(t * Math.PI * freq) * amp,
    });
  }
  return {
    pts,
    hue: Math.floor(Math.random() * 3) as 0 | 1 | 2,
    width: 1.2 + Math.random() * 3.4,
    speed: 0.06 + Math.random() * 0.16,
    phase: Math.random() * Math.PI * 2,
    drift: { x: 12 + Math.random() * 30, y: (Math.random() - 0.5) * 14 },
  };
}

export default function NeonFlow() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, running = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let tubes: Tube[] = [];
    const pointer = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4 };

    const resize = () => {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      tubes = Array.from({ length: TUBE_COUNT }, () => makeTube(w, h));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.tx = e.clientX - r.left; pointer.ty = e.clientY - r.top;
    };
    const onLeave = () => { pointer.tx = -1e4; pointer.ty = -1e4; };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);

    const draw = (dt: number) => {
      ctx.fillStyle = "#0a0a0f";
      ctx.fillRect(0, 0, w, h);

      // pointer eases toward target — tubes bend toward the cursor
      pointer.x += (pointer.tx - pointer.x) * 0.08;
      pointer.y += (pointer.ty - pointer.y) * 0.08;

      ctx.lineCap = "round";
      ctx.globalCompositeOperation = "lighter"; // neon additive glow
      for (const t of tubes) {
        t.phase += dt * t.speed;
        const col = COLORS[t.hue];
        // re-wave points around their base line, bowing near the pointer
        const pts = t.pts.map((p, i) => {
          const wob = Math.sin(t.phase + i * 0.42) * 9;
          const dx = pointer.x - p.x, dy = pointer.y - p.y;
          const d2 = dx * dx + dy * dy;
          const pull = Math.max(0, 1 - d2 / (240 * 240)) * 46;
          const d = Math.sqrt(d2) || 1;
          return {
            x: p.x + (dx / d) * pull,
            y: p.y + wob + (dy / d) * pull,
          };
        });

        // pass 1: wide soft glow, pass 2: bright core
        for (const [lw, alpha] of [[t.width * 6, 0.05], [t.width, 0.5]] as const) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length - 1; i++) {
            const xc = (pts[i].x + pts[i + 1].x) / 2;
            const yc = (pts[i].y + pts[i + 1].y) / 2;
            ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
          }
          ctx.strokeStyle = `rgba(${col},${alpha})`;
          ctx.lineWidth = lw;
          ctx.stroke();
        }

        // slow drift, wrap around edges
        for (const p of t.pts) {
          p.x += t.drift.x * dt; p.y += t.drift.y * dt;
        }
        if (t.pts[0].x > w + 120) for (const p of t.pts) p.x -= w + 240;
        if (t.pts[t.pts.length - 1].x < -120) for (const p of t.pts) p.x += w + 240;
      }
      ctx.globalCompositeOperation = "source-over";
    };

    let last = performance.now();
    const frame = (now: number) => {
      if (!running) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      draw(dt);
      raf = requestAnimationFrame(frame);
    };

    if (reduced) {
      draw(0); // single static frame, no loop
    } else {
      raf = requestAnimationFrame(frame);
      const onVis = () => {
        if (document.hidden) { running = false; cancelAnimationFrame(raf); }
        else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
      };
      document.addEventListener("visibilitychange", onVis);
      return () => {
        running = false; cancelAnimationFrame(raf);
        document.removeEventListener("visibilitychange", onVis);
        ro.disconnect();
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerleave", onLeave);
      };
    }
    return () => { ro.disconnect(); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerleave", onLeave); };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="absolute inset-0 h-full w-full" />;
}
