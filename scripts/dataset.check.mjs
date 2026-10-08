// Check: dataset.mjs hygiene — the rules that make the SFT set clean.
// Exercises: tool-heading extraction, envelope unwrapping, automation +
// internal exclusion, empty-assistant dropping, alternation, truncation,
// dedup, and the manifest's reduction accounting.
// Run: node scripts/dataset.check.mjs
import assert from "node:assert";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "astra-dataset-check-"));
process.env.TRAINING_DB_PATH = join(dir, "t.db");
process.env.TRAINING_DATA_DIR = dir;

const { openTrainingDb } = await import("../server/training.mjs");
const { buildTrainingDataset, toolHeading, headingsFor, unwrap } = await import("../server/dataset.mjs");

// ---- unit: tool headings + unwrap -----------------------------------------
assert.equal(toolHeading({ function: { name: "terminal", arguments: '{"command":"ls -la"}' } }), "terminal: ls -la");
assert.equal(toolHeading({ name: "read_file", arguments: '{"file_path":"src/App.tsx"}' }), "read_file: src/App.tsx");
assert.equal(toolHeading({ function: { name: "noop", arguments: "{}" } }), "noop", "no arg → bare name");
assert.equal(headingsFor('[{"function":{"name":"terminal","arguments":"{\\"command\\":\\"pwd\\"}"}}]').length, 1);
assert.deepEqual(headingsFor("not json"), []);
assert.equal(unwrap('{"output":"hello","exit_code":0}'), "hello");
assert.equal(unwrap('{"content":"body text"}'), "body text");
assert.equal(unwrap('{"name":"tool_call","args":{}}'), "", "bare call envelope → empty");
assert.equal(unwrap("plain prose"), "plain prose");

// ---- fixtures -------------------------------------------------------------
const db = openTrainingDb();
const insMsg = db.prepare(
  "INSERT INTO messages (sid,row_id,ts,role,content,tool_calls,reasoning) VALUES (?,?,?,?,?,?,?)",
);
const insSess = db.prepare(
  `INSERT INTO sessions (sid,title,source,created_at,ended_at,message_rows,token_stats,review_status,ingested_at,last_activity_at)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,
);

// s1 — a good chat whose assistant did a tool call. The tool RESULT body must
// not appear; the heading must.
insMsg.run("s1", "m1", 1, "user", "list the files", null, null);
insMsg.run("s1", "m2", 2, "assistant", "", '[{"function":{"name":"terminal","arguments":"{\\"command\\":\\"ls -la\\"}"}}]', null);
insMsg.run("s1", "m3", 3, "tool", '{"output":"SECRET_TOOL_BODY","exit_code":0}', null, null);
insMsg.run("s1", "m4", 4, "assistant", "There are three files.", null, null);
insSess.run("s1", "good", "webui", 1, 100, 4, "{}", "archived", 100, 4);

// s2 — automation session: excluded entirely.
insMsg.run("s2", "m1", 5, "user", "cron tick", null, null);
insMsg.run("s2", "m2", 6, "assistant", "done", null, null);
insSess.run("s2", "cron", "cron", 5, 200, 2, "{}", "done", 200, 6);

// s3 — internal reviewer session: excluded by the marker, not by source.
insMsg.run("s3", "m1", 7, "user", "PROMPT_TEMPLATE_VERSION: 1\nreviewer", null, null);
insMsg.run("s3", "m2", 8, "assistant", "FILE: none", null, null);
insSess.run("s3", "reviewer", "webui", 7, 300, 2, "{}", "done", 300, 8);

// s4 — duplicate of s1: deduped.
insMsg.run("s4", "m1", 9, "user", "list the files", null, null);
insMsg.run("s4", "m2", 10, "assistant", "", '[{"function":{"name":"terminal","arguments":"{\\"command\\":\\"ls -la\\"}"}}]', null);
insMsg.run("s4", "m3", 11, "tool", '{"output":"SECRET_TOOL_BODY","exit_code":0}', null, null);
insMsg.run("s4", "m4", 12, "assistant", "There are three files.", null, null);
insSess.run("s4", "dup", "webui", 9, 400, 4, "{}", "archived", 400, 12);

// s5 — assistant-only, no user turn: unusable.
insMsg.run("s5", "m1", 13, "assistant", "orphan", null, null);
insSess.run("s5", "orphan", "webui", 13, 500, 1, "{}", "archived", 500, 13);

// s6 — an oversized user turn must be truncated, not dropped.
insMsg.run("s6", "m1", 14, "user", "X".repeat(50000), null, null);
insMsg.run("s6", "m2", 15, "assistant", "ack", null, null);
insSess.run("s6", "huge", "webui", 14, 600, 2, "{}", "archived", 600, 15);

// ---- build ----------------------------------------------------------------
const m = buildTrainingDataset({ outDir: dir });
assert.equal(m.conversations, 2, "s1 kept, s6 kept (s2/s3 excluded, s4 dedup, s5 unusable)");
assert.equal(m.excluded.automation, 1, "cron session excluded");
assert.equal(m.excluded.internal, 1, "reviewer session excluded");
assert.equal(m.excluded.duplicates, 1, "duplicate excluded");
assert.equal(m.excluded.unusable, 1, "user-less session excluded");
assert.ok(m.hygiene.tool_results_dropped >= 2, "tool result bodies dropped");
assert.ok(m.hygiene.tool_headings_kept >= 2, "tool headings kept");
assert.ok(existsSync(m.file), "dataset written");

const lines = readFileSync(m.file, "utf8").trim().split("\n");
for (const line of lines) {
  const row = JSON.parse(line);
  assert.ok(row.messages.every((x) => x.role === "user" || x.role === "assistant"), "no tool rows");
  assert.equal(row.messages[0].role, "user");
  assert.equal(row.messages[row.messages.length - 1].role, "assistant");
  for (let i = 1; i < row.messages.length; i++) assert.notEqual(row.messages[i].role, row.messages[i - 1].role, "alternates");
  assert.ok(!JSON.stringify(row).includes("SECRET_TOOL_BODY"), "no tool payload leaked");
}

const s1 = lines.map((l) => JSON.parse(l)).find((r) => JSON.stringify(r).includes("ls -la"));
assert.ok(s1, "the tool call left a heading");
assert.ok(s1.messages.some((x) => x.content.includes("[tools: terminal: ls -la]")), "heading format is compact");
const s6 = lines.map((l) => JSON.parse(l)).find((r) => r.messages[0].content.startsWith("X"));
assert.ok(s6.messages[0].content.length <= 8100, "oversized user turn truncated");
assert.ok(s6.messages[0].content.includes("[…truncated]"), "truncation is marked");
assert.ok(Number(String(m.reduction).replace("%", "")) > 0, "reports a size reduction");

console.log("dataset.check: 4/4 groups passed");
