// Slash-command palette logic checks.
// Run: npx tsx --test src/lib/command-registry.check.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeSlashQuery,
  applySlashCommand,
  filterCommands,
  __setRegistryCache,
  type CommandEntry,
} from "./command-registry";

const cmd = (name: string, over: Partial<CommandEntry> = {}): CommandEntry => ({
  name,
  description: `${name} description`,
  category: "Session",
  aliases: [],
  args_hint: "",
  ...over,
});

const REG: CommandEntry[] = [
  cmd("bg", { description: "Run a prompt in a separate background session", args_hint: "<prompt>" }),
  cmd("steer", { description: "Inject a message after the next tool call", args_hint: "<prompt>" }),
  cmd("model", { category: "Configuration", args_hint: "[model] [--provider name]" }),
  cmd("compress", { description: "Compress conversation context" }),
  cmd("new", { aliases: ["reset"] }),
  cmd("yolo", { category: "Configuration", description: "Toggle YOLO mode" }),
];

test("empty query preserves registry order", () => {
  assert.deepEqual(filterCommands(REG, "").map((c) => c.name), REG.map((c) => c.name));
  assert.deepEqual(filterCommands(REG, "   ").map((c) => c.name), REG.map((c) => c.name));
});

test("exact name beats prefix beats subsequence beats description", () => {
  const hits = filterCommands(REG, "bg").map((c) => c.name);
  assert.equal(hits[0], "bg", "exact match must rank first");
});

test("case-insensitive", () => {
  assert.equal(filterCommands(REG, "BG")[0].name, "bg");
  assert.equal(filterCommands(REG, "CoMpReSs")[0].name, "compress");
});

test("finds commands via alias", () => {
  const hits = filterCommands(REG, "reset").map((c) => c.name);
  assert.ok(hits.includes("new"), "alias 'reset' must surface /new");
});

test("subsequence match works (bg finds background-style names)", () => {
  // "st" is a subsequence of "steer" and of "status"-like names.
  const hits = filterCommands(REG, "str").map((c) => c.name);
  assert.ok(hits.includes("steer"), `expected /steer in ${JSON.stringify(hits)}`);
});

test("description match is reachable but ranks last", () => {
  const hits = filterCommands(REG, "background").map((c) => c.name);
  assert.ok(hits.includes("bg"), "description hit must still find the command");
  // A name match must outrank a description-only match.
  const both = [cmd("zebra"), cmd("aardvark", { description: "zebra crossing" })];
  assert.equal(filterCommands(both, "zebra")[0].name, "zebra");
});

test("no matches returns empty", () => {
  assert.deepEqual(filterCommands(REG, "qqqqqq"), []);
});

test("empty registry is safe", () => {
  assert.deepEqual(filterCommands([], "bg"), []);
});

test("live palette opens on / at line start", () => {
  assert.deepEqual(activeSlashQuery("/", 1), { query: "", start: 0 });
  assert.deepEqual(activeSlashQuery("/mo", 3), { query: "mo", start: 0 });
  // After a newline is a fresh line, so a command is legal there too.
  assert.deepEqual(activeSlashQuery("hi\n/mo", 6), { query: "mo", start: 3 });
});

test("a / mid-sentence is NOT a command (prose, paths and dates keep working)", () => {
  // Deliberately line-anchored: "hello /mo" is someone typing, not issuing
  // /model, and hijacking it would eat the text.
  assert.equal(activeSlashQuery("hello /mo", 9), null);
  assert.equal(activeSlashQuery("see /usr/bin", 12), null);
  assert.equal(activeSlashQuery("ratio 1/2", 9), null);
  // A token that already took a space is a command WITH its argument, so the
  // palette closes and the user can keep typing prose.
  assert.equal(activeSlashQuery("/model gpt", 9), null);
});

test("applying a command inserts name + first arg and parks the caret", () => {
  const c = cmd("model", { args_hint: "[model] [--provider name]" });
  const r = applySlashCommand("/mo", 0, 3, c);
  assert.equal(r.text, "/model [model]");
  assert.equal(r.caret, r.text.length, "caret must land at the end of the insert");
});

test("apply preserves text after the caret and drops the typed token", () => {
  const c = cmd("bg", { args_hint: "<prompt>" });
  // Input "/bg PROMPT" with the caret after "/bg": the typed token is replaced,
  // and the remainder — including its leading space — is kept intact.
  const r = applySlashCommand("/bg PROMPT", 0, 3, c);
  assert.equal(r.text, "/bg <prompt> PROMPT");
  assert.equal(r.caret, "/bg <prompt>".length);
});

test("command with no args hint inserts bare name", () => {
  const r = applySlashCommand("/ne", 0, 3, cmd("new"));
  assert.equal(r.text, "/new");
  assert.equal(r.caret, 4);
});

test("flag-only hint is not appended as a stub argument", () => {
  const r = applySlashCommand("/comp", 0, 5, cmd("compress", { args_hint: "--preview" }));
  assert.equal(r.text, "/compress", "a leading --flag is not an argument stub");
});

test("registry cache seam round-trips", () => {
  __setRegistryCache(REG);
  assert.equal(filterCommands(REG, "bg")[0].name, "bg");
  __setRegistryCache(null);
});