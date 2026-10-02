// Mobile viewport: trace band count (18 on low-spec via touch), tail opacity falloff smoothness,
// header ground, composer autosize, and bars-base (shell theme reads palette void — native only,
// assert the CSS var it reads exists).
import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  let f = join(resolve("dist"), p === "/" ? "index.html" : p);
  try { const b = await readFile(f); res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" }); res.end(b); }
  catch { readFile(join(resolve("dist"), "index.html")).then((b) => { res.writeHead(200, { "content-type": "text/html" }); res.end(b); }).catch(() => res.writeHead(404).end()); }
});
await new Promise((r) => server.listen(3173, "127.0.0.1", r));
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const iphone = devices["Pixel 7"];
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ ...iphone });
const page = await ctx.newPage();
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
await page.goto("http://127.0.0.1:3173/");
await page.waitForSelector(".app-shell");
// low-spec class applied?
const lowspec = await page.evaluate(() => document.querySelector(".app-shell")?.classList.contains("astra-lowspec"));
ok(`mobile flagged low-spec (lowspec=${lowspec})`, lowspec === true);
// trace bands rendered
await page.fill("textarea", "hello");
await page.waitForTimeout(300);
const bands = await page.locator(".composer-trace-step").count();
ok(`trace bands on mobile = ${bands} (finer, >= 16)`, bands >= 16 && bands < 32);
// tail smoothness: opacity deltas between consecutive bands should be small (no steps)
const ops = await page.evaluate(() => [...document.querySelectorAll(".composer-trace-step")].map((el) => Number(getComputedStyle(el).opacity)));
let maxStep = 0;
for (let i = 1; i < ops.length; i++) maxStep = Math.max(maxStep, ops[i] - ops[i - 1]);
ok(`tail opacity max step ${maxStep.toFixed(3)} (smooth, < 0.09)`, maxStep < 0.09);
// round caps
const cap = await page.evaluate(() => getComputedStyle(document.querySelector(".composer-trace-step")).strokeLinecap);
ok(`stroke linecap butt (0a428f6: round renders stray dash-origin dot) (${cap})`, cap === "butt");
// bars: --color-void var present for shell-theme to read (palette-driven)
const voidVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-void").trim());
ok(`--color-void present for native bars (${voidVar})`, voidVar.length > 0);
// user bubble green tint visible
await page.evaluate(() => {
  localStorage.setItem("astra-chat-bg", "");
});
const ub = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bubble-user-bg").trim());
ok(`user bubble tint accent-derived (${ub.slice(0, 40)})`, ub.includes("color-mix"));
await ctx.close(); await b.close(); server.close();
process.exit(fails ? 1 : 0);
