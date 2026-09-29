// Reveal pacing math for chat text segments — pure, no React, so it can be
// exercised from a plain node script (reveal-pace.check.ts) without a build.
//
// Contract (owner-settled):
// - Small live trickle reveals at the human 40-52 cps wobble (declared feel).
// - A burst that parks a backlog catches up FAST BUT VISIBLE: pace scales with
//   the backlog up to a hard cap (~4-5x reading speed). The cap is the point:
//   an uncapped catch-up empties the buffer instantly, so the next model pause
//   freezes the text mid-line (live-tested complaint) and the end-of-turn snap
//   then drops a whole block. A capped pace keeps a cushion animating through
//   pauses and bounds the final snap to roughly one burst.
// - Once the turn is done, the drain contract is unchanged: finished text
//   closes out in <2s, never slower than 2x the minimum pace.
export function revealCps(
  back: number,          // chars not yet revealed
  done: boolean,         // segment reached its final state
  now: number,           // performance.now(), drives the wobble phase
  cpsMin = 40,
  cpsMax = 52,
  lagTarget = 0.6,       // seconds a burst backlog may take to catch up
  catchCap = 240,        // hard ceiling: catch-up must stay visibly animated
): number {
  if (done) return Math.max(cpsMin * 2, back / 1.8);
  const wobble = cpsMin + (Math.sin(now / 900) + 1) * (cpsMax - cpsMin) / 2;
  return Math.max(wobble, Math.min(back / lagTarget, catchCap));
}
