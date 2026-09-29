import { useEffect, useRef, useState, useCallback } from "react";
import { nextConnState, RESTORED_MS, type ConnEvent, type ConnState } from "./connection-state";

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
  // Wall-clock of the next scheduled reconnect (null = none pending) — powers
  // the offline banner's countdown. Ref, not state: the banner polls it.
  const nextRetryAtRef = useRef<number | null>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [conn, setConn] = useState<ConnState>("online");
  const connRef = useRef<ConnState>("online");
  const bumpConn = useCallback((ev: ConnEvent) => {
    setConn((prev) => {
      const next = nextConnState(prev, ev);
      if (next !== prev) connRef.current = next;
      return next;
    });
  }, []);
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
      bumpConn({ type: "ws-open" });
      nextRetryAtRef.current = null;
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
    // nextRetryAtRef feeds the banner's countdown (read on the render tick).
    function scheduleReconnect() {
      if (disposed || reconnectTimer !== null) return;
      const delay = nextReconnectDelay(reconnectAttempt++);
      nextRetryAtRef.current = Date.now() + delay;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        nextRetryAtRef.current = null; // dial in flight — countdown stops at 0
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
        bumpConn({ type: "ws-closed" });
        onEventRef.current({ type: "ws.closed", payload: {} });
        scheduleReconnect();
      };
    }

    function replayOpenRequests(result: any) {
      const reqs = result && result.open_requests;
      if (!Array.isArray(reqs)) return;
      for (const r of reqs) {
        if (!r || !r.id) continue;
        // Strict session ownership on replay too: `open_requests` from a resume
        // reply lists the session's own pending cards (gateway already scopes
        // them to the resumed sid), but keep the exact-match guard so a future
        // gateway change can never leak a foreign card back in.
        if (!requestBelongsToLive(r.params, liveIdRef.current)) continue;
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
        // Strict session ownership: a request minted for ANOTHER chat's turn
        // must not render here (the proxy broadcasts to every tab). The live
        // session gets the card; everyone else stays untouched.
        if (!requestBelongsToLive(data.params, liveIdRef.current)) return;
        clearWatchdog();
        onEventRef.current({ type: "approval", payload: { id: data.id, params: data.params || {} } });
      }

      // Generic server→client request bridge (ids are minted "srq-<hex>" by the
      // gateway): today covers "clarify", tomorrow any new interactive kind.
      if (data.method && data.method !== "approval" && typeof data.id === "string" && data.id.startsWith("srq-")) {
        // Same strict ownership as approvals — clarify/gate cards belong to
        // the chat whose turn asked them, not whichever chat is on screen.
        if (!requestBelongsToLive(data.params, liveIdRef.current)) return;
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
          // Only a genuinely dead session may clear the tab's identity. A
          // gateway restart (or any transport hiccup) rejects resume with
          // "session not found / not owned by this transport" even when the
          // session is alive and persisted — wiping here destroyed the open
          // chat (URL rewritten to /, messages cleared) on every reload that
          // raced a gateway recycle. Instead: keep the URL + stored id, drop
          // the in-flight create latch, and re-create the session binding;
          // history re-pull restores the transcript.
          const msg = String(data.error?.message || data.error || "");
          const transient = /not owned|transport|unavailable|busy|5000|4001/i.test(msg);
          if (!transient) {
            writeStoredSid(null);
            setStoredSessionIdState(null);
            setLiveSessionId(null);
            if (isStreamingRef.current) setIsStreaming(false); // session gone → turn can't be live
          }
          // Transient: touch nothing. URL + stored id keep pointing at the chat,
          // loadHistory (HTTP) still restores the transcript, and the next
          // reconnect/proxy.status re-issues session.resume.
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
        let { type, payload, session_id } = data.params;

        // Completion/failure finalize BEFORE the session filter below (so a
        // completion never gets silently dropped and strands the composer on
        // "Astra is replying…"). Ownership is STRICT: an event with a session_id
        // only belongs to the live turn if it equals liveIdRef.current exactly.
        // A null liveIdRef (just reset, new session not created yet) must NEVER
        // vacuously match a foreign session_id — that hole let an abandoned
        // chat's stray completion/deltas render into a fresh "New chat" (H4/H9).
        if (type === "message.complete" || type === "message.error") {
          // A FAILED turn rides message.complete with payload.status === "error"
          // (prompt_turn.py: `payload = {"text": raw, ..., "status": status}`).
          // Treating it as a success left the composer locked on "Astra is
          // replying" forever, because the failure text still rendered but no
          // message.error ever arrived. Normalize it so every consumer sees the
          // error shape.
          if (type === "message.complete" && payload && payload.status === "error") {
            type = "message.error";
            if (!payload.error) payload.error = { message: payload.text || "The agent turn failed." };
          }
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
          if (payload.state === "reconnecting") bumpConn({ type: "proxy-reconnecting" });
          else if (payload.state === "online") bumpConn({ type: "proxy-online" });
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
  }, [setLiveSessionId, flushPendingPrompt, clearWatchdog, armWatchdog, sendSessionCreate, bumpConn]);

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
    // Mid-turn submit while the session is live: queue, never refuse or
    // interrupt (Claude-Code-style). The gateway's busy path holds the text as
    // a run-after envelope; plain sends pass queued:true to pin that mode.
    const midTurn = isStreamingRef.current && liveIdRef.current;
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
      rpc("prompt.submit", { session_id: liveIdRef.current || storedSessionId, text: content, surface: "webui", ...(midTurn ? { queued: true } : {}) })
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

  // /bg <text> — explicit run-after: identical to a mid-turn queue but works
  // even when the turn looks idle from the client (server may still be finishing).
  // Gateway contract: queued:true forces the queue path, never steer/interrupt.
  const submitBg = useCallback((content: string) => {
    const sid = liveIdRef.current || readStoredSid();
    if (!sid) { onEventRef.current({ type: "message.error", payload: { error: "No session yet — send a message first." } }); return Promise.resolve(false); }
    return rpc("prompt.submit", { session_id: sid, text: content, surface: "webui", queued: true })
      .then(() => true)
      .catch((err: any) => {
        onEventRef.current({ type: "message.error", payload: { error: err?.message || err?.data?.message || String(err) } });
        return false;
      });
  }, [rpc]);

  // /steer <text> — live course-correction. The gateway's busy path reads the
  // GLOBAL display.busy_input_mode, so: set steer → submit → restore previous.
  // config.set busy → _write_config_key(display.busy_input_mode) takes effect
  // on the very next submit (config is mtime-cached, re-read per call).
  const steerBusyLock = useRef(false);
  const submitSteer = useCallback(async (content: string) => {
    const sid = liveIdRef.current || readStoredSid();
    if (!sid) { onEventRef.current({ type: "message.error", payload: { error: "No session yet — send a message first." } }); return false; }
    if (!ws.current || ws.current.readyState !== 1) {
      onEventRef.current({ type: "message.error", payload: { error: "Can't steer while offline — retry when connected." } });
      return false;
    }
    if (steerBusyLock.current) return false; // a steer bridge is already in flight
    steerBusyLock.current = true;
    try {
      const prev = await rpc("config.get", { key: "busy" }).then((r: any) => (typeof r?.value === "string" ? r.value : "interrupt")).catch(() => "interrupt");
      if (prev !== "steer") await rpc("config.set", { key: "busy", value: "steer" }).catch(() => {});
      try {
        await rpc("prompt.submit", { session_id: sid, text: content, surface: "webui" });
        return true;
      } finally {
        if (prev !== "steer") await rpc("config.set", { key: "busy", value: prev }).catch(() => {});
      }
    } catch (err: any) {
      onEventRef.current({ type: "message.error", payload: { error: err?.message || err?.data?.message || String(err) } });
      return false;
    } finally {
      steerBusyLock.current = false;
    }
  }, [rpc]);

  // Banner Retry: tear the socket down and dial fresh. Success (open + any
  // frame) flips the banner to "Connected" via bumpConn; failure schedules the
  // normal backoff reconnect loop, so Retry is always safe to press.
  const retryConnection = useCallback(() => {
    bumpConn({ type: "retry-begin" });
    const dead = !ws.current || ws.current.readyState > 1;
    if (dead) {
      sharedSocket = null;
      // The reconnect effect owns dialing; force it by closing whatever remains.
      try { ws.current?.close(); } catch { /* noop */ }
      // If nothing was left to close (already null), the effect's liveness
      // timer or online/visible listener dials next; poke visibility as a belt.
      if (!ws.current) {
        window.dispatchEvent(new Event("online"));
      }
    } else {
      // Socket alive: the offline signal came from the upstream proxy leg —
      // nothing the browser can dial; confirm via a cheap RPC round-trip.
      rpc("config.get", { key: "mtime" })
        .then(() => bumpConn({ type: "retry-ok" }))
        .catch(() => {
          bumpConn({ type: "retry-fail" });
          try { ws.current?.close(); } catch { /* noop */ }
        });
    }
  }, [bumpConn, rpc]);

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

  // Milliseconds until the next scheduled reconnect (0 when a dial is live or
  // none is pending) — the offline banner's countdown source.
  const nextRetryIn = useCallback(() => {
    const at = nextRetryAtRef.current;
    return at === null ? 0 : Math.max(0, at - Date.now());
  }, []);

  // Restored → online: the banner starts its slide-out at RESTORED_MS; flip the
  // state right after so the element unmounts as the animation finishes.
  useEffect(() => {
    if (conn !== "restored") return;
    const t = window.setTimeout(() => bumpConn({ type: "restored-timeout" }), RESTORED_MS + 220);
    return () => window.clearTimeout(t);
  }, [conn, bumpConn]);

  return { isStreaming, submitPrompt, submitBg, submitSteer, retryConnection, conn, nextRetryIn, interrupt, storedSessionId, setStoredSessionId, liveSessionId, sendApprovalResponse, sendServerResponse, rpc, sessionInfo, setSessionInfo, resetSession };
}
