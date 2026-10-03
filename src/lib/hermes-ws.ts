// hermes-ws.ts — compatibility facade.
//
// The connection brain now lives in ws-engine.ts (module singleton) with state
// in ws-store.ts (zustand). This file keeps the old `useHermesWS(onEvent)` hook
// API so chat-landing.tsx (1,300+ lines) works unchanged.
//
// What changed under the hood:
//   • The socket + reconnect loop are APP-lifetime, not hook-lifetime — a React
//     unmount/StrictMode remount/Android WebView freeze can no longer tear the
//     reconnect timers down with the component (the old effect cleanup nulled
//     the socket and killed every timer on unmount — the "app sat offline
//     forever until reopened" bug).
//   • The outbound queue is DURABLE (localStorage) — an Android app kill no
//     longer eats a message the user watched "send".
//   • The store is the single source of truth; multiple components can read
//     connection state without prop-drilling.
//
// Pure helpers live in ws-helpers.ts and are re-exported unchanged — the check
// files and the engine import them from here, so tests keep passing.

import { useEffect, useCallback } from "react";
import { RESTORED_MS, type ConnEvent, type ConnState } from "./connection-state";
import { useWsStore, wsGet, wsSet } from "./ws-store";
import type { EventPayload, SessionInfo } from "./ws-helpers";
import {
  startEngine, addListener, rpc, submitPrompt, submitBg, submitSteer,
  sendApprovalResponse, sendServerResponse, interrupt,
  resetSession as engineResetSession, retryConnection as engineRetry,
  pokeResumeCheck,
} from "./ws-engine";

export type { EventPayload, SessionInfo } from "./ws-helpers";

// Pure helpers (checked by streaming-resilience.check.ts et al).
export { nextReconnectDelay, RECONNECT_BASE_MS, RECONNECT_MAX_MS } from "./ws-helpers";
export { transportSilent, TRANSPORT_SILENCE_MS } from "./ws-helpers";
export { applyTurnTruth } from "./ws-helpers";
export { watchdogAction } from "./ws-helpers";
export { requestBelongsToLive } from "./ws-helpers";

// lastSessionInfo global (files-page reads it outside React)
export let lastSessionInfo: SessionInfo | null = null;
export function getLastSessionInfo() { return lastSessionInfo; }
export function setLastSessionInfo(info: SessionInfo | null) { lastSessionInfo = info; }

export function useHermesWS(onEvent: (ev: EventPayload) => void) {
  const conn = useWsStore((s) => s.conn);
  // PERF: `nextRetryIn` is deliberately NOT subscribed here. It ticks 1 Hz
  // during an outage, and a subscription at this level re-rendered the entire
  // chat tree once a second to feed a countdown that lives in ConnectionBanner.
  // Zustand bails out on equal values, so the idle case was already free —
  // the cost was outage-time only. ConnectionBanner subscribes directly; the
  // getter below stays for non-React callers. See references/perf-r1-timer.md.
  const isStreaming = useWsStore((s) => s.turnRunning);
  const liveSessionId = useWsStore((s) => s.liveSessionId);
  const storedSessionId = useWsStore((s) => s.storedSessionId);
  const sessionInfo = useWsStore((s) => s.sessionInfo);
  const queue = useWsStore((s) => s.queue);

  // App-lifetime engine: starts once, no matter how often the hook mounts.
  useEffect(() => { startEngine(); }, []);

  // Per-mount frame listener — forwards engine frames into the app handler.
  useEffect(() => {
    return addListener((ev) => {
      if (ev.type === "session.info") {
        lastSessionInfo = ev.payload as SessionInfo;
      }
      onEvent(ev);
    });
  }, [onEvent]);

  // Restored → online: the banner starts its slide-out at RESTORED_MS; flip the
  // state right after so the element unmounts as the animation finishes.
  // (Ported from the old hook — the banner's leave animation depends on it.)
  useEffect(() => {
    if (conn !== "restored") return;
    const t = window.setTimeout(() => useWsStore.getState().setConn({ type: "restored-timeout" } as ConnEvent), RESTORED_MS + 220);
    return () => window.clearTimeout(t);
  }, [conn]);

  const setStoredSessionId = useCallback((sid: string | null) => {
    wsGet().setStoredSessionId(sid);
  }, []);

  // Functional setter — optimistic config toggles (yolo/model/reasoning) patch
  // the previous value; a plain assignment would race the next session.info.
  const setSessionInfo = useCallback((fnOrVal: any) => {
    if (typeof fnOrVal === "function") wsGet().patchSessionInfo(fnOrVal);
    else wsSet({ sessionInfo: fnOrVal });
  }, []);

  return {
    isStreaming,
    submitPrompt,
    submitBg,
    submitSteer,
    retryConnection: engineRetry,
    conn: conn as ConnState,
    // Non-reactive getter: reads the store on demand. React callers that need
    // to re-render on this value subscribe via useWsStore directly.
    nextRetryIn: () => wsGet().nextRetryIn,
    interrupt,
    storedSessionId,
    setStoredSessionId,
    liveSessionId,
    sendApprovalResponse,
    sendServerResponse,
    rpc,
    sessionInfo: sessionInfo as SessionInfo | null,
    setSessionInfo,
    resetSession: engineResetSession,
    pokeResumeCheck,
    queue,
  };
}

// Store re-export for any component that wants fine-grained connection state.
export { useWsStore, wsGet, wsSet };
export { RESTORED_MS };
