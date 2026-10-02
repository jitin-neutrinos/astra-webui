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
await new Promise((r) => server.listen(3185, "127.0.0.1", r));
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const page = await (await b.newContext()).newPage();
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
await page.goto("http://127.0.0.1:3185/");
await page.waitForSelector(".app-shell");
console.log(await page.evaluate(() => {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  return JSON.stringify({
    c66: cs.getPropertyValue("--c-66").trim(),
    r66: cs.getPropertyValue("--r-66").trim(),
    c9: cs.getPropertyValue("--c-9").trim(),
    cyanx: cs.getPropertyValue("--color-cyanx").trim(),
  });
}));
await page.evaluate(() => { localStorage.setItem("astra-palette", "tokyo-night-dark"); location.reload(); });
await page.waitForSelector(".app-shell");
await page.waitForTimeout(400);
console.log(await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  return JSON.stringify({
    c66: cs.getPropertyValue("--c-66").trim(),
    c9: cs.getPropertyValue("--c-9").trim(),
    cyanx: cs.getPropertyValue("--color-cyanx").trim(),
    void: cs.getPropertyValue("--color-void").trim(),
  });
}));
await b.close(); server.close();
