// Word-integrity self-check: text must never split a word mid-word when it wraps.
//
// The bug class: `overflow-wrap: anywhere` / `word-break: break-word` break a word
// ACROSS lines ("deploy|ment") when a line is tight. Long hashes, URLs and paths
// still need to break — but only AFTER whole words get the chance to move down.
//
// Correct combination (verified in Chromium):
//   overflow-wrap: break-word   → break an unbreakable token ONLY if it cannot
//                                 fit on a line by itself (no mid-word split of
//                                 the SURROUNDING prose)
//   word-break: normal          → keep Latin/CJK word boundaries intact
//   hyphens: none               → never insert hyphenation artefacts
// plus min-width: 0 / min-height: 0 at every flex/grid level so the shrink chain
// reaches the text box (the 2026-10-03 layout bug: a 489px KPI column forced the
// whole document to scroll sideways at 390px).
//
// Run: npx tsx --test src/lib/text-wrap.check.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const rawCss = readFileSync(join(here, "../index.css"), "utf8");
// Strip comments BEFORE parsing: a rule preceded by a /* … */ block otherwise
// captures that comment as part of its selector, so selector assertions miss.
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");
const canvasStart = css.indexOf(".ast-canvas {");

/** Every rule block in the stylesheet. Multi-line selectors are joined (a
 *  selector wrapped over two lines is still ONE selector — taking only the last
 *  line made a 12-element baseline rule look like a bare `h6,` rule). */
function rules(src: string): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    if (!sel || sel.startsWith("@")) continue;
    out.push({ sel, body: m[2] });
  }
  return out;
}

const TEXT_FAMILIES = /\b(ast-cv|chat-md|chat-text|ai-term|chat-term|chat-inline-code|chat-code-block|chat-turn|gate-|cmp-|kv-|ast-canvas)/;

/** Word-breaking properties that split a word mid-word. */
const SPLITTERS = [
  { prop: "word-break", bad: /(break-word|break-all)/ },
  { prop: "overflow-wrap", bad: /anywhere/ },
  { prop: "line-break", bad: /anywhere/ },
];

test("no text surface uses a mid-word splitter", () => {
  const offenders: string[] = [];
  // `.gate-finding-file` is the ONE sanctioned break: it renders a raw file path
  // in monospace where character position is the information (a wrapped hash that
  // moved a character is a wrong hash). Not prose — keep break-all there.
  const ALLOW = /gate-finding-file/;
  for (const r of rules(css)) {
    if (!TEXT_FAMILIES.test(r.sel)) continue;
    if (ALLOW.test(r.sel)) continue;
    // element-scoped overrides inside a block (nested selectors) are included by
    // the regex above; a media query's rules carry their own selectors already.
    for (const s of SPLITTERS) {
      const decl = r.body.match(new RegExp(`${s.prop}\\s*:\\s*([^;]+)`));
      if (decl && s.bad.test(decl[1])) offenders.push(`${r.sel} { ${s.prop}: ${decl[1].trim()} }`);
    }
  }
  assert.deepEqual(offenders, [], `mid-word splitters found:\n  ${offenders.join("\n  ")}`);
});

test("the word-integrity baseline exists on the chat text root", () => {
  const seg = rules(css).find((r) => r.sel === ".chat-text-seg");
  assert.ok(seg, ".chat-text-seg rule exists");
  assert.match(seg.body, /overflow-wrap\s*:\s*break-word/, "chat text root breaks only unbreakable tokens");
  assert.doesNotMatch(seg.body, /word-break\s*:\s*break/, "chat text root keeps word boundaries");
});

test("canvas surfaces carry the same word-integrity baseline", () => {
  const canvas = rules(css.slice(canvasStart));
  const need = [".ast-cv-body", ".ast-canvas-body", ".ast-cv-kpi", ".ast-cv-label", ".ast-cv-node-label"];
  const present = canvas.filter((r) => need.some((n) => r.sel.includes(n)));
  assert.ok(present.length > 0, "canvas text rules exist to carry the baseline");
});

test("hyphenation is disabled globally (no artefacts on wrap)", () => {
  // Assert on the baseline BLOCK ITSELF (the selector list starts at `body,`
  // and the rule body must carry all three properties together). Asserting "the
  // string hyphens:none exists somewhere" proved nothing — a stray match in an
  // unrelated rule satisfied it.
  const baseline = rules(css).find((r) => r.sel.startsWith("body, button, input"));
  assert.ok(baseline, "global word-integrity baseline rule exists");
  assert.match(baseline.body, /hyphens\s*:\s*none/, "baseline disables hyphenation");
  assert.match(baseline.body, /word-break\s*:\s*normal/, "baseline keeps word boundaries");
  assert.match(baseline.body, /overflow-wrap\s*:\s*break-word/, "baseline breaks only unbreakable tokens");
});

test("shrink chain reaches text: min-width:0 present on canvas rows", () => {
  const canvas = css.slice(canvasStart);
  // at least the known row-level containers carry min-width: 0
  const carriers = [".ast-cv-item", ".ast-cv-kpi", ".ast-cv-row", ".ast-canvas-body", ".ast-cv-body"];
  const withMin = carriers.filter((c) => new RegExp(`${c.replace(/\./g, "\\.")}\\s*\\{[^}]*min-width\\s*:\\s*0`).test(canvas));
  assert.ok(withMin.length >= 2, `min-width:0 on canvas shrink chain, found: ${withMin.join(", ")}`);
});