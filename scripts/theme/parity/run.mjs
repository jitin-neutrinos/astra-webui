// Visual-parity capture. One invocation = one build, many states, both themes.
//   node scripts/theme/parity/run.mjs --dist <dir> --out <dir> [--port N] [--quick]
// Serves <dir> (SPA fallback) on a local port, mocks /api + WebSocket (fixtures.mjs),
// drives the SAME interaction script for every state, and for each state saves
//   <out>/<state>.json  (computed-style snapshot)   <out>/<state>.png  (pixels)
// Compare two output dirs with compare.mjs.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { captureInPage, PROPS } from "./capture.mjs";
import { installMocks, SID } from "./fixtures.mjs";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : d; };
const DIST = resolve(arg("dist", "dist"));
const OUT = resolve(arg("out", "parity-out"));
const PORT = Number(arg("port", 3190));
const QUICK = process.argv.includes("--quick");
const CHROME = process.env.CHROME || "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  let f = join(DIST, p === "/" ? "index.html" : p);
  try { if (!(await stat(f)).isFile()) throw 0; } catch { f = join(DIST, "index.html"); }
  try { const b = await readFile(f); res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream", "cache-control": "no-store" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
await mkdir(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FREEZE = `
  *, *::before, *::after { caret-color: transparent !important; }
  html { scroll-behavior: auto !important; }
`;

async function freeze(page) {
  await page.addStyleTag({ content: FREEZE }).catch(() => {});
  await page.evaluate(() => document.getAnimations().forEach((a) => {
    try {
      const end = a.effect && a.effect.getComputedTiming().endTime;
      if (Number.isFinite(end)) a.finish();          // entering fades etc.: land on the final, visible frame
      else { a.pause(); a.currentTime = 0; }         // infinite loops: one fixed frame
    } catch {}
  })).catch(() => {});
  await sleep(150);
}

// states: [name, viewport, async (page) => interaction]
const clickText = async (page, text, opts = {}) => {
  const loc = page.getByRole(opts.role || "button", { name: text, exact: opts.exact ?? false }).first();
  await loc.click({ timeout: 4000 });
};
const D = { width: 1366, height: 820 }, M = { width: 390, height: 780 };
const STATES = [
  ["login",            D, { authed: false }, async () => {}],
  ["login-m",          M, { authed: false }, async () => {}],
  ["login-err",        D, { authed: false }, async (p) => { await p.route("**/api/login", (r) => r.fulfill({ status: 401, contentType: "application/json", body: '{"ok":false,"error":"Wrong password"}' })); await p.fill("#password", "x"); await p.keyboard.press("Enter"); await sleep(500); }],
  ["chat-empty",       D, {}, async () => {}],
  ["chat-empty-m",     M, {}, async () => {}],
  ["chat-history",     D, {}, async (p) => { await p.goto(`${p.url().split("/").slice(0,3).join("/")}/c/${SID}`); await p.waitForSelector(".chat-turn", { timeout: 8000 }); await sleep(600); }],
  ["chat-history-m",   M, {}, async (p) => { await p.goto(`${p.url().split("/").slice(0,3).join("/")}/c/${SID}`); await p.waitForSelector(".chat-turn", { timeout: 8000 }); await sleep(600); }],
  ["chat-typing",      D, {}, async (p) => { const ta = p.locator("textarea").first(); await ta.click({ timeout: 8000, force: true }).catch(async (e) => { console.log("  [debug] click failed:", String(e.message).split("\n")[0], "composer html:", await p.evaluate(() => document.querySelector("textarea")?.outerHTML.slice(0,200))); }); await ta.fill("A longer draft message that should wrap onto a second line inside the composer so we see the growth behaviour, hover borders and the focus ring all at once."); await sleep(300); }],
  ["chat-slash-bg",    D, {}, async (p) => { const ta = p.locator("textarea").first(); await ta.click({ timeout: 8000, force: true }); await ta.fill("/bg run the nightly checks"); await sleep(300); }],
  ["chat-options",     D, {}, async (p) => { await p.locator(".chat-chip-options").first().click({ timeout: 4000, force: true }); await sleep(500); }],
  ["sidebar-chats",    D, {}, async (p) => { await clickText(p, "Chats", { exact: true }); await sleep(700); }],
  ["sidebar-config-open", D, {}, async (p) => { await clickText(p, "Configure"); await sleep(500); }],
  ["sidebar-rail",     D, {}, async (p) => { await p.locator('button[aria-label="Collapse sidebar"]').click({ timeout: 4000 }); await sleep(500); }],
  ["drawer-m",         M, {}, async (p) => { await p.locator('button[aria-label="Open navigation"]:visible').first().click({ timeout: 4000, force: true }); await sleep(500); }],
  ["files",            D, {}, async (p) => { await clickText(p, "Files", { exact: true }); await sleep(700); }],
  ["config",           D, {}, async (p) => { await p.goto(`${p.url().split("/").slice(0,3).join("/")}/config`); await sleep(900); }],
  ["approvals",        D, {}, async (p) => { await p.goto(`${p.url().split("/").slice(0,3).join("/")}/approvals`); await sleep(900); }],
  ["vault",            D, {}, async (p) => { await p.goto(`${p.url().split("/").slice(0,3).join("/")}/vault`); await sleep(900); }],
  ["tracker",          D, {}, async (p) => { await p.goto(`${p.url().split("/").slice(0,3).join("/")}/tracker`); await sleep(900); }],
  ["chat-offline",     D, { wsOffline: true }, async () => { await sleep(1500); }],
];
const run = QUICK ? STATES.filter(([n]) => ["login", "chat-empty", "chat-history", "sidebar-chats"].includes(n)) : STATES;

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text", "--disable-gpu"] });
const summary = [];
for (const mode of ["dark", "light"]) {
  for (const [name, viewport, mockOpts, act] of run) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: mode, locale: "en-US", timezoneId: "UTC" });
    await ctx.addInitScript((m) => { try { localStorage.setItem("astra-theme", m); } catch {} Date.now = ((n) => () => n)(1790000100000); }, mode);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 160)));
    try {
      await installMocks(page, mockOpts);
      await page.route(/(esm\.sh|cdn\.jsdelivr|unpkg\.com|cdn\.skypack)/, (r) => r.abort());
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load" });
      await sleep(900);
      await act(page);
      await freeze(page);
      const snap = await page.evaluate(captureInPage, PROPS);
      await page.screenshot({ path: join(OUT, `${name}.${mode}.png`) });
      await writeFile(join(OUT, `${name}.${mode}.json`), JSON.stringify(snap));
      const n = Object.keys(snap.map).length;
      summary.push({ state: `${name}.${mode}`, elements: n, theme: snap.theme, newSkipped: snap.skippedNew, errs: errs.length });
      console.log(`ok   ${name}.${mode}  elements=${n} data-theme=${snap.theme}${errs.length ? "  pageerrors=" + errs.length : ""}`);
    } catch (e) {
      const dbg = await page.evaluate(() => ({
        chips: document.querySelectorAll(".chat-chip-options").length,
        tas: document.querySelectorAll("textarea").length,
        nav: document.querySelectorAll('button[aria-label="Open navigation"]').length,
        body: document.body.innerText.slice(0, 120),
      })).catch(() => ({}));
      summary.push({ state: `${name}.${mode}`, failed: String(e.message).split("\n")[0].slice(0, 140), dbg });
      console.log(`FAIL ${name}.${mode}  ${String(e.message).split("\n")[0].slice(0, 110)}  dbg=${JSON.stringify(dbg)}`);
    }
    await ctx.close();
  }
}
await writeFile(join(OUT, "_summary.json"), JSON.stringify(summary, null, 1));
await browser.close();
server.close();
const failed = summary.filter((s) => s.failed);
console.log(`\ncaptured ${summary.length - failed.length}/${summary.length} states -> ${OUT}`);
process.exit(failed.length ? 2 : 0);
