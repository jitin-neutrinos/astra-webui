// In-page capture: every element's computed colour-bearing properties, its box,
// and its ::before/::after/::placeholder pseudo-elements. Pure function so it can
// be passed to page.evaluate(). Elements marked [data-theme-engine-new] (UI the
// feature adds on purpose) are skipped and counted separately.

export const PROPS = [
  "color", "backgroundColor", "backgroundImage", "borderTopColor", "borderRightColor",
  "borderBottomColor", "borderLeftColor", "outlineColor", "boxShadow", "textShadow",
  "filter", "backdropFilter", "fill", "stroke", "stopColor", "floodColor",
  "lightingColor", "caretColor", "accentColor", "textDecorationColor",
  "columnRuleColor", "scrollbarColor", "opacity", "webkitTextFillColor",
  "webkitTextStrokeColor", "borderImageSource", "mixBlendMode", "colorScheme",
  "backgroundBlendMode", "maskImage",
];

export function captureInPage(PROPS) {
  const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "META", "HEAD", "TITLE", "NOSCRIPT", "BASE"]);
  const out = {};
  let skippedNew = 0;
  const read = (cs) => PROPS.map((p) => cs[p]).join("\u241f");
  const short = (el) => el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "");
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10).join(",");
  };
  const visit = (el, path) => {
    if (SKIP.has(el.tagName)) return;
    if (el.hasAttribute("data-theme-engine-new")) { skippedNew++; return; }
    const cs = getComputedStyle(el);
    out[path] = { s: short(el), r: rectOf(el), c: read(cs) };
    for (const ps of ["::before", "::after"]) {
      const pcs = getComputedStyle(el, ps);
      if (pcs.content && pcs.content !== "none" && pcs.content !== "normal") out[path + ps] = { s: short(el) + ps, r: "", c: read(pcs) };
    }
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const pcs = getComputedStyle(el, "::placeholder");
      out[path + "::placeholder"] = { s: short(el) + "::placeholder", r: "", c: read(pcs) };
    }
    let i = 0;
    for (const ch of el.children) {
      if (SKIP.has(ch.tagName) || ch.hasAttribute("data-theme-engine-new")) { if (ch.hasAttribute("data-theme-engine-new")) skippedNew++; continue; }
      visit(ch, `${path}/${ch.tagName.toLowerCase()}${i++}`);
    }
  };
  visit(document.documentElement, "html");
  return { map: out, skippedNew, theme: document.documentElement.getAttribute("data-theme") || "dark" };
}

/** Compare two snapshot maps; returns [{key, sel, prop, a, b}] (colour props) and layout diffs. */
export function diffSnapshots(a, b) {
  // Chrome serializes rgb(var(--c)/a) computed values as color(srgb r g b / a);
  // literals as rgba(...). Same color, different spelling -> normalize before diff.
  const norm = (v) => v.replace(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/g,
    (_, r, g, b, al) => {
      const to255 = (x) => Math.round(Number(x) * 255);
      const a2 = al === undefined ? "" : `, ${Number(al).toFixed(3).replace(/\.?0+$/, "") || "0"}`;
      return `rgba(${to255(r)}, ${to255(g)}, ${to255(b)}${a2})`;
    });
  const diffs = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k], y = b[k];
    if (!x || !y) { diffs.push({ key: k, sel: (x || y).s, prop: x ? "<missing in candidate>" : "<missing in baseline>", a: "", b: "" }); continue; }
    if (x.c !== y.c) {
      const xa = x.c.split("\u241f"), ya = y.c.split("\u241f");
      PROPS.forEach((p, i) => { if (norm(xa[i]) !== norm(ya[i])) diffs.push({ key: k, sel: x.s, prop: p, a: xa[i], b: ya[i] }); });
    }
    if (x.r !== y.r) diffs.push({ key: k, sel: x.s, prop: "<layout rect>", a: x.r, b: y.r });
  }
  return diffs;
}
