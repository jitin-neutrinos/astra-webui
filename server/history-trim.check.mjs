// history-trim.check.mjs — only proven-unused fields are dropped from history.
//
// THE RULE THIS ENFORCES:
//   Dropping a field the client actually reads silently changes the UI — a missing
//   `reasoning` erases the "Thought for Nm" line, a missing `display_kind` makes
//   a failed turn render as normal prose. So every DROP is asserted safe, and
//   every KEEP is asserted present, including fields nobody has mentioned.
//
// Run: node server/history-trim.check.mjs
import assert from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trimRow, trimHistoryPayload, DROPPED_FIELDS } from "./history-trim.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- 1. the source of truth for "does the client read it?" ---------------
// A drop is only safe if NO client file mentions the field outside a check. This
// is re-derived from the real tree on every run, so a field that a later session
// starts reading fails here immediately instead of silently blanking the UI.
const clientDir = join(ROOT, "src");
function clientMentions(field) {
  const hits = [];
  const walk = (dir, depth = 0) => {
    if (depth > 5) return;
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) { walk(full, depth + 1); continue; }
      if (!/\.(ts|tsx)$/.test(name.name)) continue;
      // A check file asserts behaviour; it is not a consumer.
      if (/\.check\.(ts|tsx|mjs)$/.test(name.name)) continue;
      const src = readFileSync(full, "utf8");
      if (src.includes(field)) hits.push(full.replace(ROOT + "/", ""));
    }
  };
  walk(clientDir);
  return hits;
}

for (const field of Object.keys(DROPPED_FIELDS)) {
  const hits = clientMentions(field);
  assert.deepEqual(hits, [],
    `${field} is dropped from history but a client file reads it: ${hits.join(", ")}. ` +
    `Remove it from DROPPED_FIELDS, or stop reading it.`);
}

// --- 2. the drops happen -----------------------------------------------
const row = {
  id: "r1",
  role: "assistant",
  content: "hello",
  reasoning: "thinking about it",
  reasoning_content: "thinking about it",
  api_content: '{"raw":"provider payload"}',
  session_id: "sess-1",
  timestamp: 1700000000,
  tool_call_id: "tc1",
  display_kind: null,
  finish_reason: "stop",
};
const trimmed = trimRow(row);
for (const field of Object.keys(DROPPED_FIELDS)) {
  assert.equal(field in trimmed, false, `${field} is removed`);
}
// The original is NOT mutated — the caller may hold it.
assert.equal("api_content" in row, true, "trimRow does not mutate its input");

// --- 3. the keeps are all still there ----------------------------------
// These are what a regression here would actually break, so each is named.
for (const field of [
  "id", "role", "content", "reasoning", "timestamp",
  "tool_call_id", "display_kind", "finish_reason",
]) {
  assert.ok(field in trimmed, `${field} is PRESERVED (the UI depends on it)`);
}
assert.equal(trimmed.content, "hello", "content survives verbatim");
assert.equal(trimmed.reasoning, "thinking about it", "reasoning survives verbatim");

// `display_kind` is the subtle one: normalize-messages.ts branches on it to skip
// hidden rows and to render failed_turn. Dropping it would show internal rows.
assert.ok("display_kind" in trimmed, "display_kind survives (hidden/failed_turn rows depend on it)");

// --- 4. an unknown field passes through -------------------------------
// The reason this is a drop-list and not an allow-list: a new upstream field must
// be safe by default.
assert.equal(trimRow({ id: "r", brand_new_upstream_field: 42 }).brand_new_upstream_field, 42,
  "an unknown field is passed through untouched (allow-lists break on new fields)");

// --- 5. a row with none of the dropped fields is returned as-is ---------
const clean = { id: "x", role: "user", content: "hi" };
assert.equal(trimRow(clean), clean, "a row needing no trim is returned unchanged (same reference)");

// --- 6. payload-level trim, with real numbers -------------------------
const payload = {
  messages: Array.from({ length: 100 }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 ? "assistant" : "user",
    content: "x".repeat(900),
    reasoning: "y".repeat(400),
    reasoning_content: "y".repeat(400),   // duplicate
    api_content: "z".repeat(600),          // never read
    session_id: "s".repeat(22),            // KEPT — read by 9 client files
    timestamp: 1700000000 + i,
  })),
};
const r = trimHistoryPayload(payload);
assert.equal(r.rows, 100, "every row is visited");
assert.ok(r.bytesAfter < r.bytesBefore, `the payload shrank (${r.bytesBefore} -> ${r.bytesAfter})`);
const saved = r.bytesBefore - r.bytesAfter;
assert.ok(saved > 20_000,
  `a realistic 100-row page saves >20 KB (saved ${saved})`);
assert.equal(r.payload.messages[0].reasoning.length, 400, "reasoning is intact");
assert.equal(r.payload.messages[0].content.length, 900, "content is intact");
assert.equal("reasoning_content" in r.payload.messages[0], false, "the duplicate is gone");
assert.equal("session_id" in r.payload.messages[0], true,
  "session_id is KEPT — the review found 9 client files that read it");

// --- 7. degenerate payloads are safe ----------------------------------
assert.deepEqual(trimHistoryPayload({}).payload, {}, "an empty payload is fine");
assert.equal(trimHistoryPayload({ messages: null }).rows, 0, "a null messages array is fine");
assert.equal(trimHistoryPayload({ messages: [null, 5] }).rows, 2, "non-object rows are left alone");
assert.equal(trimRow({}).id, undefined, "an empty row is fine");

console.log(
  "history-trim.check: ALL PASS (every dropped field re-verified as unread in the " +
  "live client tree, original not mutated, content/reasoning/timestamp/tool_call_id/" +
  "display_kind/finish_reason preserved, unknown fields pass through, a realistic " +
  "100-row page saves >20 KB, degenerate payloads safe)"
);
