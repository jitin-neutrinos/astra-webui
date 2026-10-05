// mobile-canvas-audit.mjs — the MOBILE canvas measurement probe (2026-10-05).
//
// WHAT THIS IS FOR
//   Every canvas block type is rendered at 360 / 390 / 412 px, in DARK and in
//   LIGHT, in a real Chromium, and its geometry is read off the live DOM. The
//   numbers this prints are the only evidence that a phone layout is right:
//   reading CSS tells you what was intended, not what painted.
//
// HOW IT WORKS
//   1. `src/lib/probe-canvas-mobile.probe.tsx` is bundled as its own tiny vite app
//      (lib mode, IIFE) OUT of the repo's dist/ — one fixture per block type,
//      each inside a real `.chat-turn`, each parsed by the REAL
//      `parseCanvasSpec`. Vite, not esbuild: this repo has no esbuild package.
//   2. The bundle is served over HTTP (a module script on file:// is blocked),
//      with a 1×1 PNG and a tiny MP4 so `image` / `gallery` / `video` measure
//      their real layout instead of the "unavailable" fallback.
//   3. Per viewport × theme, the page is walked and every block is measured.
//
// WHAT IS MEASURED (per block, per viewport)
//   overflow   scrollWidth - clientWidth on the block root and on every
//              descendant: a positive value means real user-scrollable bleed
//              unless the element IS the scroll container (by design).
//   tinyText   any painted text node whose computed font-size is < 11px.
//   tap        any a / button / input / select / [role=button|switch] / summary
//              whose rect is under 24px in either axis (WCAG 2.2 2.5.8).
//   paint      charts/diagrams/gitgraph/graph: counted rects / paths / circles —
//              an empty chart trivially "does not clip", so a chart that painted
//              NOTHING is reported as a defect, not as a pass.
//   tableWide  a table whose intrinsic width exceeds its scroll container.
//   katex      a `.katex-display` wider than its `.ast-cv-math` scroll box.
//   gitgraph   row height, label box width vs the svg viewBox (legibility).
//   treeDepth  the deepest indent and the px each level costs.
//   layoutCols the resolved column count of `.ast-cv-layout` (1-col reflow).
//   scrollable  every scroll container found (proof a wide surface CAN be
//              scrolled rather than clipped).
//
// USAGE
//   node scripts/mobile-canvas-audit.mjs                 # measure + report
//   node scripts/mobile-canvas-audit.mjs --json out.json # machine-readable
//   node scripts/mobile-canvas-audit.mjs --keep <dir>     # keep the harness
//   node scripts/mobile-canvas-audit.mjs --widths 360,390 # subset of widths
//
// EXIT CODES
//   0 = every measured defect class is empty (and the measurement set is NOT
//       empty — a green audit with zero measurements is a lie, see the
//       "denominator" guard below).
//   1 = at least one defect class non-empty; the report says which, per block
//       type and per viewport.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, cpSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROBE = "src/lib/probe-canvas-mobile.probe.tsx";
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : d; };
const JSON_OUT = arg("json", "");
const KEEP = arg("keep", "");
const WIDTHS = String(arg("widths", "360,390,412")).split(",").map(Number).filter((n) => n > 0);
const PORT = Number(arg("port", 3291));
const CHROME = process.env.CHROME || "";

const MIN_FONT = 11;      // px — the floor the owner asked for on phone widths
const MIN_TAP = 24;       // px — WCAG 2.2 target size
const CHAR_W = 0.62;      // rough mono advance, for "how much text fits" reports

// ── 1. build the harness ──────────────────────────────────────────────────────
const WORK = KEEP ? KEEP : mkdtempSync(join(tmpdir(), "cv-mobile-"));
mkdirSync(WORK, { recursive: true });
const { build } = await import("vite");
await build({
  root: ROOT,                                  // the REPO root: the probe entry
  configFile: join(ROOT, "vite.config.ts"),    // must be the app's own config
  logLevel: "error",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: join(WORK, "dist"),
    emptyOutDir: true,
    lib: { entry: join(ROOT, PROBE), formats: ["iife"], name: "MobileProbe", fileName: () => "probe.js", cssFileName: "probe" },
  },
});

const dist = join(WORK, "dist");
const jsName = readdirSync(dist).find((f) => f.endsWith(".js"));
const cssName = readdirSync(dist).find((f) => f.endsWith(".css"));
if (!jsName || !cssName) { console.error(`probe bundle incomplete (js=${jsName} css=${cssName})`); process.exit(2); }
// Serve over HTTP: a module script on file:// is refused by CORS, and the
// bundle's own dynamic-import chunks need a real origin too.
writeFileSync(join(dist, "index.html"),
  `<!doctype html><html data-theme="dark"><head><meta charset="utf-8">
   <meta name="viewport" content="width=device-width, initial-scale=1">
   <link rel="stylesheet" href="./${cssName}"></head>
   <body><div id="root"></div>
   <script>window.__PROBE_ORIGIN = location.origin;</script>
   <script src="./${jsName}"></script></body></html>`);

// 1×1 PNG + a 1-frame MP4 so the media blocks paint their real geometry.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");
const MP4 = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAr1tZGF0AAACrgYF//+q3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE0OCByMjU0MyA1YzY1MSAwYzEwMAovf4//+2f7//AAQ0bAAAd6AtwAAAAABJRU5ErkJggg==",
  "base64");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".mp4": "video/mp4", ".woff2": "font/woff2", ".woff": "font/woff" };
const FONTS = join(ROOT, "public", "fonts");
const server = createServer(async (req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  if (p === "/pixel.png") { res.writeHead(200, { "content-type": "image/png" }); res.end(PNG); return; }
  if (p === "/pixel.mp4") { res.writeHead(200, { "content-type": "video/mp4" }); res.end(MP4); return; }
  // The REAL brand fonts. Every canvas surface stacks on var(--font-sans), and a
  // fallback face is a different size — measuring without these reports defects
  // the app does not have (and hides ones it does).
  if (p.startsWith("/fonts/")) {
    try { const b = readFileSync(join(FONTS, p.slice(7))); res.writeHead(200, { "content-type": "font/woff2" }); res.end(b); }
    catch { res.writeHead(404); res.end(); }
    return;
  }
  let f = join(dist, p === "/" ? "index.html" : p);
  try { if (!statSync(f).isFile()) throw 0; } catch { f = join(dist, "index.html"); }
  try { const b = readFileSync(f); res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream", "cache-control": "no-store" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${PORT}`;

// ── 2. the in-page measurement pass ───────────────────────────────────────────
// Everything below runs INSIDE the page. It is plain JS on purpose: playwright's
// evaluate callback cannot carry TypeScript.
function measureInPage(opts) {
  // ONE options object, passed as ONE argument. Passing an array and reading it
  // as three parameters is silent: MIN_TAP became undefined, every
  // `height < NaN` comparison was false, and the audit reported ZERO tap
  // defects on a page full of 14px controls.
  const { MIN_FONT, MIN_TAP, CHAR_W } = opts;
  if (!(MIN_TAP > 0) || !(MIN_FONT > 0) || !(CHAR_W > 0)) throw new Error("measureInPage: thresholds must be numbers, got " + JSON.stringify(opts));
  const q = (s, r) => Array.from((r ?? document).querySelectorAll(s));
  const px = (v) => Math.round(v * 10) / 10;
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const desc = (el) => {
    const bits = [];
    let n = el;
    for (let i = 0; n && n !== document.body && i < 4; i++, n = n.parentElement) {
      if (!n.tagName) continue;
      bits.push(n.tagName.toLowerCase() + (n.className && typeof n.className === "string" && n.className.trim()
        ? "." + n.className.trim().split(/\s+/).slice(0, 2).join(".") : ""));
    }
    return bits.join(" < ");
  };
  // An element is a BY-DESIGN scroll container if it declares the axis itself.
  const scrolls = (el, axis) => {
    const s = getComputedStyle(el);
    return axis === "x" ? /(auto|scroll)/.test(s.overflowX) : /(auto|scroll)/.test(s.overflowY);
  };
  // "Contained" means SOME ancestor takes the overflow on this axis, so the user
  // can reach the content by scrolling. A wide <pre> inside an overflow-x:auto
  // body is fine; the same <pre> with no scrollable ancestor is a clip.
  const contained = (el, card) => {
    let n = el.parentElement;
    while (n && n !== card) { if (scrolls(n, "x")) return true; n = n.parentElement; }
    return false;
  };
  // SVG children have no layout box of their own (clientWidth is 0), so a
  // scrollWidth on a <text>/<g> is an artefact of SVG, not a bleed. And an
  // absolutely positioned layer (an icon swap, an animation veil) overflowing
  // its box is a deliberate overlay, not content the user cannot reach.
  const notRealBleed = (el) => el.namespaceURI === "http://www.w3.org/2000/svg"
    || getComputedStyle(el).position === "absolute"
    || getComputedStyle(el).position === "fixed"
    || !!el.closest(".katex-mathml, svg");
  async function measureSection(section) {
    const id = section.dataset.probe;
    const card = section.querySelector(".ast-canvas");
    if (!card) return { id, painted: 0, error: "no card" };
    // `.chat-turn` carries `content-visibility: auto`, so an off-screen turn is
    // NOT laid out: its responsive charts measure 0×0 and paint nothing until
    // the browser lays it out. Scroll it in and give React two frames to
    // re-render before reading geometry — otherwise the audit reports the
    // blank-chart signature for every chart on the page.
    section.scrollIntoView({ block: "center" });
    await frame(); await frame();
    const rec = {
      id,
      authored: Number(section.dataset.authored || 0),
      kept: Number(section.dataset.kept || 0),
      painted: Number(section.dataset.painted || 0),
      cardWidth: px(card.clientWidth),
      docOverflow: px(document.documentElement.scrollWidth - document.documentElement.clientWidth),
      overflow: [], tinyText: [], tap: [], paint: {}, tables: [], katex: null,
      gitgraph: null, treeDepth: null, layoutCols: [], scrollables: [],
      error: section.dataset.specError || undefined,
    };
    // ── horizontal overflow that NOTHING above it can scroll ───────────────
    // The element ITSELF counts: `.ast-cv-code-body` is the scroll container,
    // so its own scrollWidth > clientWidth is the design working, not a bleed.
    // A ZERO-WIDTH box does not count: nivo's ResponsiveWrapper emits two
    // nested 0px divs around its svg, and a scrollWidth on those is an artefact
    // of an empty box, not content the user cannot reach (verified by
    // screenshot: the sankey fits its card at 360px with the reported dx=236).
    for (const el of q("*", card)) {
      const dx = el.scrollWidth - el.clientWidth;
      if (dx <= 1 || el.clientWidth < 1) continue;
      if (scrolls(el, "x") || contained(el, card)) continue;
      if (notRealBleed(el)) continue;
      if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) continue;   // native scroll-by-keystroke
      rec.overflow.push({ sel: desc(el), dx: px(dx), w: px(el.clientWidth) });
    }
    // ── painted text under the floor ────────────────────────────────────────
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          const text = (t.textContent || "").trim();
          if (!text) continue;
          // A zero-width space is NOT painted text. katex emits U+200B inside its
          // MathML twin at 1px to keep the two renderings aligned; reporting those
          // as "sub-11px text" was 54 of the findings and none of them is a glyph.
          if (/^[\u200b\u200c\u200d\u2060\ufeff\s]+$/.test(text)) continue;
          const parent = t.parentElement;
          if (!parent) continue;
          const cs = getComputedStyle(parent);
          if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
          if (parent.closest(".ast-cv-code-body, pre, .katex-mathml")) continue;  // code scrolls; mathml is the a11y twin
          const size = parseFloat(cs.fontSize);
          if (size < 10.99) rec.tinyText.push({ sel: desc(parent), size: px(size), text: text.slice(0, 28) });
        }
    // ── tap targets ─────────────────────────────────────────────────────────
    for (const el of q("a,button,input,select,summary,[role=button],[role=switch],[role=tab]", card)) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;                  // not laid out
      if (Math.min(r.width, r.height) < MIN_TAP - 0.5) {
        rec.tap.push({ sel: desc(el), w: px(r.width), h: px(r.height) });
      }
    }
    // ── painting, per drawing surface ───────────────────────────────────────
    const paintOf = (root, sels) => {
      if (!root) return null;
      const shapes = q(sels.join(","), root).filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0.5 && r.height > 0.5;
      });
      return shapes.length;
    };
    rec.paint.charts = q(".ast-cv-chart", card).map((f, i) => ({
      i,
      title: (f.querySelector(".ast-cv-chart-title") || {}).textContent || "",
      h: px(f.getBoundingClientRect().height),
      shapes: paintOf(f, ["rect", "path", "circle", "line", "polygon"]) ?? 0,
    }));
    for (const [key, root, sels] of [
      ["diagram", section.querySelector(".ast-cv-dg-svg"), ["rect", "path", "circle", "line", "text"]],
      ["gitgraph", section.querySelector(".ast-cv-git-svg"), ["rect", "path", "circle", "line", "text"]],
      ["graph", section.querySelector(".ast-cv-graph-canvas, .ast-cv-graph svg"), ["rect", "path", "circle", "line", "text"]],
      ["heatmap", section.querySelector(".ast-cv-heat-grid"), ["div, span"]],
    ]) {
      const n = paintOf(root, sels);
      if (n != null) rec.paint[key] = n;
    }
    // cytoscape paints on a <canvas>, so a node count has to come from the
    // library, not the DOM: an empty canvas is 0×0 in the rect sweep.
    const cy = section.querySelector(".ast-cv-graph-canvas");
    if (cy) {
      const g = cy.__cvCytoscape;
      rec.paint.graph = g && typeof g.nodes === "function" ? g.nodes().length : (cy.clientWidth > 0 ? -1 : 0);
      rec.paint.graphSource = g ? "cytoscape" : "canvas-only";
    }
    // ── tables wider than the card (they must be scrollable, not clipped) ───
    for (const t of q(".ast-cv-table, .ast-cv-sheet-table", card)) {
      const wrap = t.parentElement;
      const intr = t.scrollWidth, box = wrap ? wrap.clientWidth : 0;
      if (intr > box + 1) {
        rec.tables.push({ sel: desc(t), intrinsic: px(intr), box: px(box),
          scrollable: wrap ? scrolls(wrap, "x") : false,
          stickyFirst: !!(wrap && wrap.querySelector("td:first-child, th:first-child") &&
            ["sticky", "fixed"].includes(getComputedStyle(wrap.querySelector("td:first-child, th:first-child")).position)) });
      }
    }
    // ── KaTeX: a display formula wider than its scroll box must not clip ────
    const math = section.querySelector(".ast-cv-math");
    if (math) {
      const k = math.querySelector(".katex-display, .katex");
      const cs = getComputedStyle(math);
      rec.katex = {
        contentW: k ? px(k.scrollWidth) : 0,
        boxW: px(math.clientWidth),
        scrollableX: /(auto|scroll)/.test(cs.overflowX),
        hasKatex: !!k,
      };
    }
    // ── gitgraph legibility ─────────────────────────────────────────────────
    const git = section.querySelector(".ast-cv-git-svg");
    if (git) {
      const vb = (git.getAttribute("viewBox") || "0 0 0 0").split(/\s+/).map(Number);
      const msgs = q(".ast-cv-git-msg", git);
      const cy2 = msgs.map((m) => Number(m.getAttribute("y")) || 0);
      const rowH = cy2.length > 1 ? Math.min(...cy2.slice(1).map((y, i) => Math.abs(y - cy2[i]))) : 0;
      const fpx = (sel) => { const m = section.querySelector(sel); return m ? px(parseFloat(getComputedStyle(m).fontSize)) : 0; };
      rec.gitgraph = {
        viewW: px(vb[2]), viewH: px(vb[3]),
        rows: msgs.length,
        rowH: px(rowH),
        msgFontPx: fpx(".ast-cv-git-msg"),
        metaFontPx: fpx(".ast-cv-git-meta"),
        tagFontPx: fpx(".ast-cv-git-tag"),
        // The svg is laid out at its natural viewBox width; the card clips it to
        // cardWidth, so this is how many characters of a row are actually VISIBLE.
        charsFitting: px(rec.cardWidth / CHAR_W),
        scrollableX: (() => { const f = git.closest(".ast-cv-git"); return f ? scrolls(f, "x") : false; })(),
      };
    }
    // ── tree depth ──────────────────────────────────────────────────────────
    const trees = q(".ast-cv-tree-kids", card);
    if (trees.length) {
      let deepest = 0, cost = 0;
      let n = trees[0];
      while (n && n.classList.contains("ast-cv-tree-kids")) {
        deepest++; cost += parseFloat(getComputedStyle(n).marginLeft) || 0; n = n.parentElement;
      }
      rec.treeDepth = { levels: deepest, indentPx: px(cost), cardW: px(card.clientWidth) };
    }
    // ── layout columns: a phone must reflow to 1 ─────────────────────────────
    for (const l of q(".ast-cv-layout", card)) {
      const cs = getComputedStyle(l);
      const cols = cs.gridTemplateColumns !== "none"
        ? cs.gridTemplateColumns.split(" ").filter((s) => s && s !== "auto").length
        : parseInt(cs.columnCount || "1", 10);
      rec.layoutCols.push({ mode: (l.className.match(/ast-cv-layout (\w+)/) || [])[1] || "?", cols, width: px(l.clientWidth),
        cells: Array.from(l.querySelectorAll(":scope > .ast-cv-layout-cell")).map((c) => px(c.getBoundingClientRect().width)) });
    }
    // ── every scroll container (proof a wide surface CAN be scrolled) ───────
    for (const el of q("*", card)) {
      if (scrolls(el, "x") && el.scrollWidth > el.clientWidth + 1) {
        rec.scrollables.push({ sel: desc(el), scrollW: px(el.scrollWidth), clientW: px(el.clientWidth) });
      }
    }
    return rec;
  }
  return (async () => {
    const out = [];
    for (const section of q("[data-probe]")) out.push(await measureSection(section));
    return out;
  })();
}

// ── 3. drive the browser ──────────────────────────────────────────────────────
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
const report = { widths: WIDTHS, themes: ["dark", "light"], generatedAt: new Date().toISOString(), blocks: [], pageErrors: [], consoleErrors: [] };
for (const theme of report.themes) {
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    page.on("pageerror", (e) => report.pageErrors.push(`${theme}/${width}: ${String(e.message).slice(0, 200)}`));
    page.on("console", (m) => { if (m.type() === "error") report.consoleErrors.push(`${theme}/${width}: ${m.text().slice(0, 160)}`); });
    // Freeze motion so the stagger animations do not measure mid-flight.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.setAttribute("data-theme", "dark");
      });
    });
    await page.goto(ORIGIN + "/", { waitUntil: "load" });
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForFunction(() => (window).__probeReady === true, null, { timeout: 30_000 });
    // Let every lazy chunk resolve: the fixtures are Suspense-wrapped, so an
    // impatient read measures skeletons.
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("[data-probe]")).every((s) => s.dataset.painted !== undefined),
      null, { timeout: 60_000 },
    );
    await page.evaluate(() => {
      document.querySelectorAll("*").forEach((el) => { el.getAnimations?.().forEach((a) => { try { a.finish(); } catch { a.pause(); } }); });
    });
    await page.waitForTimeout(600);
    await page.evaluate(async () => {
      // force `content-visibility: auto` to keep every turn laid out for the
      // whole sweep: the audit measures geometry, and skipping layout is a
      // browser optimisation, not a canvas property.
      const s = document.createElement("style");
      s.textContent = ".chat-turn { content-visibility: visible !important; }";
      document.head.appendChild(s);
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    const measured = await page.evaluate(measureInPage, { MIN_FONT, MIN_TAP, CHAR_W });
    for (const m of measured) report.blocks.push({ theme, width, ...m });
    await page.close();
  }
}
await browser.close();
server.close();
if (!KEEP) { try { cpSync(dist, join(WORK, "kept"), { recursive: true }); } catch { /* best effort */ } }

// ── 4. report ────────────────────────────────────────────────────────────────
const isDefect = (b) => {
  const d = [];
  if (b.error) d.push(`spec:${b.error}`);
  if (b.painted === 0) d.push("painted 0 blocks (blank card)");
  if (b.authored > 0 && b.kept === 0) d.push("parser dropped every block");
  if (b.overflow.length) d.push(`h-overflow ${b.overflow.length} (max ${Math.max(...b.overflow.map((o) => o.dx))}px)`);
  if (b.tinyText.length) d.push(`text <${MIN_FONT}px ${b.tinyText.length}`);
  if (b.tap.length) d.push(`tap <${MIN_TAP}px ${b.tap.length}`);
  if (b.tables.some((t) => !t.scrollable)) d.push("table wider than card, NOT scrollable");
  if (b.katex && b.katex.hasKatex && b.katex.contentW > b.katex.boxW + 1 && !b.katex.scrollableX) d.push("katex overflow, not scrollable");
  for (const [key, sel] of Object.entries(b.paint)) {
    if (typeof sel === "number") { if (sel === 0) d.push(`${key} painted nothing`); }
  }
  for (const c of b.paint.charts || []) if (c.shapes === 0) d.push(`chart[${c.i}] "${c.title.slice(0, 22)}" painted nothing`);
  // A composed layout on a phone must be ONE column: `repeat(n, …)` at 360px
  // packs a chart, a callout and three KPI tiles into sub-120px tracks, so the
  // cells stop being readable at all (measured: every KPI cell collapsed to
  // 30px wide with its label clipped). More than one track is a defect; the
  // cell width is reported because "1 track" alone would miss the empty-track
  // case where a phantom track is still sized.
  for (const l of b.layoutCols || []) {
    if (l.cols > 1) d.push(`${l.mode} has ${l.cols} tracks at ${b.width}px (cells ${Math.min(...(l.cells || [0]))}px)`);
  }
  return d;
};

const defects = report.blocks.filter((b) => isDefect(b).length > 0).map((b) => ({ ...b, defects: isDefect(b) }));
// Denominator guard: a green report with nothing measured is a lie.
if (report.blocks.length < 10) {
  console.error(`FAIL: only ${report.blocks.length} measurements — the harness measured nothing`);
  process.exit(2);
}
const ids = new Set(report.blocks.map((b) => b.id));
console.log(`mobile-canvas-audit: ${ids.size} block types × ${report.widths.join("/")}px × ${report.themes.join("/")} = ${report.blocks.length} measurements`);
console.log(`page errors: ${report.pageErrors.length} · console errors: ${report.consoleErrors.length}`);
if (report.pageErrors.length) console.log("  " + report.pageErrors.slice(0, 5).join("\n  "));

const byBlock = new Map();
for (const d of defects) {
  const cur = byBlock.get(d.id) || { id: d.id, hits: [] };
  cur.hits.push(`${d.theme}/${d.width}: ${d.defects.join("; ")}`);
  byBlock.set(d.id, cur);
}
if (!byBlock.size) {
  console.log(`PASS: zero defects across ${report.blocks.length} measurements`);
} else {
  console.log(`DEFECTS in ${byBlock.size}/${ids.size} block types:`);
  for (const [, v] of [...byBlock].sort()) {
    console.log(`\n  ${v.id}`);
    for (const h of v.hits.slice(0, 12)) console.log(`    - ${h}`);
  }
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
if (KEEP) console.log(`\nharness kept at ${KEEP}`);
else console.log(`\nharness at ${WORK} (probe bundle: ${WORK}/dist)`);
process.exit(defects.length ? 1 : 0);