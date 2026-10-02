// YT: iframe replaced by API player (no src). Reload page -> player mounts via API, muted
// autoplay; assert no <iframe src=youtube> with visible chrome potential + player exists.
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
await new Promise((r) => server.listen(3175, "127.0.0.1", r));
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 820 } });
const page = await ctx.newPage();
// let youtube scripts LOAD (need the API) but block the heavy player swf? keep it simple: allow.
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
// unroute youtube for this test? fixtures only aborts googleapis fonts. fine.
await page.goto("http://127.0.0.1:3175/");
await page.waitForSelector(".app-shell");
await page.evaluate(() => {
  localStorage.setItem("astra-chat-bg", JSON.stringify({ kind: "youtube", src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", dim: 0.45 }));
  window.dispatchEvent(new CustomEvent("astra-chat-bg-change", { detail: { kind: "youtube", src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", dim: 0.45 } }));
});
await page.waitForTimeout(400);
// RELOAD (owner's scenario: controls visible on reload)
await page.reload({ waitUntil: "load" });
await page.waitForSelector(".chat-backdrop-yt", { timeout: 8000 });
// wait for the API to replace the mount div with an iframe
let apiIframe = false;
try {
  await page.waitForSelector(".chat-backdrop-yt iframe", { timeout: 10000 });
  apiIframe = await page.evaluate(() => {
    const f = document.querySelector(".chat-backdrop-yt iframe");
    return f && !(f.getAttribute("src") || "").includes("embed/");
  });
} catch { apiIframe = false; }
console.log("yt dom:", await page.evaluate(() => document.querySelector(".chat-backdrop-yt")?.innerHTML.slice(0, 300)));
console.log("YT global:", await page.evaluate(() => typeof window.YT !== "undefined" && !!window.YT?.Player));
const src = await page.evaluate(() => document.querySelector(".chat-backdrop-yt iframe")?.getAttribute("src") || "");
ok(`API player mounted with chrome-free params (controls=0, iv=3, autoplay=1, mute=1)`, src.includes("controls=0") && src.includes("iv_load_policy=3") && src.includes("autoplay=1") && src.includes("mute=1"));
await ctx.close(); await b.close(); server.close();
process.exit(fails ? 1 : 0);
