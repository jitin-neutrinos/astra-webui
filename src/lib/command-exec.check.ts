// Curated command-surface routing checks.
// Run: npx tsx --test src/lib/command-exec.check.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { surfaceFor, splitSlash, SURFACE_COMMANDS, NOT_SURFACED } from "./command-exec";

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
  // bg/steer keep their own live UI; quit/exit end the session.
  for (const name of ["bg", "steer", "approvals", "stop", "new", "reasoning", "model"]) {
    assert.equal(SURFACE_COMMANDS[name], undefined, `/${name} must NOT have a surface`);
  }
});

test("bg/steer/quit/exit are never auto-surfaced", () => {
  for (const name of NOT_SURFACED) {
    assert.equal(SURFACE_COMMANDS[name], undefined, `/${name} must NOT be curated`);
    assert.equal(surfaceFor(`/${name} some text`, new Set([name])), null,
      `/${name} must fall through to its own path`);
  }
});

test("splitSlash pulls name and args off a typed message", () => {
  assert.deepEqual(splitSlash("/context"), { name: "context", arg: "" });
  assert.deepEqual(splitSlash("/context all"), { name: "context", arg: "all" });
  assert.deepEqual(splitSlash("/123abc"), null, "a name must start with a letter");
  // A slash token with an argument is a command WITH args, not a rejection —
  // whether "has" exists is the registry's call to make, not the parser's.
  assert.deepEqual(splitSlash("/has space"), { name: "has", arg: "space" });
});

test("ANY registry command surfaces, not just the curated nine", () => {
  // This is the fix for "/context landed in chat as text": the curated table is
  // presentation only, so a command nobody special-cased still executes.
  const known = new Set(["context", "yolo", "moa", "version", "title"]);
  for (const name of known) {
    assert.equal(surfaceFor(`/${name}`, known)?.name, name, `/${name} must surface`);
  }
  const ctx = surfaceFor("/context all", known);
  assert.equal(ctx?.name, "context");
  assert.equal(ctx?.arg, "all");
  assert.equal(ctx?.title, "/context", "uncategorised commands render as /name");
});

test("a name the registry does not vouch for falls through to the agent", () => {
  const known = new Set(["context"]);
  assert.equal(surfaceFor("/notarealcommand", known), null);
  assert.equal(surfaceFor("/notarealcommand", null), null);
  assert.equal(surfaceFor("/notarealcommand"), null);
});

test("curated commands work even before the registry has loaded", () => {
  // Prefetch is async; the nine must not depend on it.
  assert.equal(surfaceFor("/status", null)?.name, "status");
  assert.equal(surfaceFor("/help")?.name, "help");
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