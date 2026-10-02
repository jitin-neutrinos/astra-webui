// Deep probe on LIVE site: sidebar computed styles per breakpoint + overflow/clip chain,
// WITH the owner's likely state (backdrop set, desktop viewport, hard reload).
import { chromium, devices } from "playwright";
import { readFileSync } from "node:fs";
const cookie = readFileSync("/home/notjitin/Work/scratch/astra-theme/live-cookie.txt", "utf8").trim();
const [n, v] = cookie.split("=");
const b = await chromium.launch({ executablePath: "/home/notjitin/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome", headless: true });
for (const vp of [{ w: 1366, h: 820, name: "desktop" }, { w: 1728, h: 1000, name: "wide" }]) {
  const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h } });
  await ctx.addCookies([{ name: n, value: v, domain: "astra.jitinnair.com", path: "/", secure: true, httpOnly: true }]);
  const page = await ctx.newPage();
  await page.goto("https://astra.jitinnair.com/", { waitUntil: "load" });
  await page.waitForSelector(".app-shell", { timeout: 15000 });
  await page.evaluate(() => {
    localStorage.setItem("astra-chat-bg", JSON.stringify({ kind: "image", src: "/astra-logo.png", dim: 0.3 }));
    localStorage.setItem("astra-palette", "tokyo-night-dark");
    window.dispatchEvent(new CustomEvent("astra-chat-bg-change", { detail: { kind: "image", src: "/astra-logo.png", dim: 0.3 } }));
  });
  await page.waitForTimeout(600);
  const out = await page.evaluate(() => {
    const aside = document.getElementById("astra-sidebar");
    if (!aside) return { missing: true };
    const chain = [];
    let el = aside;
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0 || cs.overflow !== "visible" || cs.transform !== "none" || cs.clipPath !== "none" || (parseFloat(cs.opacity) < 1)) {
        chain.push({ tag: el.tagName + "." + String(el.className).split(" ").slice(0,3).join("."), display: cs.display, vis: cs.visibility, op: cs.opacity, overflow: cs.overflow, transform: cs.transform.slice(0,30), clip: cs.clipPath, pos: cs.position, z: cs.zIndex, w: el.getBoundingClientRect().width });
      }
      el = el.parentElement;
    }
    const r = aside.getBoundingClientRect();
    const cs = getComputedStyle(aside);
    return { rect: [r.x, r.y, r.width, r.height], display: cs.display, op: cs.opacity, transform: cs.transform.slice(0, 40), z: cs.zIndex, pos: cs.position, suspects: chain };
  });
  console.log(vp.name, JSON.stringify(out, null, 1));
  await ctx.close();
}
await b.close();
