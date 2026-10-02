// history-retry.check.ts — behavioral checks for the chat-history retry policy.
// Run: node --test src/lib/history-retry.check.ts (after tsx transpile) or via
// the project's check runner pattern (see other *.check.ts files).
import { test } from "node:test";
import assert from "node:assert/strict";
import { histBackoffMs, histFailureTransient, HIST_MAX_ATTEMPTS } from "./history-retry";

test("backoff is exponential then capped", () => {
  assert.equal(histBackoffMs(1), 1500);
  assert.equal(histBackoffMs(2), 3000);
  assert.equal(histBackoffMs(3), 6000);
  assert.equal(histBackoffMs(4), 8000); // capped
  assert.equal(histBackoffMs(9), 8000); // stays capped
});

test("transient classification: network throws retry, 5xx-gateway family retries", () => {
  for (const s of [null, 429, 502, 503, 504]) assert.equal(histFailureTransient(s), true, `status ${s}`);
});

test("definitive failures never retry (no infinite loop on a dead chat)", () => {
  for (const s of [400, 401, 403, 404, 409, 500]) assert.equal(histFailureTransient(s), false, `status ${s}`);
});

test("attempt cap is finite and sane", () => {
  assert.ok(HIST_MAX_ATTEMPTS >= 2 && HIST_MAX_ATTEMPTS <= 10);
});
