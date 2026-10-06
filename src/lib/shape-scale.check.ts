// shape-scale.check.ts — guards the corner-style engine.
//
// The defect class this pins: a shape setting that only moves SOME of the app.
// The scale has two consumers that can silently disagree —
//   1. hand-written CSS reading --shape-N / --radius-inner|outer|pill, and
//   2. 199 `rounded-*` Tailwind utilities in TSX, which resolve to Tailwind's
//      OWN --radius-* namespace,
// and forgetting (2) yields a half-transformed app: the setting visibly works
// on some components and not others, which reads as a broken feature rather
// than a missing mapping. Both are asserted here.
//
// Node cannot load .tsx, so this reaches .ts (repo lesson 2026-10-03).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(__dirname, "../index.css"), "utf8");

// ---- 1. the scale itself -------------------------------------------------

test("the six roundedness steps exist and derive from the multiplier", () => {
  for (let i = 1; i <= 6; i++) {
    const re = new RegExp(`--shape-${i}\\s*:\\s*calc\\(\\s*(\\d+)px\\s*\\*\\s*var\\(--shape-scale\\)`);
    const m = re.exec(CSS);
    assert.ok(m, `--shape-${i} must derive from --shape-scale`);
    assert.ok(Number(m[1]) > 0, `--shape-${i} base must be a real length`);
  }
});

test("the steps are MONOTONIC — a scale that is not ordered renders wrong at one end", () => {
  const vals: number[] = [];
  for (let i = 1; i <= 6; i++) {
    const m = new RegExp(`--shape-${i}\\s*:\\s*calc\\(\\s*(\\d+)px`).exec(CSS);
    vals.push(Number(m![1]));
  }
  for (let i = 1; i < vals.length; i++) {
    assert.ok(vals[i]! > vals[i - 1]!, `--shape-${i + 1} (${vals[i]}px) must exceed --shape-${i} (${vals[i - 1]}px)`);
  }
});

test("`--shape-full` defaults to 0px, NOT 9999px", () => {
  // Load-bearing: with 9999px as the default, every consumer would need a manual
  // opt-out to avoid pill mode. At 0px, pill mode is a toggle of one token and
  // anything that must never pill simply references a --shape-N step.
  const rootBlock = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf("\n}", CSS.indexOf(":root {")));
  const m = /--shape-full\s*:\s*([^;]+);/.exec(rootBlock);
  assert.ok(m, "--shape-full must be declared in :root");
  assert.equal(m[1]!.trim(), "0px", "the DEFAULT must be 0px so pill is opt-in");
});

// ---- 2. BOTH consumers move (the half-transformed trap) -------------------

test("Tailwind's own radius namespace is mapped onto the scale", () => {
  // Without this the 199 rounded-* utilities keep stock 6/8/12/16px and the
  // setting works on hand-written CSS only.
  for (const t of ["sm", "md", "lg", "xl", "2xl"]) {
    const re = new RegExp(`--radius-${t}\\s*:\\s*([^;]+);`);
    const m = re.exec(CSS);
    assert.ok(m, `--radius-${t} must be redefined (Tailwind's stock value would ignore the mode)`);
    assert.match(m[1]!, /var\(--shape-|calc\(.*var\(--shape-scale\)/, `--radius-${t} must derive from the shape scale, got: ${m[1]}`);
  }
});

test("the SIZED steps carry max(), so circle mode pills real controls", () => {
  // The gap this pins: mapping the steps but NOT composing max() means a chip
  // gets 6px in circle mode and never pills. That is a setting that visibly
  // half-works — the worst failure mode, because it looks implemented.
  for (const t of ["md", "lg", "xl", "2xl"]) {
    const m = new RegExp(`--radius-${t}\\s*:\\s*([^;]+);`).exec(CSS);
    assert.match(m![1]!, /max\(/, `--radius-${t} must use max(…, --shape-full) to pill, got: ${m![1]}`);
  }
  // --radius-sm is the exception: 2px is an optical detail, and a pill on it
  // reads as a blob. It must still move with the multiplier, just not pill.
  const sm = /--radius-sm\s*:\s*([^;]+);/.exec(CSS);
  assert.match(sm![1]!, /var\(--shape-scale\)/, "--radius-sm must still scale");
  assert.ok(!/max\(/.test(sm![1]!), "--radius-sm must NOT pill (2px optical detail)");
});

test("PANEL steps stay off the pill idiom on purpose", () => {
  // --radius-inner/outer back cards and surfaces. 9999px on a wide, short card
  // is a stadium, not a pill, so these must reference a STEP, not max().
  // Asserted as an explicit decision so a future "make everything pill" edit
  // has to argue with this line rather than silently breaking cards.
  for (const t of ["inner", "outer"]) {
    const m = new RegExp(`--radius-${t}\\s*:\\s*([^;]+);`).exec(CSS);
    assert.ok(m![1]!.includes("var(--shape-"), `--radius-${t} must alias the scale`);
    assert.ok(!/max\(/.test(m![1]!), `--radius-${t} must NOT pill — a card is not a control`);
  }
});

// ---- 2b. THE NO-REGRESSION PROPERTY -------------------------------------
//
// The defect this pins is the one that would have shipped silently: aliasing
// the three legacy tokens onto scale steps that resolve to DIFFERENT values.
// The engine looked correct in every mode, and yet the DEFAULT mode would have
// shrunk every card and panel in the app — a shape feature that changes the
// product before the user touches a single control. Pre-engine values, measured
// from the stylesheet this replaced:
//   --radius-inner 0.75rem = 12px
//   --radius-outer 1rem    = 16px
//   --radius-pill  10px
//   --radius-md/lg/xl/2xl  = Tailwind's own 6/8/12/16px
// At `rounded` (scale 1) every one of those must resolve to the SAME number.
const PRE_ENGINE: Record<string, number> = {
  "radius-inner": 12,
  "radius-outer": 16,
  "radius-sm": 2,
  "radius-md": 6,
  "radius-lg": 8,
  "radius-xl": 12,
  "radius-2xl": 16,
};

test("`rounded` is PIXEL-IDENTICAL to pre-engine CSS", () => {
  for (const [name, want] of Object.entries(PRE_ENGINE)) {
    const m = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(CSS);
    assert.ok(m, `${name} must exist`);
    const d = /calc\(\s*(\d+)px\s*\*\s*var\(--shape-scale\)/.exec(m![1]!);
    assert.ok(d, `${name} must be scale-derived to be checkable, got: ${m![1]}`);
    assert.equal(Number(d![1]), want, `${name} at scale 1 must be ${want}px, not ${d![1]}px`);
  }
  // --radius-pill keeps its 10px in non-pill modes; the max() only raises it.
  const pill = /--radius-pill\s*:\s*([^;]+);/.exec(CSS)![1]!;
  const pd = /max\(\s*calc\(\s*(\d+)px\s*\*\s*var\(--shape-scale\)\)/.exec(pill);
  assert.ok(pd, "--radius-pill must keep a scale-derived base inside max()");
  assert.equal(Number(pd![1]), 10, "--radius-pill base must stay 10px, not adopt a step value");
});

test("`rounded` is the DEFAULT, so a first-time visitor sees unchanged CSS", () => {
  const rootBlock = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf("\n}", CSS.indexOf(":root {")));
  assert.match(rootBlock, /--shape-scale\s*:\s*1\s*;/, "the default scale must be 1 (unmodified)");
  assert.match(rootBlock, /--shape-full\s*:\s*0px\s*;/, "the default must not be a pill");
  // And no mode selector may match the default, or restoring is ambiguous.
  const modes = [...CSS.matchAll(/:root\[data-shape="(\w+)"\]\s*\{([^}]*)\}/g)];
  const def = modes.find((m) => /--shape-scale\s*:\s*1\s*;\s*--shape-full\s*:\s*0px\s*;/.test(m[2]!.replace(/\s+/g, " ").replace(/\s*;\s*/g, ";")));
  assert.ok(def, "a `rounded` mode must exist and match the :root default exactly");
});

test("rounded-full maps to --shape-full, not Tailwind's baked 2147483647px", () => {
  // Tailwind emits `.rounded-full{border-radius:2147483647px}` as a LITERAL when
  // --radius-full is undefined. That literal happens to look like a pill, but it
  // ignores the mode entirely and cannot be overridden by it.
  const m = /--radius-full\s*:\s*([^;]+);/.exec(CSS);
  assert.ok(m && /var\(--shape-full\)/.test(m[1]!), `--radius-full must be var(--shape-full), got ${m?.[1]}`);
});

test("the legacy radius tokens are ALIASES, not independent literals", () => {
  // This is what makes ~35 existing consumers move with the mode for free.
  for (const t of ["inner", "outer", "pill"]) {
    const m = new RegExp(`--radius-${t}\\s*:\\s*([^;]+);`).exec(CSS);
    assert.ok(m, `--radius-${t} must exist`);
    assert.match(m[1]!, /var\(--shape-|max\(/, `--radius-${t} must alias the scale, got: ${m[1]}`);
  }
});

test("the scale values that DO survive are the shape ones", () => {
  assert.ok(!/--radius-(inner|outer)\s*:\s*[\d.]+(px|rem)\s*;/.test(CSS),
    "a literal px/rem here means the alias was replaced by a fixed value again");
});

// ---- 3. the three modes exist and differ --------------------------------

test("all three shape modes are declared on :root", () => {
  const found: Record<string, { scale: string; full: string }> = {};
  for (const m of CSS.matchAll(/:root\[data-shape="(\w+)"\]\s*\{([^}]*)\}/g)) {
    found[m[1]!] = {
      scale: /--shape-scale\s*:\s*([^;]+)/.exec(m[2]!)?.[1]?.trim() ?? "",
      full: /--shape-full\s*:\s*([^;]+)/.exec(m[2]!)?.[1]?.trim() ?? "",
    };
  }
  for (const mode of ["sharp", "rounded", "circle"]) {
    assert.ok(found[mode], `--root[data-shape="${mode}"] must be declared`);
  }
  // sharp is SMALL NON-ZERO: a bare 0 reads as broken rather than deliberate.
  assert.notEqual(found.sharp!.scale, "0", "sharp must use small non-zero steps, not a literal 0");
  assert.equal(found.rounded!.scale, "1", "rounded is the unmodified scale");
  assert.equal(found.rounded!.full, "0px", "rounded is not a pill");
  assert.equal(found.circle!.full, "9999px", "circle flips --shape-full");
  assert.equal(found.circle!.scale, "1", "circle must NOT scale up — a pill is not scale x huge");
});

// ---- 4. the runtime store ------------------------------------------------

test("the runtime only accepts the closed set", () => {
  // jsdom-free: the store reads/writes document, so assert the CONTRACT in
  // source rather than executing it — the DOM behaviour is covered by the CSS
  // assertions above and by the browser.
  const src = readFileSync(resolve(__dirname, "./theme-store.ts"), "utf8");
  const m = /SHAPE_MODES\s*=\s*new Set<ShapeMode>\(\[([^\]]+)\]\)/.exec(src);
  assert.ok(m, "SHAPE_MODES must be a closed set");
  for (const mode of ["sharp", "rounded", "circle"]) {
    assert.ok(m[1]!.includes(`"${mode}"`), `${mode} must be in the closed set`);
  }
  assert.ok(!/SHAPE_MODES\s*=\s*new Set<ShapeMode>\([^)]*(as|any)/.test(src), "no widening casts");
});

test("shape is persisted and restored pre-paint", () => {
  const store = readFileSync(resolve(__dirname, "./theme-store.ts"), "utf8");
  assert.match(store, /LS_SHAPE\s*=\s*"astra-shape"/, "shape needs its own storage key");
  assert.match(store, /export function restoreShape/, "restoreShape must exist for the boot path");
  const main = readFileSync(resolve(__dirname, "../main.tsx"), "utf8");
  assert.match(main, /restoreShape\(\)/, "main.tsx must call restoreShape or the setting flashes the default");
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
  assert.match(html, /astra-shape/, "index.html must pre-paint the attribute or the setting flashes");
});

test("shape is wired into cross-device sync on both sides", () => {
  const store = readFileSync(resolve(__dirname, "./theme-store.ts"), "utf8");
  assert.match(store, /astra-shape-change/, "local changes must broadcast");
  assert.match(store, /shape\?: ShapeMode \| null/, "the sync payload must carry shape");
  const server = readFileSync(resolve(__dirname, "../../server/theme-sync.mjs"), "utf8");
  assert.match(server, /body\.shape === "sharp"/, "the server must validate shape, not trust it");
});
