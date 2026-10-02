// Prove the slash-command palette still works after the All-commands removal.
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
// type "/" into the composer textarea
const ta = page.locator("textarea").first();
await ta.click();
await ta.type("/");
await page.waitForTimeout(600);
const pal = await page.evaluate(() => {
  const items = [...document.querySelectorAll("[class*=cmdpal] [class*=row], [class*=palette] [class*=item], [role=option], [role=listbox] *")].filter((el) => el.getClientRects().length);
  const anyVisibleList = [...document.querySelectorAll("div,ul")].filter((el) => {
    const cs = getComputedStyle(el);
    return cs.position === "absolute" && el.getClientRects().length && el.textContent.includes("/status");
  });
  return { candidateRows: items.length, listWithName: anyVisibleList.length > 0 };
});
console.log(`${pal.listWithName ? "PASS" : "FAIL"} slash palette opens with commands (/status visible; rows=${pal.candidateRows})`);
// clear the slash so the draft is empty
await ta.press("Backspace");
await b.close();
process.exit(pal.listWithName ? 0 : 1);
