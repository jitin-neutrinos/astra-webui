// One-shot migration: bring stream-log.db from the pre-epoch schema (Oct 5
// 18:34 commit 4d18490 changed the schema in code but never migrated the file;
// every INSERT since has failed with "table stream_events has no column named
// epoch" — 19h of silently discarded durable rows).
//
// Approach: rename old table, create the new schema, copy the rows (old ones
// get epoch='pre-mig' and mono backfilled from a global descending counter so
// ordering is preserved within the copy), drop the old table.
//
// Run: node scripts/migrate-stream-log.mjs
// Safe to re-run: exits early when the schema already carries `epoch`.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DATA_DIR = process.env.ASTRA_STREAM_DIR
  || join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const DB_PATH = process.env.ASTRA_STREAM_DB || join(DATA_DIR, "stream-log.db");

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA busy_timeout = 10000;");

const cols = db.prepare("PRAGMA table_info(stream_events)").all().map((c) => c.name);
if (cols.includes("epoch")) {
  console.log("already migrated — stream_events has `epoch`; nothing to do");
  process.exit(0);
}
if (!cols.length) {
  console.log("stream_events does not exist (fresh db) — nothing to do");
  process.exit(0);
}
console.log("old columns:", cols.join(", "));

db.exec("BEGIN IMMEDIATE");
try {
  db.exec("ALTER TABLE stream_events RENAME TO stream_events_old");
  db.exec(`
    CREATE TABLE stream_events (
      sid        TEXT    NOT NULL,
      epoch      TEXT    NOT NULL,
      seq        INTEGER NOT NULL,
      mono       INTEGER NOT NULL,
      type       TEXT    NOT NULL,
      kind       TEXT    NOT NULL,
      ref_sid    TEXT,
      ref_row    TEXT,
      headline   TEXT,
      payload    TEXT,
      ts_ms      INTEGER NOT NULL,
      PRIMARY KEY (sid, epoch, seq)
    ) WITHOUT ROWID
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_stream_events_ts ON stream_events(ts_ms)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_stream_events_mono ON stream_events(sid, mono)");

  // Copy: old rows keep their sid/seq/type/... untouched. epoch='pre-mig'
  // distinguishes them from every future gateway-process epoch. mono is
  // backfilled globally descending (newest old row keeps the highest mono) so
  // replay order across the whole log stays oldest→newest.
  // db.exec returns undefined in node:sqlite; count what landed instead.
  db.exec(`
    INSERT INTO stream_events (sid, epoch, seq, mono, type, kind, ref_sid, ref_row, headline, payload, ts_ms)
    SELECT sid, 'pre-mig', seq,
           (SELECT count(*) FROM stream_events_old o2
              WHERE o2.ts_ms < o1.ts_ms) + 1 AS mono,
           type, kind, ref_sid, ref_row, headline, payload, ts_ms
      FROM stream_events_old o1
  `);
  const n = db.prepare("SELECT count(*) c FROM stream_events WHERE epoch = 'pre-mig'").get();
  console.log("copied rows:", n.c);
  db.exec("DROP TABLE stream_events_old");
  db.exec("COMMIT");
  console.log("MIGRATION OK");
} catch (e) {
  db.exec("ROLLBACK");
  console.error("MIGRATION FAILED:", e.message);
  process.exit(1);
} finally {
  db.close();
}
