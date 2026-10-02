// Command-registry server checks. Run: node --test server/command-registry.check.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { normaliseCommand } from "./command-registry.mjs";

test("normalises a well-formed record", () => {
  const c = normaliseCommand({
    name: "Model",
    description: "  Switch model  ",
    category: "Configuration",
    aliases: ["Switch-Model", " m "],
    args_hint: "[model] [--provider name]",
  });
  assert.equal(c.name, "model", "name must be lowercased for matching");
  assert.equal(c.description, "Switch model", "description must be trimmed");
  assert.deepEqual(c.aliases, ["switch-model", "m"], "aliases lowercased + trimmed");
  assert.equal(c.args_hint, "[model] [--provider name]");
  assert.equal(c.cli_only, false);
  assert.equal(c.gateway_only, false);
});

test("defaults a missing category instead of rendering an empty badge", () => {
  assert.equal(normaliseCommand({ name: "x" }).category, "Other");
});

test("tolerates a missing/null alias list", () => {
  assert.deepEqual(normaliseCommand({ name: "x", aliases: null }).aliases, []);
});

test("rejects records with no usable name", () => {
  assert.equal(normaliseCommand({ name: "" }), null);
  assert.equal(normaliseCommand({ name: "   " }), null);
  assert.equal(normaliseCommand({}), null);
  assert.equal(normaliseCommand(null), null);
  assert.equal(normaliseCommand("nope"), null);
});

test("never throws on junk field types", () => {
  const c = normaliseCommand({
    name: "ok",
    description: { toString: () => "coerced" },
    aliases: [1, null, "x"],
    args_hint: 12,
  });
  assert.equal(c.name, "ok");
  assert.equal(c.description, "coerced");
  assert.deepEqual(c.aliases, ["1", "x"], "non-strings coerced, blanks dropped");
  assert.equal(c.args_hint, "12");
});