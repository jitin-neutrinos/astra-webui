// canvas-text-integrity.check.ts — pins defects 3 and 4: a KPI delta clipped
// mid-word with no ellipsis ("+38m" instead of "+38ms"), and the general rule that
// no canvas surface may clip a value silently or break a word.
//
// THE DEFECT WAS A DOUBLE DECLARATION. src/index.css shipped TWO rules for
// .ast-cv-kpi-delta — an old `overflow:hidden; text-overflow:ellipsis;
// white-space:nowrap` and a newer `white-space:normal; overflow-wrap:break-word`
// — and the built asset carried both:
//     $ grep -o '\.ast-cv-kpi-delta{[^}]*}' dist/assets/index-*.css
//     .ast-cv-kpi-delta{text-overflow:ellipsis;white-space:nowrap;flex:none;max-width:46%;overflow:hidden}
//     .ast-cv-kpi-delta{...white-space:normal;overflow-wrap:break-word;...display:inline-flex}
// On an inline-flex chip `text-overflow: ellipsis` has NO effect (ellipsis only
// applies to a block container), so the old pair could only ever clip: `nowrap`
// truncated "+38ms" to "+38m" and `overflow:hidden` swallowed the rest with no
// marker. Four sibling selectors shared the same trap via a group rule.
//
// MEASURED in chromium at 360 and 768 (scratch/canvas-v6/nowrap-probe.mjs),
// BEFORE → AFTER, via clientWidth vs scrollWidth on the live element:
//   .ast-cv-kpi-value "412.8ms (trailing twelve months, all regions)"
//       360px: dx=161 → dx=0      768px: dx=174 → dx=0
//   .ast-cv-kpi-value "$4.28M recurring annual revenue run rate"
//       360px: dx=139 → dx=0      768px: dx=225 → dx=0
//   .ast-cv-kpi-label (nowrap+ellipsis at <=480px) : 360px dx=29 → dx=0 (wraps)
//
// Run: npx tsx --test src/lib/canvas-text-integrity.check.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, "../index.css"), "utf8");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
const blocks = readFileSync(join(here, "../components/canvas/canvas-blocks.tsx"), "utf8");

/** Every rule, multi-line selectors joined (see text-wrap.check.ts).
 *  `@media` wrappers are UNWRAPPED and recorded on the rule as `media`, because
 *  the shared helper in text-wrap.check.ts drops the wrapper — which made a
 *  phone-width rule invisible to any assertion that did not know about it. */
function rules(src: string): { sel: string; body: string; media?: string }[] {
  const out: { sel: string; body: string; media?: string }[] = [];
  // Pull the @media prelude out first, then parse the inner block(s).
  const re = /@media[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const prelude = src.slice(m.index, m.index + m[0].length).replace(/\s+/g, " ").trim();
    // Find the matching close brace for this @media.
    let depth = 1, i = m.index + m[0].length;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    const inner = src.slice(m.index + m[0].length, i - 1);
    for (const r of rawRules(inner)) out.push({ ...r, media: prelude });
    re.lastIndex = i;
  }
  // Top-level rules = everything outside any @media, found by blanking the blocks.
  const blanked = src.replace(/@media[^{]*\{[\s\S]*?\n\}/g, (s) => " ".repeat(s.length));
  for (const r of rawRules(blanked)) out.push(r);
  return out;
}

function rawRules(src: string): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    if (!sel || sel.startsWith("@")) continue;
    out.push({ sel, body: m[2] });
  }
  return out;
}
const all = rules(css);

const prop = (body: string, name: string): string | undefined =>
  body.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`))?.[1].trim();

/** Every rule whose selector list names `sel` as a WHOLE element. */
const declaring = (sel: string) =>
  all.filter((r) => r.sel.split(",").map((s) => s.trim()).some((s) => s === sel || s.endsWith(" " + sel)));

// ── defect 3: one authoritative declaration per value surface ───────────────

const VALUE_SURFACES = [
  ".ast-cv-kpi-value",
  ".ast-cv-kpi-delta",
  ".ast-cv-progress-value",
  ".ast-cv-donut-total",
];

for (const sel of VALUE_SURFACES) {
  test(`${sel}: exactly ONE white-space declaration, and it is never nowrap`, () => {
    const ws = declaring(sel).map((r) => prop(r.body, "white-space")).filter(Boolean);
    assert.ok(ws.length > 0, `${sel} declares a white-space somewhere`);
    // The defect itself: two rules, only source order separating them, and the
    // built CSS shipped both.
    assert.equal(ws.length, 1, `${sel} has ${ws.length} white-space declarations (${ws.join(" / ")}) — exactly one is authoritative`);
    assert.notEqual(ws[0], "nowrap", `${sel} must never be nowrap: it clips the tail with no ellipsis`);
  });
}

test(".ast-cv-kpi-delta has no competing overflow/text-overflow pair", () => {
  // The stale half of the pair: `overflow:hidden` + `text-overflow:ellipsis` on
  // an inline-flex chip can only clip (ellipsis is a block-container feature), so
  // neither may come back.
  for (const r of declaring(".ast-cv-kpi-delta")) {
    assert.notEqual(prop(r.body, "text-overflow"), "ellipsis", `no ${r.sel} { text-overflow: ellipsis } — it is inert on the inline-flex chip`);
    assert.notEqual(prop(r.body, "white-space"), "nowrap", `no ${r.sel} { white-space: nowrap }`);
  }
});

test("a long KPI delta wraps by word rather than clipping", () => {
  const g = declaring(".ast-cv-kpi-delta").find((r) => prop(r.body, "overflow-wrap") === "break-word");
  assert.ok(g, ".ast-cv-kpi-delta carries overflow-wrap: break-word");
  assert.equal(prop(g.body, "word-break"), "normal", "word boundaries are kept intact");
  assert.equal(prop(g.body, "hyphens"), "none", "no hyphenation artefacts");
});

test("the KPI label wraps by word instead of ellipsizing on a phone", () => {
  // The <=480px rule used to be nowrap + hidden + ellipsis, which hid 29px of
  // "Net revenue retention, trailing twelve months" at 360px even though the tile
  // had room for a second line. An eyebrow label is short prose — it wraps.
  const mob = all.find((r) => declaring(".ast-cv-kpi-label").includes(r) && r.media && /max-width:\s*480px/.test(r.media));
  assert.ok(mob, "the @media (max-width:480px) .ast-cv-kpi-label rule exists and is visible to this parser");
  assert.notEqual(prop(mob.body, "white-space"), "nowrap", "the phone label is not nowrap");
  assert.notEqual(prop(mob.body, "text-overflow"), "ellipsis", "the phone label does not ellipsize prose");
});

// ── defect 4: the text-integrity audit, extended to canvas surfaces ─────────

// Prose surfaces a model can put a full sentence into. Each must wrap by word.
const PROSE_SURFACES: [string, string][] = [
  [".ast-cv-legend-item", "a chart series name"],
  [".ast-cv-legend-name", "a chart series name (inner span)"],
  [".ast-cv-ref-link", "a reference title"],
  [".ast-cv-ref-note", "a reference note"],
  [".ast-cv-tl-title", "a timeline title"],
  [".ast-cv-cmp-name", "a compare item name"],
  [".ast-cv-table td", "a table cell"],
];

for (const [sel, what] of PROSE_SURFACES) {
  test(`${sel} (${what}) wraps by word, never mid-word`, () => {
    const hit = declaring(sel).filter((r) => prop(r.body, "overflow-wrap") === "break-word");
    assert.ok(hit.length > 0, `${sel} carries overflow-wrap: break-word`);
    for (const r of hit) {
      assert.notEqual(prop(r.body, "overflow-wrap"), "anywhere", `${r.sel}: 'anywhere' breaks a word AND shrinks min-content`);
      if (prop(r.body, "word-break")) {
        assert.equal(prop(r.body, "word-break"), "normal", `${r.sel} keeps word boundaries`);
      }
      if (prop(r.body, "hyphens")) {
        assert.equal(prop(r.body, "hyphens"), "none", `${r.sel} never hyphenates`);
      }
    }
  });
}

test("no canvas surface hides a value with nowrap+hidden and no ellipsis", () => {
  // The silent-clip shape: nowrap + overflow:hidden + text-overflow:clip.
  // `.ast-cv-kv-key` is the one sanctioned exception — it IS a visible ellipsis on
  // a label half of a label:value pair, and its value beside it always shows.
  const SANCTIONED = /\.ast-cv-kv-key$/;
  const offenders: string[] = [];
  for (const r of all) {
    if (!/ast-cv|ast-canvas/.test(r.sel)) continue;
    if (SANCTIONED.test(r.sel.split(",").pop()?.trim() ?? "")) continue;
    if (prop(r.body, "white-space") !== "nowrap") continue;
    const ov = prop(r.body, "overflow"), te = prop(r.body, "text-overflow");
    if ((ov === "hidden" || ov === "clip") && te !== "ellipsis") {
      offenders.push(`${r.sel} { white-space:nowrap; overflow:${ov}; text-overflow:${te} }`);
    }
  }
  assert.deepEqual(offenders, [], `silent clip (nowrap + hidden, no ellipsis):\n  ${offenders.join("\n  ")}`);
});

test("keyvalue values: a mono value breaks as code, a prose value breaks by word", () => {
  const mono = declaring(".ast-cv-kv-val.mono")[0];
  assert.ok(mono, ".ast-cv-kv-val.mono rule exists");
  assert.equal(
    prop(mono.body, "overflow-wrap"),
    "break-word",
    "a path/hash/command has no spaces, so break-word already breaks it as code — and unlike 'anywhere' it does not shrink the box's min-content width (which text-wrap.check.ts refuses for good reason)",
  );
  const prose = declaring(".ast-cv-kv-val").find((r) => !r.sel.includes(".mono"));
  assert.ok(prose, ".ast-cv-kv-val rule exists");
  assert.equal(prop(prose.body, "overflow-wrap"), "break-word", "a prose keyvalue value breaks between words");
});

test("the delta chip gives its text span min-width:0 so it can wrap", () => {
  // The chip is inline-flex; without min-width:0 on the text child the flex item
  // refuses to shrink below its content width and the chip's overflow:hidden clips
  // instead of wrapping. The glyph must stay flex:none (arrow + text together).
  assert.match(
    blocks,
    /className="ast-cv-kpi-delta-text"/,
    "the delta text is its own span (it can then wrap independently of the glyph)",
  );
  const chip = declaring(".ast-cv-kpi-delta").find((r) => prop(r.body, "display") === "inline-flex");
  assert.ok(chip, "the delta chip is inline-flex");
  assert.equal(prop(chip.body, "min-width"), "0", "the chip itself may shrink");
  const glyph = declaring(".ast-cv-kpi-delta-glyph")[0];
  assert.ok(glyph, ".ast-cv-kpi-delta-glyph rule exists");
  assert.equal(prop(glyph.body, "flex"), "none", "the trend glyph never shrinks or wraps");
  const text = declaring(".ast-cv-kpi-delta-text")[0];
  assert.ok(text, ".ast-cv-kpi-delta-text rule exists");
  assert.equal(prop(text.body, "min-width"), "0", "the text span may shrink so the chip wraps by word");
});

test("the legend name may shrink (a long series name cannot widen the card)", () => {
  const item = declaring(".ast-cv-legend-item").find((r) => prop(r.body, "min-width") === "0");
  assert.ok(item, ".ast-cv-legend-item carries min-width:0");
  assert.ok(prop(item.body, "max-width"), ".ast-cv-legend-item is capped so it cannot exceed the card");
  const name = declaring(".ast-cv-legend-name")[0];
  assert.ok(name, ".ast-cv-legend-name rule exists (the series name wraps on its own)");
  assert.equal(prop(name.body, "min-width"), "0");
});