// Mobile implementation audit on Pixel 7 emulation: drawer opens/closes, chat usable,
// composer grows, trace present, backdrop fixed, no page errors, no overlap of drawer.
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
await new Promise((r) => server.listen(3170, "127.0.0.1", r));
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 120)));
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
await page.goto("http://127.0.0.1:3170/");
await page.waitForSelector(".app-shell", { timeout: 10000 });
// drawer open
await page.locator('button[aria-label="Open navigation"]:visible').first().click({ force: true });
await page.waitForTimeout(400);
const drawer = await page.evaluate(() => {
  const a = document.getElementById("astra-sidebar");
  const r = a.getBoundingClientRect();
  const cs = getComputedStyle(a);
  return { x: r.x, w: r.width, tx: cs.transform, vis: r.x > -10 && r.width > 200, blur: cs.backdropFilter || cs.webkitBackdropFilter, bg: cs.backgroundColor };
});
ok(`drawer opens on mobile (x=${drawer.x})`, drawer.vis && !drawer.tx.includes("-"));
ok(`drawer glass = bubble intensity (${drawer.blur})`, String(drawer.blur).includes("29px"));
// drawer close (overlay click)
await page.mouse.click(370, 400);
await page.waitForTimeout(400);
const closed = await page.evaluate(() => document.getElementById("astra-sidebar").getBoundingClientRect().x);
ok(`drawer closes (${closed})`, closed < -200);
// composer grows + send visible
await page.fill("textarea", "line\n".repeat(6));
await page.waitForTimeout(250);
const ta = await page.evaluate(() => document.querySelector("textarea").getBoundingClientRect().height);
ok(`composer grows on mobile (${ta | 0}px)`, ta > 80);
await page.fill("textarea", "");
// backdrop fixed with bg set
await page.evaluate(() => {
  localStorage.setItem("astra-chat-bg", JSON.stringify({ kind: "image", src: "/astra-logo.png", dim: 0.3 }));
  window.dispatchEvent(new CustomEvent("astra-chat-bg-change", { detail: { kind: "image", src: "/astra-logo.png", dim: 0.3 } }));
});
await page.waitForTimeout(300);
const bd = await page.evaluate(() => getComputedStyle(document.querySelector(".chat-backdrop")).position);
ok(`backdrop fixed full-screen on mobile (${bd})`, bd === "fixed");
// send button reachable & viewport bottom clean
const shell = await page.evaluate(() => {
  const s = document.querySelector(".app-shell").getBoundingClientRect();
  return { bottom: s.bottom, vh: window.innerHeight };
});
ok(`shell fills viewport (bottom ${shell.bottom} vs ${shell.vh})`, Math.abs(shell.bottom - shell.vh) < 2);
ok(`zero page errors`, errs.length === 0);
if (errs.length) console.log(errs.slice(0, 3));
await ctx.close(); await b.close(); server.close();
process.exit(fails ? 1 : 0);
