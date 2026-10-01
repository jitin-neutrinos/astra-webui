// Cross-device read-marker store (WhatsApp model, 2026-10-01).
// Server-side watermark per stored session key — the ONE durable source of truth
// for read/unread across devices/tabs/restarts. Sessions list is ENRICHED with
// { unread, last_read_at } from here; PATCH {unread:false} stamps the watermark
// and the proxy broadcasts `session.read` so every open device clears instantly.
// TinyBase mirrors this to clients; this file stays the durable record.
//
// Deliberately boring: single JSON file, atomic swap on write, monotonic stamps
// (a stale write from a phone that was offline never un-reads a chat).
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = process.env.ASTRA_READ_STATE_DIR
  || join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const FILE = join(DATA_DIR, "read-state.json");

/** storedKey -> { last_read_at: epochSeconds, last_read_device?: string } */
let marks = new Map();
let loaded = false;
let writeTimer = null;
let seq = 0; // in-memory version, bumped every mutation (recovery ring epoch)

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(FILE)) {
      const raw = JSON.parse(readFileSync(FILE, "utf8"));
      if (raw && typeof raw === "object" && raw.marks && typeof raw.marks === "object") {
        for (const [k, v] of Object.entries(raw.marks)) {
          if (typeof v?.last_read_at === "number") marks.set(k, v);
        }
      }
    }
  } catch (e) {
    console.error("[read-state] load failed (starting fresh):", e?.message || e);
    marks = new Map();
  }
}

function persistNow() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const obj = Object.fromEntries(marks);
    const tmp = FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify({ marks: obj }));
    renameSync(tmp, FILE); // atomic swap — a torn write never replaces the store
  } catch (e) {
    console.error("[read-state] persist failed:", e?.message || e);
  }
}

function schedulePersist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => { writeTimer = null; persistNow(); }, 500);
}

/** Stamp `storedKey` read at `now` (epoch seconds, monotonic guard). */
export function markRead(storedKey, now = Math.floor(Date.now() / 1000), device = null) {
  load();
  const key = String(storedKey || "");
  if (!key) return null;
  const prev = marks.get(key);
  if (prev && prev.last_read_at >= now) return null; // stale/out-of-order write
  const rec = { last_read_at: now };
  if (device) rec.last_read_device = String(device).slice(0, 64);
  marks.set(key, rec);
  seq++;
  schedulePersist();
  return rec;
}

/** Watermark record for a stored key (or null when never read). */
export function getMark(storedKey) {
  load();
  return marks.get(String(storedKey || "")) || null;
}

/** True when the session has messages newer than its watermark (client computes
 *  the exact count from history rows; this is the coarse pill flag). */
export function isUnread(storedKey, lastActivityEpochSeconds) {
  load();
  const m = marks.get(String(storedKey || ""));
  if (!m) return true; // never read → unread
  if (typeof lastActivityEpochSeconds !== "number") return false;
  return lastActivityEpochSeconds > m.last_read_at;
}

/** Mutation version — the recovery ring / polling clients compare it to skip
 *  no-op fetches (Centrifugo-style position/recovery semantics, in-process). */
export function readStateVersion() {
  load();
  return seq;
}

/** Enrich an upstream /api/sessions row list with unread/last_read_at.
 *  Rows carry session_id || id; writes mutate the row objects in place.
 *  Precedence: OUR watermark wins when we have one (it's device-spanning);
 *  otherwise the gateway's native `unread`/`last_read_at` passes through
 *  untouched — never force unread:true on a gateway-read row. */
export function enrichSessions(rows) {
  load();
  if (!Array.isArray(rows)) return rows;
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const key = r.session_id || r.id;
    if (!key) continue;
    const m = marks.get(String(key));
    if (!m) continue; // no local mark → gateway truth passes through
    const last = typeof r.last_activity_at === "number"
      ? r.last_activity_at
      : (typeof r.last_active === "number" ? r.last_active
        : (typeof r.started_at === "number" ? r.started_at : null));
    r.unread = last != null ? last > m.last_read_at : false;
    r.last_read_at = m.last_read_at;
  }
  return rows;
}

/** Everything (for the TinyBase server mirror + /api/read-state endpoint). */
export function allMarks() {
  load();
  return Object.fromEntries(marks);
}

// on-boot flush safety: persist any pending write if we're asked to shut down
process.on?.("exit", () => { if (writeTimer) { writeTimer = null; persistNow(); } });

export const _test = { FILE, reset: () => { marks = new Map(); seq = 0; }, persistNow };
