// ws-store.ts — zustand store for the WS transport layer.
//
// WHY zustand: the previous design kept the whole connection brain inside a
// React hook. StrictMode remounts, backgrounded-tab effect teardowns, and
// Android Doze pausing the WebView could each tear the reconnect timers down
// WITH the component — the app then sat offline forever until reopened.
// A module-level engine + store survives every mount/unmount cycle; the hook
// becomes a thin subscription layer.
//
// The queue here is DURABLE: pending prompts persist to localStorage so an
// Android app kill (swipe away, memory pressure) no longer eats a message the
// user watched "send".

import { create } from "zustand";
import { nextConnState, type ConnEvent, type ConnState } from "./connection-state";

export type QueuedPrompt = {
  id: string;
  text: string;
  queuedAt: number;
  /** fresh = needs session.create first; resume = flush after resume of `sessionId` */
  mode: "fresh" | "resume";
  sessionId?: string;
};

export type WsStatus = {
  conn: ConnState;
  /** ms until next reconnect attempt (0 = dialing or connected) */
  nextRetryIn: number;
  /** gateway-side turn truth: is a turn running in the live session */
  turnRunning: boolean;
  liveSessionId: string | null;
  storedSessionId: string | null;
  queue: QueuedPrompt[];
  lastError: string | null;
  /** latest session.info payload — powers yolo/model/reasoning toggles */
  sessionInfo: any;
  /** which live session `sessionInfo` describes (merge within a session, replace across) */
  sessionInfoSid: string | null;
};

const TAB_QUEUE_KEY = "astra-ws-queue-v2";

function loadQueue(): QueuedPrompt[] {
  // PER-TAB queue (sessionStorage) + legacy-migrate from the old SHARED
  // localStorage queue — only when it's empty so two tabs never split one list.
  let store: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = null;
  try { store = sessionStorage; } catch { /* private mode */ }
  if (!store) {
    try { store = localStorage; } catch { /* private mode */ }
  }
  let raw: string | null = null;
  try { raw = store?.getItem(TAB_QUEUE_KEY) ?? null; } catch { /* private mode */ }
  if (!raw) {
    // Legacy one-time migration: adopt the old shared queue into this tab's
    // own space if (and only if) it has no queue of its own yet.
    try {
      const legacy = localStorage.getItem("astra-ws-queue-v1");
      if (legacy) {
        try { localStorage.removeItem("astra-ws-queue-v1"); } catch { /* ignore */ }
        raw = legacy;
      }
    } catch { /* ignore */ }
  }
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr
          // R5 staleness cap: a prompt queued >24h ago is never what the owner
          // wants fired at a fresh session — drop it on load (count cap stays).
          .filter((q) => q && typeof q.text === "string" && typeof q.id === "string"
            && typeof q.queuedAt === "number" && Date.now() - q.queuedAt < 86_400_000)
          .slice(-20)
      : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedPrompt[]) {
  let store: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = null;
  try { store = sessionStorage; } catch { /* private mode */ }
  if (!store) {
    try { store = localStorage; } catch { /* private mode */ }
  }
  try {
    if (!store) return;
    if (queue.length) store.setItem(TAB_QUEUE_KEY, JSON.stringify(queue.slice(-20)));
    else store.removeItem(TAB_QUEUE_KEY);
  } catch { /* private mode */ }
}

type WsStore = WsStatus & {
  // actions — called ONLY by ws-engine (the single writer)
  setConn: (ev: ConnEvent) => void;
  setNextRetryIn: (ms: number) => void;
  setTurnRunning: (running: boolean) => void;
  setLiveSessionId: (sid: string | null) => void;
  setStoredSessionId: (sid: string | null) => void;
  setLastError: (err: string | null) => void;
  /** functional update — optimistic config toggles patch the previous value */
  patchSessionInfo: (fn: (prev: any) => any) => void;
  enqueue: (p: QueuedPrompt) => void;
  dequeue: (id: string) => void;
  /** replace the whole queue (engine reconcile after flush attempt) */
  setQueue: (q: QueuedPrompt[]) => void;
};

export const useWsStore = create<WsStore>((set) => ({
  conn: "online",
  nextRetryIn: 0,
  turnRunning: false,
  liveSessionId: null,
  storedSessionId: null,
  queue: loadQueue(),
  lastError: null,
  sessionInfo: null,
  sessionInfoSid: null,

  setConn: (ev) => set((s) => ({ conn: nextConnState(s.conn, ev) })),
  setNextRetryIn: (ms) => set({ nextRetryIn: ms }),
  setTurnRunning: (running) => set({ turnRunning: running }),
  setLiveSessionId: (sid) => set({ liveSessionId: sid }),
  setStoredSessionId: (sid) => {
    set({ storedSessionId: sid });
    try {
      if (sid) sessionStorage.setItem("astra-chat-session", sid);
      else sessionStorage.removeItem("astra-chat-session");
      localStorage.removeItem("astra-chat-session"); // legacy shared key
    } catch { /* private mode */ }
  },
  setLastError: (err) => set({ lastError: err }),
  patchSessionInfo: (fn) => set((s) => ({ sessionInfo: fn(s.sessionInfo) })),
  enqueue: (p) => set((s) => { const q = [...s.queue, p]; saveQueue(q); return { queue: q }; }),
  dequeue: (id) => set((s) => { const q = s.queue.filter((x) => x.id !== id); saveQueue(q); return { queue: q }; }),
  setQueue: (q) => { saveQueue(q); set({ queue: q }); },
}));

// ---- non-hook read/write helpers (for the engine + plain modules) ----

export const wsGet = () => useWsStore.getState();
export const wsSet = (partial: Partial<WsStore>) => useWsStore.setState(partial);
export function wsQueuePush(p: QueuedPrompt) {
  // Durable-first (RG-101): the row lands in IndexedDB with an owner stamp
  // before the zustand mirror updates; sessionStorage stays the fallback path.
  if (durableApi) durableApi.push(p);
  else wsGet().enqueue(p);
}
export function wsQueueRemove(id: string) {
  if (durableApi) { durableApi.remove(id); syncStoreFromDurable(); return; }
  wsGet().dequeue(id);
}
export function wsQueueAll(): QueuedPrompt[] {
  // The mirror IS the answer in both paths: the durable write keeps the zustand
  // queue in sync, and the fallback path owns that store anyway.
  return wsGet().queue;
}
export function wsQueueSet(q: QueuedPrompt[]) {
  if (durableApi) {
    // Replace = remove every visible row, then push the new list (engine
    // reconcile after a flush attempt). Clear ALL rows the tab can see.
    for (const r of visibleQueue()) durableApi.remove(r.id);
    for (const p of q) durableApi.push(p);
    syncStoreFromDurable();
    return;
  }
  wsGet().setQueue(q);
}

// ---- durable queue wiring (RG-101) -----------------------------------------
//
// The zustand queue above mirrors the DURABLE outbox (durable-outbox.ts,
// IndexedDB) once the store is up; the sessionStorage path stays as the fallback
// for private mode / a store that failed to open. Owner stamps give per-tab
// isolation on the shared origin: a row written by THIS tab is invisible to
// another tab, an unowned row stays adoptable, and ownership is write-once.
import {
  startDurableStore, enqueueOutbox, dequeueOutbox, outboxList, clearDurable,
  claimRowsForOwner, rowOwnedBy, type OutboxRow,
} from "./durable-outbox";

const OWNER_KEY = "astra-ws-tab-owner";
function tabOwner(): string {
  let id: string | null = null;
  try { id = sessionStorage.getItem(OWNER_KEY); } catch { /* private mode */ }
  if (!id) {
    id = uuidLocal();
    try { sessionStorage.setItem(OWNER_KEY, id); } catch { /* private mode */ }
  }
  return id;
}
function uuidLocal(): string {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const b = new Uint8Array(16); c.getRandomValues(b);
    b[6] = 0x70 | (b[6] & 0x0f); b[8] = 0x80 | (b[8] & 0x3f);
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  return `t-${Date.now()}-${Math.floor(Math.random()*1e9)}`;
}

let durableUp = false;
let durableApi: {
  push: (p: QueuedPrompt) => void;
  remove: (id: string) => boolean;
  list: () => (OutboxRow & { owner?: string })[];
  clear: () => void;
  claim: (ids: string[], owner: string) => number;
  ownedBy: (row: unknown, owner: string) => boolean;
} | null = null;

/** Open the durable store and switch the queue onto it. Resolves false when
 *  IndexedDB is unavailable — the callers then keep the sessionStorage path. */
export async function initDurableQueue(): Promise<boolean> {
  const ok = await startDurableStore();
  if (!ok) return false;
  durableUp = true;
  // Stamp ownership on rows THIS tab wrote before the store was ready (rare,
  // but a fast reload could have landed rows through the fallback path).
  claimRowsForOwner([...tabQueueIds()], tabOwner());
  durableApi = {
    push: (p) => { enqueueOutbox(p.text, { mode: p.mode, sessionId: p.sessionId, id: p.id, now: p.queuedAt, });
      claimRowsForOwner([p.id], tabOwner()); syncStoreFromDurable(); },
    remove: (id) => dequeueOutbox(id),
    list: () => outboxList() as (OutboxRow & { owner?: string })[],
    clear: () => clearDurable(),
    claim: (ids, owner) => claimRowsForOwner(ids, owner),
    ownedBy: (row, owner) => rowOwnedBy(row, owner),
  };
  syncStoreFromDurable();
  return true;
}
export const durableQueueReady = () => durableUp && durableApi != null;

/** Fault-injection seam: null restores the sessionStorage path. */
export function __setDurableApi(api: typeof durableApi) { durableApi = api; durableUp = api != null; }

/** The tab's own sessionStorage ids, so pre-durable writes can be claimed. */
function tabQueueIds(): string[] {
  try {
    const raw = sessionStorage.getItem(TAB_QUEUE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((q: { id?: unknown }) => String(q?.id ?? "")) : [];
  } catch { return []; }
}

/** Rows this tab may act on: owned by this tab, or unowned (adoptable). */
export function visibleQueue(): QueuedPrompt[] {
  const owner = tabOwner();
  const rows = durableApi ? durableApi.list() : [];
  const owned = rows.filter((r) => rowOwnedBy(r, owner));
  return owned.map((r) => ({ id: r.id, text: r.text, queuedAt: r.queuedAt, mode: r.mode as QueuedPrompt["mode"], sessionId: r.sessionId }));
}

function syncStoreFromDurable() {
  if (!durableApi) return;
  useWsStore.setState({ queue: visibleQueue() });
}

// OVERRIDE the helpers to route through the durable store when it is up.
// The zustand actions above still own the sessionStorage path untouched.
export function wsQueuePushDurable(p: QueuedPrompt) {
  if (durableApi) { durableApi.push(p); return; }
  wsGet().enqueue(p);
}
