import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { useOriginsStore, getDeviceBadge } from "./origins.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("message.origin event -> store update", () => {
  const store = useOriginsStore.getState();
  
  store.ingestEvent({ stored_sid: "s1", row_id: 10, device: "cli" });
  assert.equal(useOriginsStore.getState().getOrigin("s1", 10), "cli");
});

test("device -> label mapping", () => {
  assert.equal(getDeviceBadge("telegram").label, "Telegram");
  assert.equal(getDeviceBadge("cli").label, "Terminal");
  assert.equal(getDeviceBadge("android-phone").label, "Android");
  assert.equal(getDeviceBadge("unknown").label, "Web");
});

test("badge uses theme tokens not hardcoded colors", () => {
  const code = readFileSync(resolve(__dirname, "../components/SurfaceStrip.tsx"), "utf8");
  // Theme compliance = colors come from the token system, by class (bg-accent,
  // text-muted — the repo's Tailwind theme roles) or by var(). No hex, no
  // phantom shadcn names the repo never defines.
  const usesTokenClasses = /(?:bg|text|border)-(?:accent|muted|void|midnight|depth|surface|brandtext)\b/.test(code);
  const usesTokenVars = /var\(--color-/.test(code);
  assert.ok(usesTokenClasses || usesTokenVars, "no theme tokens found");
  assert.doesNotMatch(code, /#([0-9a-fA-F]{3}){1,2}\b/);
  for (const phantom of ["muted-foreground", "color-border-subtle", "color-glass-fill", "color-accent-subtle", "color-accent-border"]) {
    assert.ok(!code.includes(phantom), `phantom token in use: ${phantom}`);
  }
});
