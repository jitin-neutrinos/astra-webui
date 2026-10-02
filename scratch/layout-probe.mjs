// Why does the chat pane start at x~288 on mobile? Measure aside computed style + main rect + flex ancestors.
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
await new Promise((r) => server.listen(3173, "127.0.0.1", r));
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ ...devices["Pixel 7"] });
const page = await ctx.newPage();
const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
await installMocks(page, {});
await page.goto("http://127.0.0.1:3173/");
await page.waitForSelector(".app-shell", { timeout: 10000 });
await page.waitForTimeout(600);
const out = await page.evaluate(() => {
  const aside = document.getElementById("astra-sidebar");
  const cs = aside ? getComputedStyle(aside) : null;
  const r = aside?.getBoundingClientRect();
  // walk up from aside collecting layout-relevant computed props
  const chain = [];
  let n = aside;
  while (n && n !== document.body) {
    const c = getComputedStyle(n);
    chain.push({
      tag: n.tagName, cls: String(n.className).slice(0, 70),
      pos: c.position, x: Math.round(n.getBoundingClientRect().x), w: Math.round(n.getBoundingClientRect().width),
      display: c.display, transform: c.transform !== "none" ? c.transform.slice(0, 40) : "none",
      bf: c.backdropFilter, filter: c.filter, contain: c.contain, willChange: c.willChange,
    });
    n = n.parentElement;
  }
  const main = document.querySelector("main");
  const mr = main?.getBoundingClientRect();
  const shell = document.querySelector(".app-shell");
  const scs = shell ? getComputedStyle(shell) : null;
  return {
    aside: cs ? { position: cs.position, x: r.x, w: r.width, transform: cs.transform, translate: cs.translate } : null,
    main: mr ? { x: Math.round(mr.x), w: Math.round(mr.width) } : null,
    shellDisplay: scs?.display, shellFlexDir: scs?.flexDirection,
    chain,
  };
});
console.log(JSON.stringify(out, null, 1));
await b.close(); server.close();
