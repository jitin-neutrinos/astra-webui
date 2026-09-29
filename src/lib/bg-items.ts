export type BgItemStatus = "queued" | "running" | "done";
export type BgItemKind = "bg" | "steer";

export interface BgItem {
  id: number;
  kind: BgItemKind;
  text: string;
  status: BgItemStatus;
  dismissed?: boolean;
  // id of the assistant turn (ChatMsg.id) whose reply answers this item
  replyMsgId?: string;
}

// Per-chat persistence (localStorage). Covers reload + same-browser revisit.
// ponytail: browser-local only — cross-device sync of these decorations needs a
// server store; add when the owner actually wants bg history on another device.
const key = (sid: string) => `bg_items_${sid}`;

type Store = {
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
};
export type { Store };

const defaultStore = (): Store | null => {
  try { return globalThis.localStorage; } catch { return null; }
};

export function loadItems(sid: string, store: Store | null = defaultStore()): BgItem[] {
  if (!sid || !store) return [];
  try {
    const raw = store.getItem(key(sid));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((it: BgItem) => it && typeof it.id === "number" && typeof it.text === "string") : [];
  } catch {
    return [];
  }
}

export function saveItems(sid: string, items: BgItem[], store: Store | null = defaultStore()): void {
  if (!sid || !store) return;
  try {
    if (items.length === 0) store.removeItem(key(sid));
    else store.setItem(key(sid), JSON.stringify(items));
  } catch { /* quota/private mode: dock just won't persist */ }
}

// Monotonic id: Date.now() alone collides when two items are created in the same ms
// (two quick /bg submits), which made dismissItem kill both. lastId floors each new
// id above every id this process has minted.
let lastId = 0;
export function createItem(kind: BgItemKind, text: string, isLive: boolean, _existing?: BgItem[]): BgItem {
  let status: BgItemStatus;
  if (kind === "steer") {
    status = "running";
  } else {
    status = isLive ? "queued" : "running";
  }
  const id = Math.max(Date.now(), lastId + 1);
  lastId = id;
  return { id, kind, text, status };
}

export function onTurnComplete(items: BgItem[]): BgItem[] {
  const nextItems = items.map(it => it.status === "running" ? { ...it, status: "done" as BgItemStatus } : it);
  const oldestQueuedIdx = nextItems.findIndex(it => it.status === "queued");
  if (oldestQueuedIdx !== -1) {
    nextItems[oldestQueuedIdx] = { ...nextItems[oldestQueuedIdx], status: "running" };
  }
  return nextItems;
}

export function reconcileWithServer(items: BgItem[], snapshot: { queued: { user: string } | null, running: boolean }): BgItem[] {
  if (!snapshot.running && !snapshot.queued) {
    // Server is fully idle: nothing queued, nothing executing. Any running item whose
    // completion frame was missed (back-to-back queue drains can race) is done by definition.
    return items.map(it => it.status !== "done" ? { ...it, status: "done" as BgItemStatus } : it);
  }
  if (snapshot.queued) {
    const qUser = snapshot.queued.user;
    const matchIdx = items.findIndex(it => it.status === "queued" && it.text === qUser);
    const firstQueuedIdx = items.findIndex(it => it.status === "queued");
    if (matchIdx !== -1 && matchIdx !== firstQueuedIdx) {
      const matchItem = items[matchIdx];
      const result: BgItem[] = [];
      let placedMatch = false;
      for (const it of items) {
        if (it.status === "queued") {
          if (!placedMatch) {
            result.push(matchItem);
            placedMatch = true;
          }
          if (it.id !== matchItem.id) {
            result.push(it);
          }
        } else {
          result.push(it);
        }
      }
      return result;
    }
  }
  return items;
}

// Dock shows everything not explicitly dismissed — done items stay until the user
// clears them (owner mandate: persist until dismissed).
export function dockVisible(items: BgItem[]): boolean {
  return items.some(it => !it.dismissed);
}

export function dismissItem(items: BgItem[], id: number): BgItem[] {
  return items.map(it => it.id === id ? { ...it, dismissed: true } : it);
}
