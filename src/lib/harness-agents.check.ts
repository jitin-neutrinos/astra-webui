// harness-agents checks (repo assert pattern). Run: npx tsx src/lib/harness-agents.check.ts
import { detectHarness, mergeRoster } from "./harness-agents";

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
}

// Real invocation shapes from the fleet skills — must match.
ok(detectHarness("claude -p 'fix the bug' --max-turns 5")?.name === "claude", "claude -p must match");
ok(detectHarness("opencode run --auto 'read spec and do it'")?.name === "opencode", "opencode run must match");
ok(detectHarness("agy -p 'build the feature' --print-timeout 300")?.name === "agy", "agy -p must match");
ok(detectHarness("bash -lc 'claude -p \"task\" > out.log'")?.name === "claude", "wrapped claude must match");
ok(detectHarness("/usr/local/bin/opencode run task")?.name === "opencode", "abs-path binary must match");
ok(detectHarness("claude")?.name === "claude", "bare claude must match");
ok(detectHarness("timeout 600 agy -p build")?.name === "agy", "timeout-wrapped agy must match");

// Non-agent commands — must NOT match.
ok(detectHarness("echo claude is great") === null, "echo must not match");
ok(detectHarness("grep -r agy src/") === null, "grep must not match");
ok(detectHarness("cat notes-claude.txt") === null, "cat must not match");
ok(detectHarness("claude-desktop-unofficial --flag") === null, "claude-desktop binary must not match");
ok(detectHarness("ls -la") === null, "ls must not match");
ok(detectHarness("") === null, "empty must not match");
ok(detectHarness(null) === null, "null must not match");
ok(detectHarness("npm install") === null, "npm must not match");

// Merge: gateway wins on id collision, harness rows kept otherwise.
const merged = mergeRoster(
  [{ subagent_id: "harness-t1", model: "gateway-truth" }],
  [{ subagent_id: "harness-t1", model: "claude", status: "running" } as any,
   { subagent_id: "harness-t2", model: "agy", status: "running" } as any],
);
ok(merged.length === 2, "dedupe by id");
ok(merged.find((r) => r.subagent_id === "harness-t1")?.model === "gateway-truth", "gateway wins collision");
ok(!!merged.find((r) => r.subagent_id === "harness-t2"), "harness-only row kept");

if (failures) throw new Error(`${failures} harness-agents check(s) failed`);
console.log("PASS: harness-agents checks");
