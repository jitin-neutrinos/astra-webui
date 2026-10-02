import { test } from "node:test";
import assert from "node:assert/strict";
import { _test, lastResponseFrom } from "./last-reply.mjs";

const { responseText } = _test;

test("picks the NEWEST assistant response, not the first", () => {
  const rows = [
    { role: "user", content: "first ask" },
    { role: "assistant", content: "first answer" },
    { role: "user", content: "second ask" },
    { role: "assistant", content: "LATEST answer" },
  ];
  assert.equal(lastResponseFrom(rows), "LATEST answer");
});

test("skips tool calls, thinking and scaffolding rows", () => {
  assert.equal(responseText({ role: "assistant", content: "[tool_call] terminal ran ls" }), "");
  assert.equal(responseText({ role: "assistant", content: "[Surface: replayed from telegram]" }), "");
  assert.equal(responseText({ role: "assistant", content: "   " }), "");
  assert.equal(responseText({ role: "user", content: "a user message" }), "");
});

test("falls through a tool-only newest row to the real response beneath it", () => {
  const rows = [
    { role: "assistant", content: "the real reply" },
    { role: "user", content: "next ask" },
    { role: "assistant", content: "[tool_result] ok" },
  ];
  assert.equal(lastResponseFrom(rows), "the real reply");
});

test("a user message after the last response does not become the preview", () => {
  // host pages back from the newest; the trailing user turn is the newest row
  const rows = [
    { role: "assistant", content: "my answer" },
    { role: "user", content: "my next question" },
  ];
  assert.equal(lastResponseFrom(rows), "my answer");
});

test("accepts text/display_content shapes and trims + caps length", () => {
  assert.equal(lastResponseFrom([{ role: "assistant", text: "via text field" }]), "via text field");
  assert.equal(lastResponseFrom([{ role: "assistant", display_content: "via display" }]), "via display");
  const long = "x".repeat(400);
  const out = lastResponseFrom([{ role: "assistant", content: long }]);
  assert.equal(out.length, 220);
  assert.ok(out.endsWith("…"));
});

test("empty / malformed input yields empty string (never throws)", () => {
  assert.equal(lastResponseFrom([]), "");
  assert.equal(lastResponseFrom(null), "");
  assert.equal(lastResponseFrom(undefined), "");
  assert.equal(lastResponseFrom([null, {}, { role: "assistant" }]), "");
});
