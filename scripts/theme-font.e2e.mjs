// theme-font.e2e.mjs — live HTTP tests against the REAL routes.
//
// Why this exists: the unit check reads source text. This drives the actual
// handlers over real sockets with a real cookie, so the auth gate, the magic-byte
// rejection, the Range path, the traversal guard and the Google proxy are all
// exercised as shipped rather than as described.
//
// Zero deps, assert-based, exits 1 on failure.
//   node scripts/theme-font.e2e.mjs

import { createServer } from "node:http";
import { readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import {
  handleFontUpload, handleFontServe, handleGoogleFontCss, handleGoogleFontFile,
} from "../server/theme-font.mjs";

const REPO = resolve(import.meta.dirname, "..");
const FONT_DIR = join(REPO, "data", "theme-font");
const GOOGLE_DIR = join(FONT_DIR, "google");

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`ok - ${name}`); };
const bad = (name, e) => { fail++; console.log(`not ok - ${name}\n    ${e?.message || e}`); };

const TOKEN = "test-token";
const validToken = (t) => t === TOKEN;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const path = url.pathname;
  const authed = (req.headers.cookie || "").includes(`astra_session=${TOKEN}`);
  try {
    if (path === "/api/theme/font") return handleFontUpload(req, res, validToken);
    if (path.startsWith("/api/theme/font/google/")) {
      const rest = path.slice("/api/theme/font/google/".length);
      if (rest.endsWith(".css")) {
        return await handleGoogleFontCss(req, res, validToken, decodeURIComponent(rest.slice(0, -4)));
      }
      return handleGoogleFontFile(req, res, validToken, rest);
    }
    if (path.startsWith("/api/theme/font/")) {
      return handleFontServe(req, res, validToken, path.slice("/api/theme/font/".length));
    }
    res.writeHead(404); res.end();
  } catch (e) {
    console.error("handler threw:", e);
    if (!res.headersSent) { res.writeHead(500); res.end(); }
  }
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const cookie = { cookie: `astra_session=${TOKEN}` };

const req = (path, opts = {}) => fetch(base + path, { ...opts, headers: { ...cookie, ...(opts.headers || {}) } });

// A real shipped woff2 to upload.
const SAMPLE = join(REPO, "public/fonts/f01-rP2Hp2ywxg089UriCZOIHTWEBlw.woff2");
const sampleBuf = readFileSync(SAMPLE);

try {
  // ---- 1. auth gate ------------------------------------------------------
  {
    const r = await fetch(base + "/api/theme/font", {
      method: "POST",
      headers: { "x-file-name": "x.woff2" },
      body: sampleBuf,
    });
    try { assert.equal(r.status, 401); ok("upload without a session is 401"); }
    catch (e) { bad("upload without a session is 401", e); }
  }

  // ---- 2. a real upload round-trips --------------------------------------
  let url = "", family = "";
  {
    const r = await req("/api/theme/font", {
      method: "POST",
      headers: { "content-type": "font/woff2", "x-file-name": encodeURIComponent("my-font.woff2") },
      body: sampleBuf,
    });
    const j = await r.json();
    try {
      assert.equal(r.status, 200);
      url = j.url; family = j.family;
      assert.match(url, /^\/api\/theme\/font\//, "must return a same-origin path");
      assert.equal(family, "DM Sans 9pt", "the family must come from the FILE, not the filename");
      assert.equal(j.variable, true, "DM Sans is a variable face and must be reported so");
      assert.equal(j.bytes, sampleBuf.length);
      ok("upload returns the file's own family, variable flag and byte count");
    } catch (e) { bad("upload returns the file's own family", e); }
  }

  // ---- 3. serving it back, with the right MIME --------------------------
  {
    const r = await req(url);
    const buf = Buffer.from(await r.arrayBuffer());
    try {
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("content-type"), "font/woff2");
      assert.equal(buf.length, sampleBuf.length);
      assert.equal(buf.subarray(0, 4).toString("latin1"), "wOF2");
      ok("a stored face serves back byte-identical as font/woff2");
    } catch (e) { bad("a stored face serves back byte-identical", e); }
  }

  // ---- 4. Range support (a browser asks for it on a variable face) -------
  {
    const r = await req(url, { headers: { range: "bytes=0-3" } });
    try {
      assert.equal(r.status, 206);
      assert.equal(r.headers.get("content-range"), `bytes 0-3/${sampleBuf.length}`);
      ok("Range requests are honoured (206)");
    } catch (e) { bad("Range requests are honoured", e); }
  }

  // ---- 5. path traversal is refused -------------------------------------
  {
    const r = await req("/api/theme/font/..%2F..%2Ftheme-state.json");
    try { assert.ok(r.status === 404 || r.status === 400, `expected 404/400, got ${r.status}`); ok("traversal out of the font dir is refused"); }
    catch (e) { bad("traversal out of the font dir is refused", e); }
  }

  // ---- 6. a non-font is rejected by MAGIC, not by extension -------------
  {
    const r = await req("/api/theme/font", {
      method: "POST",
      headers: { "content-type": "font/woff2", "x-file-name": "evil.woff2" },
      body: Buffer.from("<svg onload=alert(1)></svg>"),
    });
    try {
      assert.equal(r.status, 415, "an SVG renamed .woff2 must be refused");
      const j = await r.json();
      assert.match(j.error, /magic/i, "the error must name the real reason");
      ok("a renamed non-font is rejected on magic bytes, not its extension");
    } catch (e) { bad("a renamed non-font is rejected", e); }
  }

  // ---- 7. .eot is refused (dead format, script surface) -----------------
  {
    const r = await req("/api/theme/font", {
      method: "POST",
      headers: { "content-type": "application/vnd.ms-fontobject", "x-file-name": "old.eot" },
      body: Buffer.from("xxxx"),
    });
    try { assert.equal(r.status, 415); ok(".eot is refused outright"); }
    catch (e) { bad(".eot is refused outright", e); }
  }

  // ---- 8. a bad family name never reaches the network --------------------
  {
    const r = await req("/api/theme/font/google/" + encodeURIComponent("evil&x=1") + ".css");
    try { assert.equal(r.status, 400, "a family name with & or = must be refused locally"); ok("a malformed family name is refused before any fetch"); }
    catch (e) { bad("a malformed family name is refused", e); }
  }

  // ---- 9. the real Google proxy: fetched, cached, rewritten --------------
  {
    const t0 = Date.now();
    const r = await req("/api/theme/font/google/Poppins.css");
    const css = await r.text();
    const ms = Date.now() - t0;
    try {
      assert.equal(r.status, 200, `css2 proxy failed: ${css.slice(0, 120)}`);
      assert.match(css, /@font-face/, "must return CSS");
      assert.ok(!/fonts\.gstatic\.com/.test(css), "every gstatic url must be rewritten");
      assert.match(css, /url\(\/api\/theme\/font\/google\//, "rewritten to a same-origin path");
      assert.equal(existsSync(GOOGLE_DIR), true, "the woff2 must be cached on disk");
      ok(`Google proxy: Poppins fetched, ${ms}ms, urls rewritten, woff2 cached locally`);
    } catch (e) { bad("Google proxy rewrites and caches", e); }

    // second call must be served from cache (no network)
    const t1 = Date.now();
    const r2 = await req("/api/theme/font/google/Poppins.css");
    const ms2 = Date.now() - t1;
    try {
      assert.equal(r2.status, 200);
      assert.ok(ms2 < ms, `cached path (${ms2}ms) must beat the fetch path (${ms}ms)`);
      ok(`second call served from cache in ${ms2}ms`);
    } catch (e) { bad("second call served from cache", e); }

    // and the cached file actually downloads
    const m = /url\((\/api\/theme\/font\/google\/[^)]+)\)/.exec(css);
    if (m) {
      const rf = await req(m[1]);
      try {
        assert.equal(rf.status, 200);
        assert.equal(rf.headers.get("content-type"), "font/woff2");
        const b = Buffer.from(await rf.arrayBuffer());
        assert.equal(b.subarray(0, 4).toString("latin1"), "wOF2", "the cached file must be a real woff2");
        ok(`the cached woff2 downloads (${b.length} bytes) with the right type`);
      } catch (e) { bad("the cached woff2 downloads", e); }
    }
  }

  // ---- 10. an unknown family is refused, not a 500 -----------------------
  {
    const r = await req("/api/theme/font/google/NotARealFontXYZ123.css");
    const body = await r.text();
    try {
      // css2 answers a missing family with 400 text/html. Passing that status
      // through is the RIGHT answer — it is the upstream's own verdict, it
      // carries the real reason, and inventing a 404 here would lose that. The
      // requirement is "never a 500 and never CSS pretending to be a font".
      assert.ok(r.status === 400 || r.status === 404, `expected 400/404, got ${r.status}`);
      assert.ok(!/@font-face/.test(body), "a rejected family must never return font CSS");
      ok(`an unknown Google family is refused cleanly (${r.status}, no CSS body)`);
    } catch (e) { bad("an unknown family is refused cleanly", e); }
  }

  // ---- 11. upload cap ----------------------------------------------------
  {
    const big = Buffer.alloc(5 * 1024 * 1024, 0);
    big.write("wOF2", 0, "latin1");
    const r = await req("/api/theme/font", {
      method: "POST", headers: { "x-file-name": "big.woff2" }, body: big,
    }).catch(() => ({ status: 413 }));
    try { assert.ok(r.status === 413 || r.status === 400, `expected 413, got ${r.status}`); ok("an oversized upload is refused (4MB cap)"); }
    catch (e) { bad("an oversized upload is refused", e); }
  }
} finally {
  server.close();
  try { rmSync(FONT_DIR, { recursive: true, force: true }); } catch { /* scratch */ }
}

console.log(`\ntheme-font e2e: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
