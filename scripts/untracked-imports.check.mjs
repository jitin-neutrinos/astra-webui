// Fresh-clone build guard (2026-10-05).
//
// A clean `git clone` of this repo could NOT build, twice, and nothing caught
// it:
//
//   1. 2026-10-03, commit bd04fe6 — App.tsx imported context-page, memory-page,
//      harness-page and ui/chart.tsx; the files were never staged.
//   2. 2026-10-05, commit 2f60290 — chat-timeline.tsx imported
//      ../lib/canvas-sanitize and canvas-view.tsx imported ./canvas-export;
//      again untracked. A clean clone failed `tsc` with TS2307.
//
// The pattern is a tracked file importing a module that exists only in the
// working tree. Neither the build nor any check catches it, because the build
// runs in the primary checkout where the untracked file is present. Only a
// clone is honest.
//
// This check reproduces the condition locally, with no clone: resolve every
// relative import made by a TRACKED src file and fail if any target is neither
// tracked nor a resolvable extension of a tracked file.
//
// Run: node scripts/untracked-imports.check.mjs
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

const tracked = new Set(
  execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 })
    .split("\n")
    .filter(Boolean),
);

const SRC_EXT = [".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"];
const files = [...tracked].filter((f) => f.startsWith("src/") && SRC_EXT.some((e) => f.endsWith(e)));

// `from "x"`, `import "x"`, `require("x")` — relative specifiers only.
const SPEC = /(?:from|import)\s*["'](\.[^"']+)["']|require\(\s*["'](\.[^"']+)["']\s*\)/g;

const offenders = [];
for (const rel of files) {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) continue; // deleted-but-staged; not our concern here
  const src = readFileSync(abs, "utf8");
  for (const m of src.matchAll(SPEC)) {
    const spec = m[1] || m[2];
    const base = resolve(dirname(abs), spec);
    // A tracked target, either as-is or via an extension / index file.
    const candidates = [base, ...SRC_EXT.map((e) => base + e), ...SRC_EXT.map((e) => resolve(base, "index" + e))];
    const hit = candidates.find((c) => {
      if (!existsSync(c)) return false;
      if (!statSync(c).isFile()) return false;
      return tracked.has(c.slice(ROOT.length + 1));
    });
    if (!hit) {
      offenders.push({
        importer: rel,
        spec,
        // Distinguish "missing entirely" from "exists but untracked" — the
        // second is the exact shape that makes a clean clone fail.
        onDisk: candidates.some((c) => existsSync(c) && statSync(c).isFile()),
      });
    }
  }
}

if (offenders.length) {
  const lines = offenders.map(
    (o) => `  ${o.importer} -> "${o.spec}"${o.onDisk ? "   (file EXISTS but is NOT tracked)" : "   (no file on disk)"}`,
  );
  console.error(
    `${offenders.length} tracked file(s) import a module that is not in the index:\n${lines.join("\n")}\n\n` +
      `A fresh clone cannot build. Fix: git add the file(s) above, then re-run.\n` +
      `History: bd04fe6 (2026-10-03) and 2f60290 (2026-10-05) both shipped this.`,
  );
  process.exit(1);
}

console.log(`untracked-imports: ${files.length} tracked src file(s) checked, 0 untracked imports.`);