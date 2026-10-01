// Runnable check: read-marker store + enrichment + recovery ring semantics.
// Run: node server/read-state.check.mjs  (isolated via ASTRA_READ_STATE_DIR)
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// isolate the store file BEFORE importing (env is read at load time)
const tmp = mkdtempSync(join(tmpdir(), "astra-read-"));
process.env.ASTRA_READ_STATE_DIR = tmp;
const rs = await import("./read-state.mjs");

// 1) markRead stamps monotonic watermarks
const t0 = 1_000_000;
assert.ok(rs.markRead("s1", t0), "first mark stamps");
assert.equal(rs.getMark("s1").last_read_at, t0);
assert.equal(rs.markRead("s1", t0 - 5), null, "stale write rejected (monotonic)");
assert.ok(rs.markRead("s1", t0 + 10), "newer write wins");

// 2) isUnread: never-read → unread; activity after watermark → unread
assert.equal(rs.isUnread("s2", t0 + 100), true, "never read = unread");
assert.equal(rs.isUnread("s1", t0), false, "activity at watermark = read");
assert.equal(rs.isUnread("s1", t0 + 11), true, "activity after watermark = unread");

// 3) enrichSessions patches rows in place; our watermark WINS when present,
//    gateway-native unread passes through untouched when not.
const rows = [
  { session_id: "s1", last_activity_at: t0 },      // our mark: read (activity == watermark)
  { id: "s2", last_activity_at: t0 + 999 },        // never marked by us → passthrough
  { session_id: "s3", started_at: t0 + 5 },        // never marked by us → passthrough
];
const before2 = { unread: rows[1].unread, last_read_at: rows[1].last_read_at };
rs.enrichSessions(rows);
assert.equal(rows[0].unread, false);
assert.ok(rows[0].last_read_at > 0, "watermark exposed on row");
assert.equal(rows[1].unread, before2.unread, "unmarked row untouched (unread)");
assert.ok(!("last_read_at" in rows[1]) || rows[1].last_read_at === before2.last_read_at, "unmarked row untouched (watermark)");

// 4) persist + reload round-trip
rs.markRead("persist-me", t0 + 50, "android");
rs._test.persistNow();
const fresh = rs.allMarks();
assert.ok(fresh["persist-me"], "mark survives persist");
assert.equal(fresh["persist-me"].last_read_device, "android");

rmSync(tmp, { recursive: true, force: true });
console.log("read-state.check: ALL PASS (markRead monotonic, isUnread, enrich, persist)");
