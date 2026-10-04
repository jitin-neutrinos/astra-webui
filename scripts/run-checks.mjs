#!/usr/bin/env node
// run-checks.mjs — one runner for every *.check.* file in the repo.
//
// Usage:
//   node scripts/run-checks.mjs              # all checks
//   node scripts/run-checks.mjs --filter lib # only paths matching "lib"
//   node scripts/run-checks.mjs --serial     # no concurrency (debugging)
//
// Why this exists: the repo's convention is assert-based checks that run under
// bare Node (no test framework). That works, but nothing ran them — a check
// could rot silently. This runner makes the convention executable and gives
// CI a single nonzero-exit gate.
//
// Notes:
//   • .ts/.tsx checks load through --import ./scripts/ts-resolve.mjs, which
//     teaches Node the extensionless-relative imports the app source uses.
//   • Checks that need a live server / credentials / a browser are reported
//     as SKIP, never as pass — see ENV_REQUIRED below.

import { spawn } from "node:child_process";
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

// Checks that need infrastructure this runner does not provision.
// A skip must never read as a pass.
const ENV_REQUIRED = [
  {
    file: "scripts/ops-pages.dom.check.mjs",
    needs: "live server on 127.0.0.1:3011 + ASTRA_WEBUI_PASSWORD + playwright browser",
  },
];

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".audit-evidence",
  "graphify-out", "android", "ios", "src-tauri", ".cache",
]);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    if (name.startsWith(".") && name !== ".") continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc);
    else if (/\.check\.(ts|tsx|mjs|js)$/.test(name)) acc.push(full);
  }
  return acc;
}

const argv = process.argv.slice(2);
const filter = argv.includes("--filter") ? argv[argv.indexOf("--filter") + 1] : null;
const serial = argv.includes("--serial");
const CONCURRENCY = serial ? 1 : Math.max(2, Math.min(8, (globalThis.navigator?.hardwareConcurrency || 4) - 1));

const skipMap = new Map(ENV_REQUIRED.map((e) => [e.file, e.needs]));

const all = walk(ROOT)
  .map((f) => relative(ROOT, f).split(sep).join("/"))
  .filter((f) => (filter ? f.includes(filter) : true))
  .sort();

function runOne(rel, slot) {
  return new Promise((resolve) => {
    // A `.mjs` check can still import a `.ts` module (the ported comindash
    // self-checks do exactly that), so the TS resolver goes on for any check
    // whose SOURCE mentions a .ts import — not only .ts/.tsx check files.
    const isTs = /check\.(ts|tsx)$/.test(rel) || /from ['"][^'"]+\.ts['"]/.test(readFileSync(join(ROOT, rel), "utf8"));
    const args = isTs
      ? ["--import", "./scripts/ts-resolve.mjs", rel]
      : [rel];
    // Per-worker-slot port offset (2026-10-03). Two checks spawn a real
    // server on a FIXED port: server/vault.check.mjs (:3911) and
    // server/transcode-route.check.mjs (:3917). The regression gate re-runs
    // those same checks with spawnSync WHILE the worker pool is still running
    // them, so the gate's child and the pool's child raced for one port —
    // EADDRINUSE, a health poll answered by the wrong process, and a phantom
    // "REGRESSED" in the gate that was actually a collision. Giving each
    // worker slot its own offset makes the port a function of the slot, so two
    // concurrent instances can never target the same one. The gate's spawnSync
    // children inherit this env, so the gate's re-runs get the gate's slot
    // offset automatically — no gate change needed.
    const env = { ...process.env, ASTRA_CHECK_PORT_OFFSET: String(slot) };
    const child = spawn(process.execPath, args, { cwd: ROOT, env });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      const last = out.trim().split("\n").filter(Boolean).pop() || "";
      resolve({ rel, code, last: last.slice(0, 160), ms: 0 });
    });
  });
}

const results = [];
const queue = all.filter((f) => !skipMap.has(f));
const skipped = all.filter((f) => skipMap.has(f));

async function worker(slot) {
  for (;;) {
    const rel = queue.shift();
    if (!rel) return;
    results.push(await runOne(rel, slot));
  }
}

const t0 = Date.now();
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, (_, i) => worker(i)),
);

const passed = results.filter((r) => r.code === 0);
const failed = results.filter((r) => r.code !== 0);
failed.sort((a, b) => a.rel.localeCompare(b.rel));

console.log("");
for (const r of failed) {
  console.log(`FAIL  ${r.rel}`);
  console.log(`      ${r.last}`);
}
for (const s of skipped) {
  console.log(`SKIP  ${s}  (needs ${skipMap.get(s)})`);
}
console.log("");
console.log(`checks: ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped  (${Date.now() - t0}ms)`);

if (failed.length) {
  console.log("");
  for (const r of failed) console.log(`  FAILED: ${r.rel}`);
  process.exit(1);
}
