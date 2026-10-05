// Runnable check: the stream-log READ side (Phase 3).
//
// WHAT THIS PROVES, and why each part matters:
//   The store is proven in stream-log.check.mjs. This proves the HTTP contract —
//   which is where the dangerous failure lives: a read that LOOKS complete but
//   has a hole in it renders a transcript that appears whole while missing text.
//   That is worse than an error, so the `truncated` flag is asserted hard.
//
// Run: node server/stream-routes.check.mjs   (isolated via ASTRA_STREAM_DIR)
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "astra-sroutes-"));
process.env.ASTRA_STREAM_DIR = tmp;
process.env.ASTRA_STREAM_TTL_MS = "1000";

const slog = await import("./stream-log.mjs");
const { handleStreamRoutes } = await import("./stream-routes.mjs");

// A minimal req/res pair: records status + body, like the real Node response.
function mockRes() {
  const out = { status: 0, body: null, ended: false };
  return {
    out,
    writeHead(code) { out.status = code; },
    end(payload) { out.body = payload ? JSON.parse(payload) : null; out.ended = true; },
  };
}

async function call(method, rawUrl) {
  const res = mockRes();
  const url = new URL(rawUrl, "http://x");
  const owned = await handleStreamRoutes({ method, url: rawUrl, headers: {} }, res, url);
  return { owned, status: res.out.status, body: res.out.body };
}

const SID = "sess-routes-check";

// Seed a realistic turn.
const seed = [
  { seq: 1, type: "message.start",    payload: { message_id: "m1" } },
  { seq: 2, type: "thinking.delta",   payload: { text: "considering" } },
  { seq: 3, type: "message.delta",    payload: { text: "Par" } },
  { seq: 4, type: "tool.done",        payload: { tool_call_id: "tc1", tool_name: "terminal", command: "cat f.txt" } },
  { seq: 5, type: "message.delta",    payload: { text: "tial" } },
  { seq: 6, type: "message.delta",    payload: { text: " answer" } },
  { seq: 7, type: "message.complete", payload: { status: "ok" } },
];
for (const f of seed) slog.recordEvent({ session_id: SID, ...f });
slog.flushNow();

// --- 1. full read from cursor 0 ------------------------------------------
const full = await call("GET", `/api/hx/stream/${SID}?since=0`);
assert.equal(full.owned, true, "the route owns the request");
assert.equal(full.status, 200, "200 on a good read");
assert.equal(full.body.events.length, 7, `all 7 events returned (got ${full.body.events.length})`);
assert.equal(full.body.latest_seq, 7, "latest_seq is the head cursor");
assert.equal(full.body.next_cursor, 7, "next_cursor is the last event's seq");
assert.equal(full.body.truncated, false, "nothing purged, so not truncated");
assert.equal(full.body.more, false, "a complete read is not `more`");
assert.deepEqual(full.body.events.map((e) => e.seq), [1,2,3,4,5,6,7], "ascending by seq");

// --- 2. resume from a cursor: ONLY what was missed -----------------------
const tail = await call("GET", `/api/hx/stream/${SID}?since=4`);
assert.deepEqual(tail.body.events.map((e) => e.seq), [5,6,7], "since=4 returns 5..7 only");
assert.equal(tail.body.since, 4, "the echoed cursor is what was asked for");
assert.equal(tail.body.next_cursor, 7, "next_cursor advances");

// --- 3. a cursor already at the head returns nothing, and is NOT truncated
const drained = await call("GET", `/api/hx/stream/${SID}?since=7`);
assert.equal(drained.body.events.length, 0, "nothing new past the head");
assert.equal(drained.body.truncated, false,
  "a caught-up client must NOT be told it is truncated (that would refetch forever)");
assert.equal(drained.body.next_cursor, 7, "next_cursor holds steady when idle");

// --- 4. reassembly from the HTTP response alone --------------------------
const text = full.body.events.filter((e) => e.type === "message.delta")
  .map((e) => e.payload?.text ?? "").join("");
assert.equal(text, "Partial answer", `HTTP response reassembles byte-identically (got ${JSON.stringify(text)})`);

// --- 5. D2 is visible over HTTP: tool chunk is a reference, no body ------
const tool = full.body.events.find((e) => e.type === "tool.done");
assert.equal(tool.kind, "ref", "tool chunk is a reference over HTTP too");
assert.equal(tool.payload, undefined, "a reference carries NO payload copy over HTTP");
assert.equal(tool.ref_row, "tc1", "the reference names the gateway row");
assert.ok(tool.headline?.includes("terminal"), "and carries an inline headline");

// --- 6. `more` tells a paginating client to come back -------------------
const paged = await call("GET", `/api/hx/stream/${SID}?since=0&limit=3`);
assert.equal(paged.body.events.length, 3, "limit is honoured");
assert.equal(paged.body.more, true, "a partial page reports more=true");
assert.equal(paged.body.truncated, false, "paginating is not truncation");
const paged2 = await call("GET", `/api/hx/stream/${SID}?since=3&limit=3`);
assert.deepEqual(paged2.body.events.map((e) => e.seq), [4,5,6], "the cursor advances correctly between pages");
const paged3 = await call("GET", `/api/hx/stream/${SID}?since=6&limit=3`);
assert.equal(paged3.body.more, false, "the last page reports more=false");

// --- 7. THE FLAG THAT MATTERS: after a purge the client is told ----------
// A client resuming from 0 must NOT get "truncated: false, events: []" — that
// combination reads as "nothing happened" and silently loses the turn.
const d = slog.openStreamDb();
d.prepare("UPDATE stream_events SET ts_ms = ? WHERE sid = ?").run(Date.now() - 60_000, SID);
slog.purgeOlderThan(Date.now());
const afterPurge = await call("GET", `/api/hx/stream/${SID}?since=0`);
assert.equal(afterPurge.status, 200, "a purged read still answers 200");
assert.equal(afterPurge.body.events.length, 0, "the events really are gone");
assert.equal(afterPurge.body.truncated, true,
  "truncated=true tells the client to refetch history instead of trusting an empty answer");

// --- 8. an unknown session is empty, NOT truncated -----------------------
const unknown = await call("GET", "/api/hx/stream/sess-never-existed?since=0");
assert.equal(unknown.status, 200, "unknown session answers 200");
assert.equal(unknown.body.events.length, 0, "unknown session has no events");
assert.equal(unknown.body.truncated, false,
  "a session that never streamed is NOT truncated (must not trigger a refetch storm)");

// --- 9. bad input is a clear 400, not a silent empty answer -------------
for (const [q, why] of [["since=-5", "negative cursor"], ["since=abc", "non-numeric cursor"]]) {
  const r = await call("GET", `/api/hx/stream/${SID}?${q}`);
  assert.equal(r.status, 400, `${why} -> 400`);
  assert.ok(r.body?.error, `${why} carries an error message`);
}
const limitClamp = await call("GET", `/api/hx/stream/${SID}?since=0&limit=99999999`);
assert.equal(limitClamp.status, 200, "an absurd limit is clamped, not rejected");
assert.ok(limitClamp.body.events.length <= 20000, "the clamp is honoured");

// --- 10. the cursor-only probe + stats ---------------------------------
const probe = await call("GET", `/api/hx/stream?session_id=${SID}&since=0`);
assert.equal(probe.status, 200, "the probe answers");
assert.equal(probe.body.latest_seq, 0, "the probe reports the head cursor");
assert.equal(probe.body.truncated, true, "and reports truncation after a purge");

const stats = await call("GET", "/api/hx/stream/stats");
assert.equal(stats.status, 200, "stats answers");
assert.equal(typeof stats.body.events, "number", `stats carries counts (got keys ${Object.keys(stats.body||{})})`);
assert.equal(stats.body.session_id, undefined, "stats is NOT answered as a session read (routing-order bug)");
assert.ok(stats.body.path.startsWith(tmp), "stats points at the isolated dir");
// A query string does not change the path, so `?since=0` on /stats is still the
// stats route — asserting otherwise would be asserting a lie. What matters is
// that the RESERVED name can never be read as a session id.
const statsWithQuery = await call("GET", "/api/hx/stream/stats?since=0");
assert.equal(statsWithQuery.status, 200, "a query string does not re-route /stats");
assert.equal(statsWithQuery.body.session_id, undefined, "still stats, never a session read");

// --- 11. non-owned paths fall through to the gateway --------------------
const passthrough = await call("GET", "/api/hx/sessions");
assert.equal(passthrough.owned, false, "an unrelated /api/hx path is NOT owned by this router");
const wrongMethod = await call("POST", `/api/hx/stream/${SID}`);
assert.equal(wrongMethod.owned, false, "POST is not owned (read-only surface)");

// --- 12. over-long / hostile session keys are bounded ------------------
const evil = "x".repeat(500);
const bounded = await call("GET", `/api/hx/stream/${evil}?since=0`);
assert.equal(bounded.status, 200, "an over-long key does not throw");
assert.ok(bounded.body.session_id.length <= 128, `the key is truncated to a bound (${bounded.body.session_id.length})`);

slog.closeStreamDb();
rmSync(tmp, { recursive: true, force: true });
console.log(
  "stream-routes.check: ALL PASS (full read, cursor resume, reassembly, D2 " +
  "reference over HTTP, pagination+more, truncated-after-purge, unknown session " +
  "not truncated, bad input 400, probe, stats, pass-through, bounded keys)"
);
