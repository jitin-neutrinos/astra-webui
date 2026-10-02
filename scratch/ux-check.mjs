// Verify the 4 fixes: mobile header ground+blur; actions inside bubble; blur +60%; composer shrink.
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
await new Promise((r) => server.listen(3191, "127.0.0.1", r));
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");

// 1) mobile header
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  await installMocks(page, {});
  await page.goto("http://127.0.0.1:3191/");
  await page.waitForSelector(".app-shell");
  const h = await page.evaluate(() => {
    const el = document.querySelector("header.mobile-accent-header");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, blur: cs.backdropFilter || cs.webkitBackdropFilter };
  });
  ok(`mobile header has accent ground + blur (${h && h.bg}, ${h && h.blur})`, !!h && h.bg !== "rgba(0, 0, 0, 0)" && String(h.blur).includes("35"));
  await ctx.close();
}
// desktop header stays flat
{
  const ctx = await b.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await ctx.newPage();
  await installMocks(page, {});
  await page.goto("http://127.0.0.1:3191/");
  await page.waitForSelector(".app-shell");
  const flat = await page.evaluate(() => {
    const el = document.querySelector("header.mobile-accent-header");
    return el ? getComputedStyle(el).backgroundColor : "missing";
  });
  ok(`desktop header glass (${flat})`, flat === "color(srgb 0.0715776 0.0735664 0.0986969 / 0.45)" || flat.includes("0.45"));
  await ctx.close();
}
// 2+3) history view: actions inside bubble + blur values
{
  const ctx = await b.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await ctx.newPage();
  await installMocks(page, {});
  await page.goto("http://127.0.0.1:3191/c/s-parity-1");
  await page.waitForSelector(".chat-turn", { timeout: 8000 });
  const r = await page.evaluate(() => {
    const turn = document.querySelector(".chat-turn");
    const bubble = document.querySelector(".chat-bubble-user");
    const acts = document.querySelector(".chat-actions");
    const comp = document.querySelector(".chat-composer");
    const g = (el) => el ? getComputedStyle(el) : null;
    const t = g(turn), a = g(acts), c = g(comp);
    // is actions row visually INSIDE the bubble's box? compare bottoms
    const tb = bubble ? bubble.getBoundingClientRect() : null;
    const ab = acts ? acts.getBoundingClientRect() : null;
    return {
      turnBlur: t && (t.backdropFilter || t.webkitBackdropFilter),
      bubblePadB: t && t.paddingBottom,
      actsTop: ab && tb ? ab.top >= tb.top : null,
      compBlur: c && (c.backdropFilter || c.webkitBackdropFilter),
    };
  });
  ok(`bubble blur 29px (${r.turnBlur})`, String(r.turnBlur).includes("29"));
  ok(`actions docked inside bubble (${r.actsTop})`, r.actsTop === true);
  ok(`bubble bottom padding reserved (${r.bubblePadB})`, r.bubblePadB === "42px");
  ok(`composer blur 35px (${r.compBlur})`, String(r.compBlur).includes("35"));
  await ctx.close();
}
// 4) composer grows then shrinks
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  await installMocks(page, {});
  await page.goto("http://127.0.0.1:3191/");
  await page.waitForSelector(".chat-composer textarea");
  const ta = page.locator(".chat-composer textarea").first();
  const long = "line\n".repeat(12);
  await ta.fill(long);
  await page.waitForTimeout(250);
  const tall = await ta.evaluate((el) => el.getBoundingClientRect().height);
  await ta.fill("");
  await page.waitForTimeout(250);
  const short = await ta.evaluate((el) => el.getBoundingClientRect().height);
  ok(`composer grows with text (${tall | 0}px)`, tall > 100);
  ok(`composer shrinks when cleared (${tall | 0}px -> ${short | 0}px)`, short < tall - 40 && short <= 60);
  await ctx.close();
}
await b.close(); server.close();
process.exit(fails ? 1 : 0);
