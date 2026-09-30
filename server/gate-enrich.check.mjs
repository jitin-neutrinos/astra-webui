import assert from "node:assert";
import { enrichGate, SEVERITY_ORDER } from "./gate-enrich.mjs";

console.log("Running gate-enrich checks...");

assert.strictEqual(SEVERITY_ORDER.low, 0);
assert.strictEqual(SEVERITY_ORDER.critical, 3);

// Critical
let res = enrichGate({ command: "rm -rf ~/x" });
assert.strictEqual(res.severity, "critical");
assert.ok(res.risk.includes("Irreversible"));
assert.ok(res.whatItDoes.includes("Deletes"));

res = enrichGate({ command: "mkfs.ext4 /dev/sda1" });
assert.strictEqual(res.severity, "critical");

// High
res = enrichGate({ command: "dnf install nodejs" });
assert.strictEqual(res.severity, "high");
assert.strictEqual(res.impact, "Package or system state changed");

// Moderate
res = enrichGate({ command: "git commit -m 'wip'" });
assert.strictEqual(res.severity, "moderate");

// Unknown -> Moderate
res = enrichGate({ command: "some-weird-tool --flag" });
assert.strictEqual(res.severity, "moderate");
assert.ok(res.risk.includes("Unrecognized"));

// Low
res = enrichGate({ command: "ls -la" });
assert.strictEqual(res.severity, "low");
assert.strictEqual(res.impact, "Read-only lookup — nothing changed");

res = enrichGate({ command: "cat /etc/os-release" });
assert.strictEqual(res.severity, "low");

// Fallback whatItDoes
res = enrichGate({ command: "some-weird-tool", description: "Does a thing" });
assert.strictEqual(res.whatItDoes, "Does a thing");

res = enrichGate({ command: "some-weird-tool" });
assert.ok(res.whatItDoes.includes("Executes `some-weird-tool`"));

res = enrichGate({ }, "clarify");
assert.strictEqual(res.whatItDoes, "Astra has a question");
assert.strictEqual(res.severity, "low");

console.log("gate-enrich checks passed.");
