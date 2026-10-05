// durable-outbox.ts — the client's at-least-once outbox, backed by IndexedDB.
//
// WHY THIS EXISTS (and the bug it fixes):
//   src/lib/ws-store.ts persists queued prompts to `sessionStorage`, while its own
//   header comment claims *"pending prompts persist to localStorage so an Android
//   app kill (swipe away, memory pressure) no longer eats a message the user
//   watched 'send'."* sessionStorage dies with the tab. Two fixes collided: a
//   per-tab change (so tab A's prompt stopped leaking into tab B's chat) and a
//   durability change (so the queue outlived a reload) — and the durability claim
//   was silently lost. This module restores it with a store that is BOTH
//   per-tab-scoped and durable.
//
// WHY INDEXEDDB AND NOT localStorage:
//   localStorage fails on every axis that matters here — synchronous (blocks the
//   main thread, the chat-landing typing-lag class), a ~5 MiB ceiling against
//   multi-MB transcripts, and unavailable to workers/service workers. IndexedDB is
//   async, structured-clone, and effectively unbounded.
//
// THE ONE ORIGIN (D3):
//   capacitor.config.ts points the Android app at https://astra.jitinnair.com, so
//   the phone WebView and the desktop browser share ONE origin and one quota.
//   They are still SEPARATE storage partitions, so "a few devices" means N
//   independent caches, not one shared cache. The server is authoritative either
//   way: this store is a CACHE and an OUTBOX, never the archive.
//
// WHY THIS IS NEVER LOAD-BEARING:
//   `navigator.storage.persist()` silently fails on Android WebView — the Chromium
//   "site is important" heuristic needs a bookmarkable origin, which a WebView is
//   not (ionic-team/capacitor#7594 was closed as not_planned). So the OS may
//   reclaim this store. That is acceptable ONLY because the gateway owns session
//   history and re-pull is the authoritative restore path: a lost local store
//   costs a slow first paint, never a lost message. persist() is requested for
//   diagnostics and never assumed.
//
// AT-LEAST-ONCE, NOT EXACTLY-ONCE (D5):
//   Every flush carries the row's `id` as the server's idempotency key, and the
//   server claims it BEFORE forwarding upstream. A crash after the server accepted
//   but before we deleted the row re-sends, and the server answers "already had
//   it" — at-least-once delivery, once-only EFFECT.

import { createStore, type Store } from "tinybase";

export type OutboxMode = "fresh" | "resume";

export type OutboxRow = {
  id: string;
  text: string;
  queuedAt: number;
  mode: OutboxMode;
  sessionId?: string;
  /** Delivery attempts so far (drives backoff; also diagnostics). */
  attempts?: number;
  /** Epoch ms before which we should not retry. */
  nextAttemptAt?: number;
  lastError?: string;
};

/** A session key plus our cursor into the durable stream log. */
export type SessionMeta = {
  storedSid: string;
  liveSid?: string | null;
  /** Highest stream-log seq this client has durably consumed for storedSid. */
  cursor: number;
  updatedAt: number;
};

const DB_NAME = "astra-durable-v1";

// The queue is a handful of pending messages, not an archive. The cap prevents an
// unreachable-server scenario from growing without limit; the newest rows are the
// ones a user just typed, so eviction drops the OLDEST.
const MAX_ROWS = 200;
const MAX_TEXT = 64 * 1024;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // outbox rows expire after a week

type Listener = () => void;
const outboxSubscribers = new Set<Listener>();
const sessionSubscribers = new Set<Listener>();

let store: Store | null = null;
let persister: {
  startAutoLoad: () => Promise<void>;
  stopAutoLoad: () => Promise<void>;
  startAutoSave: () => Promise<void>;
  destroy: () => Promise<void>;
  getPersisted: () => Promise<boolean>;
} | null = null;
let started = false;
let persistedOnce = false;

// ---------------------------------------------------------------- uuidv7 ----
// RFC 9562 §5.7 time-ordered UUID: time-ordered so the store's key order matches
// insertion order, with a random tail so ids stay unique across tabs and devices.
// Hand-rolled deliberately: a dependency for this is not worth it, and
// crypto.randomUUID() is v4 (unordered).
export function uuidv7(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  const c = globalThis.crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);

  const ms = BigInt(now);
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);
  bytes[6] = 0x70 | (bytes[6] & 0x0f); // version 7
  bytes[8] = 0x80 | (bytes[8] & 0x3f); // variant 10xx

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ------------------------------------------------------------------ store ----

function requireStore(): Store {
  if (!store) throw new Error("durable-outbox: startDurableStore() has not resolved");
  return store;
}

/**
 * Open the store and attach the IndexedDB persister. Resolves false when
 * IndexedDB is unavailable (private mode, locked-down WebView) so callers can fall
 * back rather than crash — the memory-only path is still correct for the session.
 */
export async function startDurableStore(): Promise<boolean> {
  if (started) return persistedOnce;
  started = true;

  const s = createStore();
  store = s;
  // Notify on any transaction touching either table. TinyBase v10 has no
  // getTablesTouchedByTransaction, so the check is "did the row count or a
  // known row change" — cheap here because these tables hold tens of rows.
  s.addDidFinishTransactionListener(() => {
    outboxSubscribers.forEach((fn) => { try { fn(); } catch { /* noop */ } });
    sessionSubscribers.forEach((fn) => { try { fn(); } catch { /* noop */ } });
  });

  try {
    const { createIndexedDbPersister } = await import(
      "tinybase/persisters/persister-indexed-db"
    );
    const p = createIndexedDbPersister(s, DB_NAME);
    await p.startAutoLoad();
    await p.startAutoSave();
    persister = p as unknown as typeof persister;
    persistedOnce = true;
    // Best-effort durability request; diagnostics only, never relied upon.
    try { await globalThis.navigator?.storage?.persist?.(); } catch { /* noop */ }
    pruneExpired();
    return true;
  } catch (e) {
    console.warn("[durable-outbox] IndexedDB unavailable, running memory-only:", e);
    persistedOnce = false;
    return false;
  }
}

export async function stopDurableStore() {
  try { await persister?.stopAutoLoad(); } catch { /* noop */ }
  try { await persister?.destroy(); } catch { /* noop */ }
  persister = null;
  store = null;
  started = false;
  persistedOnce = false;
}

/** True when rows are actually on disk (vs. this session's memory only). */
export const durablePersisted = () => persistedOnce;

// --------------------------------------------------------------- outbox API ----

/**
 * Record a user message locally BEFORE it goes on the wire. Returns the row,
 * whose `id` doubles as the server's idempotency key.
 */
export function enqueueOutbox(
  text: string,
  { mode = "fresh", sessionId = undefined, id = uuidv7(), now = Date.now() }: {
    mode?: OutboxMode; sessionId?: string; id?: string; now?: number;
  } = {}
): OutboxRow {
  const s = requireStore();
  const row: OutboxRow = {
    id,
    text: String(text ?? "").slice(0, MAX_TEXT),
    queuedAt: now,
    mode,
    sessionId,
    attempts: 0,
    nextAttemptAt: 0,
  };
  s.setRow("outbox", id, row as never);
  trim();
  return row;
}

/** Remove a row the server has durably accepted. */
export function dequeueOutbox(id: string): boolean {
  const s = requireStore();
  if (!s.hasRow("outbox", id)) return false;
  s.delRow("outbox", id);
  return true;
}

export function outboxList(now = Date.now()): OutboxRow[] {
  const s = requireStore();
  const rows = Object.values(s.getTable("outbox")) as unknown as OutboxRow[];
  return rows
    .filter((r) => r && typeof r.id === "string" && typeof r.queuedAt === "number")
    .filter((r) => now - r.queuedAt < RETENTION_MS)
    .sort((a, b) => a.queuedAt - b.queuedAt || (a.id < b.id ? -1 : 1));
}

/** Rows eligible to send right now (respecting backoff). */
export function outboxReady(now = Date.now()): OutboxRow[] {
  return outboxList(now).filter((r) => (r.nextAttemptAt ?? 0) <= now);
}

/** Record a failed attempt and schedule the retry with exponential backoff. */
export function markAttempt(id: string, error?: string, now = Date.now()): void {
  const s = requireStore();
  const row = s.getRow("outbox", id) as unknown as OutboxRow | undefined;
  if (!row) return;
  const attempts = (row.attempts ?? 0) + 1;
  // 1s, 2s, 4s, 8s, 16s, then hold at 30s. Capped so a long outage cannot push
  // the retry far into the future and quietly cost the message its timeliness.
  const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts - 1, 5));
  s.setPartialRow("outbox", id, {
    attempts,
    nextAttemptAt: now + delay,
    lastError: String(error ?? "").slice(0, 200),
  } as never);
}

export function outboxCount(): number {
  return requireStore().getRowIds("outbox").length;
}

export function subscribeOutbox(fn: Listener): () => void {
  outboxSubscribers.add(fn);
  return () => { outboxSubscribers.delete(fn); };
}

// ------------------------------------------------------- session + cursor ----

export function saveSessionMeta(meta: SessionMeta): void {
  requireStore().setRow("sessions", meta.storedSid, {
    storedSid: meta.storedSid,
    liveSid: meta.liveSid ?? null,
    cursor: meta.cursor ?? 0,
    updatedAt: meta.updatedAt ?? Date.now(),
  } as never);
}

export function getSessionMeta(storedSid: string): SessionMeta | null {
  const row = requireStore().getRow("sessions", storedSid) as unknown as SessionMeta | undefined;
  if (!row || typeof row.storedSid !== "string") return null;
  return {
    storedSid: row.storedSid,
    liveSid: row.liveSid ?? null,
    cursor: Number(row.cursor || 0),
    updatedAt: Number(row.updatedAt || 0),
  };
}

/** Highest seq this client has durably consumed for a session. */
export function getCursor(storedSid: string): number {
  return getSessionMeta(storedSid)?.cursor ?? 0;
}

/**
 * Advance the cursor, never lowering it. A lower value means a stale writer (a
 * tab that has been asleep), and letting it rewind a device that is ahead would
 * replay the same chunks on every reconnect.
 */
export function advanceCursor(storedSid: string, seq: number, liveSid?: string | null): number {
  const prev = getSessionMeta(storedSid);
  const next = Math.max(Number(seq) || 0, prev?.cursor ?? 0);
  saveSessionMeta({
    storedSid,
    liveSid: liveSid ?? prev?.liveSid ?? null,
    cursor: next,
    updatedAt: Date.now(),
  });
  return next;
}

export function listSessionMetas(): SessionMeta[] {
  const rows = Object.values(requireStore().getTable("sessions")) as unknown as SessionMeta[];
  return rows.filter((r) => r && typeof r.storedSid === "string");
}

export function subscribeSessions(fn: Listener): () => void {
  sessionSubscribers.add(fn);
  return () => { sessionSubscribers.delete(fn); };
}

// ---------------------------------------------------------------- hygiene ----

function trim() {
  const s = requireStore();
  if (s.getRowIds("outbox").length <= MAX_ROWS) return;
  const rows = Object.values(s.getTable("outbox")) as unknown as OutboxRow[];
  rows.sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0));
  for (const r of rows.slice(0, Math.max(0, rows.length - MAX_ROWS))) {
    if (r?.id) s.delRow("outbox", r.id);
  }
}

/** Remove expired and malformed rows. Called on start; the table is small. */
export function pruneExpired(now = Date.now()): number {
  const s = requireStore();
  let n = 0;
  for (const r of Object.values(s.getTable("outbox")) as unknown as OutboxRow[]) {
    if (!r || typeof r.id !== "string" || typeof r.queuedAt !== "number") {
      if (r && typeof (r as { id?: unknown }).id === "string") s.delRow("outbox", r.id);
      n++;
      continue;
    }
    if (now - r.queuedAt >= RETENTION_MS) { s.delRow("outbox", r.id); n++; }
  }
  return n;
}

/**
 * Stamp rows as belonging to one tab.
 *
 * WHY: IndexedDB is shared by every tab on the origin, so durability alone would
 * reintroduce the tab-leak that src/lib/concurrent-queue.check.ts guards — tab A's
 * pending prompt flushing into tab B's chat. Each tab claims only the rows it
 * wrote; unclaimed rows (a legacy adoption, or a write that raced) stay visible to
 * every tab so a pending message is never orphaned.
 *
 * Owner is written ONCE per row: a second tab must never steal a row that already
 * has an owner, or two tabs would both consider it theirs.
 */
export function claimRowsForOwner(ids: string[], owner: string): number {
  const s = requireStore();
  let n = 0;
  for (const id of ids) {
    // hasRow BEFORE setPartialRow, deliberately. TinyBase's setPartialRow CREATES
    // a row that does not exist, so without this guard a bogus id would be
    // conjured into a real pending message — a phantom row nothing ever sent.
    if (!s.hasRow("outbox", id)) continue;
    const row = s.getRow("outbox", id) as unknown as (OutboxRow & { owner?: string }) | undefined;
    if (!row || row.owner) continue; // already claimed — never steal
    s.setPartialRow("outbox", id, { owner } as never);
    n++;
  }
  return n;
}

/** True when this row is owned by `owner` (or unowned, hence adoptable). */
export function rowOwnedBy(row: unknown, owner: string): boolean {
  const o = (row as { owner?: string } | null)?.owner;
  return !o || o === owner;
}

export function durableStats() {
  const s = requireStore();
  return {
    outbox: s.getRowIds("outbox").length,
    sessions: s.getRowIds("sessions").length,
    persisted: persistedOnce,
    db: DB_NAME,
    retention_ms: RETENTION_MS,
    max_rows: MAX_ROWS,
  };
}

/** Wipe everything (a "forget this device" action). */
export function clearDurable(): void {
  const s = requireStore();
  for (const id of s.getRowIds("outbox")) s.delRow("outbox", id);
  for (const id of s.getRowIds("sessions")) s.delRow("sessions", id);
}

export const _test = { DB_NAME, MAX_ROWS, RETENTION_MS, MAX_TEXT };
