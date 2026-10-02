// Live check: All-commands button gone, composer + send still render, mobile + desktop.
import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";
const pass = process.env.ASTRA_WEBUI_PASSWORD;
const hdrs = execSync(`curl -s -D - -o /dev/null -X POST http://127.0.0.1:3011/api/login -H 'content-type: application/json' -d '{"password":${JSON.stringify(pass)}}'`).toString();
const cookieLine = hdrs.split(/\r?\n/).find((l) => /^set-cookie:/i.test(l) && l.includes("astra_session="));
const cookie = cookieLine.replace(/^set-cookie:\s*/i, "").split(";")[0];
// served bundle grep
const idx = await (await fetch("https://astra.jitinnair.com/")).text();
const js = [...idx.matchAll(/(index-[^"]+\.js)/g)].map((m) => m[1])[0];
const served = await (await fetch(`https://astra.jitinnair.com/assets/${js}`)).text();
console.log(`${served.includes("chat-allcmds") ? "FAIL" : "PASS"} served bundle has no chat-allcmds (${js})`);

const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
let fails = 0;
for (const [label, ctxOpts] of [["mobile", { ...devices["Pixel 7"] }], ["desktop", { viewport: { width: 1440, height: 900 } }]]) {
  const ctx = await b.newContext(ctxOpts);
  await ctx.addCookies([{ name: "astra_session", value: cookie.split("=", 2)[1], domain: "astra.jitinnair.com", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 80)));
  await page.goto("https://astra.jitinnair.com/", { waitUntil: "load" });
  await page.waitForSelector(".app-shell", { timeout: 15000 });
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({
    allcmds: document.querySelectorAll(".chat-allcmds").length,
    composer: !!document.querySelector(".chat-composer-bar, textarea"),
    send: !!document.querySelector('button[aria-label*="Send" i], .chat-send'),
    trace: !!document.querySelector(".composer-trace-step, [class*=trace]"),
  }));
  const ok = r.allcmds === 0 && r.composer && r.send && errs.length === 0;
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: allcmds=${r.allcmds} composer=${r.composer} send=${r.send} errors=${errs.length}${errs[0] ? " " + errs[0] : ""}`);
  await ctx.close();
}
await b.close();
process.exit(fails || served.includes("chat-allcmds") ? 1 : 0);
