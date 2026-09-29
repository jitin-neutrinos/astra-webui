// ws-helpers.ts — pure, dependency-free helpers for the WS transport layer.
//
// Extracted from the old hermes-ws.ts hook so THREE modules can share them
// without import cycles:
//   • ws-engine.ts (the singleton connection brain)
//   • hermes-ws.ts (the React facade, re-exports for the check files)
//   • the *.check.ts files (assert-based, run under plain node)
//
// Nothing here touches React, the DOM, or module state — safe to import
// anywhere, including node-run checks.

export type EventPayload = { type: string; payload: any; session_id?: string };
export type SessionInfo = {
  cwd?: string;
  yolo?: boolean;
  model?: string;
  provider?: string;
  reasoning_effort?: string;
};

// R4: transport liveness — ANY frame within 60s proves the wire alive (the proxy
// ticks every 25s when healthy). Silence = dead transport (reconnect), NOT a
// dead turn; this check never touches isStreaming.
export const TRANSPORT_SILENCE_MS = 60_000;
export function transportSilent(lastFrameAt: number, now: number): boolean {
  return now - lastFrameAt > TRANSPORT_SILENCE_MS;
}

// R3: reconnect backoff 1s → 30s cap, ±15% jitter, forever; reset on open.
export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 30000;
export function nextReconnectDelay(attempt: number, jitter: () => number = Math.random): number {
  const raw = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
  const j = 1 + (jitter() - 0.5) * 0.3;
  return Math.round(Math.min(Math.max(raw * j, 250), RECONNECT_MAX_MS));
}

// Server→client requests (approval / clarify / gates) carry params.session_id
// minted by the gateway (server_requests.py frame()). The proxy broadcasts
// every upstream frame to EVERY tab, and these requests were dispatched BEFORE
// the session filter — an approval minted for chat A's turn rendered in chat B.
// STRICT ownership, same rule as events: exact match only; a null live id (no
// live session yet) or a missing/foreign tag matches NOTHING (fail-closed —
// the gateway stamps every request with its session id).
export function requestBelongsToLive(params: any, liveSid: string | null): boolean {
  const sid = params && typeof params === "object" ? params.session_id : null;
  return typeof sid === "string" && sid.length > 0 && sid === liveSid;
}

// R5: gateway turn truth → UI state. Turn truth is the gateway's, never the UI's.
export function applyTurnTruth(running: boolean | undefined, status: string | undefined): "streaming" | "idle" | "unknown" {
  if (running === true || status === "streaming") return "streaming";
  if (running === false || status === "idle") return "idle";
  return "unknown";
}

// R6: watchdog probe decision table. wait = transport/query hiccup — keep
// watching, never emit a false "timed out" while the gateway may be working.
export function watchdogAction(probeFailed: boolean, running: boolean | undefined): "wait" | "stay" | "finalize" {
  if (probeFailed || running === undefined) return "wait";
  return running ? "stay" : "finalize";
}
