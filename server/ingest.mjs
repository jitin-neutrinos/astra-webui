// ingest.mjs — Chat auto-ingestion sweeper + training-dataset builder.
//
// Two duties, on a timer and on demand:
//   1. Scan the gateway session list and dump every session not yet in the
//      archive (end-session dumps AND button-less chats alike) — so the
//      transcript archive is complete regardless of how a chat ended.
//   2. Build a versioned SFT JSONL dataset from the archive for fine-tuning.
//
// The 14-day archive itself is the gateway's NATIVE auto-archive
// (config.yaml gateway.auto_archive + auto_archive_days, soft-hide, never
// delete) — this module does not re-implement retention. The archive tier
// here is the training DB, which keeps every transcript forever.
//
// Env knobs (also the test seam): INGEST_SWEEP_INTERVAL_MS, INGEST_BATCH,
// INGEST_MIN_MESSAGES, TRAINING_DATA_DIR, TRAINING_DB_PATH.
import { openTrainingDb, gatewayJson, dumpSession } from "./training.mjs";
import { broadcastFrame } from "./hermes-proxy.mjs";
const INGEST_INTERVAL_MS = Number(process.env.INGEST_SWEEP_INTERVAL_MS || 15 * 60 * 1000);
const INGEST_BATCH = Math.max(1, Number(process.env.INGEST_BATCH || 4));
const MIN_MESSAGES = Math.max(1, Number(process.env.INGEST_MIN_MESSAGES || 2));
const SESSIONS_PAGE = 100;
const MAX_SCAN = 5000; // safety cap: never page the gateway forever

// ---- helpers --------------------------------------------------------------

function* chunk(arr, n) {
  for (let i = 0; i < arr.length; i += n) yield arr.slice(i, i + n);
}

let sweepRunning = false;
let lastSweep = null;

function broadcastIngest(payload) {
  try {
    broadcastFrame(JSON.stringify({
      method: "event",
      params: { type: "ingest.updated", payload },
    }));
  } catch { /* no live ws clients is not an error */ }
}

// ---- scan -----------------------------------------------------------------

// Sessions present in the gateway but absent from the local archive.
// Skips still-active chats (never snapshot a live transcript) and empty ones.
export async function uningestedSessions() {
  const database = openTrainingDb();
  const known = new Set(database.prepare("SELECT sid FROM sessions").all().map((r) => String(r.sid)));
  const out = [];
  let offset = 0;
  for (;;) {
    const data = await gatewayJson(
      "GET",
      `/api/sessions?archived=include&order=recent&limit=${SESSIONS_PAGE}&offset=${offset}&min_messages=${MIN_MESSAGES}`,
    );
    const rows = data.sessions || [];
    if (!rows.length) break;
    for (const r of rows) {
      const sid = String(r.session_id || r.id || "");
      if (!sid || known.has(sid)) continue;
      if (r.is_active) continue; // ingest once the chat has gone idle
      out.push(r);
    }
    offset += rows.length;
    if (rows.length < SESSIONS_PAGE || offset >= MAX_SCAN) break;
  }
  return out;
}

// One sweep: dump every un-ingested session into the archive tables.
export async function runIngestSweep() {
  if (sweepRunning) return { skipped: "sweep in progress" };
  sweepRunning = true;
  const startedAt = Date.now();
  try {
    let pending;
    try {
      pending = await uningestedSessions();
    } catch (e) {
      lastSweep = { at: startedAt, error: e && e.message };
      return { error: e && e.message };
    }
    let ingested = 0;
    let failed = 0;
    for (const batch of chunk(pending, INGEST_BATCH)) {
      await Promise.all(batch.map(async (r) => {
        const sid = String(r.session_id || r.id);
        try {
          await dumpSession(sid, r.title ?? null, r.source ?? null, { status: "archived" });
          ingested++;
        } catch (e) {
          failed++;
          console.error(`[ingest] ${sid}:`, e && e.message);
        }
      }));
    }
    lastSweep = { at: startedAt, pending: pending.length, ingested, failed, ms: Date.now() - startedAt };
    broadcastIngest({ ...lastSweep, ...ingestStats() });
    return lastSweep;
  } finally {
    sweepRunning = false;
  }
}

// ---- stats ----------------------------------------------------------------

export function ingestStats() {
  const database = openTrainingDb();
  const total = database.prepare("SELECT COUNT(*) n FROM sessions").get().n;
  const ingested = database.prepare("SELECT COUNT(*) n FROM sessions WHERE ingested_at IS NOT NULL").get().n;
  const messages = database.prepare("SELECT COUNT(*) n FROM messages").get().n;
  return { total_sessions: total, ingested_sessions: ingested, uningested: total - ingested, messages, last_sweep: lastSweep };
}

// Existing rows (dumped before ingested_at existed) are, by definition,
// already ingested — stamp them so the un-ingested count is honest.
function backfillIngested() {
  const database = openTrainingDb();
  database.prepare(
    "UPDATE sessions SET ingested_at = COALESCE(ended_at, ?) WHERE ingested_at IS NULL AND message_rows > 0",
  ).run(Date.now());
}

// ---- sweeper --------------------------------------------------------------

export function startIngestSweeper() {
  backfillIngested();
  const tick = () => {
    void runIngestSweep().catch((e) => console.error("[ingest] sweep:", e && e.message));
  };
  tick();
  const t = setInterval(tick, INGEST_INTERVAL_MS);
  if (typeof t.unref === "function") t.unref();
  return t;
}