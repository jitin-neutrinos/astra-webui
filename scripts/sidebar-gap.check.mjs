// Sidebar nav spacing: group header must not touch the first nav row.
// Regression guard — if the items container loses flex+gap, the filled
// selected header/row merge into one blob (owner report 2026-10-05).
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const src = readFileSync("src/App.tsx", "utf8");
const m = /group\.items\.map/.exec(src);
assert.ok(m, "items loop found");
// The container just before the items loop must be a flex column with a gap
const idx = m.index;
const before = src.slice(Math.max(0, idx - 400), idx);
assert.match(before, /className=\{cn\("flex flex-col gap-1\.5 mt-1"/,
  "items container must carry flex flex-col gap-1.5 mt-1 (header/row spacing)");
console.log("# pass 1\n# fail 0");
