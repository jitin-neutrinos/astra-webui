// Browser proof for L1 (2026-10-05): an `astra-canvas` fence must NEVER paint
// as a code block, for any body, in any streaming state.
//
// Runs the REAL production pipeline in a REAL Chromium page. DOMPurify is inert
// under bare node (no DOM), so this is the only place the guarantee can honestly
// be verified — which is also what the owner asked for.
//
// Bundled with Vite (this repo uses rolldown, there is no standalone esbuild).
//
// Run: npx tsx scripts/canvas-raw-code.browser.mts
import { chromium } from "playwright";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORK = mkdtempSync(join(tmpdir(), "cv-raw-"));
const PROBE = "src/lib/probe-canvas-raw-code.probe";

// 1. Build the probe as its own tiny vite app, OUT of the repo's dist/.
mkdirSync(WORK, { recursive: true });
const { build } = await import("vite");
await build({
  root: WORK,
  logLevel: "error",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: { alias: { "@": join(ROOT, "src") } },
  build: {
    outDir: join(WORK, "dist"),
    emptyOutDir: true,
    lib: { entry: join(ROOT, PROBE + ".ts"), formats: ["iife"], name: "Probe", fileName: () => "probe.js" },
  },
});

// vite lib-mode needs a cssFileName when CSS lands in the bundle
const cfgPath = join(WORK, "vite.config.mjs");
writeFileSync(cfgPath, "export default { build: { lib: { cssFileName: 'probe' } } };");

// 2. Page that loads the bundle from disk.
const dist = join(WORK, "dist");
const jsName = (await import("node:fs")).readdirSync(dist).find((f: string) => f.endsWith(".js"))!;
writeFileSync(
  join(dist, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"></head><body><script src="./${jsName}"></script></body></html>`,
);

// 3. Run it.
const browser = await chromium.launch();
const page = await browser.newPage();
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 240)));
await page.goto("file://" + join(dist, "index.html"));
await page.waitForFunction(() => (window as any).__done === true, null, { timeout: 30_000 });

const results = (await page.evaluate(() => (window as any).__results)) as {
  name: string; ok: boolean; detail: string;
}[];

let fails = 0;
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(34)} ${r.detail}`);
  if (!r.ok) fails++;
}
if (errs.length) console.log("\npage errors:", errs.slice(0, 3));
await browser.close();
console.log(fails ? `\n${fails} FAILURE(S)` : `\nALL ${results.length} BROWSER ASSERTIONS PASS`);
process.exit(fails ? 1 : 0);