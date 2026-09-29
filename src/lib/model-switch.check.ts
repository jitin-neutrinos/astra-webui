import { modelSwitchValue } from "./model-switch.ts";

function assertEq(actual: string, expected: string) {
  if (actual !== expected) throw new Error(`Expected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
}

// The reported case. Model FIRST, provider after the flag — never the reverse.
assertEq(modelSwitchValue({ provider: "openrouter", model: "inkling:free" }),
         "inkling:free --provider openrouter --session");
assertEq(modelSwitchValue({ provider: "anthropic", model: "claude-opus-4-6" }),
         "claude-opus-4-6 --provider anthropic --session");

// Explicit effort rides the switch (gateway re-resolves reasoning on a model change).
assertEq(modelSwitchValue({ provider: "zai", model: "glm-5.3", effort: "low" }),
         "glm-5.3 --provider zai --session --reasoning low");

import { mergeSessionInfo } from "./ws-helpers.ts";
const full = { model: "m", provider: "p", yolo: true, reasoning_effort: "low" };
// cwd-only event inside the same session keeps model/yolo/effort
const m1 = mergeSessionInfo(full, "s1", "s1", { cwd: "/x" });
if (m1.model !== "m" || m1.yolo !== true || m1.cwd !== "/x") throw new Error("same-session merge lost keys");
// new session never inherits the old session's keys
const m2 = mergeSessionInfo(full, "s1", "s2", { model: "n", lazy: true });
if ("yolo" in m2 || m2.model !== "n") throw new Error("cross-session leak");
if (mergeSessionInfo(full, "s1", "s1", null) !== full) throw new Error("null incoming must be a no-op");
// optimistic pre-session pick beats the lazy create info, but fills the gaps from it
const m3 = mergeSessionInfo({ model: "picked", yolo: true }, null, "s1", { model: "default", cwd: "/x", lazy: true });
if (m3.model !== "picked" || m3.yolo !== true || m3.cwd !== "/x") throw new Error("pre-session pick lost");

console.log("ok");
