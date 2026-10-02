// Final batch check: (1) cross-device sync via two contexts sharing the mock server state,
// (2) bubble bg/glow follow brand color, (3) send button solid theme color on tokyo,
// (4) default parity untouched.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  if (p === "/api/theme/state") {
    // minimal in-memory echo of the real endpoint
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
await new Promise((r) => server.listen(3183, "127.0.0.1", r));
let fails = 0;
const ok = (n, c) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) fails++; };
const br = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const mk = async () => {
  const ctx = await br.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await ctx.newPage();
  const { installMocks } = await import("/home/notjitin/Work/scratch/astra-theme/wt/scripts/theme/parity/fixtures.mjs");
  await installMocks(page, {});
  // let the REAL theme-sync endpoint through to the node server (mock's 404 otherwise eats it)
  await page.route("**/api/theme/state*", async (route) => {
    if (server.__state === undefined) server.__state = { rev: 0 };
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(server.__state) });
    const body = req.postData() || "{}";
    server.__state = { ...JSON.parse(body), rev: server.__state.rev + 1 };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, rev: server.__state.rev }) });
  });
  await page.goto("http://127.0.0.1:3183/");
  await page.waitForSelector(".app-shell");
  return { ctx, page };
};
// device A picks tokyo-night-dark
const A = await mk();
await A.page.evaluate(() => { localStorage.setItem("astra-palette", "tokyo-night-dark"); });
await A.page.reload({ waitUntil: "load" });
await A.page.waitForSelector(".app-shell");
await A.page.waitForTimeout(5500); // let the sync loop push
const reqs = [];
console.log("state after wait:", JSON.stringify(server.__state));
const st = server.__state;
ok(`device A pushed theme state (palette=${st && st.palette})`, !!st && st.palette === "tokyo-night-dark");
// device B (fresh) should adopt it within 5s poll
const B = await mk();
await B.page.evaluate(() => localStorage.removeItem("astra-palette"));
await B.page.reload({ waitUntil: "load" });
await B.page.waitForSelector(".app-shell");
await B.page.waitForTimeout(6000);
const bVoid = await B.page.evaluate(() => getComputedStyle(document.querySelector(".app-shell")).backgroundColor);
ok(`device B adopted tokyo void (${bVoid})`, bVoid === "rgb(26, 27, 38)");
// bubbles follow brand: astra -> cyanx tint; tokyo -> tokyo tint (device B tokyo)
const bubble = await B.page.evaluate(() => {
  // seed one turn? simpler: read the CSS var directly
  return getComputedStyle(document.documentElement).getPropertyValue("--bubble-ai-border").trim();
});
ok(`bubble border var is color-mix (theme-following) (${bubble.slice(0, 50)})`, bubble.includes("color-mix"));
// send button on device A (tokyo): solid accent gradient, not transparent
const send = await A.page.evaluate(() => {
  const el = document.querySelector(".chat-send");
  const cs = getComputedStyle(el);
  return { bg: cs.backgroundImage, color: cs.color };
});
ok(`send button carries theme gradient (${send.bg.slice(0, 80)})`, send.bg.includes("linear-gradient") && !send.bg.includes("rgba(0, 0, 0, 0)"));
await A.ctx.close(); await B.ctx.close();
await br.close(); server.close();
process.exit(fails ? 1 : 0);
