// Pure view helpers for the training page. They live here (not inline in the
// component) so the executable spec can import the SAME code the app ships —
// a spec that restates the logic only tests the copy, and passes even after the
// page breaks.

/** Pipeline states that mean "still in flight" for the summary tiles. */
export const ACTIVE_STATES = ["dumping", "reviewing", "awaiting_retry"];

export type JobCounts = { active: number; failed: number; done: number; total: number };

/**
 * Summary tiles for the review-job list. An unrecognised status (a pipeline
 * state added server-side before this page knows it) still counts toward total
 * so the tiles cannot silently under-report, but it must not inflate active.
 */
export function jobCounts(jobs: Array<{ status?: string | null }>): JobCounts {
  let active = 0, failed = 0, done = 0;
  for (const j of jobs) {
    const s = j?.status;
    if (ACTIVE_STATES.includes(String(s))) active++;
    else if (s === "failed") failed++;
    else if (s === "done") done++;
  }
  return { active, failed, done, total: jobs.length };
}

/** Duration in ms → "1h 5m" / "2m 5s" / "9s". Negative input clamps to "0s". */
export function fmtCountdown(ms: number): string {
  const clamped = Math.max(0, ms);
  const h = Math.floor(clamped / 3600000);
  const m = Math.floor((clamped % 3600000) / 60000);
  const s = Math.floor((clamped % 60000) / 1000);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Epoch-ms retry target → countdown string. Empty string when unset. */
export function countdownUntil(nextAttemptAt?: number | null): string {
  if (!nextAttemptAt) return "";
  return fmtCountdown(nextAttemptAt - Date.now());
}