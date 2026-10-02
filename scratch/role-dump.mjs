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
await new Promise((r) => server.listen(3186, "127.0.0.1", r));
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const page = await (await b.newContext()).newPage();
await page.goto("http://127.0.0.1:3186/");
await page.waitForSelector(".app-shell");
console.log(await page.evaluate(() => {
  let r = 0, c = 0, sample = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const t = rule.style;
      for (let i = 0; i < t.length; i++) {
        if (t[i].startsWith("--r-")) { r++; if (sample.length < 3) sample.push(t[i] + "=" + t.getPropertyValue(t[i])); }
        if (/^--c-\d+$/.test(t[i])) c++;
      }
    }
  }
  return JSON.stringify({ roleTags: r, chanVars: c, sample });
}));
await b.close(); server.close();
