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

// ---- Durable storage keys: per-tab queue, cross-tab session registry ----
// True concurrent chats (tab A and tab B running different conversations at
// the same time) need the durable offline prompt queue to be PER-TAB: a shared
// localStorage queue let tab A's queued prompt flush into tab B's freshly
// minted chat after a reconnect. Session ids themselves stay GLOBAL so the
// sidebar/other tabs can see and resume them.
export const TAB_QUEUE_KEY = "astra-ws-queue-v2"; // sessionStorage: survives reloads, never crosses tabs
export const SESSION_INDEX_KEY = "astra-session-index-v1"; // localStorage: cross-tab registry of live chats

export function storageForQueue(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage;
}

export function storageForSessions(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}
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

// ---- session info (model / provider / effort / yolo) ----
// The gateway's `info` object arrives in THREE places: the session.info event,
// the create reply, and every resume reply (incl. the 45s watchdog probe). A
// reload onto a still-live session gets NO session.info event at all - only the
// resume reply carries the truth - so all three feed this one reducer.
// Payloads can be the lazy shape (model + cwd only) or a cwd-only event, so:
//  - same session: MERGE (absent keys keep their last known value)
//  - pre-session optimistic picks (prevSid null, prev set): picks WIN over the
//    lazy create info (else the user's pick flickers back to the default)
//  - different session: REPLACE (a stale chat never leaks into the next one)
export function mergeSessionInfo(prev: any, prevSid: string | null, sid: string, incoming: any): any {
  if (!incoming || typeof incoming !== "object") return prev;
  if (prev && prevSid === sid) return { ...prev, ...incoming };
  if (prev && prevSid === null) return { ...incoming, ...prev };
  return { ...incoming };
}
