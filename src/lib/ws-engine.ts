// ws-engine.ts — module-singleton WebSocket engine. ONE per app, lives OUTSIDE
// React so nothing a component does (mount, unmount, StrictMode double-invoke,
// Android freezing the WebView) can tear the reconnect brain down.
//
// Ownership map (what moved here from the old hook):
//   • the socket + reconnect backoff loop (R3)
//   • liveness: 60s of total silence recycles the wire (R4)
//   • watchdog probe: 45s of turn silence asks the gateway for truth (R6)
//   • resume on open + on proxy-online; capabilities re-advertise
//   • the durable queue: prompts typed offline are flushed on reconnect
//   • Android resume repair hook (astra:ws-poke → recycle-if-silent)
//
// React reads state from ws-store (zustand) and forwards frames via the
// listener list. Exactly one onEvent listener per mounted ChatLanding.

import {
  nextReconnectDelay, transportSilent, requestBelongsToLive,
  applyTurnTruth, watchdogAction, mergeSessionInfo,
  type EventPayload,
} from "./ws-helpers";
import {
  useWsStore, wsGet, wsSet, wsQueuePush, wsQueueAll, wsQueueSet,
} from "./ws-store";
import { pushLiveSession } from "./native-session-bridge";
import type { ConnEvent } from "./connection-state";
import { Capacitor } from "@capacitor/core";
import * as notify from "./notify";
import { setPresenceFocus as _setPresenceFocus, startTabSync, startServerSync } from "./read-sync";

const APP_SOURCE = Capacitor.isNativePlatform() ? "android" : "webui";

type Listener = (ev: EventPayload) => void;

const generateRpcId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const TURN_WATCHDOG_MS = 45_000;

type Engine = {
  socket: WebSocket | null;
  disposed: boolean;
  started: boolean;

  listeners: Set<Listener>;

  // reconnect
  reconnectAttempt: number;
  reconnectTimer: number | null;
  livenessTimer: number | null;
  countdownTimer: number | null;
  lastFrameAt: number;

  // rpc bookkeeping
  ownRpcIds: Set<string>;
  pendingRpcs: Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>;
  pendingResumes: Set<string>;
  /** resume rpc id -> stored session key it was sent for */
  resumeKeys: Map<string, string>;
  /** stored key the current liveSessionId is bound to (null = unbound) */
  liveKey: string | null;
  pendingPreTurnRpcs: { id: string; method: string; params: any; resolve: any; reject: any }[];

  // create/prompt latches
  pendingCreate: boolean;
  createOnOpen: boolean;
  probeId: string | null;
  probeFails: number;
  queuedRepairs: number;

  watchdogTimer: number | null;
  queuedCapTimer: number | null;

  // turn truth mirror (avoid reading store inside hot paths)
  turnRunning: boolean;
};

const eng: Engine = {
  socket: null,
  disposed: false,
  started: false,
  listeners: new Set(),
  reconnectAttempt: 0,
  reconnectTimer: null,
  livenessTimer: null,
  countdownTimer: null,
  lastFrameAt: Date.now(),
  ownRpcIds: new Set(),
  pendingRpcs: new Map(),
  pendingResumes: new Set(),
  resumeKeys: new Map(),
  liveKey: null,
  pendingPreTurnRpcs: [],
  pendingCreate: false,
  createOnOpen: false,
  probeId: null,
  probeFails: 0,
  queuedRepairs: 0,
  watchdogTimer: null,
  queuedCapTimer: null,
  turnRunning: false,
};

// ---- session identity (URL wins, then sessionStorage — per-tab by design) ----

function sidFromPath(): string | null {
  const m = location.pathname.match(/^\/c\/([A-Za-z0-9_-]+)$/);
  return m ? m[1] : null;
}

function readStoredSid(): string | null {
  try {
    const fromUrl = sidFromPath();
    if (fromUrl) {
      sessionStorage.setItem("astra-chat-session", fromUrl);
      if (wsGet().storedSessionId !== fromUrl) wsGet().setStoredSessionId(fromUrl);
      return fromUrl;
    }
    const stored = sessionStorage.getItem("astra-chat-session");
    // Sync the store on BOTH branches — chat-landing keys per-chat persistence
    // and send decisions off storedSessionId; leaving it null while the engine
    // resumes from sessionStorage would split the two views of the same fact.
    if (stored && wsGet().storedSessionId !== stored) wsGet().setStoredSessionId(stored);
    return stored;
  } catch { return null; }
}

// One place that sends a stored-key resume and remembers which key it was for.
function sendResume(s: WebSocket, key: string) {
  const id = ownRpcId();
  eng.pendingResumes.add(id);
  eng.resumeKeys.set(id, key);
  s.send(JSON.stringify({ method: "session.resume", params: { session_id: key }, id }));
}

// Sidebar / URL switch to a different stored chat: the old live session id must
// NOT stay bound (prompts, config.set and the selector popup all key off it -
// the popup would show and edit the PREVIOUS chat's model/yolo/effort). Rebind
// by resuming the newly selected chat. Never interrupts the old turn (isolation
// is the event filter's job).
function rebindToStored(key: string) {
  const s = eng.socket;
  if (!s || s.readyState !== 1) return; // onSocketOpen resumes the stored key
  if (key === eng.liveKey) return;
  for (const k of eng.resumeKeys.values()) if (k === key) return; // already in flight
  eng.liveKey = null;
  wsSet({ liveSessionId: null, sessionInfo: null, sessionInfoSid: null });
  notify.setActiveSession(key);
  sendResume(s, key);
}

// Single funnel for model/provider/effort/yolo truth. Fed by session.info events AND
// every reply that carries `info` (create, resume, watchdog probe, bg poll) — a reload
// onto a live session emits no session.info, so the resume reply is the only source.
function applySessionInfo(sid: string | null | undefined, incoming: any) {
  if (!sid || !incoming || typeof incoming !== "object") return;
  const st = wsGet();
  const live = st.liveSessionId;
  // Only the live session's info may drive the popup (mirrors the event filter).
  if (live && sid !== live) return;
  wsSet({
    sessionInfo: mergeSessionInfo(st.sessionInfo, st.sessionInfoSid, sid, incoming),
    sessionInfoSid: sid,
  });
}

function ownRpcId(): string {
  const id = generateRpcId();
  eng.ownRpcIds.add(id);
  if (eng.ownRpcIds.size > 200) {
    const first = eng.ownRpcIds.values().next().value;
    if (first !== undefined) eng.ownRpcIds.delete(first);
  }
  return id;
}

function emit(ev: EventPayload) {
  for (const l of eng.listeners) {
    try { l(ev); } catch { /* one bad listener never kills dispatch */ }
  }
  // Bridge for views outside the chat surface (approvals panel live-refresh):
  // one DOM event per frame, payload = {type, payload}.
  try { window.dispatchEvent(new CustomEvent("astra-ws-event", { detail: ev })); } catch { /* SSR/no-window guard */ }
}

function bumpConn(ev: ConnEvent) {
  useWsStore.getState().setConn(ev);
}

function setTurnRunning(running: boolean) {
  if (eng.turnRunning !== running) {
    eng.turnRunning = running;
    useWsStore.getState().setTurnRunning(running);
  }
}

// ---- watchdog (turn truth probe) ----

function clearWatchdog() {
  if (eng.watchdogTimer) { window.clearTimeout(eng.watchdogTimer); eng.watchdogTimer = null; }
}

function armWatchdog() {
  clearWatchdog();
  eng.watchdogTimer = window.setTimeout(() => probeTurn(), TURN_WATCHDOG_MS);
}

function probeTurn() {
  const sid = wsGet().liveSessionId || readStoredSid();
  if (!eng.socket || eng.socket.readyState !== 1 || !sid) {
    eng.probeFails++;
    // REPAIR-first: at 3 strikes force a reconnect cycle; only fail visibly
    // after 6 (a second full repair window also found no wire).
    if (eng.probeFails === 3) {
      try { eng.socket?.close(); } catch { /* gone */ }
      if (eng.socket) eng.socket = null;
      window.dispatchEvent(new Event("online"));
      armWatchdog();
      return;
    }
    if (eng.probeFails >= 6) {
      eng.probeFails = 0;
      setTurnRunning(false);
      emit({ type: "message.error", payload: { error: "Lost contact with Astra while it was working. The connection didn't recover in time — please try again." } });
      emit({ type: "turn.settled", payload: {} });
      return;
    }
    armWatchdog();
    return;
  }
  eng.probeId = ownRpcId();
  eng.socket.send(JSON.stringify({ method: "session.resume", params: { session_id: sid, omit_messages: true }, id: eng.probeId }));
}

// ---- durable queue: the 5-min cap now repairs instead of eating the message ----

function armQueuedCap() {
  if (eng.queuedCapTimer) return;
  eng.queuedCapTimer = window.setTimeout(() => {
    eng.queuedCapTimer = null;
    if (!wsQueueAll().length) return;
    eng.queuedRepairs++;
    if (eng.queuedRepairs <= 2) {
      try { eng.socket?.close(); } catch { /* gone */ }
      if (eng.socket) eng.socket = null;
      armQueuedCap();
      window.dispatchEvent(new Event("online"));
      return;
    }
    eng.queuedRepairs = 0;
    const q = wsQueueAll();
    wsQueueSet([]);
    setTurnRunning(false);
    emit({ type: "message.error", payload: { error: `Message${q.length > 1 ? "s" : ""} couldn't be sent — the connection was unavailable for too long. Please try again.` } });
  }, 300_000);
}

function clearQueuedCap() {
  if (eng.queuedCapTimer) { window.clearTimeout(eng.queuedCapTimer); eng.queuedCapTimer = null; }
  eng.queuedRepairs = 0;
}

// ---- queue flush (resume or fresh-create path) ----

function flushPendingPreTurnRpcs(sid: string) {
  const queue = eng.pendingPreTurnRpcs;
  eng.pendingPreTurnRpcs = [];
  for (const req of queue) {
    if (eng.socket && eng.socket.readyState === 1) {
      const params = { ...req.params, session_id: sid };
      eng.socket.send(JSON.stringify({ method: req.method, params, id: req.id }));
      eng.pendingRpcs.set(req.id, {
        resolve: (v: any) => { req.resolve(v); },
        reject: (e: any) => { req.reject(e); },
      });
    }
  }
}

function flushQueueForSession(sid: string) {
  flushPendingPreTurnRpcs(sid);
  // A create reply lands with the fresh sid; a resume reply with the stored
  // one. A "fresh"-mode queued prompt must flush on the CREATE reply even when
  // it carries no sessionId, so flush everything that doesn't explicitly
  // target a DIFFERENT session.
  const q = wsQueueAll().filter((p) => p.mode === "fresh" || (!p.sessionId || p.sessionId === sid));
  if (!q.length) return;
  const remaining = wsQueueAll().filter((p) => !q.includes(p));
  wsQueueSet(remaining);
  clearQueuedCap();
  armWatchdog();
  for (const p of q) {
    sendPrompt(sid, p.text);
  }
  emit({ type: "queue.flushed", payload: { count: q.length } });
}

function sendPrompt(sid: string, text: string, queued = false) {
  rpc("prompt.submit", { session_id: sid, text, surface: APP_SOURCE, ...(queued ? { queued: true } : {}) })
    .catch((err: any) => {
      setTurnRunning(false);
      emit({
        type: "message.error",
        payload: { error: err?.message || err?.data?.message || String(err) },
      });
    });
}

function sendSessionCreate() {
  if (eng.pendingCreate || wsGet().liveSessionId) return;
  if (!eng.socket || eng.socket.readyState !== 1) { eng.createOnOpen = true; return; }
  eng.pendingCreate = true;
  eng.socket.send(JSON.stringify({ method: "session.create", params: { source: APP_SOURCE }, id: ownRpcId() }));
}

// ---- public RPC ----

export function rpc(method: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ownRpcId();
    if (!wsGet().liveSessionId && (method === "config.set" || method === "image.attach")) {
      eng.pendingPreTurnRpcs.push({ id, method, params, resolve, reject });
    } else {
      eng.pendingRpcs.set(id, { resolve, reject });
      if (eng.socket && eng.socket.readyState === 1) {
        const sid = wsGet().liveSessionId;
        const p = sid && !params.session_id ? { ...params, session_id: sid } : params;
        eng.socket.send(JSON.stringify({ method, params: p, id }));
      } else {
        eng.pendingRpcs.delete(id);
        reject(new Error("WebSocket not connected"));
      }
    }
  });
}

// ---- public send path (mirrors the old submitPrompt semantics) ----

export function submitPrompt(content: string) {
  const st = wsGet();
  if (st.queue.length) armQueuedCap();
  if (!eng.socket || eng.socket.readyState !== 1) {
    const sid = readStoredSid();
    wsQueuePush({ id: generateRpcId(), text: content, queuedAt: Date.now(), mode: sid ? "resume" : "fresh", sessionId: sid || undefined });
    eng.createOnOpen = !sid;
    armQueuedCap();
    setTurnRunning(true);
    emit({ type: "queue.queued", payload: { text: content } });
    return;
  }
  setTurnRunning(true);
  armWatchdog();
  const live = wsGet().liveSessionId;
  const stored = readStoredSid();
  if (!live && !stored) {
    wsQueuePush({ id: generateRpcId(), text: content, queuedAt: Date.now(), mode: "fresh" });
    armQueuedCap();
    // Socket is UP — create NOW. (createOnOpen only fires on the next socket
    // open; setting it here instead of creating left the fresh prompt parked
    // in the queue with the Thinking pill on and no session ever minted.)
    sendSessionCreate();
  } else {
    // Mid-turn submit while the session is live: queue, never refuse or
    // interrupt (Claude-Code-style). queued:true pins the gateway's
    // run-after envelope — without it a mid-turn send could be treated as a
    // steer or interrupt and eat the running turn.
    sendPrompt(live || stored!, content, /* queued */ eng.turnRunning);
  }
}

export function submitBg(content: string): Promise<boolean> {
  const sid = wsGet().liveSessionId || readStoredSid();
  if (!sid) { emit({ type: "message.error", payload: { error: "No session yet — send a message first." } }); return Promise.resolve(false); }
  return rpc("prompt.submit", { session_id: sid, text: content, surface: APP_SOURCE, queued: true })
    .then(() => true)
    .catch((err: any) => {
      emit({ type: "message.error", payload: { error: err?.message || err?.data?.message || String(err) } });
      return false;
    });
}

// /steer <text> — live course-correction. The gateway's busy path reads the
// GLOBAL display.busy_input_mode, so: set steer → submit → restore previous.
// config.set busy → _write_config_key(display.busy_input_mode) takes effect
// on the very next submit (config is mtime-cached, re-read per call).
// Ported from the old hook verbatim — the facade re-exports it unchanged.
let steerBusyLock = false;
export async function submitSteer(content: string): Promise<boolean> {
  const sid = wsGet().liveSessionId || readStoredSid();
  if (!sid) { emit({ type: "message.error", payload: { error: "No session yet — send a message first." } }); return false; }
  if (!eng.socket || eng.socket.readyState !== 1) {
    emit({ type: "message.error", payload: { error: "Can't steer while offline — retry when connected." } });
    return false;
  }
  if (steerBusyLock) return false; // a steer bridge is already in flight
  steerBusyLock = true;
  try {
    const prev = await rpc("config.get", { key: "busy" }).then((r: any) => (typeof r?.value === "string" ? r.value : "interrupt")).catch(() => "interrupt");
    if (prev !== "steer") await rpc("config.set", { key: "busy", value: "steer" }).catch(() => {});
    try {
      await rpc("prompt.submit", { session_id: sid, text: content, surface: APP_SOURCE });
      return true;
    } finally {
      if (prev !== "steer") await rpc("config.set", { key: "busy", value: prev }).catch(() => {});
    }
  } catch (err: any) {
    emit({ type: "message.error", payload: { error: err?.message || err?.data?.message || String(err) } });
    return false;
  } finally {
    steerBusyLock = false;
  }
}

export function sendApprovalResponse(id: string, choice: string): boolean {
  if (!eng.socket || eng.socket.readyState !== 1) return false;
  eng.socket.send(JSON.stringify({ jsonrpc: "2.0", id, result: { choice } }));
  return true;
}

export function sendServerResponse(id: string, result: Record<string, unknown>): boolean {
  if (!eng.socket || eng.socket.readyState !== 1) return false;
  eng.socket.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
  return true;
}

export function interrupt() {
  clearWatchdog();
  if (!eng.socket || eng.socket.readyState !== 1) return;
  const sid = wsGet().liveSessionId || readStoredSid();
  if (sid) {
    eng.socket.send(JSON.stringify({ method: "session.interrupt", params: { session_id: sid }, id: ownRpcId() }));
  }
  setTurnRunning(false);
}

export function resetSession() {
  // Never interrupt the old session's turn (skill rule): isolation is the event
  // filter's job, not a kill.
  clearWatchdog();
  setTurnRunning(false);
  eng.liveKey = null;
  wsSet({ liveSessionId: null, sessionInfo: null, sessionInfoSid: null });
  notify.setActiveSession(null);
  wsGet().setStoredSessionId(null);
  eng.pendingPreTurnRpcs = [];
  eng.pendingCreate = false;
  eng.createOnOpen = false;
  eng.probeFails = 0;
  clearQueuedCap();
}

export function retryConnection() {
  bumpConn({ type: "retry-begin" });
  const dead = !eng.socket || eng.socket.readyState > 1;
  if (dead) {
    const deadSock = eng.socket;
    eng.socket = null;
    try { deadSock?.close(); } catch { /* gone */ }
    window.dispatchEvent(new Event("online"));
    // confirm via cheap RPC once a wire is up
    const check = window.setInterval(() => {
      if (eng.socket && eng.socket.readyState === 1) {
        window.clearInterval(check);
        rpc("config.get", { key: "mtime" })
          .then(() => bumpConn({ type: "retry-ok" }))
          .catch(() => { bumpConn({ type: "retry-fail" }); try { eng.socket?.close(); } catch {} });
      }
    }, 500);
    window.setTimeout(() => window.clearInterval(check), 15000);
  } else {
    rpc("config.get", { key: "mtime" })
      .then(() => bumpConn({ type: "retry-ok" }))
      .catch(() => {
        bumpConn({ type: "retry-fail" });
        try { eng.socket?.close(); } catch { /* noop */ }
      });
  }
}

// Android resume repair: called from android-resume.ts via astra:ws-poke.
export function pokeResumeCheck() {
  const s = eng.socket;
  const stale = !s || s.readyState > 1 || transportSilent(eng.lastFrameAt, Date.now());
  if (stale) {
    try { s?.close(); } catch { /* gone */ }
    if (eng.socket) eng.socket = null;
    window.dispatchEvent(new Event("online"));
  }
}

// ---- R9: wake probes -------------------------------------------------------
// A socket can look OPEN while its path is actually dead (CF tunnel reaped a
// half-closed wire, device switched WiFi→LTE). The old wake path only dialed
// when the socket was NOT open — a zombie-OPEN socket sat there until the 60s
// liveness timer noticed silence. Now every wake event probes the wire with a
// cheap RPC; failure force-cycles immediately with backoff reset.

let wakeProbeInFlight = false; // single-flight: one probe per wake, never two

function resetBackoffAndDialNow() {
  eng.reconnectAttempt = 0;
  if (eng.reconnectTimer !== null) {
    window.clearTimeout(eng.reconnectTimer);
    eng.reconnectTimer = null;
  }
  connect();
}

export function wakeProbe() { // exported for wake-probe.check.ts (behavioral test)
  if (wakeProbeInFlight) return;
  const s = eng.socket;
  if (s && s.readyState === 1) {
    // OPEN: prove the path with the cheap mtime probe, 8s deadline.
    // (was 3s — a tunnel RTT spike past 3s killed HEALTHY sockets on mobile and
    // kicked the reconnect storm; 8s = generous but still bounded.)
    wakeProbeInFlight = true;
    let settled = false;
    const done = (failed: boolean) => {
      if (settled) return;
      settled = true;
      wakeProbeInFlight = false;
      if (!failed) return;
      // Zombie-OPEN: force the cycle NOW instead of waiting out liveness.
      eng.reconnectAttempt = 0;
      try { s.close(); } catch { /* gone */ }
      if (eng.socket === s) eng.socket = null;
      window.dispatchEvent(new Event("online"));
    };
    window.setTimeout(() => done(true), 8000);
    rpc("config.get", { key: "mtime" }).then(() => done(false)).catch(() => done(true));
  } else if (s && s.readyState === 0) {
    // CONNECTING: dial in flight — let it land; the 3s-open... nothing to do.
  } else {
    // CLOSED/CLOSING/none: cancel any pending backoff wait, dial now.
    resetBackoffAndDialNow();
  }
}

// ---- listener registry (React subscribes here) ----

export function addListener(l: Listener): () => void {
  eng.listeners.add(l);
  return () => { eng.listeners.delete(l); };
}

// ---- lifecycle ----

export function startEngine() {
  if (eng.started) return;
  eng.started = true;
  eng.disposed = false;
  connect();
  // read-sync: TinyBase cross-tab CRDT + server watermark poll (2026-10-01)
  void startTabSync();
  startServerSync();
  // presence writer used by notify.reportFocus (avoids a circular import)
  (globalThis as any).__astraWsSend = (payload: string) => {
    const s = eng.socket;
    if (s && s.readyState === 1) { s.send(payload); return true; }
    return false;
  };

  // Chat switched from the sidebar / URL while a different session is bound.
  useWsStore.subscribe((st, prev) => {
    if (st.storedSessionId && st.storedSessionId !== prev.storedSessionId) rebindToStored(st.storedSessionId);
  });

  // Android resume repair: android-resume.ts dispatches astra:ws-poke on app
  // resume. Registered HERE (not at module top level — the check files import
  // this module under plain node where `window` doesn't exist), and at
  // engine-level rather than in React: commit 97c2765 claimed to forward the
  // poke in chat-landing but its diff never added the listener, so v1.1
  // shipped with a dead event. App-lifetime engine = repair survives remounts.
  window.addEventListener("astra:ws-poke", pokeResumeCheck);

  // R4 liveness: 60s of total silence recycles the wire. Wall-clock based, so
  // Android throttling timers just delays the check — never kills the socket.
  eng.livenessTimer = window.setInterval(() => {
    if (transportSilent(eng.lastFrameAt, Date.now())) {
      try { eng.socket?.close(); } catch { /* gone */ }
    }
  }, 5000);

  // Banner countdown poll (1 Hz while a retry is pending)
  eng.countdownTimer = window.setInterval(() => {
    const at = nextRetryAt;
    useWsStore.getState().setNextRetryIn(at === null ? 0 : Math.max(0, at - Date.now()));
  }, 1000);

  // Browser/mobile network return → immediate reconnect
  const tryImmediateReconnect = () => {
    if (eng.disposed) return;
    if (eng.socket && (eng.socket.readyState === 0 || eng.socket.readyState === 1)) return;
    if (eng.reconnectTimer !== null) { window.clearTimeout(eng.reconnectTimer); eng.reconnectTimer = null; }
    connect();
  };
  window.addEventListener("online", tryImmediateReconnect);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tryImmediateReconnect();
  });

  // R9 wake probes: on any wake signal, a zombie-OPEN socket is probed (not
  // trusted) and a pending backoff wait is cut short — dial immediately.
  // Guards keep one wake from arming probe + dial double.
  window.addEventListener("online", wakeProbe);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wakeProbe();
  });
  window.addEventListener("pageshow", wakeProbe);

  // R1 native leg: mirror the live session identity into the shell so the
  // background chat-socket subscribes (?sid=) to the chat the page is on.
  // Fires on bind changes AND on start (restores identity after reload).
  useWsStore.subscribe((st, prev) => {
    const cur = `${st.liveSessionId ?? ""}|${st.storedSessionId ?? ""}`;
    const was = `${prev.liveSessionId ?? ""}|${prev.storedSessionId ?? ""}`;
    if (cur !== was) pushLiveSession(st.liveSessionId, st.storedSessionId);
  });
  pushLiveSession(wsGet().liveSessionId, wsGet().storedSessionId);
}

export function stopEngine() {
  // Only tests / hot-swap paths call this. The engine is app-lifetime by design.
  eng.disposed = true;
  if (eng.livenessTimer) window.clearInterval(eng.livenessTimer);
  if (eng.countdownTimer) window.clearInterval(eng.countdownTimer);
  if (eng.reconnectTimer) window.clearTimeout(eng.reconnectTimer);
  clearWatchdog();
  clearQueuedCap();
  try { eng.socket?.close(); } catch { /* gone */ }
  eng.socket = null;
  eng.started = false;
}

// Test hook for src/lib/*.check.ts files (wake-probe.check.ts drives
// wakeProbe through the real singleton). Not app API — never read in app code.
export const __eng = eng;

// ---- internals: connect/receive ----

let nextRetryAt: number | null = null;

function scheduleReconnect() {
  if (eng.disposed || eng.reconnectTimer !== null) return;
  const delay = nextReconnectDelay(eng.reconnectAttempt++);
  nextRetryAt = Date.now() + delay;
  useWsStore.getState().setNextRetryIn(delay);
  eng.reconnectTimer = window.setTimeout(() => {
    eng.reconnectTimer = null;
    nextRetryAt = null;
    useWsStore.getState().setNextRetryIn(0);
    connect();
  }, delay);
}

function onSocketOpen(s: WebSocket) {
  bumpConn({ type: "ws-open" });
  nextRetryAt = null;
  useWsStore.getState().setNextRetryIn(0);
  s.send(JSON.stringify({ jsonrpc: "2.0", id: ownRpcId(), method: "client.capabilities", params: { server_requests: true } }));
  const sid = readStoredSid();
  if (sid) sendResume(s, sid);
  if (eng.createOnOpen && !sid) {
    eng.createOnOpen = false;
    sendSessionCreate();
  }
  // Durable fresh-mode prompts from a previous page load (or app kill): no
  // session was ever minted, so create one now — the create reply's
  // flushQueueForSession sends the queued text.
  if (!sid && !eng.pendingCreate && wsQueueAll().some((p) => p.mode === "fresh")) {
    sendSessionCreate();
  }
}

function replayOpenRequests(result: any) {
  const reqs = result && result.open_requests;
  if (!Array.isArray(reqs)) return;
  for (const r of reqs) {
    if (!r || !r.id) continue;
    if (!requestBelongsToLive(r.params, wsGet().liveSessionId)) continue;
    emit({ type: r.method || "approval", payload: { id: r.id, params: r.params || r } });
  }
}

function applyReplyTruth(result: any) {
  const v = applyTurnTruth(result && result.running, result && result.status);
  if (v === "streaming") { setTurnRunning(true); armWatchdog(); }
  else if (v === "idle" && eng.turnRunning) {
    setTurnRunning(false);
    emit({ type: "turn.settled", payload: {} });
  }
}

function attachHandlers(s: WebSocket) {
  // A socket the engine already abandoned (recycled by the watchdog, the liveness timer or
  // Android resume repair) can still hand over buffered frames and a late close event. The
  // proxy broadcasts every upstream frame to every browser socket, so applying them would
  // render each frame twice on top of the new socket's resume; its close would flip the
  // banner offline and schedule a redundant reconnect + re-resume (a second open_requests
  // replay). Only the CURRENT socket speaks; the new socket's session.resume is the truth.
  s.onmessage = (e) => { if (eng.socket === s) onMessage(e); };
  s.onclose = () => {
    if (eng.socket && eng.socket !== s) return; // superseded by a newer socket
    if (eng.socket === s) eng.socket = null;
    bumpConn({ type: "ws-closed" });
    emit({ type: "ws.closed", payload: {} });
    scheduleReconnect();
  };
}

function connect() {
  if (eng.disposed) return;
  if (eng.socket && eng.socket.readyState === 1) {
    attachHandlers(eng.socket);
    eng.reconnectAttempt = 0;
    onSocketOpen(eng.socket);
    return;
  }
  if (eng.socket && eng.socket.readyState === 0) return; // dial already in flight
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/api/hx/ws`;
  const sock = new WebSocket(url);
  eng.socket = sock;
  attachHandlers(sock);
  sock.onopen = () => { eng.reconnectAttempt = 0; onSocketOpen(sock); };
}

function onMessage(e: MessageEvent) {
  eng.lastFrameAt = Date.now();
  let data;
  try { data = JSON.parse(e.data); } catch { return; }

  // Any reply carrying `info` (session.create / session.resume incl. probe + bg poll)
  // refreshes the selector state. Resume/create replies set liveSessionId below, so
  // for those the live check must not reject: apply after the sid is adopted.
  const replyInfo = data.result && data.result.info && data.result.session_id ? data.result : null;

  if (data.method === "approval" && data.id) {
    if (!requestBelongsToLive(data.params, wsGet().liveSessionId)) return;
    clearWatchdog();
    emit({ type: "approval", payload: { id: data.id, params: data.params || {} } });
  }

  if (data.method && data.method !== "approval" && typeof data.id === "string" && data.id.startsWith("srq-")) {
    if (!requestBelongsToLive(data.params, wsGet().liveSessionId)) return;
    clearWatchdog();
    emit({ type: data.method, payload: { id: data.id, params: data.params || {} } });
  }
  
  if (data.method === "event" && data.params && data.params.type === "message.complete") {
    const liveSid = data.params.session_id;
    // Prefer the proxy-stamped stored_session_id (it survives even when this
    // client's own sidmap has never seen the pair — bumped chats the user never
    // opened this boot would otherwise key off the ephemeral live sid and read
    // as orphans, invisible in the row list until the prune TTL ate them).
    const mapped = data.params.payload?.stored_session_id || notify.storedKeyFor(liveSid);
    const fid = data.params.payload && data.params.payload.turn_id != null ? data.params.payload.turn_id : (data.id ?? liveSid + ":" + String(data.params.payload?.ts ?? 0));
    notify.handleComplete(liveSid, mapped, data.params.payload, fid);
  }

  // Cross-device read marker from the proxy (another device read this chat).
  if (data.method === "event" && data.params && data.params.type === "session.read") {
    const key = data.params.payload?.stored_session_id || data.params.session_id;
    if (key) notify.handleRemoteRead(key);
  }

  // Presence (Centrifugo-style join/leave/focus broadcasts from the proxy).
  if (data.method === "event" && data.params && (data.params.type === "presence.snapshot" || data.params.type === "presence.update")) {
    // Feed the focus set into the unread store: a chat focused on another
    // surface is read here. Chats that just became remotely focused drop any
    // pill we were still showing for them.
    const payload = data.params.payload || {};
    for (const key of notify.applyPresence(payload)) notify.clearLocalPill(key);
    emit({ type: data.params.type, payload });
  }

  // Server-origin events (no session_id — training pipeline etc.) reach the
  // emit funnel below only if they carry no session filter; guard line 868
  // drops session-tagged frames for other chats, but training.updated has no
  // session_id so it falls through cleanly. Handled here to be explicit:
  if (data.method === "event" && data.params && data.params.type === "training.updated") {
    emit({ type: "training.updated", payload: data.params.payload });
    return;
  }

  // watchdog probe reply
  if (data.id && eng.probeId === data.id) {
    eng.probeId = null;
    if (replyInfo) applySessionInfo(replyInfo.session_id, replyInfo.info);
    const failed = !!data.error;
    const running = data.result ? data.result.running : undefined;
    if (failed || running === undefined) {
      eng.probeFails++;
      if (eng.probeFails >= 6) {
        eng.probeFails = 0;
        setTurnRunning(false);
        emit({ type: "message.error", payload: { error: "Lost contact with Astra while it was working. The connection didn't recover in time — please try again." } });
        emit({ type: "turn.settled", payload: {} });
        return;
      }
    } else {
      eng.probeFails = 0;
    }
    const act = watchdogAction(failed, running);
    if (act === "finalize") {
      if (eng.turnRunning) {
        setTurnRunning(false);
        emit({ type: "turn.settled", payload: {} });
      }
    } else {
      if (!failed && running === true && !eng.turnRunning) setTurnRunning(true);
      armWatchdog();
    }
    return;
  }

  if (data.id && eng.pendingRpcs.has(data.id)) {
    const p = eng.pendingRpcs.get(data.id)!;
    eng.pendingRpcs.delete(data.id);
    if (replyInfo) applySessionInfo(replyInfo.session_id, replyInfo.info);
    if (data.error) p.reject(data.error);
    else p.resolve(data.result);
    return;
  }

  if (data.id && eng.pendingResumes.has(data.id)) {
    eng.pendingResumes.delete(data.id);
    const resumedKey = eng.resumeKeys.get(data.id) ?? null;
    eng.resumeKeys.delete(data.id);
    // Stale reply: user already moved on to another chat while this resume was in flight.
    if (resumedKey && readStoredSid() !== resumedKey) return;
    if (data.error) {
      const msg = String(data.error?.message || data.error || "");
      const transient = /not owned|transport|unavailable|busy|5000|4001/i.test(msg);
      if (!transient) {
        wsGet().setStoredSessionId(null);
        wsSet({ liveSessionId: null });
        eng.liveKey = null;
        setTurnRunning(false);
      }
      return;
    } else if (data.result && data.result.session_id) {
      eng.liveKey = resumedKey;
      wsSet({ liveSessionId: data.result.session_id });
      const mappedStored = data.result.session_key || data.result.session_id;
      notify.mapSession(data.result.session_id, mappedStored);
      notify.setActiveSession(mappedStored === data.result.session_id ? notify.storedKeyFor(data.result.session_id) || mappedStored : mappedStored);
      if (replyInfo) applySessionInfo(replyInfo.session_id, replyInfo.info);
      applyReplyTruth(data.result);
      flushQueueForSession(data.result.session_id);
      replayOpenRequests(data.result);
    }
  } else if (data.id && data.result && data.result.session_id && eng.ownRpcIds.has(data.id)) {
    eng.ownRpcIds.delete(data.id);
    wsSet({ liveSessionId: data.result.session_id });
    const mappedStored2 = data.result.stored_session_id || data.result.session_id;
    notify.mapSession(data.result.session_id, mappedStored2);
    notify.setActiveSession(mappedStored2 === data.result.session_id ? notify.storedKeyFor(data.result.session_id) || mappedStored2 : mappedStored2);
    if (replyInfo) applySessionInfo(replyInfo.session_id, replyInfo.info);
    eng.pendingCreate = false;
    eng.createOnOpen = false;
    const stored = data.result.stored_session_id;
    eng.liveKey = stored || null; // set BEFORE the store write so the subscriber sees "already bound"
    if (stored) wsGet().setStoredSessionId(stored);
    applyReplyTruth(data.result);
    flushQueueForSession(data.result.session_id);
    replayOpenRequests(data.result);
  }

  if (data.id && data.error && !eng.pendingRpcs.has(data.id) && eng.ownRpcIds.has(data.id)) {
    eng.ownRpcIds.delete(data.id);
    eng.pendingCreate = false;
    setTurnRunning(false);
    emit({ type: "message.error", payload: { error: data.error?.message || JSON.stringify(data.error) } });
    return;
  }

  if (data.method === "event" && data.params) {
    let { type, payload, session_id } = data.params;

    if (type === "message.complete" || type === "message.error") {
      if (type === "message.complete" && payload && payload.status === "error") {
        type = "message.error";
        if (!payload.error) payload.error = { message: payload.text || "The agent turn failed." };
      }
      const belongsToLive = session_id === wsGet().liveSessionId;
      if (belongsToLive) {
        clearWatchdog();
        setTurnRunning(false);
      }
      // Cross-session turn tracking (owner 10-06): the sidebar shows "Working…"
      // on any chat whose turn is running, not just the open one. Frames for
      // the live session are handled above; other chat's completions land as
      // chat.turn events so the row status clears. Deliberately silent for the
      // live session too — no extra listeners needed for those turns.
      if (!belongsToLive && session_id && type === "message.complete") {
        emit({ type: "chat.turn", payload: { sid: session_id, running: false } });
      }
      if (type === "message.error") {
        if (belongsToLive) emit({ type, payload, session_id });
        return;
      }
    }

    if (type === "proxy.status") {
      if (payload.state === "reconnecting") bumpConn({ type: "proxy-reconnecting" });
      else if (payload.state === "online") bumpConn({ type: "proxy-online" });
      if (payload.state === "online") {
        if (eng.socket?.readyState === 1) {
          eng.socket.send(JSON.stringify({ jsonrpc: "2.0", id: ownRpcId(), method: "client.capabilities", params: { server_requests: true } }));
        }
        const sid = readStoredSid();
        if (sid && eng.socket?.readyState === 1) sendResume(eng.socket, sid);
      }
      emit({ type, payload });
      return;
    }

    if (session_id && session_id !== wsGet().liveSessionId) {
      // Another chat's turn started — surface it for the sidebar's row status
      // (thinking / working animation there, owner 10-06). Then drop, exactly
      // as before: a foreign session's frames must never reach the chat UI.
      if (type === "message.start" || type === "message.complete" || type === "message.error") {
        // Sid mapping (owner 10-06: "no realtime Thinking/Working on the
        // sidebar"): events carry the LIVE session id, which rotates on
        // compression — the sidebar rows key on the STORED id, so a naive
        // sid match never lit the row. Stamp BOTH ids on the event; the row
        // matches either. storedKeyFor covers sessions this client mapped;
        // payload.stored_session_id covers sessions the proxy stamped.
        emit({
          type: "chat.turn",
          payload: {
            sid: session_id,
            stored: payload?.stored_session_id || notify.storedKeyFor(session_id) || "",
            running: type === "message.start",
            thinking: type === "message.start",
            text: type === "message.complete" ? String(payload?.text || "") : "",
          },
        });
      }
      return;
    }

    if (type === "session.info") {
      applySessionInfo(session_id, payload);
      emit({ type, payload, session_id });
    }

    if (type === "message.start" || type === "message.delta" || type === "thinking.delta" || type === "reasoning.delta" || type === "tool.start") {
      armWatchdog();
      eng.probeFails = 0;
    }

    if (type === "message.start") setTurnRunning(true);
    if (type === "message.complete" || type === "message.error") {
      clearWatchdog();
      setTurnRunning(false);
    }

    emit({ type, payload, session_id });
  }
}
