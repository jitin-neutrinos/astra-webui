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

// ponytail: fixed ceiling, sized for high reasoning effort (ultra turns legitimately
// run minutes of silent reasoning). Make it per-model only if a real turn trips it.
const TURN_WATCHDOG_MS = 120_000;

// Export last session info globally (safe since there's one session at a time)
export let lastSessionInfo: SessionInfo | null = null;
export function getLastSessionInfo() { return lastSessionInfo; }

let sharedSocket: WebSocket | null = null;

export function useHermesWS(onEvent: (ev: EventPayload) => void) {
  const ws = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  const [isStreaming, setIsStreaming] = useState(false);
  const [storedSessionId, setStoredSessionIdState] = useState<string | null>(
    typeof sessionStorage !== "undefined" ? sessionStorage.getItem("astra-chat-session") : null
  );

  const [liveSessionId, setLiveSessionIdState] = useState<string | null>(null);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const liveIdRef = useRef<string | null>(null);
  const sessionInfoRef = useRef<SessionInfo | null>(null);

  const setLiveSessionId = useCallback((sid: string | null) => {
    setLiveSessionIdState(sid);
    liveIdRef.current = sid;
  }, []);

  const setStoredSessionId = useCallback((sid: string | null) => {
    if (sid) sessionStorage.setItem("astra-chat-session", sid);
    else sessionStorage.removeItem("astra-chat-session");
    setStoredSessionIdState(sid);
  }, []);

  const pendingResumes = useRef<Set<string>>(new Set());
  const pendingRpcs = useRef<Map<string, { resolve: (val: any) => void, reject: (err: any) => void }>>(new Map());
  const pendingPreTurnRpcs = useRef<{id: string, method: string, params: any, resolve: any, reject: any}[]>([]);

  const watchdogRef = useRef<number | null>(null);
  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) { window.clearTimeout(watchdogRef.current); watchdogRef.current = null; }
  }, []);
  const armWatchdog = useCallback(() => {
    clearWatchdog();
    watchdogRef.current = window.setTimeout(() => {
      watchdogRef.current = null;
      setIsStreaming(false);
      onEventRef.current({ type: "message.error", payload: { error: "No response from the agent (timed out after 120s)." } });
    }, TURN_WATCHDOG_MS);
  }, [clearWatchdog]);

  const rpc = useCallback((method: string, params: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      const id = generateRpcId();
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

    let socket: WebSocket;
    if (sharedSocket && sharedSocket.readyState === 1) {
      socket = sharedSocket;
      if (socket.readyState === 1) {
        attachHandlers(socket);
        ws.current = socket;
        if (sessionStorage.getItem("astra-chat-session") && liveIdRef.current) {}
        return () => { ws.current = null; };
      }
    }
    socket = new WebSocket(url);
    sharedSocket = socket;
    ws.current = socket;
    attachHandlers(socket);

    function attachHandlers(s: WebSocket) {
      s.onmessage = onMessage;
      s.onclose = () => {
        clearWatchdog();
        setIsStreaming(false);
        onEventRef.current({ type: "ws.closed", payload: {} });
      };
    }

    function replayOpenRequests(result: any) {
      const reqs = result && result.open_requests;
      if (!Array.isArray(reqs)) return;
      for (const r of reqs) {
        if (!r || !r.id) continue;
        onEventRef.current({ type: "approval", payload: { id: r.id, params: r.params || r } });
      }
    }

    function onMessage(e: MessageEvent) {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }

      if (data.method === "approval" && data.id) {
        clearWatchdog();
        onEventRef.current({ type: "approval", payload: { id: data.id, params: data.params || {} } });
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
          setStoredSessionIdState(null);
          sessionStorage.removeItem("astra-chat-session");
          setLiveSessionId(null);
          return;
        } else if (data.result && data.result.session_id) {
          liveIdRef.current = data.result.session_id;
          setLiveSessionId(data.result.session_id);
          flushPendingPrompt(data.result.session_id);
          replayOpenRequests(data.result);
        }
      } else if (data.id && data.result && data.result.session_id) {
        liveIdRef.current = data.result.session_id;
        setLiveSessionId(data.result.session_id);
        const stored = data.result.stored_session_id;
        if (stored) {
          sessionStorage.setItem("astra-chat-session", stored);
          setStoredSessionIdState(stored);
        }
        flushPendingPrompt(data.result.session_id);
        replayOpenRequests(data.result);
      }

      // Any {id, error} reply nobody is tracking — a fire-and-forget send whose
      // rejection would otherwise be dropped. One guard covers every present and
      // future raw send on this socket.
      if (data.id && data.error && !pendingRpcs.current.has(data.id)) {
        setIsStreaming(false);
        onEventRef.current({ type: "message.error", payload: { error: data.error?.message || JSON.stringify(data.error) } });
        return;
      }

      if (data.method === "event" && data.params) {
        const { type, payload, session_id } = data.params;
        
        if (type === "proxy.status") {
          if (payload.state === "reconnecting") {
            setIsStreaming(false);
          } else if (payload.state === "online") {
            const sid = sessionStorage.getItem("astra-chat-session");
            if (sid && ws.current?.readyState === 1) {
              const id = generateRpcId();
              pendingResumes.current.add(id);
              ws.current.send(JSON.stringify({ method: "session.resume", params: { session_id: sid }, id }));
            }
          }
          onEventRef.current({ type, payload });
          return;
        }

        if (liveIdRef.current && session_id && liveIdRef.current !== session_id) return;

        if (type === "session.info") {
          setSessionInfo(payload);
          sessionInfoRef.current = payload;
          lastSessionInfo = payload;
        }

        // Clear watchdog on first sign of life
        if (type === "message.start" || type === "message.delta" || type === "thinking.delta" || type === "reasoning.delta" || type === "tool.start") {
          clearWatchdog();
        }

        if (type === "message.start") setIsStreaming(true);
        // Clear watchdog again on completion/error
        if (type === "message.complete" || type === "message.error") {
          clearWatchdog();
          setIsStreaming(false);
        }

        onEventRef.current({ type, payload, session_id });
      }
    }

    if (socket.readyState === 1) {
      const sid = sessionStorage.getItem("astra-chat-session");
      if (sid) {
        const id = generateRpcId();
        pendingResumes.current.add(id);
        socket.send(JSON.stringify({ method: "session.resume", params: { session_id: sid }, id }));
      }
    }

    return () => { ws.current = null; };
  }, [setStoredSessionId, setLiveSessionId, flushPendingPrompt, clearWatchdog]);

  const submitPrompt = useCallback((content: string) => {
    if (!ws.current || ws.current.readyState !== 1) return;
    setIsStreaming(true);
    if (!storedSessionId) {
      pendingPromptRef.current = content;
      ws.current.send(JSON.stringify({ method: "session.create", params: { source: "webui" }, id: generateRpcId() }));
    } else {
      armWatchdog();
      rpc("prompt.submit", { session_id: liveSessionId || storedSessionId, text: content, surface: "webui" })
        .catch((err: any) => {
          setIsStreaming(false);
          onEventRef.current({
            type: "message.error",
            payload: { error: err?.message || err?.data?.message || String(err) },
          });
        });
    }
  }, [storedSessionId, liveSessionId, rpc, armWatchdog]);

  const sendApprovalResponse = useCallback((id: string, choice: string) => {
    if (!ws.current || ws.current.readyState !== 1) return;
    ws.current.send(JSON.stringify({ jsonrpc: "2.0", id, result: { choice } }));
  }, []);

  const interrupt = useCallback(() => {
    clearWatchdog();
    if (!ws.current || ws.current.readyState !== 1) return;
    if (liveSessionId || storedSessionId) {
      ws.current.send(JSON.stringify({
        method: "session.interrupt",
        params: { session_id: liveSessionId || storedSessionId },
        id: generateRpcId()
      }));
    }
    setIsStreaming(false);
  }, [liveSessionId, storedSessionId, clearWatchdog]);

  const resetSession = useCallback(() => {
    clearWatchdog();
    liveIdRef.current = null; setLiveSessionId(null);
    setStoredSessionId(null); setSessionInfo(null);
    pendingPreTurnRpcs.current = []; pendingPromptRef.current = null;
  }, [setStoredSessionId, setLiveSessionId, clearWatchdog]);

  return { isStreaming, submitPrompt, interrupt, storedSessionId, setStoredSessionId, liveSessionId, sendApprovalResponse, rpc, sessionInfo, setSessionInfo, resetSession };
}
