import { useEffect, useRef, useState, useCallback } from "react";

export type EventPayload = { type: string; payload: any; session_id?: string };
export type SessionInfo = {
  cwd?: string;
  yolo?: boolean;
  model?: string;
  provider?: string;
  reasoning_effort?: string;
};

// Simple ID generator for RPCs
const generateRpcId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// R6: the watchdog is a PROBE, never an executioner. It re-arms on every turn
// event (rolling): 45s of turn silence → ask the gateway for truth
// (session.resume) and only finalize on running:false. Long silent tool runs
// survive (probe is read-only); a stranded "replying" state self-heals ≤45s.
const TURN_WATCHDOG_MS = 45_000;

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

// Session identity is PER TAB, and the URL is the source of truth.
//
// This used to be a single localStorage key shared by every tab on the origin.
// localStorage is per-ORIGIN, not per-tab, so two tabs were one chat wearing two
// windows: opening a second tab inherited the first tab's chat, and the moment
// either tab switched chats it overwrote the shared key — the other tab then
// resumed the wrong session on its next reconnect and silently jumped to a
// conversation the user never opened there (reproduced: two tabs, two different
// chats, both ended up on the second tab's session).
//
// Resolution order:
//   1. `/c/<id>` in the URL — deep links, reload, back/forward, and the value a
//      tab keeps re-asserting for itself.
//   2. sessionStorage — per-tab BY DESIGN (a new tab gets an empty one, a reload
//      keeps it), so it survives reload without ever leaking sideways.
//   3. nothing — a brand-new tab at `/` starts a fresh chat instead of hijacking
//      whatever another tab happens to be doing.
const SESSION_KEY = "astra-chat-session";
const LEGACY_SHARED_KEY = "astra-chat-session";

function sidFromPath(): string | null {
  const m = location.pathname.match(/^\/c\/([A-Za-z0-9_-]+)$/);
  return m ? m[1] : null;
}

function readStoredSid(): string | null {
  try {
    // The URL wins: it is what the user actually has open in THIS tab.
    const fromUrl = sidFromPath();
    if (fromUrl) {
      sessionStorage.setItem(SESSION_KEY, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(SESSION_KEY);
  } catch { return null; }
}

function writeStoredSid(sid: string | null) {
  try {
    if (sid) sessionStorage.setItem(SESSION_KEY, sid);
    else sessionStorage.removeItem(SESSION_KEY);
    // Drop the old origin-wide key on sight so a stale value can never be
    // picked up again by any tab.
    localStorage.removeItem(LEGACY_SHARED_KEY);
  } catch { /* private mode */ }
}

// Export last session info globally (safe since there's one session at a time)
export let lastSessionInfo: SessionInfo | null = null;
export function getLastSessionInfo() { return lastSessionInfo; }

let sharedSocket: WebSocket | null = null;

export function useHermesWS(onEvent: (ev: EventPayload) => void) {
  const ws = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  const [isStreaming, setIsStreaming] = useState(false);
  const [storedSessionId, setStoredSessionIdState] = useState<string | null>(readStoredSid);

  const [liveSessionId, setLiveSessionIdState] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const liveIdRef = useRef<string | null>(null);
  const sessionInfoRef = useRef<SessionInfo | null>(null);
  const isStreamingRef = useRef(false);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  const setLiveSessionId = useCallback((sid: string | null) => {
    setLiveSessionIdState(sid);
    liveIdRef.current = sid;
  }, []);

  const setStoredSessionId = useCallback((sid: string | null) => {
    writeStoredSid(sid);
    setStoredSessionIdState(sid);
  }, []);

  const pendingResumes = useRef<Set<string>>(new Set());
  const pendingRpcs = useRef<Map<string, { resolve: (val: any) => void, reject: (err: any) => void }>>(new Map());
  // Every RPC id THIS tab has ever sent. The proxy fans every upstream frame out
  // to all connected browsers, so a reply carrying a session_id may belong to a
  // different tab entirely. Without this, the catch-all `{id, result.session_id}`
  // branch below adopted a sibling tab's session.create reply as its own and
  // both tabs converged on one chat.
  const ownRpcIds = useRef<Set<string>>(new Set());
  const ownRpcId = () => {
    const id = generateRpcId();
    ownRpcIds.current.add(id);
    // Bound the set; ids are only ever matched against in-flight replies.
    if (ownRpcIds.current.size > 200) {
      const first = ownRpcIds.current.values().next().value;
      if (first !== undefined) ownRpcIds.current.delete(first);
    }
    return id;
  };
  const pendingPreTurnRpcs = useRef<{id: string, method: string, params: any, resolve: any, reject: any}[]>([]);

  // R6: watchdog fires → probe the gateway via probeTurn; its reply is matched
  // by probeIdRef in onMessage. The old hard-kill path is deleted.
  const watchdogRef = useRef<number | null>(null);
  const probeIdRef = useRef<string | null>(null);
  const probeTurnRef = useRef<() => void>(() => {});
  // Silent-death guard: consecutive probe failures (gateway unreachable while a
  // turn looks active). 3 strikes ≈ 6 min of silence → visible failure, never
  // an infinite quiet spinner.
  const probeFailsRef = useRef(0);
  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) { window.clearTimeout(watchdogRef.current); watchdogRef.current = null; }
  }, []);
  const armWatchdog = useCallback(() => {
    clearWatchdog();
    watchdogRef.current = window.setTimeout(() => {
      watchdogRef.current = null;
      probeTurnRef.current();
    }, TURN_WATCHDOG_MS);
  }, [clearWatchdog]);
  const probeTurn = useCallback(() => {
    const sid = liveIdRef.current || readStoredSid();
    // Transport down or no session: R3/R4 owns recovery — but bounded. If the
    // transport is still gone after 3 probe cycles (~6 min), fail visibly
    // instead of spinning a silent Thinking pill forever.
    if (!ws.current || ws.current.readyState !== 1 || !sid) {
      probeFailsRef.current++;
      if (probeFailsRef.current >= 3) {
        probeFailsRef.current = 0;
        setIsStreaming(false);
        onEventRef.current({ type: "message.error", payload: { error: "Lost contact with Astra while it was working. The connection didn't recover in time — please try again." } });
        onEventRef.current({ type: "turn.settled", payload: {} });
        return;
      }
      armWatchdog();
      return;
    }
    probeIdRef.current = ownRpcId();
    ws.current.send(JSON.stringify({ method: "session.resume", params: { session_id: sid, omit_messages: true }, id: probeIdRef.current }));
  }, [armWatchdog]);
  useEffect(() => { probeTurnRef.current = probeTurn; }, [probeTurn]);

  // A prompt queued while the socket was down must not spin forever if the
  // connection never comes back: 5-min hard cap, then a visible failure.
  const queuedTimerRef = useRef<number | null>(null);
  const clearQueuedCap = useCallback(() => {
    if (queuedTimerRef.current) { window.clearTimeout(queuedTimerRef.current); queuedTimerRef.current = null; }
  }, []);
  const armQueuedCap = useCallback(() => {
    if (queuedTimerRef.current) return;
    queuedTimerRef.current = window.setTimeout(() => {
      queuedTimerRef.current = null;
      if (pendingPromptRef.current === null) return; // already flushed — not our problem
      pendingPromptRef.current = null;
      createOnOpenRef.current = false;
      setIsStreaming(false);
      onEventRef.current({ type: "message.error", payload: { error: "Message couldn't be sent — the connection was unavailable for too long. Please try again." } });
    }, 300_000);
  }, []);

  const rpc = useCallback((method: string, params: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      const id = ownRpcId();
      if (!liveIdRef.current && (method === "config.set" || method === "image.attach")) {
        pendingPreTurnRpcs.current.push({ id, method, params, resolve, reject });
      } else {
        pendingRpcs.current.set(id, { resolve, reject });
        if (ws.current && ws.current.readyState === 1) {
          const sid = liveIdRef.current;
          const p = sid && !params.session_id ? { ...params, session_id: sid } : params;
          ws.current.send(JSON.stringify({ method, params: p, id }));
        } else {
          pendingRpcs.current.delete(id);
          reject(new Error("WebSocket not connected"));
        }
      }
    });
  }, []);

  const pendingPromptRef = useRef<string | null>(null);
  // Set while a session.create is in flight; cleared when its reply lands.
  // Guards the auto-greet/first-message race that used to mint TWO sessions
  // (the prompt then landed in a session the UI had already abandoned —
  // symptom: stuck thinking pill, message gone after reload).
  const pendingCreateRef = useRef(false);
  // Set when a fresh-session send found the socket down; the connect handler
  // sends session.create on open so the queued prompt still flushes.
  const createOnOpenRef = useRef(false);

  const sendSessionCreate = useCallback(() => {
    if (pendingCreateRef.current || liveIdRef.current) return;
    if (!ws.current || ws.current.readyState !== 1) { createOnOpenRef.current = true; return; }
    pendingCreateRef.current = true;
    ws.current.send(JSON.stringify({ method: "session.create", params: { source: "webui" }, id: ownRpcId() }));
  }, []);

  const flushPendingPrompt = useCallback(async (sid: string) => {
    const queue = pendingPreTurnRpcs.current;
    pendingPreTurnRpcs.current = [];
    // Await all pending config.set/image.attach RPCs
    if (pendingPromptRef.current !== null) armWatchdog();
    const sent = queue.map(req => {
      if (ws.current && ws.current.readyState === 1) {
        const params = { ...req.params, session_id: sid };
        ws.current.send(JSON.stringify({ method: req.method, params, id: req.id }));
        return new Promise<void>((done) => {
          pendingRpcs.current.set(req.id, {
            resolve: (v: any) => { req.resolve(v); done(); },
            reject:  (e: any) => { req.reject(e);  done(); },
          });
        });
      }
      return Promise.resolve();
    });
    await Promise.allSettled(sent);

    const text = pendingPromptRef.current;
    if (text === null) return;
    pendingPromptRef.current = null;
    clearQueuedCap(); // prompt is on the wire — the queued cap no longer applies
    if (ws.current && ws.current.readyState === 1) {
      rpc("prompt.submit", { session_id: sid, text, surface: "webui" })
        .catch((err: any) => {
          setIsStreaming(false);
          onEventRef.current({
            type: "message.error",
            payload: { error: err?.message || err?.data?.message || String(err) },
          });
        });
    }
  }, [rpc, armWatchdog]);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/hx/ws`;

    let disposed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;

    // R4: transport liveness — reset on ANY incoming frame (proxy ticks every
    // 25s when healthy). 60s of total silence recycles the socket; the turn
    // keeps streaming server-side and R5 restores state after resume.
    let lastFrameAt = Date.now();
    const touchLiveness = () => { lastFrameAt = Date.now(); };
    const livenessTimer = window.setInterval(() => {
      if (transportSilent(lastFrameAt, Date.now())) {
        try { ws.current?.close(); } catch { /* already gone */ }
      }
    }, 5000);

    // Shared open-sequence: capabilities advertisement, stored-session resume, and
    // the queued-create flush. Bound as socket.onopen (a fresh WebSocket is
    // always CONNECTING) and invoked directly on the already-open reuse path.
    function onSocketOpen(s: WebSocket) {
      // Advertise that this client answers server→client requests (clarify cards,
      // approvals, …). Without it the gateway fails these fast instead of asking.
      s.send(JSON.stringify({ jsonrpc: "2.0", id: ownRpcId(), method: "client.capabilities", params: { server_requests: true } }));
      const sid = readStoredSid();
      if (sid) {
        const id = ownRpcId();
        pendingResumes.current.add(id);
        s.send(JSON.stringify({ method: "session.resume", params: { session_id: sid }, id }));
      }
      // A prompt was queued while the socket was down. With a stored session the
      // resume above will flush it; only a truly fresh session needs a create.
      if (createOnOpenRef.current && !sid) {
        createOnOpenRef.current = false;
        sendSessionCreate();
      }
    }

    // R3: auto-reconnect forever with backoff; immediate on online/visible.
    function scheduleReconnect() {
      if (disposed || reconnectTimer !== null) return;
      const delay = nextReconnectDelay(reconnectAttempt++);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function connect() {
      if (disposed) return;
      const existing = sharedSocket;
      if (existing && existing.readyState === 1) {
        attachHandlers(existing);
        ws.current = existing;
        reconnectAttempt = 0;
        onSocketOpen(existing);
        return;
      }
      if (existing && existing.readyState === 0) {
        // Adopt a socket still connecting (strict-mode remount / reconnect race).
        attachHandlers(existing);
        ws.current = existing;
        existing.onopen = () => { reconnectAttempt = 0; onSocketOpen(existing); };
        return;
      }
      const sock = new WebSocket(url);
      sharedSocket = sock;
      ws.current = sock;
      attachHandlers(sock);
      sock.onopen = () => { reconnectAttempt = 0; onSocketOpen(sock); };
    }

    function attachHandlers(s: WebSocket) {
      s.onmessage = onMessage;
      s.onclose = () => {
        // R3: invalidate the dead socket so the reuse path can't bind it, then
        // reconnect. No setIsStreaming(false) here — turn truth is the gateway's.
        if (ws.current === s) { ws.current = null; sharedSocket = null; }
        onEventRef.current({ type: "ws.closed", payload: {} });
        scheduleReconnect();
      };
    }

    function replayOpenRequests(result: any) {
      const reqs = result && result.open_requests;
      if (!Array.isArray(reqs)) return;
      for (const r of reqs) {
        if (!r || !r.id) continue;
        // Preserve the request kind (approval / clarify / …) so restored cards
        // render with their own UI instead of everything becoming approvals.
        onEventRef.current({ type: r.method || "approval", payload: { id: r.id, params: r.params || r } });
      }
    }

    // R5: honor turn truth on ANY resume/create reply. Locks the composer
    // mid-turn after reload or on another device, zero user action.
    function applyReplyTruth(result: any) {
      const v = applyTurnTruth(result && result.running, result && result.status);
      if (v === "streaming") { setIsStreaming(true); armWatchdog(); }
      else if (v === "idle" && isStreamingRef.current) {
        setIsStreaming(false);
        // Completion detected via resume (turn finished while disconnected or
        // on another device) — refresh history so the final reply renders.
        onEventRef.current({ type: "turn.settled", payload: {} });
      }
    }

    function onMessage(e: MessageEvent) {
      touchLiveness();
      let data;
      try { data = JSON.parse(e.data); } catch { return; }

      if (data.method === "approval" && data.id) {
        clearWatchdog();
        onEventRef.current({ type: "approval", payload: { id: data.id, params: data.params || {} } });
      }

      // Generic server→client request bridge (ids are minted "srq-<hex>" by the
      // gateway): today covers "clarify", tomorrow any new interactive kind.
      if (data.method && data.method !== "approval" && typeof data.id === "string" && data.id.startsWith("srq-")) {
        clearWatchdog();
        onEventRef.current({ type: data.method, payload: { id: data.id, params: data.params || {} } });
      }

      // R6: watchdog probe reply — gateway truth decides; never a false kill.
      if (data.id && probeIdRef.current === data.id) {
        probeIdRef.current = null;
        const failed = !!data.error;
        const running = data.result ? data.result.running : undefined;
        if (failed || running === undefined) {
          probeFailsRef.current++;
          // 3 silent strikes ≈ 6 min: say something instead of spinning forever.
          if (probeFailsRef.current >= 3) {
            probeFailsRef.current = 0;
            setIsStreaming(false);
            onEventRef.current({ type: "message.error", payload: { error: "Lost contact with Astra while it was working. The connection didn't recover in time — please try again." } });
            onEventRef.current({ type: "turn.settled", payload: {} });
            return;
          }
        } else {
          probeFailsRef.current = 0;
        }
        const act = watchdogAction(failed, running);
        if (act === "finalize") {
          if (isStreamingRef.current) {
            setIsStreaming(false);
            // Turn ended while we were disconnected/probing — tell the UI to
            // re-pull history so the completed reply renders without a reload.
            onEventRef.current({ type: "turn.settled", payload: {} });
          }
          // Idle-probe confirmed idle: nothing to finalize, stop probing until
          // the next turn (send/turn-event re-arms the watchdog).
        } else {
          // Probe caught a live turn the UI thought was finished → re-lock.
          if (!failed && running === true && !isStreamingRef.current) setIsStreaming(true);
          armWatchdog(); // stay OR wait — keep watching either way
        }
        return;
      }

      if (data.id && pendingRpcs.current.has(data.id)) {
        const p = pendingRpcs.current.get(data.id)!;
        pendingRpcs.current.delete(data.id);
        if (data.error) p.reject(data.error);
        else p.resolve(data.result);
        return;
      }

      if (data.id && pendingResumes.current.has(data.id)) {
        pendingResumes.current.delete(data.id);
        if (data.error) {
          writeStoredSid(null);
          setStoredSessionIdState(null);
          setLiveSessionId(null);
          if (isStreamingRef.current) setIsStreaming(false); // session gone → turn can't be live
          return;
        } else if (data.result && data.result.session_id) {
          liveIdRef.current = data.result.session_id;
          setLiveSessionId(data.result.session_id);
          applyReplyTruth(data.result);
          flushPendingPrompt(data.result.session_id);
          replayOpenRequests(data.result);
        }
      } else if (data.id && data.result && data.result.session_id && ownRpcIds.current.has(data.id)) {
        // Guarded by ownRpcIds: the proxy broadcasts every upstream frame to
        // every connected tab, so without this check a sibling tab's
        // session.create reply was adopted here and two tabs collapsed onto one
        // chat. Only a reply to an id THIS tab sent may retarget this tab.
        ownRpcIds.current.delete(data.id);
        liveIdRef.current = data.result.session_id;
        pendingCreateRef.current = false; // create/resume reply landed — allow future creates after a reset
        createOnOpenRef.current = false;
        setLiveSessionId(data.result.session_id);
        const stored = data.result.stored_session_id;
        if (stored) {
          writeStoredSid(stored);
          setStoredSessionIdState(stored);
        }
        applyReplyTruth(data.result);
        flushPendingPrompt(data.result.session_id);
        replayOpenRequests(data.result);
      }

      // Any {id, error} reply nobody is tracking — a fire-and-forget send whose
      // rejection would otherwise be dropped. One guard covers every present and
      // future raw send on this socket.
      if (data.id && data.error && !pendingRpcs.current.has(data.id) && ownRpcIds.current.has(data.id)) {
        ownRpcIds.current.delete(data.id);
        // A raw fire-and-forget send (session.create, session.interrupt) failed.
        // Clear the create latch too or every later New chat silently no-ops (H3).
        pendingCreateRef.current = false;
        pendingPromptRef.current = null;
        setIsStreaming(false);
        onEventRef.current({ type: "message.error", payload: { error: data.error?.message || JSON.stringify(data.error) } });
        return;
      }

      if (data.method === "event" && data.params) {
        const { type, payload, session_id } = data.params;

        // Completion/failure finalize BEFORE the session filter below (so a
        // completion never gets silently dropped and strands the composer on
        // "Astra is replying…"). Ownership is STRICT: an event with a session_id
        // only belongs to the live turn if it equals liveIdRef.current exactly.
        // A null liveIdRef (just reset, new session not created yet) must NEVER
        // vacuously match a foreign session_id — that hole let an abandoned
        // chat's stray completion/deltas render into a fresh "New chat" (H4/H9).
        if (type === "message.complete" || type === "message.error") {
          const belongsToLive = session_id === liveIdRef.current;
          if (belongsToLive) {
            clearWatchdog();
            setIsStreaming(false);
          }
          if (type === "message.error") {
            if (belongsToLive) {
              onEventRef.current({ type, payload, session_id });
            }
            return;
          }
        }

        if (type === "proxy.status") {
          // R7: "reconnecting" no longer drops isStreaming — a blip must not
          // unlock the composer mid-turn; R5 restores truth after resume.
          // ("tick" frames are plain liveness; chat-landing maps states to the banner.)
          if (payload.state === "online") {
            // This fresh upstream transport may never have seen our
            // capabilities (its connect raced our socket open). Re-advertise
            // BEFORE resuming or the gateway fast-fails every clarify/approval
            // with "the attached client predates server→client requests".
            if (ws.current?.readyState === 1) {
              ws.current.send(JSON.stringify({ jsonrpc: "2.0", id: ownRpcId(), method: "client.capabilities", params: { server_requests: true } }));
            }
            const sid = readStoredSid();
            if (sid && ws.current?.readyState === 1) {
              const id = ownRpcId();
              pendingResumes.current.add(id);
              ws.current.send(JSON.stringify({ method: "session.resume", params: { session_id: sid }, id }));
            }
          }
          onEventRef.current({ type, payload });
          return;
        }

        // STRICT filter: any remaining event with a session_id must match the
        // live session exactly — no vacuous pass when liveIdRef is null (see
        // the completion/error block above for why that hole mattered).
        if (session_id && session_id !== liveIdRef.current) return;

        if (type === "session.info") {
          setSessionInfo(payload);
          sessionInfoRef.current = payload;
          lastSessionInfo = payload;
        }

        // Re-arm the probe watchdog on turn traffic (rolling silence probe)
        if (type === "message.start" || type === "message.delta" || type === "thinking.delta" || type === "reasoning.delta" || type === "tool.start") {
          armWatchdog();
          probeFailsRef.current = 0; // real turn traffic — any earlier probe failures don't count
        }

        if (type === "message.start") setIsStreaming(true);
        if (type === "message.complete" || type === "message.error") {
          clearWatchdog();
          setIsStreaming(false);
        }

        onEventRef.current({ type, payload, session_id });
      }
    }

    connect();

    // R3: mobile unlock / network return → immediate reconnect attempt.
    const tryImmediateReconnect = () => {
      if (disposed) return;
      if (ws.current && (ws.current.readyState === 0 || ws.current.readyState === 1)) return;
      if (reconnectTimer !== null) { window.clearTimeout(reconnectTimer); reconnectTimer = null; }
      connect();
    };
    const onVisible = () => { if (document.visibilityState === "visible") tryImmediateReconnect(); };
    window.addEventListener("online", tryImmediateReconnect);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      window.clearInterval(livenessTimer);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      window.removeEventListener("online", tryImmediateReconnect);
      document.removeEventListener("visibilitychange", onVisible);
      ws.current = null;
    };
  }, [setLiveSessionId, flushPendingPrompt, clearWatchdog, armWatchdog, sendSessionCreate]);

  const submitPrompt = useCallback((content: string) => {
    if (!ws.current || ws.current.readyState !== 1) {
      // Socket still connecting (or briefly down). Queue the prompt and let the
      // connect handler create/resume + flush it. NEVER silently drop — the
      // optimistic UI already shows the user's message + thinking pill.
      pendingPromptRef.current = content;
      createOnOpenRef.current = true;
      armQueuedCap(); // bounded wait: 5 min, then a visible failure
      setIsStreaming(true);
      return;
    }
    setIsStreaming(true);
    // Arm in BOTH branches: the fresh-session path used to arm only inside
    // flushPendingPrompt (after the create reply), leaving a window with no
    // timeout — a lost create reply disabled the composer forever (H2).
    armWatchdog();
    if (!liveIdRef.current && !storedSessionId) {
      // Fresh session: create first; flushPendingPrompt sends the prompt when
      // the create reply lands. One create per fresh session — no double mint.
      pendingPromptRef.current = content;
      sendSessionCreate();
    } else {
      armWatchdog();
      rpc("prompt.submit", { session_id: liveIdRef.current || storedSessionId, text: content, surface: "webui" })
        .catch((err: any) => {
          setIsStreaming(false);
          onEventRef.current({
            type: "message.error",
            payload: { error: err?.message || err?.data?.message || String(err) },
          });
        });
    }
  }, [storedSessionId, liveSessionId, rpc, armWatchdog, sendSessionCreate]);

  const sendApprovalResponse = useCallback((id: string, choice: string) => {
    if (!ws.current || ws.current.readyState !== 1) return false;
    ws.current.send(JSON.stringify({ jsonrpc: "2.0", id, result: { choice } }));
    return true;
  }, []);

  // Generic answer to any server→client request (clarify: {answer} | {answers}).
  const sendServerResponse = useCallback((id: string, result: Record<string, unknown>) => {
    if (!ws.current || ws.current.readyState !== 1) return false;
    ws.current.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
    return true;
  }, []);

  const interrupt = useCallback(() => {
    clearWatchdog();
    if (!ws.current || ws.current.readyState !== 1) return;
    if (liveSessionId || storedSessionId) {
      ws.current.send(JSON.stringify({
        method: "session.interrupt",
        params: { session_id: liveSessionId || storedSessionId },
        id: ownRpcId()
      }));
    }
    setIsStreaming(false);
  }, [liveSessionId, storedSessionId, clearWatchdog]);

  const resetSession = useCallback(() => {
    // Do NOT interrupt the old session's turn: New Chat must never stop work
    // still running in a chat the user is leaving (it also poisoned the old
    // chat's own transcript with "Operation interrupted…" — a real bug, not a
    // desired behavior). The old turn keeps streaming server-side exactly as
    // it would if the user just navigated away; they can reopen that chat and
    // see the finished reply. Clearing liveIdRef to null is now SAFE because
    // the strict session_id filter (session_id !== liveIdRef.current) drops
    // every stray frame from the abandoned session — nothing bleeds into the
    // fresh chat without an interrupt.
    clearWatchdog();
    setIsStreaming(false);
    liveIdRef.current = null; setLiveSessionId(null);
    setStoredSessionId(null); setSessionInfo(null);
    pendingPreTurnRpcs.current = []; pendingPromptRef.current = null;
    pendingCreateRef.current = false; createOnOpenRef.current = false;
    probeFailsRef.current = 0;
    clearQueuedCap();
  }, [setStoredSessionId, setLiveSessionId, setSessionInfo, clearWatchdog, clearQueuedCap]);

  return { isStreaming, submitPrompt, interrupt, storedSessionId, setStoredSessionId, liveSessionId, sendApprovalResponse, sendServerResponse, rpc, sessionInfo, setSessionInfo, resetSession };
}
