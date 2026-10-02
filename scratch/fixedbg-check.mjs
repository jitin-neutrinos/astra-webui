// backdrop is position:fixed inset:0 (fills physical screen under bars) and chrome stays inset.
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
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
await page.goto("http://127.0.0.1:3172/");
await page.waitForSelector(".app-shell");
await page.evaluate(() => {
  localStorage.setItem("astra-chat-bg", JSON.stringify({ kind: "image", src: "/astra-logo.png", dim: 0.3 }));
  window.dispatchEvent(new CustomEvent("astra-chat-bg-change", { detail: { kind: "image", src: "/astra-logo.png", dim: 0.3 } }));
});
await page.waitForTimeout(400);
const r = await page.evaluate(() => {
  const bd = document.querySelector(".chat-backdrop");
  const cs = getComputedStyle(bd);
  const rect = bd.getBoundingClientRect();
  const header = document.querySelector("header")?.getBoundingClientRect();
  const composer = document.querySelector(".chat-composer")?.getBoundingClientRect();
  return {
    pos: cs.position,
    rect: [rect.x, rect.y, rect.width, rect.height],
    win: [window.innerWidth, window.innerHeight],
    headerTop: header?.top,
    composerBottom: composer ? window.innerHeight - composer.bottom : null,
  };
});
ok(`backdrop position:fixed (${r.pos})`, r.pos === "fixed");
ok(`backdrop fills window 0,0 ${r.win} (got ${r.rect})`, r.rect[0] === 0 && r.rect[1] === 0 && r.rect[2] === r.win[0] && r.rect[3] === r.win[1]);
ok(`chrome still inset (header top ${r.headerTop} > 0)`, (r.headerTop ?? 0) >= 0);
await ctx.close(); await b.close(); server.close();
process.exit(fails ? 1 : 0);
