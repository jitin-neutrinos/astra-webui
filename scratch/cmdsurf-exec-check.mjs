// Full readout path: pick /status from the slash palette, send it, expect a
// .cmdsurf readout card above the composer (the curated surface), not chat text.
import { chromium, devices } from "playwright";
import { execSync } from "node:child_process";
const pass = process.env.ASTRA_WEBUI_PASSWORD;
const hdrs = execSync(`curl -s -D - -o /dev/null -X POST http://127.0.0.1:3011/api/login -H 'content-type: application/json' -d '{"password":${JSON.stringify(pass)}}'`).toString();
const cookieLine = hdrs.split(/\r?\n/).find((l) => /^set-cookie:/i.test(l) && l.includes("astra_session="));
const cookie = cookieLine.replace(/^set-cookie:\s*/i, "").split(";")[0];
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const ctx = await b.newContext({ ...devices["Pixel 7"] });
await ctx.addCookies([{ name: "astra_session", value: cookie.split("=", 2)[1], domain: "astra.jitinnair.com", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
const page = await ctx.newPage();
await page.goto("https://astra.jitinnair.com/", { waitUntil: "load" });
await page.waitForSelector(".app-shell", { timeout: 15000 });
await page.waitForTimeout(800);
const ta = page.locator("textarea").first();
await ta.click();
await ta.type("/status");
await page.waitForTimeout(600);
// pick the /status row from the palette (keyboard: Enter selects highlighted)
await ta.press("Enter");
await page.waitForTimeout(200);
// submit it (Enter again if the palette consumed the first; textarea must be empty or holding the command)
const taVal = await ta.inputValue().catch(() => "");
if (taVal) { await ta.press("Enter"); }
// wait for a cmdsurf card to appear with a settled status
let found = null;
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(1000);
  found = await page.evaluate(() => {
    const c = document.querySelector(".cmdsurf");
    if (!c) return null;
    const title = c.querySelector(".cmdsurf-title")?.textContent || "";
    const badge = c.querySelector("[class*=status], .cmdsurf-badge, [class*=badge]")?.textContent || "";
    return { title, badge: badge.slice(0, 30) };
  });
  if (found && found.badge && !/running/i.test(found.badge)) break;
  if (found && !found.badge && found.title) break; // card present, no live status text
}
console.log(found ? `PASS cmdsurf readout rendered: "${found.title}" ${found.badge}` : "FAIL no cmdsurf readout appeared within 30s");
await ta.press("Backspace").catch(() => {});
await b.close();
process.exit(found ? 0 : 1);
