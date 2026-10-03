// Self-check for term-format. Run: node --experimental-strip-types src/lib/term-format.check.ts
// (or via scripts/run-checks.mjs). Assert-based, no framework.
import assert from "node:assert/strict";
import { test } from "node:test";
import { stripAnsi, tidyWhitespace, prettyJson, jsonSummary, humanizeTimestamps, shortenPaths, lineTone, formatTerminal } from "./term-format.ts";

test("stripAnsi removes SGR colour codes", () => {
  assert.equal(stripAnsi("\u001b[32m✓\u001b[0m done"), "✓ done");
  assert.equal(stripAnsi("\u001b[1;31merror\u001b[0m"), "error");
});

test("stripAnsi removes cursor/OSC sequences", () => {
  assert.equal(stripAnsi("\u001b[2K\u001b[1Gtext"), "text");
  assert.equal(stripAnsi("\u001b]0;title\u0007body"), "body");
  assert.equal(stripAnsi("\u001b[?25lhidden"), "hidden");
});

test("stripAnsi keeps only the final CR overwrite (progress bars)", () => {
  assert.equal(stripAnsi("10%\r50%\r100% done"), "100% done");
});

test("stripAnsi drops other C0 control chars but keeps tab/newline", () => {
  assert.equal(stripAnsi("a\u0007b\u0000c"), "abc");
  assert.equal(stripAnsi("a\tb\nc"), "a\tb\nc");
});

test("tidyWhitespace collapses blank runs and trims line ends", () => {
  assert.equal(tidyWhitespace("a   \n\n\n\nb"), "a\n\nb");
});

test("prettyJson formats a whole JSON document, null for prose", () => {
  assert.equal(prettyJson('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(prettyJson("hello world"), null);
  // a log line CONTAINING braces is not a JSON document
  assert.equal(prettyJson("info: {\"a\":1} trailing"), null);
});

test("jsonSummary counts instead of showing braces", () => {
  assert.equal(jsonSummary([{a:1,b:2},{a:3,b:4}]), "2 items · 2 fields each");
  assert.equal(jsonSummary([]), "empty list");
  assert.equal(jsonSummary({a:1,b:2,c:3}), "3 fields");
});

test("humanizeTimestamps turns ISO into a readable date", () => {
  const out = humanizeTimestamps("created 2026-10-02T11:24:07.881Z ok");
  assert.ok(!out.includes("T11:24"), "ISO form must be gone: " + out);
  assert.ok(/2 Oct, \d\d:\d\d/.test(out), "expected '2 Oct, HH:MM' in: " + out);
});

test("shortenPaths compresses deep absolute paths, leaves short ones", () => {
  assert.equal(shortenPaths("/home/notjitin/Work/projects/astra-webui"), "…/projects/astra-webui");
  assert.equal(shortenPaths("/home/notjitin"), "/home/notjitin");
});

test("lineTone classifies by word boundary, not substring", () => {
  assert.equal(lineTone("$ npm run build"), "cmd");
  assert.equal(lineTone("Error: not found"), "err");
  assert.equal(lineTone("errorless prose here"), "plain");   // no false positive
  assert.equal(lineTone('    "ok": true,'), "plain");        // JSON data, not a success report
  assert.equal(lineTone("✓ states: 38"), "ok");
  assert.equal(lineTone("warning: deprecated"), "warn");
  assert.equal(lineTone("✓ passed"), "ok");
  assert.equal(lineTone(""), "dim");
});

test("formatTerminal end-to-end on messy real-world output", () => {
  const messy = "\u001b[32m✓\u001b[0m states: 38\n" +
    "\u001b[31mwarning\u001b[0m: deprecated flag\n" +
    "cwd /home/notjitin/Work/projects/astra-webui/x/y\n" +
    "at 2026-10-02T11:24:07.881Z\n";
  const r = formatTerminal(messy);
  const text = r.lines.map((l) => l.text).join("\n");
  assert.ok(!text.includes("\u001b"), "no escape codes survive");
  assert.ok(!text.includes("T11:24"), "timestamps humanized");
  assert.ok(!/\/home\/notjitin\/Work\/projects/.test(text), "deep path shortened");
  assert.equal(r.lines.find((l) => l.text.includes("states"))?.tone, "ok");
  assert.equal(r.lines.find((l) => l.text.includes("deprecated"))?.tone, "warn");
});

test("formatTerminal summarises a whole-JSON result and keeps it valid", () => {
  const r = formatTerminal('{"rows":[{"id":1},{"id":2}],"total":2}');
  assert.equal(r.summary, "2 fields");
  assert.ok(r.lines.length > 1, "pretty-printed across lines");
  assert.ok(r.lines.some((l) => l.text.includes('"total": 2')));
});

test("formatTerminal truncates the MIDDLE, preserving head and tail", () => {
  const big = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
  const r = formatTerminal(big, { maxLines: 10 });
  assert.equal(r.omitted, 90);
  assert.ok(r.lines[0].text === "line 0", "head kept");
  assert.ok(r.lines[r.lines.length - 1].text === "line 99", "tail kept");
  assert.ok(r.lines.some((l) => l.text.includes("more lines")));
});

test("formatTerminal tolerates empty/nullish input", () => {
  assert.deepEqual(formatTerminal("").lines, []);
  assert.deepEqual(formatTerminal(undefined as unknown as string).lines, []);
});
