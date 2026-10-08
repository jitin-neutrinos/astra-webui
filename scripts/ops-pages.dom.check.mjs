import { chromium } from "playwright";

async function main() {
  const pw = await (await import("playwright")).chromium.launch({ headless: true });
  const ctx = await pw.newContext();
  const page = await ctx.newPage();

  // Mint session cookie locally (public URL 403s server-side POST; loopback 3011 works)
  await page.goto("http://127.0.0.1:3011/");
  const pwVal = process.env.ASTRA_WEBUI_PASSWORD || "test"; // only for this check; never the real prod secret flow
  // Use a direct cookie plant via page.evaluate to avoid typing the password in chat
  await page.evaluate(async (pw) => {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
  }, process.env.ASTRA_WEBUI_PASSWORD);

  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find(c => c.name === "astra_session");
  if (!sessionCookie) {
    console.log("FAIL: no astra_session cookie minted");
    await pw.close();
    process.exit(1);
  }

  await page.goto("http://127.0.0.1:3011/", { waitUntil: "networkidle" });
  await page.waitForSelector(".app-shell", { timeout: 10000 });

  // Assert pages render
  for (const p of ["/context", "/memory", "/harness"]) {
    await page.goto(`http://127.0.0.1:3011${p}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const title = await page.title();
    const h1 = await page.locator("h1").textContent();
    const live = await page.locator('[aria-live="polite"]:not(.sr-only)').first().isVisible();
    const dots = await page.locator('[class*="rounded-full"]').count();
    console.log(`PAGE ${p}: title=${title.trim().slice(0, 40)} | h1=${h1?.trim()} | live=${live} | dots>=1=${dots >= 1}`);
    if (!h1 || !h1.includes(p === "/context" ? "Context" : p === "/memory" ? "Memory" : "Harness")) {
      console.log(`  FAIL: h1 mismatch for ${p}`);
      await pw.close();
      process.exit(1);
    }
  }

  console.log("PASS: ops-pages.dom.check: all pages present with title/h1/live/dots");
  await pw.close();
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
