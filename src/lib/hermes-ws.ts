import { useEffect, useRef, useState, useCallback } from "react";

export type EventPayload = {
  type: string;
  payload: any;
  session_id?: string;
};

let sharedSocket: WebSocket | null = null;

export function useHermesWS(onEvent: (ev: EventPayload) => void) {
  const ws = useRef<WebSocket | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  
  const [storedSessionId, setStoredSessionIdState] = useState<string | null>(() => {
    return sessionStorage.getItem("astra-chat-session");
  });

  const generateRpcId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const setStoredSessionId = useCallback((id: string | null) => {
    if (id) sessionStorage.setItem("astra-chat-session", id);
    else sessionStorage.removeItem("astra-chat-session");
    setStoredSessionIdState(id);
    liveIdRef.current = null;
    setLiveSessionId(null);
    setIsStreaming(false);
  }, []);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // Track pending RPCs to handle resume failures
  const pendingResumes = useRef<Set<string>>(new Set());
  const liveIdRef = useRef<string | null>(null);
  const pendingPromptRef = useRef<string | null>(null);
  const flushPendingPrompt = useCallback((sid: string) => {
    const text = pendingPromptRef.current;
    if (text === null) return;
    pendingPromptRef.current = null;
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        method: "prompt.submit",
        params: { session_id: sid, text, surface: "webui" },
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }));
    }
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/hx/ws`;

    // Reuse a live socket across React remounts (view swaps); the browser tab
    // keeps exactly ONE proxy socket for its lifetime. ponytail: never closes
    // on unmount — closing would drop the shared upstream session mid-turn.
    let socket: WebSocket;
    if (sharedSocket && sharedSocket.readyState === WebSocket.OPEN) {
      socket = sharedSocket;
      if (socket.readyState === WebSocket.OPEN) {
        // re-attach handlers on the shared socket
        attachHandlers(socket);
        ws.current = socket;
        if (sessionStorage.getItem("astra-chat-session") && liveIdRef.current) {
          // already attached upstream; nothing to do
        }
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
        setIsStreaming(false);
        // Interrupted/dropped turns never emit message.complete — the consumer
        // must finalize any open segments itself on this signal.
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

      // Server->client JSON-RPC request (not wrapped in {method:"event"}):
      // approval prompts. Respond on the same socket via sendApprovalResponse.
      if (data.method === "approval" && data.id) {
        onEventRef.current({ type: "approval", payload: { id: data.id, params: data.params || {} } });
      }

      if (data.id && pendingResumes.current.has(data.id)) {
        pendingResumes.current.delete(data.id);
        if (data.error) {
          // session.resume failure -> clear session
          setStoredSessionIdState(null);
          sessionStorage.removeItem("astra-chat-session");
          setLiveSessionId(null);
        } else if (data.result && data.result.session_id) {
          liveIdRef.current = data.result.session_id;
          setLiveSessionId(data.result.session_id);
          flushPendingPrompt(data.result.session_id);
          replayOpenRequests(data.result);
        }
      } else if (data.id && data.result && data.result.session_id) {
        // session.create success: adopt live handle, then flush the queued first prompt
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

      if (data.method === "event" && data.params) {
        const { type, payload, session_id } = data.params;
        
        if (type === "proxy.status") {
          if (payload.state === "reconnecting") {
            setIsStreaming(false);
          } else if (payload.state === "online") {
            const sid = sessionStorage.getItem("astra-chat-session");
            if (sid && ws.current?.readyState === WebSocket.OPEN) {
              const id = generateRpcId();
              pendingResumes.current.add(id);
              ws.current.send(JSON.stringify({ method: "session.resume", params: { session_id: sid }, id }));
            }
          }
          onEventRef.current({ type, payload });
          return;
        }

        // two-tab guard: ignore events for other sessions (live ids differ per tab)
        if (liveIdRef.current && session_id && liveIdRef.current !== session_id) return;

        if (type === "message.start") setIsStreaming(true);
        if (type === "message.complete" || type === "message.error") setIsStreaming(false);

        onEventRef.current({ type, payload, session_id });
      }
    }

    // resume the stored session whenever this component mounts with a fresh socket
    if (socket.readyState === WebSocket.OPEN) {
      const sid = sessionStorage.getItem("astra-chat-session");
      if (sid) {
        const id = generateRpcId();
        pendingResumes.current.add(id);
        socket.send(JSON.stringify({ method: "session.resume", params: { session_id: sid }, id }));
      }
    }

    return () => { ws.current = null; };
  }, [setStoredSessionId]);

  const submitPrompt = useCallback((content: string) => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    setIsStreaming(true);
    if (!storedSessionId) {
      // session.create accepts NO prompt (extra=forbid); the turn starts via
      // prompt.submit once the create reply yields the live id (pendingPromptRef).
      pendingPromptRef.current = content;
      ws.current.send(JSON.stringify({ method: "session.create", params: { source: "webui" }, id: generateRpcId() }));
    } else {
      ws.current.send(JSON.stringify({
        method: "prompt.submit",
        params: { session_id: liveSessionId || storedSessionId, text: content, surface: "webui" },
        id: generateRpcId()
      }));
    }
  }, [storedSessionId, liveSessionId]);

  const sendApprovalResponse = useCallback((id: string, choice: string) => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    ws.current.send(JSON.stringify({ jsonrpc: "2.0", id, result: { choice } }));
  }, []);

  const interrupt = useCallback(() => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    if (liveSessionId || storedSessionId) {
      ws.current.send(JSON.stringify({
        method: "session.interrupt",
        params: { session_id: liveSessionId || storedSessionId },
        id: generateRpcId()
      }));
    }
    setIsStreaming(false);
  }, [liveSessionId, storedSessionId]);

  return { isStreaming, submitPrompt, interrupt, storedSessionId, setStoredSessionId, liveSessionId, sendApprovalResponse };
}
