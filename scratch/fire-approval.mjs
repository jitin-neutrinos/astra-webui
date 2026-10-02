// Live-fire approval gate: log into the real astra.jitinnair.com in playwright,
// submit a prompt that makes Hermes raise a real tool approval, verify the
// approval frame lands in the gate ledger (=> ntfy push => phone popup).
// Usage: node fire-approval.mjs "<prompt text>" [timeout_s]
import { chromium } from "playwright";

const PUBLIC = "https://astra.jitinnair.com";
const LOCAL = "http://127.0.0.1:3011";
const LEDGER = "/home/notjitin/Work/projects/astra-webui/data/gate-ledger.jsonl";
const PROMPT = process.argv[2] || "Run this exact shell command: touch ~/astra-gate-test.txt and then tell me the word DONE.";
const TIMEOUT_S = Number(process.argv[3] || 240);

const { execSync } = await import("node:child_process");
const fs = await import("node:fs");
const baseline = fs.existsSync(LEDGER)
  ? fs.readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).length
  : 0;

// login LOCALLY (CF 403s server-side POSTs to the public login), plant cookie on public domain
const pwline = fs.readFileSync("/home/notjitin/.config/astra-webui/env", "utf8")
  .split("\n").find(l => l.startsWith("ASTRA_WEBUI_PASSWORD="));
const PW = pwline.split("=", 1)[1] === "" ? "" : pwline.slice("ASTRA_WEBUI_PASSWORD=".length);

const login = await fetch(`${LOCAL}/api/login`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: PW }),
});
assert(login.status === 200, `local login ${login.status}`);
const setCookie = login.headers.get("set-cookie") || "";
const token = /astra_session=([^;]+)/.exec(setCookie)?.[1];
assert(token, "no token in set-cookie");

function assert(cond, msg) { if (!cond) { console.error("FAIL:", msg); process.exit(1); } }

const exe = "/usr/lib64/chromium-browser/chromium-browser";
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "astra_session", value: token, domain: "astra.jitinnair.com", path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
const page = await ctx.newPage();

// watch WS frames for the approval request
let approvalId = null;
page.on("websocket", ws => {
  ws.on("framereceived", f => {
    try {
      const d = JSON.parse(f.payload.toString());
      const id = d?.id || "";
      if (String(id).startsWith("srq-") && d?.method === "approval") approvalId = id;
    } catch {}
  });
});

await page.goto(PUBLIC, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!document.querySelector(".app-shell, #password"), null, { timeout: 20000 });
// if login wall appeared, auth state failed — bail loudly
const onLogin = await page.evaluate(() => !!document.querySelector("#password"));
assert(!onLogin, "landed on login wall — cookie plant failed");

// find composer and send the prompt (native prototype setter for React)
await page.waitForFunction(() => {
  const ta = document.querySelector("textarea");
  return ta && !ta.disabled;
}, null, { timeout: 20000 });
await page.evaluate((text) => {
  const ta = document.querySelector("textarea");
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  set.call(ta, text);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}, PROMPT);
await page.evaluate(() => {
  const ta = document.querySelector("textarea");
  ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
});

console.log("prompt submitted, waiting for approval frame...");
const deadline = Date.now() + TIMEOUT_S * 1000;
let answered = false;
while (Date.now() < deadline) {
  await page.waitForTimeout(3000);
  if (approvalId) {
    // check ledger for the gate + answer
    try {
      const lines = fs.readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean);
      const gate = lines.map(l => JSON.parse(l)).reverse().find(o => o.id === approvalId);
      if (gate) {
        console.log(`GATE RAISED: ${approvalId} answered=${gate.answered} choice=${gate.result?.choice ?? "-"}`);
        if (gate.answered) { answered = true; break; }
      } else {
        console.log(`frame seen (${approvalId}), ledger not yet...`);
      }
    } catch {}
  } else {
    // detect gate in ledger even if WS parse missed it
    try {
      const lines = fs.readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean);
      if (lines.length > baseline) {
        const fresh = lines.slice(baseline).map(l => JSON.parse(l)).find(o => o.type === "gate");
        if (fresh) { approvalId = fresh.id; console.log(`GATE IN LEDGER: ${fresh.id} kind=${fresh.kind}`); }
      }
    } catch {}
  }
}

if (approvalId) {
  console.log(answered ? `SUCCESS: gate ${approvalId} answered` : `GATE ${approvalId} still pending — check the phone now (popup should be up)`);
  if (!answered) {
    // answer from here so the turn doesn't hang fail-closed (~5 min)
    console.log("answering from web to release the turn...");
    const btn = page.locator(".gate-approval .ga-btn.primary").first();
    if (await btn.count()) { await btn.click(); console.log("clicked Allow once (web)"); }
  }
} else {
  console.log("NO GATE raised within timeout — approval mode may not be manual, or the turn errored.");
}
await browser.close();
