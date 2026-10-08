import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE = readFileSync(resolve(__dirname, "ws-engine.ts"), "utf8");

test("every prompt.submit call site in ws-engine.ts carries surface:", () => {
  const code = ENGINE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // find all rpc("prompt.submit", { ... })
  let match;
  let count = 0;
  const regex = /rpc\(["']prompt\.submit["'],\s*\{([^}]*)\}/gs;
  while ((match = regex.exec(code)) !== null) {
    count++;
    assert.match(match[1], /surface:\s*APP_SOURCE/, "prompt.submit must carry surface: APP_SOURCE");
  }
  assert.ok(count > 0, "must find at least one prompt.submit");
});
