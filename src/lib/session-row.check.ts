import type { SessionRow } from "./session-row.ts";
import { rowKey, rowTime, timeAgo, sortRows, mergeRows } from "./session-row.ts";

function eq(a: any, b: any, msg: string) { if (a !== b) throw new Error(msg + ": " + a + " !== " + b); }
function ok(v: any, msg: string) { if (!v) throw new Error(msg); }

// --- rowKey prefers the compression-tip id the gateway stamps on search rows ---
eq(rowKey({ id: "a", session_id: "b" } as SessionRow), "b", "rowKey search row");
eq(rowKey({ id: "a" } as SessionRow), "a", "rowKey plain row");

// --- rowTime picks the freshest known field ---
eq(rowTime({ id: "a", last_activity_at: 5, last_active: 9 } as SessionRow), 5, "rowTime prefers last_activity_at");
eq(rowTime({ id: "a", last_active: 9, started_at: 2 } as SessionRow), 9, "rowTime falls back to last_active");
eq(rowTime({ id: "a" } as SessionRow), null, "rowTime null when unknown");

// --- timeAgo buckets ---
const NOW = 1_800_000_000_000; // fixed clock
eq(timeAgo(undefined, NOW), "", "timeAgo undefined");
eq(timeAgo(NOW / 1000 - 30, NOW), "now", "timeAgo now");
eq(timeAgo(NOW / 1000 - 5 * 60, NOW), "5m", "timeAgo minutes");
eq(timeAgo(NOW / 1000 - 3 * 3600, NOW), "3h", "timeAgo hours");
eq(timeAgo(NOW / 1000 - 2 * 86400, NOW), "2d", "timeAgo days");
eq(timeAgo(NOW / 1000 - 10 * 86400, NOW), "Jan 5", "timeAgo same-year date");
eq(timeAgo(NOW / 1000 - 30 * 86400, NOW), "Dec 16 ’26", "timeAgo past-year boundary");
const yearsAgo = new Date(NOW - 400 * 86400 * 1000);
eq(timeAgo(yearsAgo.getTime() / 1000, NOW), expectPrevYear(yearsAgo), "timeAgo past-year date");
function expectPrevYear(d: Date): string {
  const label = d.toLocaleString("default", { month: "short" }) + " " + d.getDate();
  return `${label} ’${String(d.getFullYear()).slice(2)}`;
}

// --- sortRows: pinned first, then recency, stable on ties ---
const rows: SessionRow[] = [
  { id: "old", started_at: 10 } as SessionRow,
  { id: "new", started_at: 50 } as SessionRow,
  { id: "pin-old", started_at: 5, pinned: true } as SessionRow,
];
eq(sortRows(rows).map(r => r.id).join(","), "pin-old,new,old", "sortRows pinned-then-recent");

// --- mergeRows: fresh wins, dedupes by key, re-sorts ---
const p1: SessionRow[] = [{ id: "a", started_at: 10, title: "stale" } as SessionRow];
const p2: SessionRow[] = [
  { id: "a", started_at: 20, title: "fresh" } as SessionRow,
  { id: "b", session_id: "b2", started_at: 30 } as SessionRow,
];
const merged = mergeRows(p1, p2);
eq(merged.length, 2, "mergeRows dedupes");
eq(merged.find(r => r.id === "a")!.title, "fresh", "mergeRows fresh wins");
eq(merged[0].id, "b", "mergeRows re-sorted by recency");
ok(merged[0].session_id === "b2", "mergeRows keeps tip key");

console.log("PASS: session-row checks");
