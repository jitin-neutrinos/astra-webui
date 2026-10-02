// verify: welcome glass (std blur), theme-color meta follows palette+mode, loop wiring intact
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
await new Promise((r) => server.listen(3188, "127.0.0.1", r));
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 820 } });
const page = await ctx.newPage();
await page.route(/youtube\.com|youtube\.nocookie/, (r) => r.abort());
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
await page.goto("http://127.0.0.1:3188/");
await page.waitForSelector(".chat-welcome");
const w = await page.evaluate(() => {
  const cs = getComputedStyle(document.querySelector(".chat-welcome"));
  return { blur: cs.backdropFilter || cs.webkitBackdropFilter, bg: cs.backgroundColor, radius: cs.borderRadius };
});
ok(`welcome glass (blur=${w.blur}, bg=${w.bg}, r=${w.radius})`, String(w.blur).includes("24") && w.bg !== "rgba(0, 0, 0, 0)" && parseFloat(w.radius) >= 16);
const meta0 = await page.evaluate(() => document.querySelector('meta[name="theme-color"]:not([media])')?.getAttribute("content"));
ok(`default theme-color = astra void (${meta0})`, meta0?.toLowerCase() === "#0a0a0f");
// switch palette to tokyo-night-dark -> meta should become #1a1b26
await page.evaluate(() => { localStorage.setItem("astra-palette", "tokyo-night-dark"); });
await page.reload({ waitUntil: "load" });
await page.waitForSelector(".app-shell");
const meta1 = await page.evaluate(() => document.querySelector('meta[name="theme-color"]:not([media])')?.getAttribute("content"));
ok(`palette switch -> meta follows (${meta1})`, meta1?.toLowerCase() === "#1a1b26");
// light mode flip -> meta light void of tokyo palette
await page.evaluate(() => {
  document.documentElement.setAttribute("data-theme", "light");
  localStorage.setItem("astra-theme", "light");
  window.dispatchEvent(new CustomEvent("astra-theme-change", { detail: "light" }));
});
await page.waitForTimeout(200);
const meta2 = await page.evaluate(() => document.querySelector('meta[name="theme-color"]:not([media])')?.getAttribute("content"));
ok(`light mode -> meta follows palette light void (${meta2})`, !!meta2 && meta2.toLowerCase() !== "#1a1b26");
await page.evaluate(() => localStorage.removeItem("astra-palette"));
await ctx.close();
// loop wiring still present
const ctx2 = await b.newContext({ viewport: { width: 1366, height: 820 } });
const page2 = await ctx2.newPage();
await page2.route(/youtube\.com/, (r) => r.abort());
await installMocks(page2, {});
await page2.goto("http://127.0.0.1:3188/");
await page2.waitForSelector(".chat-composer");
await page2.evaluate(() => {
  localStorage.setItem("astra-chat-bg", JSON.stringify({ kind: "youtube", src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", dim: 0.4 }));
  window.dispatchEvent(new CustomEvent("astra-chat-bg-change", { detail: { kind: "youtube", src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", dim: 0.4 } }));
});
await page2.waitForTimeout(400);
const src = await page2.evaluate(() => document.querySelector(".chat-backdrop-yt iframe")?.getAttribute("src") || "");
ok(`YT src: enablejsapi + loop + playlist (loop driver)`, src.includes("enablejsapi=1") && src.includes("loop=1") && src.includes("playlist="));
await b.close(); server.close();
process.exit(fails ? 1 : 0);
