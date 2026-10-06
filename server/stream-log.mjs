// stream-log.mjs — durable append-only log of every LLM stream chunk (Phase 2).
//
// WHY THIS IS THE ONLY DURABLE RECORD (D9):
//   The gateway coalesces token deltas at ~30 fps (tui_gateway/ws.py
//   _TOKEN_COALESCE_S = 0.033) and then DISCARDS them — only the final message
//   row survives. Its replay ring is in-process memory (512 events / 4 MiB per
//   session) and dies with the process; `replay_epoch` exists precisely because
//   a restart resets the counters. The HTTP stream route writes no `id:` line,
//   so Last-Event-ID resume is structurally impossible there either.
//
//   Net effect: today, if Astra crashes mid-answer, that answer is GONE. This log
//   is what makes it recoverable. It is not belt-and-braces duplication.
//
// WHY CHUNK BODIES vs REFERENCES (D2):
//   Prose (text / thinking / reasoning) and canvas fences are recorded in full:
//   they are small (assistant rows average 166 B) and have no other durable
//   copy. Tool RESULT payloads are recorded as a REFERENCE to the gateway's own
//   message row instead of a copy — tool rows are 74,138 of 149,060 rows and
//   average 2,902 B, i.e. the overwhelming majority of the 233 MB corpus, and
//   they are ALREADY durably stored in ~/.hermes/state.db keyed by
//   (session_id, id). Re-logging them would duplicate the single largest corpus
//   for zero benefit.
//
// STORAGE (D7 / D10):
//   Its own file. `auto_vacuum = INCREMENTAL` MUST be set before the first table
//   (SQLite cannot change it afterwards) so retention can actually return space.
//   `synchronous = NORMAL` — measured 58x faster per-chunk autocommit, and in WAL
//   mode NORMAL is still durable across a PROCESS crash; only power-loss
//   durability is traded. For this table the worst case is "re-pull the final
//   message from the gateway", which makes that trade correct.
//
//   Single-connection (the service only) with default auto-checkpointing: that is
//   the configuration SQLite documents as safe from the WAL-reset bug, and it is
//   deliberately kept. NEVER add a background `wal_checkpoint` thread or process
//   against this file — that is the one change that would move this store into
//   the bug's blast radius.
//
// ORDERING (D8):
//   Rows are keyed by the GATEWAY's own per-session monotonic `seq`
//   (tui_gateway/event_replay.py stamps `params.seq` on every event frame), not
//   by a timestamp and not by a client clock. Reconnect is a plain
//   `WHERE seq > :cursor` read. That is the same contract OpenAI's
//   `starting_after=cursor` and Slack's `ts` use.
//
// WRITE PATH: called from hermes-proxy's broadcastFrame BEFORE the socket write.
// If the socket write fails, the log still has the chunk — which is the point.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = process.env.ASTRA_STREAM_DIR
  || join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const DB_PATH = process.env.ASTRA_STREAM_DB || join(DATA_DIR, "stream-log.db");

// Retention (D1): 14 days, matching the gateway's own auto_archive_days.
const RETENTION_MS = Number(process.env.ASTRA_STREAM_TTL_MS || 14 * 24 * 60 * 60 * 1000);

// A single chunk is capped so one pathological tool result cannot balloon a row.
// Tool payloads are references anyway, so this only ever bites malformed input.
const MAX_INLINE_BYTES = Number(process.env.ASTRA_STREAM_MAX_INLINE || 64 * 1024);

// How many chunks one insert statement batches. Fewer syscalls on a hot stream.
const BATCH_MAX = Number(process.env.ASTRA_STREAM_BATCH_MAX || 64);

// --- the body-or-reference line (D2) ---------------------------------------
// Bodies: the prose that has no other durable record.
// References: tool output, which the gateway already stores in state.db.
const BODY_TYPES = new Set([
  "message.delta",
  "thinking.delta",
  "reasoning.delta",
  "message.start",
  "message.complete",
  "message.error",
  "gate",
  "approval",
  "clarify",
  "done",
  "run",
]);
const REFERENCE_TYPES = new Set([
  "tool.start",
  "tool.update",
  "tool.done",
  "tool.result",
]);

let db = null;
let pending = [];
let flushTimer = null;
let lastFlushError = null;

// The gateway's per-session seq counter lives in ITS process memory, so a
// gateway restart resets it to 1 (event_replay.py: "Seq counters live
// in-process, so a restart resets them to 1 while clients hold high watermarks").
// That makes (sid, seq) NOT unique across a restart: the very next chunk of a live
// session collides with the first one logged before the restart.
//
// Measured before this fix: after logging seq 1..3, restarting, then logging seq
// 1..2 again, the two post-restart chunks were SILENTLY DROPPED by
// INSERT OR IGNORE — a permanent hole in the replay, which is the one thing this
// log exists to prevent.
//
// The gateway already hands out the discriminator: `replay_epoch()`, an opaque
// per-process token echoed in gateway.ready. Scoped to Astra, we cannot read the
// gateway's epoch directly from an event frame, so the epoch is derived from a
// value that DOES change on restart: the process start time. Both are per-process
// identities, and the property we need is only "different after a restart".
let EPOCH = "";
function currentEpoch() {
  if (EPOCH) return EPOCH;
  // boot time, seconds since the epoch — stable within a process, different after.
  const bootSec = Math.floor(Date.now() / 1000) - Math.round(process.uptime());
  EPOCH = bootSec.toString(36);
  return EPOCH;
}

export function openStreamDb() {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  // MUST precede table creation — SQLite cannot change auto_vacuum afterwards.
  db.exec("PRAGMA auto_vacuum = INCREMENTAL;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  try { db.exec("PRAGMA busy_timeout = 10000;"); } catch { /* older sqlite */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS stream_events (
      sid        TEXT    NOT NULL,
      epoch      TEXT    NOT NULL,          -- per-gateway-process discriminator
      seq        INTEGER NOT NULL,
      mono       INTEGER NOT NULL,          -- per-session monotonic, restart-safe
      type       TEXT    NOT NULL,
      kind       TEXT    NOT NULL,          -- 'body' | 'ref'
      ref_sid    TEXT,                      -- gateway row pointer (kind='ref')
      ref_row    TEXT,
      headline   TEXT,                      -- short, inline, for collapsed render
      payload    TEXT,                      -- JSON; the chunk body (kind='body')
      ts_ms      INTEGER NOT NULL,
      PRIMARY KEY (sid, epoch, seq)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_stream_events_ts ON stream_events(ts_ms);
    CREATE INDEX IF NOT EXISTS idx_stream_events_mono ON stream_events(sid, mono);
  `);
  // Seed the per-session counters from disk so this process's own mono stream
  // continues after the highest row already stored — NEVER restarts at 1 over
  // rows it cannot see. (Without this, a relay restart interleaves new mono-1..
  // rows with migrated/live rows and replay order breaks.) Idempotent.
  try {
    const rows = db.prepare("SELECT sid, max(mono) m FROM stream_events GROUP BY sid").all();
    for (const r of rows) monoCounters.set(String(r.sid), Number(r.m || 0));
  } catch { /* fresh db: nothing to seed */ }
  return db;
}

/**
 * Assign the next per-session monotonic counter.
 *
 * `seq` is the gateway's number, which RESETS on restart. `mono` is ours: it is
 * strictly increasing per session for the lifetime of this log, so replay order is
 * well-defined even when two chunks from different gateway processes carry the
 * same seq. Ordering for READS uses `mono`; `seq` stays for the "what did the
 * gateway say" question and for matching gateway replies.
 */
let monoCounters = new Map();
function nextMono(sid) {
  const cur = monoCounters.get(sid) ?? 0;
  const next = cur + 1;
  monoCounters.set(sid, next);
  return next;
}

/** Seed the counter from disk so a restart of THIS process keeps ordering. */
function loadMono() {
  try {
    const d = openStreamDb();
    const rows = d.prepare("SELECT sid, max(mono) m FROM stream_events GROUP BY sid").all();
    for (const r of rows) monoCounters.set(String(r.sid), Number(r.m || 0));
  } catch { /* first open; nothing to seed */ }
}

function classify(type) {
  if (REFERENCE_TYPES.has(type)) return "ref";
  if (BODY_TYPES.has(type)) return "body";
  return null; // not logged
}

/**
 * Record one gateway event frame. Fire-and-forget, NEVER throws: losing a log
 * row is survivable (the final message still lands in the gateway), so this must
 * never be able to break the relay.
 */
export function recordEvent(params, { now = Date.now() } = {}) {
  try {
    if (!params || typeof params !== "object") return false;
    const type = String(params.type || "");
    const kind = classify(type);
    if (!kind) return false;
    const sid = String(params.session_id || "");
    const seq = Number(params.seq);
    // A frame without a session or without the gateway's own seq cannot be
    // ordered against anything. The gateway stamps seq on every session-scoped
    // event frame; if it ever stops, this log degrades to "no rows" rather than
    // writing rows nobody can replay.
    if (!sid) return false;
    if (!Number.isFinite(seq) || seq < 1) return false;

    const payloadObj = params.payload ?? null;
    let headline = null;
    let refSid = null;
    let refRow = null;
    let body = null;

    if (kind === "ref") {
      // A tool chunk: keep only what a collapsed row needs, and point at the
      // gateway's own durable copy for the body.
      refSid = sid;
      refRow = String(
        payloadObj?.tool_call_id ?? payloadObj?.id ?? payloadObj?.call_id ?? ""
      ) || null;
      headline = toolHeadline(payloadObj);
      // The full tool payload still goes to the client over the socket; we do not
      // copy it here. `body` stays null by design.
    } else {
      // Bodies are stored as JSON. An oversized payload MUST still produce
      // PARSEABLE JSON — a byte-slice at MAX_INLINE_BYTES lands mid-token and
      // produces a string that JSON.parse rejects, which then crashes the READ
      // path (eventsSince) rather than degrading. So: clone, drop the bulk of
      // the text fields, mark it truncated, and only slice as a last resort —
      // and verify the result parses before it is ever queued.
      let obj = payloadObj;
      if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
        try { obj = { ...obj }; } catch { obj = payloadObj; }
      }
      let serialized;
      try {
        serialized = JSON.stringify(obj);
      } catch {
        serialized = null;
      }
      // Not JSON-serialisable (a cycle, a BigInt): store a marker instead of
      // dropping the chunk, so the seq gap is still visible to the replay.
      if (serialized == null) {
        body = JSON.stringify({ _unserialisable: true, type });
      } else if (serialized.length <= MAX_INLINE_BYTES) {
        body = serialized;
      } else {
        // Shrink the known-large string fields first.
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          for (const k of Object.keys(obj)) {
            const v = obj[k];
            if (typeof v === "string" && v.length > 512) {
              obj[k] = v.slice(0, 512) + `…[+${v.length - 512} chars truncated]`;
            }
          }
          obj._truncated = true;
          obj._original_bytes = serialized.length;
        }
        let shrunk = null;
        try { shrunk = JSON.stringify(obj); } catch { /* fall through */ }
        if (shrunk != null && shrunk.length <= MAX_INLINE_BYTES) {
          body = shrunk;
        } else {
          // Still too big after field-shrinking (e.g. many keys): fall back to a
          // small, always-valid envelope rather than a corrupt slice.
          body = JSON.stringify({
            _truncated: true,
            _original_bytes: serialized.length,
            _type: type,
          });
        }
      }
    }

    pending.push([sid, currentEpoch(), seq, nextMono(sid), type, kind, refSid, refRow, headline, body, now]);
    if (pending.length >= BATCH_MAX) flush();
    else if (!flushTimer) {
      // Coalesce a burst into one write. 33ms mirrors the gateway's own token
      // flush cadence, so we add at most one frame of latency to the log and
      // never touch the socket path more than ~30x/second.
      flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 33);
      if (typeof flushTimer.unref === "function") flushTimer.unref();
    }
    return true;
  } catch {
    return false; // never propagate
  }
}

function toolHeadline(p) {
  if (!p || typeof p !== "object") return null;
  const name = p.tool_name || p.name || p.tool || null;
  const cmd = p.command || p.query || p.file_path || p.path || p.url || null;
  if (name && typeof cmd === "string" && cmd) {
    const one = cmd.replace(/\s+/g, " ").trim();
    return `${name}: ${one.length > 100 ? one.slice(0, 100) + "…" : one}`.slice(0, 240);
  }
  if (typeof name === "string" && name) return name.slice(0, 240);
  return null;
}

let insertStmt = null;
function flush() {
  if (!pending.length) return { flushed: 0 };
  const batch = pending;
  pending = [];
  try {
    const d = openStreamDb();
    if (!insertStmt) {
      insertStmt = d.prepare(
        `INSERT OR IGNORE INTO stream_events
           (sid, epoch, seq, mono, type, kind, ref_sid, ref_row, headline, payload, ts_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
    }
    d.exec("BEGIN IMMEDIATE");
    try {
      for (const row of batch) insertStmt.run(...row);
      d.exec("COMMIT");
      lastFlushError = null;
      return { flushed: batch.length };
    } catch (e) {
      try { d.exec("ROLLBACK"); } catch { /* already rolled back */ }
      // A duplicate seq is expected and harmless (INSERT OR IGNORE covers the
      // common case; a hard UNIQUE error means two writers raced) — treat any
      // failure as a logged warning, never as a relay failure.
      lastFlushError = String(e?.message || e);
      return { flushed: 0, error: lastFlushError };
    }
  } catch (e) {
    lastFlushError = String(e?.message || e);
    return { flushed: 0, error: lastFlushError };
  }
}

/** Force any buffered chunks to disk. Called on turn completion and shutdown. */
export function flushNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  return flush();
}

/**
 * Read events for a session after `sinceSeq` (exclusive), ascending.
 * This is the reconnect contract: `WHERE mono > :cursor`.
 *
 * ORDERING AND THE CURSOR USE `mono`, NOT `seq`. The gateway's seq resets to 1 on
 * every restart (event_replay.py), so a client resuming on seq would either skip a
 * whole post-restart turn or re-read everything. `mono` is Astra's own per-session
 * counter: strictly increasing for the life of the log, so it is the only cursor
 * that survives a gateway restart. `seq` is still RETURNED, because the client
 * shows gateway sequence numbers and matches gateway replies against them.
 */
export function eventsSince(sid, sinceSeq = 0, { limit = 5000 } = {}) {
  const d = openStreamDb();
  const rows = d.prepare(
    `SELECT mono, seq, type, kind, ref_sid, ref_row, headline, payload, ts_ms
       FROM stream_events
      WHERE sid = ? AND mono > ?
      ORDER BY mono ASC
      LIMIT ?`
  ).all(String(sid), Number(sinceSeq) || 0, Math.max(1, Math.min(limit, 20000)));
  return rows.map((r) => {
    const out = {
      mono: Number(r.mono),
      seq: Number(r.seq),
      type: r.type,
      kind: r.kind,
      ...(r.ref_sid ? { ref_sid: r.ref_sid, ref_row: r.ref_row } : {}),
      ...(r.headline ? { headline: r.headline } : {}),
      ts_ms: Number(r.ts_ms),
    };
    if (r.payload) {
      // Never let a bad row crash the replay: a client asking for its missed
      // chunks must get a gap it can refetch, not a 500.
      try {
        out.payload = JSON.parse(r.payload);
      } catch {
        out.payload = { _corrupt: true };
        out._corrupt_payload = true;
      }
    }
    return out;
  });
}

/** Highest logged cursor for a session (what the client resumes from). */
export function latestSeq(sid) {
  const d = openStreamDb();
  const row = d.prepare("SELECT max(mono) m FROM stream_events WHERE sid = ?").get(String(sid));
  return Number(row?.m || 0);
}

/**
 * True when events between `sinceSeq` and the oldest retained row were PURGED by
 * retention — the client must refetch history instead of trusting the replay.
 * Distinct from a mere gap (which can be a non-stream frame we chose not to log).
 */
/**
 * True when events between `sinceSeq` and the oldest RETAINED row are actually
 * MISSING — as opposed to never having been kept.
 *
 * WHY THIS IS SUBTLE, AND WHY THE OBVIOUS VERSION IS WRONG:
 *   The gateway's `seq` is monotonic per session but NOT dense — it counts every
 *   frame it emits, while this log deliberately stores only the ones that matter
 *   (prose, tool chunks, turn boundaries). Transport chatter, presence and
 *   session-list frames sit between them and are never stored. Measured on a
 *   live session: 966 stored rows spanning seq 8289..9553, i.e. `since=0` sits
 *   8,288 seq-values below the oldest kept row.
 *
 *   The naive test `since + 1 < min(seq)` therefore reports `truncated` for
 *   EVERY session, and a client obeying it would refetch full history on every
 *   fresh load. That is a real defect this check caught, not a hypothetical.
 *
 *   So the distinction that matters is: was a row DELETED (retention, or a
 *   bounded purge batch), or was it never eligible in the first place? Only the
 *   first is a hole the client must refetch around.
 *
 *   The purge watermark is the only evidence of the first case, because after a
 *   delete the rows are gone. A session that never streamed has no watermark and
 *   no rows, and is correctly NOT truncated.
 */
export function isTruncated(sid, sinceSeq) {
  const key = String(sid);
  const since = Number(sinceSeq || 0);
  const purged = _purgeWatermark.get(key) || 0;

  // Retention removed rows this client still needed. This is the ONLY case that
  // is a genuine hole: the purge watermark is the evidence, because after a
  // delete the rows themselves are gone and nothing else distinguishes "deleted"
  // from "never eligible". A session that never streamed has neither rows nor a
  // watermark, and is correctly NOT truncated.
  return purged > 0 && since < purged;
}

/**
 * Highest seq purged per session. Without this, a client cannot distinguish
 * "never streamed" from "everything I needed was deleted" — both look like an
 * empty log, and the first must not trigger a refetch storm while the second
 * must.
 */
const _purgeWatermark = new Map();

/**
 * Retention (D1): drop events older than the TTL. Returns what it removed and
 * frees pages only when a meaningful amount was reclaimed.
 */
export function purgeOlderThan(now = Date.now(), { limit = 20000 } = {}) {
  flushNow();
  const d = openStreamDb();
  try {
    const cutoff = now - RETENTION_MS;
    // WITHOUT ROWID tables have NO rowid column — a `WHERE rowid IN (...)`
    // subquery silently matches nothing and retention becomes a no-op that
    // still reports success. Cut on the PRIMARY KEY instead, with a bounded
    // batch on the subquery.
    // The purge boundary MUST be captured BEFORE the delete: afterwards the rows
    // are gone and there is nothing left to compute a watermark from. The
    // watermark is `mono` (our cursor), NOT `seq` — the client's cursor is a
    // mono value, so a seq watermark would be compared against the wrong space.
    const doomed = d.prepare(
      `SELECT sid, max(mono) AS hi FROM stream_events
        WHERE ts_ms < ? GROUP BY sid`
    ).all(cutoff);

    const cur = d.prepare(
      `DELETE FROM stream_events WHERE (sid, epoch, seq) IN (
         SELECT sid, epoch, seq FROM stream_events WHERE ts_ms < ? LIMIT ?)`
    ).run(cutoff, Math.max(1, limit));
    const removed = Number(cur?.changes || 0);

    // Raise the watermark per session (never lower it — a partial batch must not
    // make an earlier purge look undone).
    for (const r of doomed) {
      const sid = String(r.sid);
      const hi = Number(r.hi || 0);
      if (hi > (_purgeWatermark.get(sid) || 0)) _purgeWatermark.set(sid, hi);
    }
    if (removed > 0) { try { d.exec("PRAGMA incremental_vacuum;"); } catch { /* best effort */ } }
    return { removed, sessions: doomed.length };
  } catch (e) {
    return { removed: 0, error: String(e?.message || e) };
  }
}

export function streamStats() {
  const d = openStreamDb();
  return {
    sessions: Number(d.prepare("SELECT count(DISTINCT sid) c FROM stream_events").get().c),
    events: Number(d.prepare("SELECT count(*) c FROM stream_events").get().c),
    bodies: Number(d.prepare("SELECT count(*) c FROM stream_events WHERE kind='body'").get().c),
    refs: Number(d.prepare("SELECT count(*) c FROM stream_events WHERE kind='ref'").get().c),
    bytes: Number(d.prepare("SELECT sum(length(coalesce(payload,''))) c FROM stream_events").get().c),
    pending: pending.length,
    last_error: lastFlushError,
    path: DB_PATH,
    retention_ms: RETENTION_MS,
  };
}

export function closeStreamDb() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  flushNow();
  if (!db) return;
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch { /* best effort */ }
  try { db.close(); } catch { /* already closed */ }
  db = null;
  insertStmt = null;
}

export const _test = { classify, toolHeadline, DB_PATH, RETENTION_MS, currentEpoch, loadMono, resetBuffers: () => { pending = []; if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; } }, setEpochForTest: (e) => { EPOCH = e; }, resetMono: () => { monoCounters = new Map(); } };
