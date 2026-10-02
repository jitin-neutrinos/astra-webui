// LIVE-SITE mobile geometry check: astra.jitinnair.com at Pixel 7 with a minted cookie.
// 1) login locally (CF blocks server-side POST to public), 2) plant cookie on public domain,
// 3) measure main pane + drawer open/close on the real deployment.
import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";
const pass = process.env.ASTRA_WEBUI_PASSWORD;
if (!pass) { console.error("need ASTRA_WEBUI_PASSWORD"); process.exit(2); }
const hdrs = execSync(`curl -s -D - -o /dev/null -X POST http://127.0.0.1:3011/api/login -H 'content-type: application/json' -d '{"password":${JSON.stringify(pass)}}'`).toString();
const cookieLine = hdrs.split(/\r?\n/).find((l) => /^set-cookie:/i.test(l) && l.includes("astra_session="));
if (!cookieLine) { console.error("no session cookie from login"); process.exit(2); }
const cookie = cookieLine.replace(/^set-cookie:\s*/i, "").split(";")[0];

const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ ...devices["Pixel 7"] });
await ctx.addCookies([{ name: "astra_session", value: cookie.split("=", 2)[1], domain: "astra.jitinnair.com", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 100)));
await page.goto("https://astra.jitinnair.com/", { waitUntil: "load" });
await page.waitForSelector(".app-shell", { timeout: 15000 });
await page.waitForTimeout(800);
const m = await page.evaluate(() => {
  const main = document.querySelector("main")?.getBoundingClientRect();
  const aside = document.getElementById("astra-sidebar");
  return {
    vw: innerWidth,
    mainX: main ? Math.round(main.x) : null,
    mainW: main ? Math.round(main.width) : null,
    asidePos: aside ? getComputedStyle(aside).position : null,
    asideX: aside ? Math.round(aside.getBoundingClientRect().x) : null,
  };
});
console.log(`live mobile: vw=${m.vw} main x=${m.mainX} w=${m.mainW} aside pos=${m.asidePos} x=${m.asideX}`);
const okMain = m.mainX === 0 && m.mainW === m.vw && m.asidePos === "fixed";
console.log(`${okMain ? "PASS" : "FAIL"} chat pane fills phone viewport`);
// drawer open
await page.locator('button[aria-label="Open navigation"]:visible').first().click({ force: true });
await page.waitForTimeout(500);
const dx = await page.evaluate(() => Math.round(document.getElementById("astra-sidebar").getBoundingClientRect().x));
console.log(`${dx === 0 ? "PASS" : "FAIL"} drawer opens on live mobile (x=${dx})`);
console.log(`${errs.length === 0 ? "PASS" : "FAIL"} zero page errors${errs.length ? ": " + errs[0] : ""}`);
await b.close();
process.exit(okMain && dx === 0 && errs.length === 0 ? 0 : 1);
