// Check: history pagination math against the gateway's MEASURED semantics
// (probe 2026-10-01, session 20260930_090421_840d75):
//   order=latest&limit=N              → newest N rows, oldest-first ascending
//   order=latest&limit=N&offset=M     → skips M back from the END, ascending
//   order=oldest&limit=N              → FIRST N rows (what loadOlder must NOT use)
// Run: npx tsx scripts/verify-history-pagination.ts
import assert from "assert";

type Row = { id: number };

// Fake gateway: session of 450 rows, mirrors the real endpoint's semantics.
const TOTAL = 450;
function gatewayFetch(order: "latest" | "oldest", limit: number, offset = 0): Row[] {
  const start = order === "latest" ? Math.max(0, TOTAL - offset - limit) : offset;
  const end = order === "latest" ? TOTAL - offset : Math.min(TOTAL, offset + limit);
  const out: Row[] = [];
  for (let i = start; i < end; i++) out.push({ id: i });
  return out; // always ascending
}

const PAGE = 200;

// 1) Initial load: newest PAGE rows, ascending, ending at the newest row.
const page1 = gatewayFetch("latest", PAGE);
assert.equal(page1.length, PAGE);
assert.equal(page1[0].id, TOTAL - PAGE);
assert.equal(page1[page1.length - 1].id, TOTAL - 1);

// 2) THE BUG: reversing an ascending window rotates the feed.
const rotated = [...page1].reverse();
assert.equal(rotated[0].id, TOTAL - 1, "reversed window puts the NEWEST row first");
assert.notEqual(rotated[0].id, page1[0].id);

// 3) Scroll-up: offset = held count pulls the window just ABOVE held rows,
//    no overlap with page1, ascending, ends exactly where page1 begins.
const page2 = gatewayFetch("latest", PAGE, page1.length);
assert.equal(page2.length, PAGE);
assert.equal(page2[page2.length - 1].id, page1[0].id - 1);
assert.ok(!page2.some((r) => page1.some((p) => p.id === r.id)), "no overlap with held rows");

// 4) The dead-end: order=oldest&offset=<held> RE-fetches held rows →
//    dedupe empties the page (or leaves a straddle of already-held rows) →
//    pagination stalls or falsely reports done.
const badPage = gatewayFetch("oldest", PAGE, page1.length);
const deduped = badPage.filter((r) => !page1.some((p) => p.id === r.id));
assert.ok(deduped.length < badPage.length, "oldest+offset overlaps held rows (the old bug)");
assert.equal(page1[0].id, 250);
assert.equal(badPage[0].id, 200);

// 5) Merge: prepend keeps global ascending order; all pages together cover
//    every row exactly once (400 held of 450 → last page is the 50 oldest).
const held = [...page2, ...page1];
assert.equal(held[0].id, 50); // two pages reach back to row 50 of 450
const page3 = gatewayFetch("latest", PAGE, held.length);
const all = [...page3, ...held];
assert.equal(all.length, TOTAL);
assert.ok(all.every((r, i) => r.id === i), "full history strictly ascending after all pages");

console.log("verify-history-pagination: 5/5 checks passed");
