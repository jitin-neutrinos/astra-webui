// Sidebar visibility on desktop: aside exists, is visible, has width, sits left of main.
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
await new Promise((r) => server.listen(3171, "127.0.0.1", r));
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 820 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGE-ERR:", String(e.message).slice(0, 150)));
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
await page.goto("http://127.0.0.1:3171/");
await page.waitForSelector(".app-shell");
await page.evaluate(() => {
  localStorage.setItem("astra-chat-bg", JSON.stringify({ kind: "image", src: "/astra-logo.png", dim: 0.3 }));
  window.dispatchEvent(new CustomEvent("astra-chat-bg-change", { detail: { kind: "image", src: "/astra-logo.png", dim: 0.3 } }));
});
await page.waitForTimeout(400);
console.log(await page.evaluate(() => {
  const asides = [...document.querySelectorAll("aside")];
  return JSON.stringify(asides.map((a) => {
    const r = a.getBoundingClientRect();
    const cs = getComputedStyle(a);
    const hit = document.elementFromPoint(r.x + r.width / 2, Math.min(r.y + r.height / 2, window.innerHeight - 1));
    const inChain = (() => { let n = hit; while (n) { if (n === a) return true; n = n.parentElement; } return false; })();
    return { cls: a.className.slice(0, 60), w: r.width, h: r.height, x: r.x, display: cs.display, transform: cs.transform.slice(0, 40), visible: r.width > 0 && r.height > 0 && cs.display !== "none", hitTag: hit ? hit.tagName + "." + String(hit.className).slice(0, 30) : "none", inChain };
  }));
}));
await b.close(); server.close();
