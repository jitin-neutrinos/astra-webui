import { modelSwitchValue } from "./model-switch.ts";

function assertEq(actual: string, expected: string) {
  if (actual !== expected) throw new Error(`Expected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
}

// The reported case. Model FIRST, provider after the flag — never the reverse.
assertEq(modelSwitchValue({ provider: "openrouter", model: "inkling:free" }),
         "inkling:free --provider openrouter --session");
assertEq(modelSwitchValue({ provider: "anthropic", model: "claude-opus-4-6" }),
         "claude-opus-4-6 --provider anthropic --session");

console.log("ok");
