// Dump the full chat header layout: every child rect + the open-nav button rect.
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
await new Promise((r) => server.listen(3172, "127.0.0.1", r));
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
await page.goto("http://127.0.0.1:3172/");
await page.waitForSelector(".app-shell", { timeout: 10000 });
await page.waitForTimeout(600);
const dump = await page.evaluate(() => {
  const out = { vw: innerWidth, headers: [] };
  document.querySelectorAll("header").forEach((h) => {
    const kids = [...h.querySelectorAll(":scope > *, :scope > span > *")].slice(0, 12).map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, aria: el.getAttribute("aria-label"), txt: (el.textContent || "").slice(0, 14), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    out.headers.push({ cls: h.className.slice(0, 50), kids });
  });
  const navBtns = [...document.querySelectorAll('button[aria-label="Open navigation"]')].map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: cs.display, rects: el.getClientRects().length, parentHidden: el.closest('[class*="hidden"]')?.className.slice(0, 40) || null };
  });
  out.navBtns = navBtns;
  return out;
});
console.log(JSON.stringify(dump, null, 1));
await b.close(); server.close();
