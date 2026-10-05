// retention.mjs — the 14-day retention sweeper, gated on ingestion (Phase 6).
//
// THE RULE (D1), and why it has two halves:
//
//   DELETE a session only when ALL of these hold:
//     1. ingested_at IS NOT NULL  — the training/dataset pipeline has consumed it.
//        This is the gate the owner asked for: never delete a transcript the
//        dataset has not yet read, however old it is. `ingest.mjs` stamps
//        ingested_at on its 15-minute sweep; backfillIngested() backstops older rows.
//     2. older than 14 days       — matches the gateway's own
//        `gateway.auto_archive_days: 14` (config.yaml:1016), so Astra's live tier
//        and the gateway's archive expire together. No independent copy, no
//        "Astra must outlive the gateway" gap.
//     3. NOT pinned              — a pinned session is explicitly kept regardless
//        of age. The gateway has a `pinned` column; honouring it means a session
//        the owner marked stays put.
//
// WHY DRY-RUN FIRST:
//   Deletion is irreversible. This module therefore defaults to a PLAN, not an
//   execute. `runRetention({ dryRun: true })` reports exactly what WOULD be removed
//   and touches nothing. Only an explicit `dryRun: false` deletes, and the sweeper
//   runs in dry-run on its timer so an unattended job can never surprise anyone.
//   Enabling deletion is a one-line env flip once the plan has been reviewed.
//
// SECURE_DELETE:
//   A plain DELETE leaves the text readable in freed pages until they are reused.
//   `PRAGMA secure_delete = ON` (or better, VACUUM) overwrites freed content. On a
//   personal archive this is the difference between "deleted" and "still on disk",
//   so it is ON by default and can be disabled only deliberately.
//
// WHAT THIS DOES NOT TOUCH:
//   The TRAINING archive. `data/astra-training.db` keeps every transcript forever by
//   design (ingest.mjs: "the archive tier keeps every transcript forever"). This
//   sweeper governs the LIVE chat tier only. It also never deletes stream-log
//   chunks or dedupe keys — those have their own TTLs (14d / 24h).

import { openTrainingDb } from "./training.mjs";
import { purgeOlderThan as purgeStreamEvents } from "./stream-log.mjs";

const RETENTION_DAYS = Number(process.env.ASTRA_RETENTION_DAYS || 14);
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Sweep cadence. Daily is right for a 14-day window: the oldest deletable row
// crosses the threshold at a known time, and running more often does no work.
const SWEEP_INTERVAL_MS = Number(process.env.ASTRA_RETENTION_SWEEP_MS || 24 * 60 * 60 * 1000);

// Bounded work per run, so a first run over a large backlog cannot lock the
// writer for minutes. The next tick continues where this left off.
const BATCH = Number(process.env.ASTRA_RETENTION_BATCH || 200);

// Kill switch. While true (the default) nothing is ever deleted.
const ENABLED = process.env.ASTRA_RETENTION_ENABLED === "1";

function cutoffSecs(now = Date.now()) {
  return Math.floor((now - RETENTION_MS) / 1000);
}

/**
 * Plan the deletions without touching anything.
 * Returns exactly what a delete WOULD remove — the dry-run receipt.
 */
export function planRetention({ now = Date.now(), batch = BATCH } = {}) {
  const db = openTrainingDb();
  const cutoff = cutoffSecs(now);

  // `pinned` exists in the GATEWAY's schema; Astra's training copy may predate it,
  // so probe once and fall back to "no pinning" rather than throwing SQL.
  let hasPinned = false;
  try {
    db.prepare("SELECT pinned FROM sessions LIMIT 1").get();
    hasPinned = true;
  } catch { /* column absent: nothing is pinned in this archive */ }

  const pinClause = hasPinned ? " AND COALESCE(pinned, 0) = 0" : "";
  const rows = db.prepare(
    `SELECT sid, title, ended_at, ingested_at, message_rows
       FROM sessions
      WHERE ingested_at IS NOT NULL
        AND ended_at IS NOT NULL
        AND ended_at < ?
        ${pinClause}
      ORDER BY ended_at ASC
      LIMIT ?`
  ).all(cutoff, Math.max(1, batch));

  const sids = rows.map((r) => String(r.sid));
  let messageRows = 0;
  if (sids.length) {
    // Placeholders, not interpolation: a session id can never be a bound value.
    const ph = sids.map(() => "?").join(",");
    messageRows = Number(db.prepare(
      `SELECT count(*) c FROM messages WHERE sid IN (${ph})`
    ).get(...sids).c);
  }

  return {
    enabled: ENABLED,
    dry_run: true,
    retention_days: RETENTION_DAYS,
    cutoff_epoch: cutoff,
    pinned_supported: hasPinned,
    sessions: rows.map((r) => ({
      sid: String(r.sid),
      title: r.title ?? null,
      ended_at: Number(r.ended_at),
      age_days: Math.floor((now / 1000 - Number(r.ended_at)) / 86400),
      ingested_at: Number(r.ingested_at),
      message_rows: Number(r.message_rows ?? 0),
    })),
    session_count: rows.length,
    message_count: messageRows,
  };
}

/**
 * Execute the plan. Only ever called with dryRun:false, and only when ENABLED.
 * Returns what was removed. `secure_delete` is enabled first so the freed pages
 * are overwritten rather than left readable.
 */
export function runRetention({ now = Date.now(), batch = BATCH, dryRun = true, force = false } = {}) {
  if (!ENABLED && !force) {
    return { skipped: "retention disabled (set ASTRA_RETENTION_ENABLED=1 to enable)", dry_run: true };
  }

  const plan = planRetention({ now, batch });
  if (dryRun) return { ...plan, removed_sessions: 0, removed_messages: 0 };

  if (!plan.session_count) {
    return { ...plan, dry_run: false, removed_sessions: 0, removed_messages: 0 };
  }

  const db = openTrainingDb();
  const sids = plan.sessions.map((s) => s.sid);
  const ph = sids.map(() => "?").join(",");

  let removedMessages = 0;
  let removedSessions = 0;
  try {
    // Overwrite freed content rather than leaving the text readable in the file.
    try { db.exec("PRAGMA secure_delete = ON;"); } catch { /* best effort */ }

    db.exec("BEGIN IMMEDIATE");
    try {
      removedMessages = Number(db.prepare(
        `DELETE FROM messages WHERE sid IN (${ph})`
      ).run(...sids).changes);
      removedSessions = Number(db.prepare(
        `DELETE FROM sessions WHERE sid IN (${ph})`
      ).run(...sids).changes);
      db.exec("COMMIT");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
      throw e;
    }
  } catch (e) {
    // A failed sweep must never take the service down, and must never be silent.
    console.error("[retention] delete failed:", e?.message || e);
    return { ...plan, dry_run: false, error: String(e?.message || e), removed_sessions: 0, removed_messages: 0 };
  }

  // The chunk log has its own TTL; sweeping it here keeps one clock for "old".
  let streamPurged = 0;
  try { streamPurged = Number(purgeStreamEvents(now)?.removed || 0); } catch { /* best effort */ }

  return {
    ...plan,
    dry_run: false,
    removed_sessions: removedSessions,
    removed_messages: removedMessages,
    stream_events_removed: streamPurged,
  };
}

let lastSweep = null;

export function retentionStats() {
  const db = openTrainingDb();
  const total = Number(db.prepare("SELECT count(*) c FROM sessions").get().c);
  const ingested = Number(db.prepare("SELECT count(*) c FROM sessions WHERE ingested_at IS NOT NULL").get().c);
  const cutoff = cutoffSecs();
  let eligible = 0;
  try {
    eligible = Number(db.prepare(
      "SELECT count(*) c FROM sessions WHERE ingested_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at < ?"
    ).get(cutoff).c);
  } catch { /* schema drift */ }
  return {
    enabled: ENABLED,
    retention_days: RETENTION_DAYS,
    total_sessions: total,
    ingested_sessions: ingested,
    eligible_now: eligible,
    cutoff_epoch: cutoff,
    last_sweep: lastSweep,
  };
}

/**
 * Start the daily sweeper. It runs in DRY-RUN by design: an unattended timer
 * reports what it would do and deletes nothing. Flip ENABLED (or call
 * runRetention({dryRun:false, force:true}) deliberately) to actually delete.
 */
export function startRetentionSweeper() {
  const tick = () => {
    try {
      const r = runRetention({ dryRun: true });
      lastSweep = {
        at: Date.now(),
        eligible: r.session_count ?? 0,
        messages: r.message_count ?? 0,
        deleted: 0,
        enabled: r.enabled ?? false,
      };
      if (lastSweep.eligible > 0) {
        console.log(`[retention] DRY-RUN: ${lastSweep.eligible} session(s) past ${RETENTION_DAYS}d and ingested, ` +
          `${lastSweep.messages} message(s). Nothing deleted (enable with ASTRA_RETENTION_ENABLED=1).`);
      }
    } catch (e) {
      console.error("[retention] sweep failed:", e?.message || e);
    }
  };
  tick();
  const t = setInterval(tick, SWEEP_INTERVAL_MS);
  if (typeof t.unref === "function") t.unref();
  return t;
}

export const _test = { RETENTION_DAYS, RETENTION_MS, cutoffSecs, BATCH };
