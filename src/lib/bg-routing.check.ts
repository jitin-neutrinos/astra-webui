import { test } from "node:test";
import assert from "node:assert/strict";
import { showsInFeed } from "./bg-routing.ts";

// Owner mandate: /bg replies live in the dock, not the chat feed.
test("an ordinary chat turn always shows", () => {
  assert.equal(showsInFeed({ id: "m1" }, null), true);
  assert.equal(showsInFeed({ id: "m1" }, "m9"), true);
});

test("a bg reply is hidden from the feed", () => {
  assert.equal(showsInFeed({ id: "m2", bgId: 7 }, null), false);
});

test("a bg reply shows only while it is the jump target", () => {
  assert.equal(showsInFeed({ id: "m2", bgId: 7 }, "m2"), true);
  assert.equal(showsInFeed({ id: "m2", bgId: 7 }, "m3"), false);
});

test("the bg system-note receipt stays visible in the feed", () => {
  // it is the marker that the task exists / its state — never suppressed
  assert.equal(showsInFeed({ id: "n1", bgId: 7, isSysNote: true }, null), true);
  assert.equal(showsInFeed({ id: "n1", bgId: 7, isSysNote: true }, "other"), true);
});

test("bgId 0 is a real id, not 'absent'", () => {
  // a falsy-but-present id must still route to the dock
  assert.equal(showsInFeed({ id: "m4", bgId: 0 }, null), false);
});
