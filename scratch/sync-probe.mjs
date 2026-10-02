import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  console.log("SERVER SEES:", req.method, p);
  if (p === "/api/theme/state") {
    if (!server.__state) server.__state = { rev: 0 };
    if (req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        server.__state = { ...JSON.parse(Buffer.concat(chunks).toString()), rev: server.__state.rev + 1 };
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, rev: server.__state.rev }));
      });
      return;
    }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(server.__state));
    return;
  }
  let f = join(resolve("dist"), p === "/" ? "index.html" : p);
  try { const b = await readFile(f); res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" }); res.end(b); }
  catch { readFile(join(resolve("dist"), "index.html")).then((b) => { res.writeHead(200, { "content-type": "text/html" }); res.end(b); }).catch(() => res.writeHead(404).end()); }
});
await new Promise((r) => server.listen(3182, "127.0.0.1", r));
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext();
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("ERR:", m.text().slice(0, 120)); });
// NO installMocks: pure real server
await page.goto("http://127.0.0.1:3182/");
await page.waitForTimeout(1000);
await page.evaluate(() => { localStorage.setItem("astra-palette", "tokyo-night-dark"); });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(6000);
console.log("state:", JSON.stringify(server.__state));
await b.close(); server.close();
