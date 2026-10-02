// history-retry.ts — retry policy for the chat-history first load.
//
// The first history fetch after a reload / app resume / approval deep link can
// race the tunnel or the proxy's upstream relogin (Doze killed the socket
// server-side mid-flight; proxy answers 503 {"error":"reauth"}). One failure
// used to paint a sticky banner and nothing ever retried — re-entering the
// chat only "fixed" it because the remount re-fired the fetch. Pure helpers
// here; chat-landing owns the timers.

export const HIST_MAX_ATTEMPTS = 5;

/** Backoff before attempt N (1-based): 1.5s, 3s, 6s, 8s, 8s. */
export function histBackoffMs(attempt: number): number {
  return Math.min(1500 * 2 ** Math.max(0, attempt - 1), 8000);
}

/** Transient = worth retrying. status null = fetch threw (network) → retry. */
export function histFailureTransient(status: number | null): boolean {
  if (status == null) return true;
  return status === 429 || status === 502 || status === 503 || status === 504;
}
