// Perf item 1 (2026-10-05) — the canvas render path must not re-parse prose
// that did not change.
//
// Before: the md part called renderRichHtml INLINE in the render body, so every
// prose chunk around every visible card was re-parsed and re-sanitised on every
// streaming delta. Measured then, on a 78 KB answer with a 29 KB card: 4.62
// ms/render versus 2.37 ms on the no-canvas fast path — and that was `marked`
// alone, before DOMPurify ran over the same HTML.
//
// After: MdPart is memo'd on its own source. This browser harness counts actual
// calls to the parser per render, which is the thing that must drop.
//
// Run: npx tsx scripts/canvas-render-perf.browser.mts
import { chromium } from "playwright";
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORK = mkdtempSync(join(tmpdir(), "cv-perf-"));
mkdirSync(WORK, { recursive: true });

const { build } = await import("vite");
await build({
  root: WORK,
  logLevel: "error",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: join(WORK, "dist"),
    emptyOutDir: true,
    lib: {
      entry: join(ROOT, "src/lib/probe-canvas-perf.probe.ts"),
      formats: ["iife"],
      name: "Perf",
      fileName: () => "probe.js",
      cssFileName: "probe",
    },
  },
});

const dist = join(WORK, "dist");
const js = readdirSync(dist).find((f) => f.endsWith(".js"))!;
writeFileSync(join(dist, "index.html"), `<!doctype html><html><body><script src="./${js}"></script></body></html>`);

const browser = await chromium.launch();
const page = await browser.newPage();
const errs: string[] = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 200)));
await page.goto("file://" + join(dist, "index.html"));
await page.waitForFunction(() => (window as never as { __done: boolean }).__done === true, null, { timeout: 30_000 });

const r = (await page.evaluate(() => (window as never as { __out: unknown }).__out)) as {
  name: string; ok: boolean; detail: string;
}[];
let fails = 0;
for (const x of r) {
  console.log(`${x.ok ? "PASS" : "FAIL"}  ${x.name.padEnd(40)} ${x.detail}`);
  if (!x.ok) fails++;
}
if (errs.length) console.log("page errors:", errs.slice(0, 2));
await browser.close();
console.log(fails ? `\n${fails} FAILURE(S)` : `\nALL ${r.length} PERF ASSERTIONS PASS`);
process.exit(fails ? 1 : 0);