// Persistent per-tab outbox: messages composed while the transport (or the
// session) was unavailable, or explicitly /bg-queued while a turn was live.
// sessionStorage = survives reload, never leaks across tabs (the same
// per-tab discipline as the session id itself — see hermes-ws.ts).
//
// The inbox side (Astra → user) is durable in the GATEWAY's session history;
// the client never persists assistant content — resume + /messages re-pull is
// the authoritative restore path. This outbox only guards the USER's own
// outgoing words, which no server knows about until they're on the wire.

export type OutboxItem = {
  id: string;
  text: string;
  queuedAt: number;
  kind: "offline" | "bg"; // why it's waiting: transport down, or /bg run-after
};

const KEY = "astra-outbox";

function readAll(): OutboxItem[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x.text === "string") : [];
  } catch { return []; }
}

function writeAll(items: OutboxItem[]) {
  try { sessionStorage.setItem(KEY, JSON.stringify(items.slice(-20))); } catch { /* private mode */ }
}

export function outboxList(): OutboxItem[] { return readAll(); }

export function outboxPush(kind: "offline" | "bg", text: string): OutboxItem {
  const item: OutboxItem = { id: `ob${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, queuedAt: Date.now(), kind };
  writeAll([...readAll(), item]);
  return item;
}

export function outboxRemove(id: string) {
  writeAll(readAll().filter((x) => x.id !== id));
}

export function outboxClear() { writeAll([]); }

// The optimistic chat row id for an outbox item, so a restored bubble can be
// reconciled with its queue state (pending chip → sent).
export function outboxRowId(item: OutboxItem): string { return item.id; }
