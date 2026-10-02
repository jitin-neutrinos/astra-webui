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
await new Promise((r) => server.listen(3181, "127.0.0.1", r));
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
await page.goto("http://127.0.0.1:3181/config");
await page.waitForSelector(".tf-panel");
const sections = await page.locator(".tf-section").count();
ok(`two sections (dark + light): ${sections}`, sections === 2);
const titles = await page.locator(".tf-section-title").allTextContents();
ok(`section titles (${titles.join(" / ")})`, titles[0]?.includes("Dark") && titles[1]?.includes("Light"));
const cards = await page.locator(".tf-card").count();
ok(`cards in both sections (${cards} = 2x themes)`, cards === (await page.locator(".tf-grid").first().locator(".tf-card").count()) * 2);
// toggle morph: sun/moon svg present with mask + rays
await page.goto("http://127.0.0.1:3181/");
await page.waitForSelector(".app-shell");
const glyph = await page.evaluate(() => ({
  morph: !!document.querySelector(".tt-morph"),
  mask: !!document.querySelector(".tt-morph-mask"),
  rays: !!document.querySelector(".tt-morph-rays"),
  lottie: !!document.querySelector("lottie-player, .lottie"),
}));
ok(`morph toggle wired (no lottie)`, glyph.morph && glyph.mask && glyph.rays && !glyph.lottie);
// astra-ui violetx is green now
const violet = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-violetx").trim());
ok(`astra violetx is brand green (${violet})`, violet.toLowerCase() === "#34d399");
await b.close(); server.close();
process.exit(fails ? 1 : 0);
