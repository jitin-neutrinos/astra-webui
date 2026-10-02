// Toggle<->palette integration: pick tokyo-night-dark, flip sidebar toggle to light ->
// channel vars must switch to tokyo LIGHT variant immediately (no reload).
import { chromium } from "playwright";
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
await new Promise((r) => server.listen(3176, "127.0.0.1", r));
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 820 } });
const page = await ctx.newPage();
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
await page.goto("http://127.0.0.1:3176/");
await page.waitForSelector(".app-shell");
await page.evaluate(() => { localStorage.setItem("astra-palette", "tokyo-night-dark"); });
await page.reload({ waitUntil: "load" });
await page.waitForSelector(".app-shell");
const darkBg = await page.evaluate(() => getComputedStyle(document.querySelector(".app-shell")).backgroundColor);
ok(`tokyo dark void (${darkBg})`, darkBg === "rgb(26, 27, 38)");
// flip via the sidebar toggle (real button)
await page.locator('button[role="switch"][aria-label*="mode" i], button[aria-label*="Switch to light"]').first().click();
await page.waitForTimeout(300);
const lightBg = await page.evaluate(() => getComputedStyle(document.querySelector(".app-shell")).backgroundColor);
const lightVoidVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-void").trim());
ok(`after toggle -> tokyo LIGHT paper without reload (var=${lightVoidVar})`, lightVoidVar.toLowerCase() === "#ebf2f1" && lightBg === "rgb(235, 242, 241)");
// flip back
await page.locator('button[role="switch"][aria-label*="mode" i], button[aria-label*="Switch to dark"]').first().click();
await page.waitForTimeout(300);
const backVar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-void").trim());
ok(`flip back -> dark void again (${backVar})`, backVar.toLowerCase() === "#1a1b26");
await ctx.close(); await b.close(); server.close();
process.exit(fails ? 1 : 0);
