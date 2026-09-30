// Composer animation primitives — ports of proven registry components,
// restyled to Astra tokens:
//   RotatingPlaceholder — pattern from Aceternity "placeholders-and-vanish-input"
//     + 21st "ai-prompt-input" (motion/react instead of their framer import,
//     astra brand ease, reduced-motion aware).
//   SendButton — icon-swap + press-spring pattern from 21st "ai-prompt-input"
//     (IconSwapFrame / SPRING_PRESS), Astra cyan gradient.
// Both honor prefers-reduced-motion with fade-only variants (Emil rule).
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

// Astra motion signature — app-wide strong ease-out.
const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];
const SPRING_ICON = { type: "spring" as const, duration: 0.3, bounce: 0 };

export function RotatingPlaceholder({
  phrases,
  interval = 3200,
  active,
}: {
  phrases: string[];
  interval?: number;
  active: boolean;
}) {
  const [index, setIndex] = useState(0);
  const reduce = useReducedMotion();
  const count = phrases.length;

  // Pause rotation when the tab is hidden (battery/CPU courtesy).
  useEffect(() => {
    if (!active || reduce || count <= 1) return;
    let id = 0;
    const start = () => { window.clearInterval(id); id = window.setInterval(() => setIndex((i) => (i + 1) % count), interval); };
    const stop = () => window.clearInterval(id);
    const onVis = () => { document.visibilityState === "visible" ? start() : stop(); };
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active, interval, reduce, count]);

  if (!active) return null;
  const current = phrases[index % count] ?? phrases[0];

  return (
    <div aria-hidden className="composer-ph-rotor pointer-events-none absolute inset-x-0 top-[2px] px-[4px]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={current}
          className="composer-ph-text block truncate"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6, filter: "blur(4px)" }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, filter: "blur(4px)" }}
          transition={reduce ? { duration: 0.15 } : { duration: 0.35, ease: EASE }}
        >
          {current}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

// Icon swap frame: crossfades arrow/check with a tiny blur+scale so the glyph
// never pops. Never starts from scale(0) — 0.6 on a 16px icon reads as a blink.
export function IconSwap({ swapKey, children }: { swapKey: string; children: React.ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={swapKey}
        className="flex items-center justify-center"
        initial={{ opacity: 0, scale: 0.6, filter: "blur(3px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 0.6, filter: "blur(3px)" }}
        transition={SPRING_ICON}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  );
}
