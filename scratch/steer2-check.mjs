// steer batch: stop red bg, think/tool cards translucent+10px blur, header all sizes (covered in ux-check)
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
await new Promise((r) => server.listen(3178, "127.0.0.1", r));
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 820 } });
const page = await ctx.newPage();
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
await page.goto("http://127.0.0.1:3178/c/s-parity-1");
await page.waitForSelector(".chat-turn", { timeout: 8000 });
console.log("turns:", await page.locator(".chat-turn").count(), "steps:", await page.locator(".chat-step").count(), "bodies:", await page.locator(".chat-step-body").count(), "think:", await page.locator(".chat-think-text").count());
// computed-style probes on synthetic nodes with the REAL classes (style correctness, not data)
const probe = await page.evaluate(() => {
  const mk = (cls, parent) => { const el = document.createElement("div"); el.className = cls; parent.appendChild(el); return el; };
  const composer = document.querySelector(".chat-composer");
  const stop = mk("chat-send chat-send-stop", composer);
  const feed = document.querySelector(".chat-feed") || document.querySelector("main");
  const step = mk("chat-step-body", feed);
  const think = mk("chat-think-text", feed);
  const g = (el) => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, img: cs.backgroundImage, blur: cs.backdropFilter || cs.webkitBackdropFilter }; };
  const r = { stop: g(stop), step: g(step), think: g(think) };
  stop.remove(); step.remove(); think.remove();
  return r;
});
ok(`stop button solid red gradient (${probe.stop.img.slice(0, 60)})`, probe.stop.img.includes("linear-gradient") && !probe.stop.img.includes("rgba(0, 0, 0, 0)"));
ok(`step card translucent + 10px blur (${probe.step.bg}, ${probe.step.blur})`, probe.step.bg !== "rgba(0, 0, 0, 0)" && String(probe.step.blur).includes("10px"));
ok(`think card translucent + 10px blur (${probe.think.bg}, ${probe.think.blur})`, probe.think.bg !== "rgba(0, 0, 0, 0)" && String(probe.think.blur).includes("10px"));
await ctx.close(); await b.close(); server.close();
process.exit(fails ? 1 : 0);
