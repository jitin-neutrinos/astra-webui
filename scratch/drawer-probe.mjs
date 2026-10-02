// Probe: why doesn't the mobile drawer open? elementFromPoint at the button center.
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
await new Promise((r) => server.listen(3171, "127.0.0.1", r));
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
await page.goto("http://127.0.0.1:3171/");
await page.waitForSelector(".app-shell", { timeout: 10000 });
const probe = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button[aria-label="Open navigation"]')].find((el) => el.getClientRects().length);
  if (!btn) return { err: "no visible open-nav button" };
  const r = btn.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const at = document.elementFromPoint(cx, cy);
  const chain = [];
  let n = at;
  while (n && chain.length < 5) { chain.push(`${n.tagName}.${String(n.className).slice(0, 60)}`); n = n.parentElement; }
  const sb = document.getElementById("astra-sidebar");
  return {
    btnRect: { x: r.x, y: r.y, w: r.width, h: r.height },
    expanded: btn.getAttribute("aria-expanded"),
    hitIsButton: at === btn || btn.contains(at),
    hitChain: chain,
    sidebarCount: document.querySelectorAll("#astra-sidebar").length,
    sidebarX: sb?.getBoundingClientRect().x,
    sidebarZ: sb ? getComputedStyle(sb).zIndex : null,
  };
});
console.log(JSON.stringify(probe, null, 1));
// try a real click and re-read
await page.locator('button[aria-label="Open navigation"]:visible').first().click({ force: true });
await page.waitForTimeout(450);
const after = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button[aria-label="Open navigation"]')].find((el) => el.getClientRects().length);
  const sb = document.getElementById("astra-sidebar");
  return { expanded: btn?.getAttribute("aria-expanded"), sidebarX: sb?.getBoundingClientRect().x };
});
console.log("after click:", JSON.stringify(after));
await b.close(); server.close();
