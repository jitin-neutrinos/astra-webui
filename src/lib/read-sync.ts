// TinyBase client-state layer (2026-10-01).
// MergeableStore = native CRDT → read markers, presence, and per-tab focus
// written from phone + desktop + N tabs merge deterministically, no conflicts.
// Syncs over BroadcastChannel (instant same-browser tabs) + a small HTTP poll
// of the proxy's /api/read-state (server watermark is durable truth; the CRDT
// layer is the fast path). Server-side "ws synchronizer" was evaluated and
// skipped: our proxy already owns a WS relay, and the read-state set is tiny —
// the existing relay carries the live session.read frames instead.
import { createMergeableStore } from "tinybase";

const DEVICE_KEY = "astra_device_id_v1";

export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() || Math.random().toString(36).slice(2)).slice(0, 12);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch { return "unknown"; }
}

const store = createMergeableStore();

// schema: table "read"    → { [storedKey]: { last_read_at: sec, device } }
//        table "presence" → { [device]:    { focus, at } }
//        table "meta"     → { ring: { v }, sync: { at } }
store.setTablesSchema({
  read: { last_read_at: { type: "number", default: 0 }, device: { type: "string", default: "" } },
  presence: { focus: { type: "string", default: "" }, at: { type: "number", default: 0 } },
  meta: { v: { type: "number", default: 0 }, at: { type: "number", default: 0 } },
});

// --- cross-tab fast path (BroadcastChannel via TinyBase) ----------------------
let bcStarted = false;
export async function startTabSync(): Promise<void> {
  if (bcStarted || typeof window === "undefined") return;
  bcStarted = true;
  try {
    const { createBroadcastChannelSynchronizer } = await import("tinybase/synchronizers/synchronizer-broadcast-channel");
    const sync = createBroadcastChannelSynchronizer(store, "astra-read-state");
    await sync.startSync();
  } catch (e) {
    console.warn("[read-sync] tab sync unavailable:", e);
  }
}

// --- server watermark mirror (durable truth → CRDT layer) ---------------------
let timer: number | null = null;

export async function pullServerMarks(): Promise<void> {
  try {
    const res = await fetch("/api/read-state");
    if (!res.ok) return;
    const data = await res.json() as { marks?: Record<string, { last_read_at: number; last_read_device?: string }> };
    if (!data?.marks) return;
    const tbl = store.getTable("read");
    for (const [key, rec] of Object.entries(data.marks)) {
      const cur = (tbl as Record<string, { last_read_at?: number }>)?.[key];
      if (!cur || (rec.last_read_at ?? 0) > (cur.last_read_at ?? 0)) {
        store.setRow("read", key, { last_read_at: rec.last_read_at, device: rec.last_read_device || "" });
      }
    }
    store.setCell("meta", "sync", "at", Date.now());
  } catch { /* offline: next tick retries */ }
}

/** Pull on start + every 30s (cheap: server answers from memory). */
export function startServerSync(): void {
  void pullServerMarks();
  if (timer != null || typeof window === "undefined") return;
  timer = window.setInterval(() => void pullServerMarks(), 30_000);
}

// --- writers ------------------------------------------------------------------
export function setReadMark(storedKey: string, atSec: number, device = deviceId()): void {
  store.setRow("read", storedKey, { last_read_at: atSec, device });
}

export function setPresenceFocus(focus: string | null): void {
  store.setRow("presence", deviceId(), { focus: focus || "", at: Math.floor(Date.now() / 1000) });
}

// --- readers (reactive via useCell/useTable in components) ---------------------
export function getReadMark(storedKey: string): number {
  const row = store.getRow("read", storedKey) as { last_read_at?: number } | undefined;
  return (row as any)?.last_read_at ?? 0;
}

export const readStore = store;
