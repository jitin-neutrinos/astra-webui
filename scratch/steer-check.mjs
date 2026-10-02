// Steer verify: on tokyo-night-dark, new-chat btn, send btn, options glow, composer trace,
// bubble borders all show TOKYO colors (not astra #22d3ee). Plus the pending fixes:
// welcome glass std-blur, theme-color meta follows palette+mode.
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
await new Promise((r) => server.listen(3187, "127.0.0.1", r));
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const ASTRA = "34, 211, 238";
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 820 } });
const page = await ctx.newPage();
await page.route(/youtube\.com/, (r) => r.abort());
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
await page.goto("http://127.0.0.1:3187/");
await page.waitForSelector(".chat-welcome");

// welcome glass (std property this time)
const w = await page.evaluate(() => {
  const cs = getComputedStyle(document.querySelector(".chat-welcome"));
  return { blur: cs.backdropFilter || cs.webkitBackdropFilter, bg: cs.backgroundColor, radius: cs.borderRadius };
});
ok(`welcome glass std blur (${w.blur})`, String(w.blur).includes("24") && w.bg !== "rgba(0, 0, 0, 0)" && parseFloat(w.radius) >= 16);

// default meta
const meta0 = await page.evaluate(() => document.querySelector('meta[name="theme-color"]:not([media])')?.getAttribute("content"));
ok(`default meta astra void (${meta0})`, meta0?.toLowerCase() === "#0a0a0f");

// capture astra-state button colors
const astraColors = await page.evaluate(() => {
  const g = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundColor + "|" + getComputedStyle(el).boxShadow : ""; };
  return {
    nc: g(".nc-btn"),
    options: g(".chat-chip-options"),
    send: (() => { const el = document.querySelector(".chat-send"); return el ? getComputedStyle(el).backgroundImage : ""; })(),
  };
});

// switch to tokyo-night-dark
await page.evaluate(() => { localStorage.setItem("astra-palette", "tokyo-night-dark"); });
await page.reload({ waitUntil: "load" });
await page.waitForSelector(".chat-welcome");
const meta1 = await page.evaluate(() => document.querySelector('meta[name="theme-color"]:not([media])')?.getAttribute("content"));
ok(`meta follows palette (${meta1})`, meta1?.toLowerCase() === "#1a1b26");

const tokyoColors = await page.evaluate(() => {
  const g = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundColor + "|" + getComputedStyle(el).boxShadow : ""; };
  return {
    nc: g(".nc-btn"),
    options: g(".chat-chip-options"),
    send: (() => { const el = document.querySelector(".chat-send"); return el ? getComputedStyle(el).backgroundImage : ""; })(),
    trace: (() => { const el = document.querySelector(".composer-trace-step"); return el ? getComputedStyle(el).stroke : ""; })(),
    voidColor: getComputedStyle(document.querySelector(".app-shell")).backgroundColor,
  };
});
const notAstra = (v) => !v.includes(ASTRA) && v.length > 0;
ok(`new-chat btn follows tokyo (${tokyoColors.nc.slice(0, 60)})`, notAstra(tokyoColors.nc) && tokyoColors.nc !== astraColors.nc);
ok(`options glow follows tokyo (${tokyoColors.options.slice(0, 80)})`, notAstra(tokyoColors.options) && tokyoColors.options !== astraColors.options);
ok(`send btn follows tokyo (${tokyoColors.send.slice(0, 60)})`, notAstra(tokyoColors.send) && tokyoColors.send !== astraColors.send);
ok(`composer trace follows tokyo (${tokyoColors.trace})`, notAstra(tokyoColors.trace));

// light mode: meta should move to tokyo light void (#d5d6db family) not stay dark
await page.evaluate(() => {
  document.documentElement.setAttribute("data-theme", "light");
  window.dispatchEvent(new CustomEvent("astra-theme-change", { detail: "light" }));
});
await page.waitForTimeout(250);
const meta2 = await page.evaluate(() => document.querySelector('meta[name="theme-color"]:not([media])')?.getAttribute("content"));
ok(`light mode -> meta = tokyo-dark light void (${meta2})`, meta2?.toLowerCase() === "#16161e");
await page.evaluate(() => localStorage.removeItem("astra-palette"));
await ctx.close();
await b.close(); server.close();
process.exit(fails ? 1 : 0);
