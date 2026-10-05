// history-trim-routing.check.mjs — the TRIM must actually REACH a real request.
//
// WHY THIS EXISTS, and the bug it pins:
//   history-trim.check.mjs proves the trimmer is correct. It could not prove the
//   trimmer is INVOKED, because the router condition lives in hermes-proxy.mjs
//   and the URL it matches is built by the client.
//
//   The shipped condition was:
//     /^\/api\/hx\/sessions\/[^/]+\/messages\/?$/.test(req.url)
//   `$`-anchored — and EVERY real history request carries a query string
//   (`?order=latest&limit=100&offset=0`). So the pattern never matched, the trim
//   never ran, and `api_content` came straight back in the response. The feature
//   looked installed, unit-tested green, and did nothing. It was caught only by
//   re-measuring the LIVE endpoint after a stash round-trip restored an older
//   proxy — not by any test.
//
//   The lesson is general: a guard that proves a function is correct is not
//   evidence that the function is called. This pins the ROUTER.
//
// Run: node server/history-trim-routing.check.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "server", "hermes-proxy.mjs"), "utf8");

// --- 1. the pattern exists and is NOT end-anchored -----------------------
// Extract the literal so the assertion tests the SHIPPED source, not a copy.
const m = src.match(
  /const isHistoryPage\s*=\s*req\.method\s*===\s*"GET"\s*&&\s*(\/\^.*?\/)\.test\(req\.url\)/s
);
assert.ok(m, "hermes-proxy.mjs still defines isHistoryPage with a literal regex");

const regexSrc = m[1];
assert.ok(
  !/\\\$$/.test(regexSrc.trim()),
  `the history matcher must NOT be $-anchored — every real history URL carries a ` +
  `query string, so a $-anchored pattern silently never matches (got ${regexSrc})`
);
assert.ok(
  /\(\\\?\|\$\)/.test(regexSrc),
  `the history matcher must accept a query string explicitly (got ${regexSrc})`
);

// --- 2. the extracted pattern behaves on REAL urls -----------------------
const re = new RegExp(regexSrc.slice(1, -1)); // strip the /.../ delimiters
const SID = "20261005_132524_323a0c";
const mustMatch = [
  `/api/hx/sessions/${SID}/messages?order=latest&limit=100&offset=0`, // the real open
  `/api/hx/sessions/${SID}/messages?order=latest&limit=20`,
  `/api/hx/sessions/${SID}/messages?order=latest&limit=500`,        // the wide fetch
  `/api/hx/sessions/${SID}/messages`,                                // bare form
  `/api/hx/sessions/${SID}/messages/`,
];
for (const u of mustMatch) {
  assert.ok(re.test(u), `the trimmer MUST engage for ${u}`);
}

// --- 3. and must NOT engage for anything else ---------------------------
const mustNotMatch = [
  "/api/hx/sessions",                        // the list
  "/api/hx/sessions/search?q=foo",           // search
  `/api/hx/sessions/${SID}`,                 // one session (title/mutations)
  `/api/hx/sessions/${SID}/messages/extra`,  // a deeper path
  "/api/hx/stream/abc",                      // the stream log
  "/api/hx/session-title/abc",               // the title route
];
for (const u of mustNotMatch) {
  assert.ok(!re.test(u), `the trimmer must NOT engage for ${u}`);
}

// --- 4. method gate: only GET is trimmed -------------------------------
assert.ok(
  /req\.method\s*===\s*"GET"/.test(src.slice(m.index, m.index + 200)),
  "the trimmer is gated on GET — a PATCH/DELETE to the same path must pass through untouched"
);

// --- 5. a failure here must still pass the original bytes through -------
// A parse/serialize failure must not leave the client with a truncated body.
assert.ok(
  /re-serialize failed, passing through/.test(src),
  "if re-serializing the trimmed payload fails, the original bytes are passed through"
);

console.log(
  "history-trim-routing.check: ALL PASS (the matcher is not $-anchored, matches all " +
  "5 real history URL shapes including every query-string form the client sends, and " +
  "rejects the list / search / single-session / stream / title paths; GET-gated; " +
  "a re-serialize failure passes the original bytes through)"
);
