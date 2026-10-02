import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const server = createServer(async (req, res) => {
  let f = join(resolve("dist"), new URL(req.url, "http://x").pathname === "/" ? "index.html" : new URL(req.url, "http://x").pathname);
  try { const b = await readFile(f); res.writeHead(200).end(b); } catch { readFile(join(resolve("dist"),"index.html")).then(b=>res.writeHead(200).end(b)).catch(()=>res.writeHead(404).end()); }
});
await new Promise(r=>server.listen(3199,"127.0.0.1",r));
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1366, height: 820 } });
const page = await ctx.newPage();
const { installMocks } = await import("../scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
page.on("console", (m) => console.log("CONSOLE:", m.text().slice(0, 140)));
await page.goto("http://127.0.0.1:3199/");
await page.waitForTimeout(1500);
console.log("options chip count:", await page.locator(".chat-chip-options").count());
console.log("textarea count:", await page.locator("textarea").count());
console.log("body snippet:", (await page.evaluate(() => document.body.innerText.slice(0, 220))).replace(/\n/g, " | "));
console.log("html len:", await page.evaluate(() => document.body.innerHTML.length));
console.log("root html:", (await page.evaluate(() => document.getElementById("root")?.innerHTML.slice(0, 300))) || "EMPTY");
page.on("console", (m) => console.log("CONSOLE:", m.text().slice(0, 140)));
server.close(); await b.close();
