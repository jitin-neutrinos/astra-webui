// pagination.check.ts — guards the chat-history pagination contract.
//
// Pagination shipped 2026-10-01 (HIST_PAGE tail-page + scroll-up loadOlder).
// These assertions pin the invariants that make it correct, because each one
// was a real way to silently drop or duplicate rows.
//
// Run: node --import ./scripts/ts-resolve.mjs src/lib/pagination.check.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAGE_SIZE, pageOffset, prependOlder, hasMore, pageRequest,
} from "./pagination.ts";

// --- request shape ---------------------------------------------------------

test("first page is the tail, newest-anchored, oldest-first", () => {
  const q = pageRequest({ offset: 0 });
  assert.equal(q.order, "latest", "must anchor on the newest rows");
  assert.equal(q.limit, PAGE_SIZE);
  assert.equal(q.offset, 0);
});

test("order=oldest with an offset would re-fetch rows we already hold", () => {
  // The comment in chat-landing.tsx calls this out; pin it so nobody 'fixes'
  // it back to order=oldest, which dead-ends pagination into duplicate rows.
  assert.notEqual(pageRequest({ offset: 10 }).order, "oldest");
});

// --- offset arithmetic -----------------------------------------------------

test("offset is the count of rows already held, not a page index", () => {
  assert.equal(pageOffset({ held: 0 }), 0);
  assert.equal(pageOffset({ held: 200 }), 200);
  assert.equal(pageOffset({ held: 450 }), 450);
  assert.equal(pageOffset({ held: null }), 0, "no rows held yet = first page");
});

test("a non-positive or unknown row count must not produce a negative offset", () => {
  assert.equal(pageOffset({ held: -5 }), 0);
  assert.equal(pageOffset({ held: NaN }), 0);
});

// --- hasMore ---------------------------------------------------------------

test("a short page means the transcript is exhausted", () => {
  assert.equal(hasMore({ returned: PAGE_SIZE }), true, "full page → maybe more");
  assert.equal(hasMore({ returned: PAGE_SIZE - 1 }), false, "short page → done");
  assert.equal(hasMore({ returned: 0 }), false, "empty page → done");
});

test("hasMore treats a non-array/negative return as exhausted, never as infinite", () => {
  assert.equal(hasMore({ returned: -1 }), false);
  assert.equal(hasMore({ returned: undefined as unknown as number }), false);
});

// --- prepend ---------------------------------------------------------------

const row = (id: number) => ({ id, role: "user", content: `m${id}` });

test("older rows prepend and stay oldest-first", () => {
  const held = [row(3), row(4), row(5)];
  const older = [row(1), row(2)];
  const out = prependOlder({ held, older });
  assert.deepEqual(out.map((r: { id: number }) => r.id), [1, 2, 3, 4, 5]);
});

test("rows already held are dropped (id-keyed), so a replay cannot duplicate", () => {
  const held = [row(2), row(3)];
  // Server re-sends row 2 at the page boundary.
  const older = [row(1), row(2), row(3)];
  const out = prependOlder({ held, older });
  assert.deepEqual(out.map((r: { id: number }) => r.id), [1, 2, 3]);
});

test("a page of only already-held rows terminates pagination", () => {
  const held = [row(1), row(2), row(3)];
  const out = prependOlder({ held, older: [row(1), row(2), row(3)] });
  assert.deepEqual(out.map((r: { id: number }) => r.id), [1, 2, 3]);
  assert.equal(hasMore({ returned: out.length - held.length }), false);
});

test("rows without an id are never treated as duplicates of each other", () => {
  // id == null must not collapse every un-stamped row into one.
  const held: Array<{ id: number | null; role: string; content: string }> = [
    { id: null, role: "user", content: "a" },
  ];
  const older: Array<{ id: number | null; role: string; content: string }> = [
    { id: null, role: "user", content: "b" },
  ];
  const out = prependOlder({ held, older });
  assert.equal(out.length, 2, "both un-stamped rows survive");
});

test("prepend preserves held order when older is empty", () => {
  const held = [row(1), row(2)];
  assert.deepEqual(prependOlder({ held, older: [] }).map((r) => r.id), [1, 2]);
});
