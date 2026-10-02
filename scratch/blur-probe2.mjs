import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
const page = await b.newPage();
await page.setContent(`<div id=x style="-webkit-backdrop-filter:blur(22px) saturate(1.25)"></div>`);
console.log("webkit-only:", await page.evaluate(() => {
  const cs = getComputedStyle(document.getElementById("x"));
  return JSON.stringify({ std: cs.backdropFilter, wk: cs.webkitBackdropFilter });
}));
await b.close();
