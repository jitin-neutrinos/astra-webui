import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * UnreadPill — animated count badge for sidebar rows.
 * Visual DNA: Magic UI number-ticker pop + diceui Status pill pattern; plate
 * styles live in .ast-unread-pill (index.css).
 * Motion contract (emil-design-eng): enter from scale(.6)+fade 180ms ease-out
 * (never scale(0)), pop on count change via key-remount spring, exit fade+scale(.9).
 * key={count} remount keeps it interruptible-by-React without animation loops.
 */
export function UnreadPill({ count }: { count: number }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {count > 0 && (
        <motion.span
          className="ast-unread-pill shrink-0"
          aria-label={`${count} unread`}
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
          transition={{ duration: reduce ? 0.12 : 0.18, ease: [0.23, 1, 0.32, 1] }}
        >
          <motion.span
            key={count}
            initial={reduce ? undefined : { scale: 1.25 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", duration: 0.32, bounce: 0.25 }}
            className="inline-block tabular-nums"
          >
            {count > 99 ? "99+" : count}
          </motion.span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}
