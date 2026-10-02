import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { extname } from "node:path";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  let f = join(resolve("dist"), p === "/" ? "index.html" : p);
  try { const b = await readFile(f); res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" }); res.end(b); }
  catch { readFile(join(resolve("dist"), "index.html")).then((b) => { res.writeHead(200, { "content-type": "text/html" }); res.end(b); }).catch(() => res.writeHead(404).end()); }
});
await new Promise((r) => server.listen(3197, "127.0.0.1", r));
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 820 } });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text().slice(0, 200)); });
page.on("pageerror", (e) => console.log("PAGE-ERR:", String(e.stack || e.message).replace(/\n/g, " || ").slice(0, 600)));
const { installMocks } = await import("../scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
await page.goto("http://127.0.0.1:3197/");
await page.waitForTimeout(1200);
// open config page
await page.goto("http://127.0.0.1:3197/config");
await page.waitForTimeout(1800);
console.log("body:", (await page.evaluate(() => document.body.innerText.slice(0, 160))).replace(/\n/g, " | "));
console.log("root len:", await page.evaluate(() => document.getElementById("root")?.innerHTML.length || 0));
// ThemePanel present?
const panel = await page.locator(".tf-panel").count();
console.log("ThemePanel mounted:", panel === 1);
// click Tokyo Night Dark card
const cards = await page.locator(".tf-card").count();
console.log("palette cards:", cards);
const bodyColorBefore = await page.evaluate(() => getComputedStyle(document.querySelector(".app-shell")).color);
await page.locator(".tf-card", { hasText: "Tokyo Night Dark" }).click();
await page.waitForTimeout(300);
// app-shell color should now be tokyo fg (#a9b1d6-ish -> computed from palette brandtext base05 #A9B1D6)
const bodyColorAfter = await page.evaluate(() => getComputedStyle(document.querySelector(".app-shell")).color);
console.log("app-shell color before:", bodyColorBefore, " -> after:", bodyColorAfter);
console.log("palette changed:", bodyColorBefore !== bodyColorAfter);
// persisted?
await page.reload(); await page.waitForTimeout(1200);
const afterReload = await page.evaluate(() => getComputedStyle(document.querySelector(".app-shell")).color);
console.log("persists after reload:", afterReload === bodyColorAfter);
// switch back to Astra UI
await page.locator(".tf-card", { hasText: "Astra UI" }).click();
await page.waitForTimeout(300);
const back = await page.evaluate(() => getComputedStyle(document.querySelector(".app-shell")).color);
console.log("switch back to Astra:", back === bodyColorBefore);
// chat backdrop: set image via store + check layer renders
await page.evaluate(() => {
  const ev = new CustomEvent("astra-chat-bg-change", { detail: { kind: "image", src: "/astra-logo.png", dim: 0.3 } });
  localStorage.setItem("astra-chat-bg", JSON.stringify({ kind: "image", src: "/astra-logo.png", dim: 0.3 }));
  window.dispatchEvent(ev);
});
await page.goto("http://127.0.0.1:3197/");
await page.waitForTimeout(800);
const backdrop = await page.locator(".chat-backdrop").count();
console.log("chat backdrop layer renders:", backdrop === 1);
// youtube id parsing
const yt = await page.evaluate(() => window.localStorage.getItem("astra-chat-bg"));
console.log("bg persisted:", JSON.parse(yt).kind === "image");
await b.close(); server.close();
