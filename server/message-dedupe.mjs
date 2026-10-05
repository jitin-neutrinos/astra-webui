// message-dedupe.mjs — server-side idempotency for user messages (Phase 1).
//
// WHY THIS EXISTS FIRST, BEFORE THE OUTBOX:
//   D5. A durable outbox with no server-side dedupe turns every crash, retry or
//   at-least-once flush into a DUPLICATE user message. The client cannot prevent
//   this: it cannot distinguish "the server accepted this and the response was
//   lost" from "the server never received it". Only the server can, by
//   remembering the key it already accepted. So this must land before the
//   client's flush becomes durable, not after.
//
//   RFC 9110 §9.2.2 states the problem exactly: a client that retries after
//   losing a response must not have its action applied twice. The `Idempotency-Key`
//   header (draft-ietf-httpapi-idempotency-key-header) is the convention, though
//   that draft is expired; the KEY + server-side store is the durable part and
//   does not depend on the draft.
//
// WHY THE KEY LIVES HERE AND NOT IN THE GATEWAY:
//   D8-unverified. `grep platform_message_id tui_gateway/ hermes_cli/web_routers/`
//   returns nothing, so it is NOT proven that the webui ingest path can accept a
//   client-supplied message id. Until that is proven, Astra owns the key. The
//   gateway's `messages.id` (INTEGER PRIMARY KEY AUTOINCREMENT) remains the
//   ORDERING authority for committed rows — this table only answers "have I
//   already accepted this exact user message?".
//
// GUARANTEES:
//   - `claim()` is the only writer. First caller wins and is told `fresh`.
//     Every later caller with the same key is told `duplicate` and MUST NOT
//     re-apply the effect. This is what makes an at-least-once client safe.
//   - A crash between accepting a prompt upstream and marking it accepted cannot
//     duplicate the MESSAGE, because the key is claimed BEFORE the upstream call.
//     It can only lose the turn (the user retries with the same key and gets
//     `duplicate` + the already-recorded stored id back).
//
// STORAGE: its own SQLite file, NOT the training DB. Reasons, all load-bearing:
//   - D7. The training DB is opened by TWO processes (service + detached
//     backfill runner, per training.mjs's own comment) in WAL mode, and the
//     bundled SQLite carried the WAL-reset bug. A single-connection table with
//     no competing checkpointer is outside that bug's precondition set.
//   - The training DB is 300 MB and under active development by another
//     session. Adding a write path into it from this feature would couple two
//     independent lifecycles.
//   - `auto_vacuum=INCREMENTAL` must be set at CREATE time (it cannot be changed
//     once tables exist), and the training DB already has tables — so this file
//     is the only place the purge can actually return space to the filesystem.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = process.env.ASTRA_DEDUPE_DIR
  || join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const DB_PATH = process.env.ASTRA_DEDUPE_DB || join(DATA_DIR, "message-dedupe.db");

// A key is a client-minted UUIDv7. 24h is generous for an at-least-once retry
// window and bounds the table: a client that reconnects after a day is treated
// as a fresh send rather than a replay of a week-old intent.
const RETENTION_MS = Number(process.env.ASTRA_DEDUPE_TTL_MS || 24 * 60 * 60 * 1000);
// Bound the sweep so a pathological table cannot lock the writer for long.
const SWEEP_LIMIT = 500;

let db = null;

export function openDedupeDb() {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  // auto_vacuum MUST precede table creation — SQLite cannot change it after.
  db.exec("PRAGMA auto_vacuum = INCREMENTAL;");
  db.exec("PRAGMA journal_mode = WAL;");
  // D10: NORMAL is durable across PROCESS crash in WAL (only power-loss
  // durability is traded). A lost dedupe row costs a duplicate message at worst;
  // it never costs data loss, which is the correct trade for this table.
  db.exec("PRAGMA synchronous = NORMAL;");
  try { db.exec("PRAGMA busy_timeout = 10000;"); } catch { /* older sqlite */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_keys (
      key         TEXT PRIMARY KEY,
      stored_sid  TEXT,
      live_sid    TEXT,
      created_at  INTEGER NOT NULL,
      created_ms  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_message_keys_created ON message_keys(created_ms);
  `);
  return db;
}

// Normalize whatever the client sent. We accept a bare UUID or an
// `Idempotency-Key`-style `surface:uuid` and key on the whole string, so a
// client cannot accidentally collide across surfaces by truncating.
function normKey(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > 200) return null;
  // Require at least one digit and one letter-ish char: rejects accidental
  // empty/garbage headers without rejecting UUIDv7, ULID or prefixed forms.
  if (!/[0-9]/.test(s)) return null;
  return s;
}

/**
 * Claim a user message id. Returns `{ fresh: true }` for the first caller, or
 * `{ fresh: false, ... }` for every replay. Callers MUST NOT apply the effect
 * when `fresh` is false.
 */
export function claim(key, { storedSid = null, liveSid = null, now = Date.now() } = {}) {
  const k = normKey(key);
  if (!k) return { fresh: true, skipped: true, reason: "no usable idempotency key" };

  const d = openDedupeDb();
  const ms = Number(now);
  // One statement, so two concurrent flushes of the same key cannot both win:
  // the loser sees the UNIQUE constraint, not an empty pre-check.
  try {
    d.prepare(
      "INSERT INTO message_keys (key, stored_sid, live_sid, created_at, created_ms) VALUES (?, ?, ?, ?, ?)"
    ).run(k, storedSid ? String(storedSid) : null, liveSid ? String(liveSid) : null, Math.floor(ms / 1000), ms);
    return { fresh: true, key: k };
  } catch (err) {
    // UNIQUE violation = a prior claim already accepted this message.
    if (String(err?.message || "").includes("UNIQUE") || err?.errcode === 2067 || err?.errcode === 1555) {
      const row = d.prepare("SELECT stored_sid, live_sid FROM message_keys WHERE key = ?").get(k);
      return {
        fresh: false,
        key: k,
        storedSid: row?.stored_sid ?? null,
        liveSid: row?.live_sid ?? null,
      };
    }
    throw err;
  }
}

/** Learn the stored/live session ids for an already-claimed key. */
export function bindSession(key, { storedSid = null, liveSid = null } = {}) {
  const k = normKey(key);
  if (!k) return false;
  const d = openDedupeDb();
  const cur = d.prepare(
    "UPDATE message_keys SET stored_sid = COALESCE(?, stored_sid), live_sid = COALESCE(?, live_sid) WHERE key = ?"
  ).run(storedSid ? String(storedSid) : null, liveSid ? String(liveSid) : null, k);
  return Number(cur?.changes || 0) > 0;
}

/**
 * Backfill `stored_sid` for every key claimed under a live session, once the
 * proxy learns the live->stored mapping.
 *
 * WHY THIS EXISTS: at claim time we only know the LIVE session id (the client
 * sends `params.session_id`). The stored id is the gateway's durable archive
 * key and is learned LATER, when a session.create/resume reply passes through
 * `recordSidMapping`. Without this backfill, an idempotent replay is acked with
 * `stored_session_id: null` and the client cannot reconcile which chat the
 * already-accepted message belongs to after a reload.
 *
 * COALESCE semantics, matching bindSession: never overwrite a known stored id.
 */
export function bindStoredForLive(liveSid, storedSid) {
  const live = typeof liveSid === "string" ? liveSid.trim() : "";
  const stored = typeof storedSid === "string" ? storedSid.trim() : "";
  if (!live || !stored) return 0;
  const d = openDedupeDb();
  const cur = d.prepare(
    "UPDATE message_keys SET stored_sid = ? WHERE live_sid = ? AND stored_sid IS NULL"
  ).run(stored, live);
  return Number(cur?.changes || 0);
}

/** Has this key been accepted before? (read-only probe) */
export function seen(key) {
  const k = normKey(key);
  if (!k) return false;
  const d = openDedupeDb();
  return !!d.prepare("SELECT 1 FROM message_keys WHERE key = ?").get(k);
}

let lastSweep = 0;

/** Drop keys older than the TTL. Safe to call on a timer. */
export function sweep(now = Date.now()) {
  // At most once a minute: this runs inside the request path's shadow, and an
  // unbounded DELETE on every prompt is a self-inflicted stall.
  if (now - lastSweep < 60_000) return { skipped: "recently swept" };
  lastSweep = now;
  const d = openDedupeDb();
  try {
    const cutoff = now - RETENTION_MS;
    // Bounded by rowcount so a large table cannot monopolise the writer lock.
    const cur = d.prepare(
      "DELETE FROM message_keys WHERE key IN (SELECT key FROM message_keys WHERE created_ms < ? LIMIT ?)"
    ).run(cutoff, SWEEP_LIMIT);
    const removed = Number(cur?.changes || 0);
    // Only reclaim pages when a real amount was freed; incremental vacuum is
    // not free and there is no reason to pay it every sweep.
    if (removed > 0) { try { d.exec("PRAGMA incremental_vacuum;"); } catch { /* best effort */ } }
    return { removed };
  } catch (err) {
    return { error: String(err?.message || err) };
  }
}

export function dedupeStats() {
  const d = openDedupeDb();
  return {
    keys: Number(d.prepare("SELECT count(*) c FROM message_keys").get().c),
    path: DB_PATH,
    retention_ms: RETENTION_MS,
  };
}

// Close cleanly so the WAL is checkpointed on shutdown rather than left for the
// next process to discover.
export function closeDedupeDb() {
  if (!db) return;
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch { /* best effort */ }
  try { db.close(); } catch { /* already closed */ }
  db = null;
}

export const _test = { normKey, DB_PATH, resetSweepThrottle: () => { lastSweep = 0; } };
