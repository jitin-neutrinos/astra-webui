// Curated command-surface routing checks.
// Run: npx tsx --test src/lib/command-exec.check.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { surfaceFor, SURFACE_COMMANDS } from "./command-exec";

test("every requested command has a surface", () => {
  // The nine the owner asked for, by name.
  for (const name of [
    "compact", "sessions", "usage", "skills",
    "tools", "plugins", "memory", "help", "status",
  ]) {
    assert.ok(SURFACE_COMMANDS[name], `/${name} must have a surface`);
  }
});

test("excluded commands have no surface", () => {
  // bg/steer keep their own live UI; the rest were explicitly removed.
  for (const name of ["bg", "steer", "approvals", "stop", "new", "reasoning", "model"]) {
    assert.equal(SURFACE_COMMANDS[name], undefined, `/${name} must NOT have a surface`);
  }
});

test("matches bare and argumented forms", () => {
  assert.equal(surfaceFor("/status")?.name, "status");
  assert.equal(surfaceFor("/skills")?.name, "skills");
  const withArg = surfaceFor("/skills list");
  assert.equal(withArg?.name, "skills");
  assert.equal(withArg?.arg, "list");
  assert.equal(withArg?.title, "Skills");
});

test("is case-insensitive on the command name", () => {
  assert.equal(surfaceFor("/STATUS")?.name, "status");
  assert.equal(surfaceFor("/  Usage  ")?.name, "usage");
});

test("multi-word args are preserved", () => {
  assert.equal(surfaceFor("/compact here 3")?.arg, "here 3");
});

test("non-slash and unknown commands are not hijacked", () => {
  assert.equal(surfaceFor("status"), null);
  assert.equal(surfaceFor("tell me about /status"), null);
  assert.equal(surfaceFor("/notacommand"), null);
  assert.equal(surfaceFor(""), null);
  assert.equal(surfaceFor("/"), null);
});