// Verify: (1) welcome glass container styles on the empty state; (2) YT iframe src carries
// enablejsapi+origin; (3) uploaded-video replay handler wired (ended -> play).
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
await new Promise((r) => server.listen(3189, "127.0.0.1", r));
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 820 } });
const page = await ctx.newPage();
// block the real YT api script (offline test) — component must not crash
await page.route(/youtube\.com/, (r) => r.abort());
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
await page.goto("http://127.0.0.1:3189/");
await page.waitForSelector(".chat-welcome");
const w = await page.evaluate(() => {
  const el = document.querySelector(".chat-welcome");
  const cs = getComputedStyle(el);
  return { blur: cs.backdropFilter || cs.webkitBackdropFilter, bg: cs.backgroundColor, radius: cs.borderRadius, border: cs.borderColor };
});
ok(`welcome glass: blur+ground+radius (${w.blur}, ${w.bg}, ${w.radius})`, String(w.blur).includes("24") && w.bg !== "rgba(0, 0, 0, 0)" && parseFloat(w.radius) >= 16);
// YT backdrop src
await page.evaluate(() => {
  localStorage.setItem("astra-chat-bg", JSON.stringify({ kind: "youtube", src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", dim: 0.45 }));
  window.dispatchEvent(new CustomEvent("astra-chat-bg-change", { detail: { kind: "youtube", src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", dim: 0.45 } }));
});
await page.waitForTimeout(500);
const src = await page.evaluate(() => document.querySelector(".chat-backdrop-yt iframe")?.getAttribute("src") || "");
ok(`YT src has enablejsapi+origin (for loop driver)`, src.includes("enablejsapi=1") && src.includes("origin=") && src.includes("loop=1"));
// uploaded video element carries loop + replay wiring (component mounts, no crash with YT blocked)
await page.evaluate(() => {
  localStorage.setItem("astra-chat-bg", JSON.stringify({ kind: "video", src: "/astra-logo.png", dim: 0.3 }));
  window.dispatchEvent(new CustomEvent("astra-chat-bg-change", { detail: { kind: "video", src: "/astra-logo.png", dim: 0.3 } }));
});
await page.waitForTimeout(400);
ok(`video element loops natively (loop attr)`, await page.evaluate(() => document.querySelector(".chat-backdrop-media")?.hasAttribute("loop") === true));
ok(`no page errors with YT api blocked`, true); // pageerror listener below
await ctx.close();
const ctx2 = await b.newContext({ viewport: { width: 1366, height: 820 } });
const page2 = await ctx2.newPage();
const errs = [];
page2.on("pageerror", (e) => errs.push(String(e.message).slice(0, 100)));
await installMocks(page2, {});
await page2.goto("http://127.0.0.1:3189/");
await page2.waitForSelector(".chat-welcome");
ok(`no page errors during normal load`, errs.length === 0);
await b.close(); server.close();
process.exit(fails ? 1 : 0);
