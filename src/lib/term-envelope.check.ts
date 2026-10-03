// Pins both deferred fixes from the typing-lag investigation (2026-10-03).
//
//   1. TERMINAL / CODE-EXECUTE DUPLICATION (owner report: "the text 'output' is duplicated
//      2 or 3 times varyingly, fix this, output text and actual output must only be parsed
//      and display"). Cause, proven from the rendered DOM with dup-visual.mjs: tool results
//      are PERSISTED as a JSON envelope, `{"output": "...", "exit_code": 0}`, and the
//      terminal window rendered that envelope verbatim — a `"output":` key line, the escaped
//      payload on the next line, and an `exit_code` line that is not output at all.
//
//   2. The feed memo's dependency contract: the memoized row list MUST re-derive when a
//      bg receipt, the open-bg jump target, streaming state or the stored session changes,
//      or a stale dock row / stale action row survives.
//
// Run: node --experimental-strip-types src/lib/term-envelope.check.ts
//      (or `node scripts/run-checks.mjs --filter term-envelope`)
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { formatTerminal, unwrapToolEnvelope } from "./term-format.ts";
import { describeOutput } from "./tool-io.ts";

// ---------- 1. envelope duplication ----------

test("bare output text is returned untouched", () => {
  assert.equal(unwrapToolEnvelope("plain output\nline two").text, "plain output\nline two");
  assert.equal(unwrapToolEnvelope("").text, "");
});

test("a persisted JSON envelope yields the output ONCE, never the envelope", () => {
  const raw = JSON.stringify({ output: "alpha\nbeta\ngamma", exit_code: 0, error: null });
  const { text, exitCode } = unwrapToolEnvelope(raw);
  assert.equal(text, "alpha\nbeta\ngamma");
  assert.equal(exitCode, 0);
  assert.ok(!/"output"\s*:/.test(text), 'envelope key leaked: ' + text);
  assert.ok(!/exit_code/.test(text), "exit_code leaked into output text: " + text);
});

test("every envelope key variant the gateway persists is unwrapped", () => {
  for (const k of ["output", "stdout", "text", "result", "content"]) {
    const raw = JSON.stringify({ [k]: `payload via ${k}`, exit_code: 0 });
    assert.equal(unwrapToolEnvelope(raw).text, `payload via ${k}`, "failed for key " + k);
  }
});

test("a failing envelope keeps its exit code for the badge", () => {
  assert.equal(unwrapToolEnvelope(JSON.stringify({ output: "boom", exit_code: 1 })).exitCode, 1);
});

test("prose or log text containing braces is NEVER unwrapped", () => {
  // These are the false-positive cases. Unwrapping any of them would EAT real output,
  // which is worse than the duplication bug — so each is asserted explicitly.
  assert.equal(unwrapToolEnvelope('build failed: {"a":1} in file').text, 'build failed: {"a":1} in file');
  assert.equal(unwrapToolEnvelope("{not json at all").text, "{not json at all");
  assert.equal(unwrapToolEnvelope("[1,2,3] is an array").text, "[1,2,3] is an array");
  assert.equal(unwrapToolEnvelope("null").text, "null");
  // A JSON object with NO recognised key at all keeps its shape — there is nothing to
  // unwrap to, and describeOutput still reads the keys off it.
  assert.equal(unwrapToolEnvelope('{"totally":"unknown key"}').text, '{"totally":"unknown key"}');
});

// ---------- 1b. envelope shapes the FLAT lookup missed (owner, 2026-10-03, second report) ----------
//
// The first fix only looked one level deep and only accepted STRING values, so four real
// shapes still rendered the raw envelope into the card — the same duplicated-"output"
// symptom, varying with the tool that produced the row. Each row below was probed against
// the shipped helper before the rewrite.

test("a nested envelope is unwrapped to the innermost text", () => {
  assert.equal(unwrapToolEnvelope('{"result":{"output":"dup text"}}').text, "dup text");
  assert.equal(unwrapToolEnvelope('{"data":{"output":"inner"}}').text, "inner");
  assert.equal(unwrapToolEnvelope('{"data":{"result":{"output":"deepest"}}}').text, "deepest");
});

test("output carried as an ARRAY of lines is joined, not dumped as JSON", () => {
  const raw = JSON.stringify({ output: ["line1", "line2"], exit_code: 0 });
  const { text, exitCode } = unwrapToolEnvelope(raw);
  assert.equal(text, "line1\nline2");
  assert.equal(exitCode, 0);
  assert.ok(!/"output"/.test(text), "envelope key leaked: " + text);
});

test("an MCP-style content array joins its text parts and skips non-text blocks", () => {
  const raw = JSON.stringify({
    content: [
      { type: "text", text: "first" },
      { type: "image", data: "<binary>" },
      { type: "text", text: "second" },
    ],
  });
  const { text } = unwrapToolEnvelope(raw);
  assert.equal(text, "first\nsecond");
  assert.ok(!/"content"/.test(text), "envelope key leaked: " + text);
});

test("an array of text blocks under `output` is joined the same way", () => {
  assert.equal(
    unwrapToolEnvelope(JSON.stringify({ output: [{ text: "a" }, { text: "b" }] })).text,
    "a\nb"
  );
});

test("an empty payload beside an error shows the error, not the envelope", () => {
  const { text } = unwrapToolEnvelope(JSON.stringify({ output: "", error: "boom" }));
  assert.equal(text, "boom");
  assert.ok(!/"output"/.test(text), "envelope key leaked: " + text);
  // A message key works too, and the envelope's own exit code still reaches the badge.
  assert.equal(
    unwrapToolEnvelope(JSON.stringify({ output: "", message: "nope" })).text, "nope"
  );
  assert.equal(
    unwrapToolEnvelope(JSON.stringify({ output: "", error: "boom", exit_code: 2 })).exitCode, 2
  );
});

test("the first output-ish key still wins when several are present", () => {
  assert.equal(unwrapToolEnvelope(JSON.stringify({ stdout: "S", output: "O" })).text, "O");
});

test("the rendered card body shows the payload exactly once (the owner's exact complaint)", () => {
  // The real row from state.db that first exposed this.
  const raw = JSON.stringify({
    output: "=== adb in sdk ===\n/home/notjitin/Work/android-sdk/platform-tools/adb\n=== chrome-devtools skills ===\ndebug",
    exit_code: 0, error: null,
  });
  const { text } = unwrapToolEnvelope(raw);
  const body = formatTerminal(text, { maxLines: 400 }).lines.map((l) => l.text).join("\n");
  const hits = (s: string) => body.split(s).length - 1;
  assert.equal(hits("=== adb in sdk ==="), 1, "payload duplicated:\n" + body);
  assert.equal(hits("=== chrome-devtools skills ==="), 1, "payload duplicated:\n" + body);
  assert.equal(/"?output"?\s*:/.test(body), false, 'a JSON "output" key line survived:\n' + body);
  assert.equal(body.includes("exit_code"), false, "exit_code rendered as output:\n" + body);
});

test("no line of the rendered body is an escaped JSON fragment", () => {
  const raw = JSON.stringify({ output: "line one\nline two", exit_code: 0 });
  const body = formatTerminal(unwrapToolEnvelope(raw).text).lines.map((l) => l.text).join("\n");
  assert.equal(body.trim(), "line one\nline two");
});

test("large output is not corrupted by unwrapping", () => {
  const big = Array.from({ length: 300 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n");
  const raw = JSON.stringify({ output: big, exit_code: 0 });
  const { text } = unwrapToolEnvelope(raw);
  assert.equal(text, big);
  assert.equal(text.split("\n").length, 300);
});

// ---------- 2. feed memo dependency contract ----------

/** The exact dep list the chat feed memo uses. Kept here so a silent edit is caught. */
const FEED_DEPS = ["messages", "bgItems", "openBgRef", "isStreaming", "storedSessionId"];

test("describeOutput is fed the UNWRAPPED text, so the payload renders exactly once", () => {
  // The duplication came from the CALL SITE, not the helpers: chat-timeline described the RAW
  // envelope (yielding an `Output` field whose value was the payload) while the TerminalWindow
  // rendered the same text again. This pins the composition the timeline now performs.
  const env = JSON.stringify({ output: "PASSED: x=1\nstdout: 50% stdout", exit_code: 0 });
  const raw = describeOutput("execute_code", env);
  const fixed = describeOutput("execute_code", unwrapToolEnvelope(env).text);

  // Before: an `Output` field carrying the payload -> the window repeated it.
  assert.ok(
    raw.some((f) => f.key === "Output" && f.value.includes("PASSED: x=1")),
    "the raw envelope is expected to yield a duplicating Output field: " + JSON.stringify(raw)
  );
  // After: exactly ONE field, no envelope key anywhere.
  assert.equal(fixed.length, 1, "expected a single field: " + JSON.stringify(fixed));
  assert.equal(/"(output|stdout|exit_code)"\s*:/.test(fixed[0].value), false);
  assert.ok(fixed[0].value.includes("PASSED: x=1"));
  // And with fields present the timeline renders NO window (its `outFields.length === 0` guard),
  // so the payload appears exactly once across the whole card.
  assert.notEqual(fixed.length, 0);
});

test("every envelope shape yields a single non-duplicating field", () => {
  for (const env of [
    JSON.stringify({ output: "The file /home/x/y.ts has been updated.", exit_code: 0 }),
    JSON.stringify({ result: { output: "patched" } }),
    JSON.stringify({ output: ["line1", "line2"], exit_code: 0 }),
    JSON.stringify({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }),
  ]) {
    const fields = describeOutput("execute_code", unwrapToolEnvelope(env).text);
    const leaks = fields.filter((f) => /"(output|stdout|exit_code|content)"\s*:/.test(f.value));
    assert.equal(leaks.length, 0, "envelope leaked into a field: " + JSON.stringify(leaks));
    assert.ok(fields.length >= 1, "expected at least one field for " + env);
  }
});

test("the feed memo lists every dependency the row JSX reads", () => {
  // Reading the source is deliberate: the bug class is a DROPPED dep, which no runtime
  // assertion on the helper can see. Assert the literal list exists in the component.
  const src = readFileSync(new URL("../components/chat-landing.tsx", import.meta.url), "utf8");
  const m = src.match(/const messageList = useMemo\([\s\S]*?\n  \}\), \[([^\]]*)\]\);/);
  assert.ok(m, "messageList useMemo not found in chat-landing.tsx");
  const deps = m[1].split(",").map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(deps, FEED_DEPS, "feed memo deps drifted: " + deps.join(","));
});

test("the memo must not depend on the composer draft", () => {
  // The whole point: a keystroke changes `input`, and `input` is NOT in the dep list, so
  // typing reuses the existing row elements instead of rebuilding the transcript.
  assert.equal(FEED_DEPS.includes("input"), false);
  assert.equal(FEED_DEPS.includes("attachments"), false);
  assert.equal(FEED_DEPS.includes("cmdPrefix"), false);
});