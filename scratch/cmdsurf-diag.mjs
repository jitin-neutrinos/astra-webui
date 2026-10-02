// Diagnostic rerun: log every stage — palette pick, input state, user row, cmdsurf card, errors.
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
const errs = [];
page.on("pageerror", (e) => errs.push(String(e.message).slice(0, 120)));
const consoleErrs = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrs.push(m.text().slice(0, 120)); });
await page.goto("https://astra.jitinnair.com/", { waitUntil: "load" });
await page.waitForSelector(".app-shell", { timeout: 15000 });
await page.waitForTimeout(1200); // let command registry warm
const ta = page.locator("textarea").first();
await ta.click();
await ta.pressSequentially("/status", { delay: 40 });
await page.waitForTimeout(800);
const stage1 = await page.evaluate(() => ({
  val: document.querySelector("textarea")?.value,
  cmdActive: !!document.querySelector("textarea.cmd-active"),
  palRows: [...document.querySelectorAll("[role=option], .cmdpal-row, [class*=palette] [class*=row]")].filter((el) => el.getClientRects().length).length,
}));
console.log("after typing:", JSON.stringify(stage1));
await ta.press("Enter"); // pick from palette
await page.waitForTimeout(400);
const stage2 = await page.evaluate(() => ({ val: document.querySelector("textarea")?.value, cmdActive: !!document.querySelector("textarea.cmd-active") }));
console.log("after pick:", JSON.stringify(stage2));
if (stage2.val) {
  // React submit needs keyCode:13 (skill lesson) — dispatch a real keydown via CDP typing
  await ta.click();
  await ta.press("Enter");
}
await page.waitForTimeout(2500);
const stage3 = await page.evaluate(() => ({
  val: document.querySelector("textarea")?.value,
  cmdsurf: document.querySelectorAll(".cmdsurf").length,
  cmdsurfTitle: document.querySelector(".cmdsurf-title")?.textContent || null,
  userRows: [...document.querySelectorAll("[class*=bubble], [class*=msg]")].filter((el) => /status/.test(el.textContent || "")).length,
}));
console.log("after submit:", JSON.stringify(stage3));
await page.waitForTimeout(5000);
const stage4 = await page.evaluate(() => ({
  cmdsurf: document.querySelectorAll(".cmdsurf").length,
  title: document.querySelector(".cmdsurf-title")?.textContent || null,
  head: document.querySelector(".cmdsurf-head")?.textContent?.slice(0, 60) || null,
  body: document.querySelector(".cmdsurf")?.textContent?.slice(0, 120) || null,
}));
console.log("after wait:", JSON.stringify(stage4, null, 1));
console.log("pageerrors:", errs.length, errs[0] || ""); console.log("console errors:", consoleErrs.slice(0, 3));
await b.close();
