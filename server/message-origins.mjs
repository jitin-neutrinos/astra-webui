import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = process.env.ASTRA_ORIGINS_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "data");
// LAZY on purpose: the check harness sets ASTRA_ORIGINS_DB after import, so the
// env read must happen at open time, not module load (reviewer R2/env finding —
// a module-level constant sent test rows into the production db).

let db = null;

function dbPath() {
  return process.env.ASTRA_ORIGINS_DB || join(DATA_DIR, "message-origins.db");
}

// rpcId -> { device, liveSid, at }
const pendingSubmits = new Map();
const PENDING_CAP = 500;
const PENDING_TTL = 5 * 60 * 1000;

export function openOriginsDb() {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(dbPath());
  db.exec("PRAGMA auto_vacuum = INCREMENTAL;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  try { db.exec("PRAGMA busy_timeout = 10000;"); } catch {}
  db.exec(`
    CREATE TABLE IF NOT EXISTS origins (
      stored_sid TEXT,
      row_id INTEGER,
      device TEXT,
      stamped_ms INTEGER,
      PRIMARY KEY (stored_sid, row_id)
    );
  `);
  return db;
}

export function noteSubmit(rpcId, { device, liveSid, now = Date.now() } = {}) {
  if (!rpcId) return;
  pendingSubmits.set(String(rpcId), { device: device || null, liveSid: liveSid || null, at: now });
  
  if (pendingSubmits.size > PENDING_CAP) {
    const cutoff = now - PENDING_TTL;
    for (const [k, v] of pendingSubmits) {
      if (v.at < cutoff) pendingSubmits.delete(k);
    }
  }
}

export function externalOriginForSession(source) {
  if (!source) return null;
  const s = String(source).toLowerCase();
  if (s === "telegram" || s === "cli" || s === "tui") return s;
  return null;
}

export function bindRowId(rpcId, userRowId, { resolveStoredSid, now = Date.now() } = {}) {
  if (!rpcId || typeof userRowId !== "number") return null;
  const rpc = String(rpcId);
  const pending = pendingSubmits.get(rpc);
  if (!pending) return null;
  pendingSubmits.delete(rpc);
  
  const storedSid = typeof resolveStoredSid === "function" 
    ? resolveStoredSid(pending.liveSid) 
    : pending.liveSid; // caller handles map
    
  if (!storedSid) return null;

  const device = pending.device;
  const rowId = userRowId;
  const ms = now;

  const d = openOriginsDb();
  try {
    d.prepare(
      "INSERT INTO origins (stored_sid, row_id, device, stamped_ms) VALUES (?, ?, ?, ?) ON CONFLICT(stored_sid, row_id) DO UPDATE SET device=excluded.device, stamped_ms=excluded.stamped_ms"
    ).run(String(storedSid), rowId, device ? String(device) : null, ms);
  } catch (e) {
    console.error("[origins] bindRowId failed:", e);
    return null;
  }
  
  return { storedSid, rowId, device };
}

export function rebindStoredSid(liveSid, storedSid) {
  const live = typeof liveSid === "string" ? liveSid.trim() : "";
  const stored = typeof storedSid === "string" ? storedSid.trim() : "";
  if (!live || !stored) return 0;
  
  // Find pending submits matching liveSid
  let count = 0;
  for (const [rpcId, info] of pendingSubmits) {
    if (info.liveSid === live) {
      info.liveSid = stored; // We just keep the stored id in liveSid field
      count++;
    }
  }
  return count;
}

export function originFor(storedSid, rowId) {
  if (!storedSid || typeof rowId !== "number") return null;
  const d = openOriginsDb();
  return d.prepare("SELECT device, stamped_ms FROM origins WHERE stored_sid = ? AND row_id = ?").get(String(storedSid), rowId) || null;
}

export function enrichOrigins(historyPayload) {
  if (!historyPayload || !Array.isArray(historyPayload.messages)) return historyPayload;
  
  const source = historyPayload.source || historyPayload.session?.source || null;
  const external = externalOriginForSession(source);
  
  const sid = historyPayload.id || historyPayload.session_id || null;
  if (!sid && !external) return historyPayload;
  
  const d = openOriginsDb();
  const getStmt = d.prepare("SELECT device FROM origins WHERE stored_sid = ? AND row_id = ?");

  for (const msg of historyPayload.messages) {
    if (msg.role !== "user") continue;
    let device = null;
    if (sid && msg.id !== undefined) {
      const row = getStmt.get(String(sid), Number(msg.id));
      if (row && row.device) device = row.device;
    }
    if (!device && external) device = external;
    
    if (device) {
      msg.origin = device;
    }
  }
  return historyPayload;
}

export function closeOriginsDb() {
  if (!db) return;
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE);"); } catch {}
  try { db.close(); } catch {}
  db = null;
}

export const _test = {
  reset: () => { pendingSubmits.clear(); },
  pendingSize: () => pendingSubmits.size,
};
