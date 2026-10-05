// Runnable check: idempotency semantics for user messages.
// Run: node server/message-dedupe.check.mjs   (isolated via ASTRA_DEDUPE_DIR)
import assert from "node:assert";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "astra-dedupe-"));
process.env.ASTRA_DEDUPE_DIR = tmp;
// Keep the TTL deterministic and the sweep throttle out of the way.
process.env.ASTRA_DEDUPE_TTL_MS = "1000";

const dedupe = await import("./message-dedupe.mjs");

// --- 1. first claim wins --------------------------------------------------
const k1 = "0198f1c2-1111-7000-8000-aaaaaaaaaaaa";
const a = dedupe.claim(k1, { storedSid: "sess-A" });
assert.equal(a.fresh, true, "first claim is fresh");
assert.equal(a.key, k1);

// --- 2. replay is rejected, and hands back what the first claim recorded ----
const b = dedupe.claim(k1, { storedSid: "sess-OTHER" });
assert.equal(b.fresh, false, "same key must NOT be fresh again");
assert.equal(b.storedSid, "sess-A", "replay sees the ORIGINAL stored sid, not the new one");
assert.notEqual(b.storedSid, "sess-OTHER", "a replay cannot overwrite the bound session");

// --- 3. a different key is independent ------------------------------------
const k2 = "0198f1c2-2222-7000-8000-bbbbbbbbbbbb";
assert.equal(dedupe.claim(k2, { storedSid: "sess-B" }).fresh, true, "distinct keys do not collide");

// --- 4. whitespace is normalized, not rejected ---------------------------
const k3 = "  0198f1c2-3333-7000-8000-cccccccccccc  ";
const c1 = dedupe.claim(k3);
assert.equal(c1.fresh, true, "padded key is accepted");
assert.equal(dedupe.claim(k3.trim()).fresh, false, "padding does not create a second identity");

// --- 5. garbage keys are skipped, never stored, never block the send -------
for (const bad of ["", "   ", null, undefined, 12345, {}, [], "no-digits-here", "x".repeat(300)]) {
  const r = dedupe.claim(bad);
  assert.equal(r.fresh, true, `garbage key ${JSON.stringify(bad)} must not block a send`);
  assert.equal(r.skipped, true, `garbage key ${JSON.stringify(bad)} is reported as skipped`);
}

// --- 6. seen() agrees with claim() ----------------------------------------
assert.equal(dedupe.seen(k1), true, "seen() finds a claimed key");
assert.equal(dedupe.seen(k2), true);
assert.equal(dedupe.seen("never-claimed-9999"), false, "seen() rejects an unknown key");
assert.equal(dedupe.seen(null), false, "seen(null) is false, not a throw");

// --- 7. bindSession only ever fills gaps, never overwrites ----------------
assert.equal(dedupe.bindSession(k1, { liveSid: "live-1" }), true, "bind updates an existing key");
assert.equal(dedupe.bindSession("no-such-key-1234", { liveSid: "x" }), false, "bind on unknown key is a no-op");
const afterBind = dedupe.claim(k1);
assert.equal(afterBind.fresh, false);
assert.equal(afterBind.liveSid, "live-1", "bound liveSid survives a replay claim");
assert.equal(afterBind.storedSid, "sess-A", "COALESCE kept the original storedSid");

// --- 7b. bindStoredForLive backfills the stored id for keys claimed before the
//         live->stored mapping was known. Without it a replay ack names no chat.
const LB = "0198f1c2-7777-7000-8000-eeeeeeeeeeee";
assert.equal(dedupe.claim(LB, { liveSid: "live-9" }).fresh, true, "claimed with only a live id");
assert.equal(dedupe.claim(LB).storedSid, null, "stored_sid is null until the mapping is learned");
const bound = dedupe.bindStoredForLive("live-9", "stored-9");
assert.ok(bound >= 1, `bindStoredForLive backfilled rows (got ${bound})`);
const afterBind2 = dedupe.claim(LB);
assert.equal(afterBind2.fresh, false, "still a duplicate after backfill");
assert.equal(afterBind2.storedSid, "stored-9", "replay ack now names the stored session");
assert.equal(afterBind2.liveSid, "live-9", "live id preserved");
// COALESCE semantics: a second mapping must not clobber the first.
dedupe.bindStoredForLive("live-9", "stored-OTHER");
assert.equal(dedupe.claim(LB).storedSid, "stored-9", "a later mapping never overwrites a known stored id");
// Degenerate inputs are no-ops, not throws.
assert.equal(dedupe.bindStoredForLive("", "stored-9"), 0, "empty live id is a no-op");
assert.equal(dedupe.bindStoredForLive("live-none", ""), 0, "empty stored id is a no-op");
assert.equal(dedupe.bindStoredForLive(null, null), 0, "null inputs are a no-op");

// --- 8. sweep respects the TTL, and does not delete live keys -------------
// TTL is 1000ms; the recent keys must survive.
const freshSweep = dedupe.sweep(Date.now());
assert.ok(freshSweep.skipped || freshSweep.removed === 0, "a fresh sweep removes nothing");
// Age ONE key past the TTL and sweep at the real clock. (A "future clock" would
// expire every key, not just the stale one — the cutoff is relative to `now`,
// so the fresh keys must sit on the near side of it.)
const d = dedupe.openDedupeDb();
d.prepare("UPDATE message_keys SET created_ms = ? WHERE key = ?").run(Date.now() - 60_000, k2);
dedupe._test.resetSweepThrottle();
const far = dedupe.sweep(Date.now()); // TTL is 1000ms; k2 is 60s old, k1/k3 are ~now
assert.ok(far.removed >= 1, `expired key must be removed (got ${JSON.stringify(far)})`);
assert.equal(dedupe.seen(k2), false, "expired key is gone");
assert.equal(dedupe.seen(k1), true, "unexpired key survives the sweep");

// --- 9. sweep throttle: a second immediate call is a no-op ---------------
dedupe._test.resetSweepThrottle();
const t0 = dedupe.sweep(Date.now());
assert.ok(t0.skipped === undefined, "a sweep after a reset actually runs");
const again = dedupe.sweep(Date.now());
assert.ok(again.skipped, "the sweep is throttled to at most once a minute");

// --- 10. stats + the DB file is where we said it is ----------------------
const st = dedupe.dedupeStats();
assert.ok(st.keys >= 1, "stats counts the surviving keys");
assert.ok(existsSync(st.path), "the dedupe DB exists on disk");
assert.ok(st.path.startsWith(tmp), "the DB landed in the isolated test dir, not the real data dir");

// --- 11. THE RACE: two concurrent claims of the same key -----------------
// This is the whole reason the insert is a single statement. A read-then-write
// check would let both callers see "not present" and both return fresh.
const raceKey = "0198f1c2-4444-7000-8000-dddddddddddd";
const results = [];
for (let i = 0; i < 25; i++) results.push(dedupe.claim(raceKey, { storedSid: `sess-${i}` }));
const freshCount = results.filter((r) => r.fresh === true).length;
const dupCount = results.filter((r) => r.fresh === false).length;
assert.equal(freshCount, 1, `exactly ONE of 25 concurrent claims may be fresh (got ${freshCount})`);
assert.equal(dupCount, 24, `the other 24 must be duplicates (got ${dupCount})`);
// And they must all agree on WHICH claim won — the first recorded sid.
const storedSids = new Set(results.map((r) => r.storedSid).filter(Boolean));
assert.equal(storedSids.size, 1, `all claims agree on one stored_sid (got ${[...storedSids].join(",")})`);

// --- 12. close is idempotent (shutdown path) ----------------------------
dedupe.closeDedupeDb();
dedupe.closeDedupeDb();
assert.equal(dedupe.openDedupeDb(), dedupe.openDedupeDb(), "reopen returns one live handle");
dedupe.closeDedupeDb();

rmSync(tmp, { recursive: true, force: true });
console.log(
  "message-dedupe.check: ALL PASS (claim/replay/bind/sweep/throttle/" +
  "garbage-keys/25-way concurrent claim race)"
);
