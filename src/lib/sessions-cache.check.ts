// sessions-cache.check.ts — ONE shared session-list fetch.
//
// WHAT THIS PROVES, and the shape of the bug it guards:
//   The regression was the SAME chat list being downloaded three times per open
//   (~900 ms of pure waiting through the tunnel). The fix coalesces identical
//   requests and briefly caches them. But a cache that shares TOO MUCH would be a
//   worse bug than no cache: showing the wrong chat list, or pinning page 2
//   forever. So this asserts both halves — that duplicates collapse, and that
//   genuinely different answers stay separate.
//
// Run: node --import ./scripts/ts-resolve.mjs src/lib/sessions-cache.check.ts
import assert from "node:assert";

import {
  normalise,
  fetchSessionsOnce,
  invalidateSessions,
  sessionsCacheStats,
} from "./sessions-cache.ts";

// --- 1. the KEY DECISION: what may be shared ---------------------------
// Same answer -> same key.
assert.equal(
  normalise("/api/hx/sessions?limit=100&order=recent"),
  normalise("/api/hx/sessions?order=recent&limit=100"),
  "parameter ORDER does not change the answer, so the key is the same"
);
// Noise parameters must not split the key (they would defeat coalescing).
assert.equal(
  normalise("/api/hx/sessions?limit=100&order=recent&_=12345"),
  normalise("/api/hx/sessions?limit=100&order=recent"),
  "a cache-buster does not create a second cache entry"
);
// Different limit IS a different request shape... but is it a different ANSWER?
// The gateway caps and paginates by limit, so YES — it must not be shared.
assert.notEqual(
  normalise("/api/hx/sessions?limit=15&sources=webui"),
  normalise("/api/hx/sessions?limit=100&order=recent"),
  "a different limit is a different slice and is never shared"
);
// The load-bearing case: a FILTERED list is a different answer from ALL.
assert.notEqual(
  normalise("/api/hx/sessions?limit=15&sources=webui%2Ctelegram"),
  normalise("/api/hx/sessions?limit=15"),
  "a source-filtered list is NOT the unfiltered list — sharing it would show the wrong chats"
);
// Absent sources vs explicit "all" — distinct, because one is server-default and
// the other is a stated intent.
assert.notEqual(
  normalise("/api/hx/sessions?limit=15&sources="),
  normalise("/api/hx/sessions?limit=15&sources=webui"),
  "an empty source filter is distinct from a real one"
);
// Search is a different endpoint and a different shape entirely.
assert.equal(normalise("/api/hx/sessions/search?q=hello&limit=50"), null,
  "search results are never shared with a session list");
assert.equal(normalise("/api/hx/sessions?limit=15&offset=15"), null,
  "a paginated window is a different slice, not a prefix — never cached");
assert.equal(normalise("/api/other/thing"), null, "a foreign URL is never shared");
assert.equal(normalise("https://evil.example/api/hx/sessions?limit=1"), null,
  "an absolute cross-origin URL is never shared");

// --- 2. COALESCING: N concurrent callers, ONE fetch -------------------
let netCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  netCalls++;
  // Simulate the tunnel: a real round trip takes time, and during that window
  // every other caller arrives.
  await new Promise((r) => setTimeout(r, 25));
  return {
    ok: true,
    status: 200,
    json: async () => ({ sessions: [{ id: "s1" }], total: 1, fetchedByCall: netCalls }),
  } as any;
}) as any;

invalidateSessions();
netCalls = 0;
// The three REAL call sites, fired together, exactly as the app does on open.
await Promise.all([
  fetchSessionsOnce("/api/hx/sessions?limit=15&offset=0&order=recent&sources=webui%2Ctelegram%2Ccli%2Ctui%2Candroid"),
  fetchSessionsOnce("/api/hx/sessions?limit=100&order=recent"),
  fetchSessionsOnce("/api/hx/sessions?limit=500&order=recent"),
]);
assert.equal(netCalls, 3,
  `three DIFFERENT limits genuinely need three requests (got ${netCalls}) — they are different slices`);

// Now the case that was the actual bug: the SAME url from three callers at once.
invalidateSessions();
netCalls = 0;
const same = "/api/hx/sessions?limit=100&order=recent";
const r2 = await Promise.all([
  fetchSessionsOnce(same),
  fetchSessionsOnce(same),
  fetchSessionsOnce(same),
  fetchSessionsOnce(same),
]);
assert.equal(netCalls, 1, `four concurrent identical callers MUST cost ONE fetch (got ${netCalls})`);
for (const r of r2) {
  assert.equal(r.total, 1, "every caller receives the real payload");
  assert.equal(r.fetchedByCall, 1, "and they all received the SAME response");
}

// --- 3. the TTL cache covers the SEQUENTIAL case -----------------------
// Coalescing only helps callers that overlap. App.tsx's seed runs AFTER the
// panel's fetch resolves, so the TTL is what collapses that pair.
//
// invalidateSessions() FIRST, then reset the counter: otherwise the previous
// section's warm entry is still inside its TTL and the "first" call below is
// served from cache — which is correct behaviour, but would measure nothing.
invalidateSessions();
netCalls = 0;
await fetchSessionsOnce(same);                 // first: a real fetch
assert.equal(netCalls, 1, "after invalidation the first call really goes to the network");
await fetchSessionsOnce(same);                 // immediately after: cached
await fetchSessionsOnce(same);
assert.equal(netCalls, 1, `sequential identical calls inside the TTL cost one fetch (got ${netCalls})`);

// --- 4. the TTL actually EXPIRES --------------------------------------
await new Promise((r) => setTimeout(r, 1600)); // past the 1500ms default
await fetchSessionsOnce(same);
assert.equal(netCalls, 2, "after the TTL expires the list is fetched again (no stale pinning)");

// --- 5. errors are not cached, and the status survives for the callers ---
invalidateSessions();
netCalls = 0;
globalThis.fetch = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as any;
let caught: any = null;
try { await fetchSessionsOnce(same); } catch (e) { caught = e; }
assert.ok(caught, "a 503 rejects rather than resolving empty");
assert.equal(caught.status, 503, "the status is preserved so callers keep their specific messaging");
// A failed request must not poison the cache.
globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ sessions: [], total: 0 }) })) as any;
const after = await fetchSessionsOnce(same);
assert.equal(after.total, 0, "the next attempt really goes to the network (a failure is never cached)");

// --- 6. invalidation forces a refetch ---------------------------------
// Invalidate BEFORE the first call: section 5 left a successful entry behind,
// which is exactly what a real invalidation is there to clear.
invalidateSessions();
netCalls = 0;
globalThis.fetch = (async () => {
  netCalls++;
  return { ok: true, status: 200, json: async () => ({ sessions: [], total: netCalls }) } as any;
}) as any;
const a1 = await fetchSessionsOnce(same);
assert.equal(netCalls, 1, "the first call after invalidation really fetches");
invalidateSessions();
const a2 = await fetchSessionsOnce(same);
assert.equal(netCalls, 2, "invalidateSessions() forces a real refetch");
assert.equal(a1.total, 1, "before invalidation");
assert.equal(a2.total, 2, "and the refetch returns fresh data");

// --- 7. diagnostics ----------------------------------------------------
const st = sessionsCacheStats();
assert.ok(typeof st.keys === "number", "stats reports the key count");

globalThis.fetch = realFetch;
console.log(
  "sessions-cache.check: ALL PASS (param order + cache-buster do not split the key, " +
  "different limit / filter / search / offset NEVER shared, 4 concurrent identical " +
  "callers = 1 fetch, sequential callers coalesce via TTL, TTL expires and refetches, " +
  "errors are not cached and keep their status, invalidateSessions forces a refetch)"
);
