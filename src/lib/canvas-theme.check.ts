// Theme/token coverage audit — self-check that every canvas colour routes through
// theme-var indirection, and that the light scope defines (never self-references) the accent.
// Run: npx tsx --test src/lib/canvas-theme.check.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../index.css"), "utf8");

test("light scope defines the accent role literally (may not self-reference)", () => {
  // The bug this pins: the theme-compliance pass wrote the light accent as
  // `--color-cyanx: var(--color-cyanx)` — a SELF-REFERENCE that resolves to
  // nothing, so every accent-derived surface (bubbles, KPI values, chart strokes,
  // buttons) went colourless in light mode and color-mix() props on it collapsed
  // to transparent. The role is now `--color-accent` and must be a real value.
  const light = css.slice(css.indexOf('[data-theme="light"]'));
  const role = light.match(/--color-accent:\s*([^;]+);/);
  assert.ok(role, "light accent role declared");
  assert.ok(
    /^#[0-9a-fA-F]{6}$/.test(role![1].trim()),
    `light --color-accent must be a literal colour, got: ${role![1].trim()}`,
  );
  assert.ok(!/--color-accent:\s*var\(--color-accent\)/.test(light), "self-referential light accent found");
  // The dark role too — a self-reference there would be just as invisible.
  const dark = css.match(/--color-accent:\s*([^;]+);/);
  assert.ok(dark && /^#[0-9a-fA-F]{6}$/.test(dark![1].trim()), `dark --color-accent is literal, got: ${dark?.[1]}`);
});

test("components consume the accent ROLE, never the hue name", () => {
  // The hue slot (--color-cyanx) is the theme engine's STORAGE name — palettes.json
  // and the tokenizer annotations own it. Everything that PAINTS reads the role.
  //
  // Collect PAINTED values only: a declaration's value on the right of a colour
  // property. Matching the var() anywhere in the file was vacuous — the role's own
  // definition legitimately reads it, so the test passed while a component could
  // still paint the hue. (Proved: injecting `color: var(--color-cyanx)` into a
  // canvas rule kept this green before the value-level extraction.)
  const PAINT = /(?:^|[;{])\s*(?:color|background(?:-color)?|border(?:-[a-z]+)?-color|stroke|fill|box-shadow|outline-color|caret-color|text-decoration-color)\s*:\s*([^;{}\n]+)/gm;
  const painted = [...css.matchAll(PAINT)].map((m) => m[1].trim()).filter(Boolean);
  assert.ok(painted.length > 50, `sheet paints colours (found ${painted.length})`);

  // NO painted value may name the hue slot at all — not even with a fallback
  // (`var(--color-cyanx, …)`). The role definition is a custom-property
  // declaration, not a painted value, so it is not in this set.
  const bypass = painted.filter((v) => /var\(--color-cyanx/.test(v));
  assert.deepEqual(bypass, [], `painted values bypassing the accent role:\n  ${bypass.join("\n  ")}`);

  // The role must exist in BOTH scopes as a REAL value (not a self-reference, not
  // a var of the hue slot — the slot lives outside @theme so no utility can be
  // generated from it, and the role is what utilities derive from).
  const roleDecl = (src: string) => src.match(/--color-accent:\s*([^;]+);/)?.[1]?.trim();
  const dark = roleDecl(css);
  assert.ok(dark && /^#[0-9a-fA-F]{6}$/.test(dark), `dark accent role is a literal colour, got: ${dark}`);
  const light = css.slice(css.indexOf('[data-theme="light"]'));
  const lightRole = roleDecl(light);
  assert.ok(lightRole && /^#[0-9a-fA-F]{6}$/.test(lightRole), `light accent role is a literal colour, got: ${lightRole}`);
  assert.notEqual(dark, lightRole, "light and dark accents differ (the light one is darkened for contrast)");
  // The storage slot still exists for the theme engine, outside @theme.
  assert.match(css, /--color-cyanx:\s*#[0-9a-fA-F]{6}/, "storage slot still declared for the theme engine");
  // And NO cyanx utility class can exist (the slot is not a @theme token).
  // Strip comments before inspecting @theme — matching the bare word flagged the
  // explanatory comment that NAMES the slot, not an actual declaration.
  const rawTheme = css.slice(css.indexOf("@theme"), css.indexOf("\n}", css.indexOf("@theme")) + 2);
  const themeBlock = rawTheme.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(
    !/--color-cyanx\s*:/.test(themeBlock),
    "the hue slot must stay OUT of @theme or Tailwind emits *-cyanx utilities that paint by hue name",
  );
  assert.ok(/--color-accent\s*:/.test(themeBlock), "the accent ROLE must be a @theme token so utilities exist");
  // The accent must actually be USED — a role nobody paints is a dead token.
  assert.ok(painted.filter((v) => /var\(--color-accent\)/.test(v)).length > 50, "accent role is painted throughout");
});

test("the palette engine repaints the accent role per palette", () => {
  const store = readFileSync(join(here, "theme-store.ts"), "utf8");
  assert.match(
    store,
    /setProperty\("--color-accent"/,
    "applyPalette must set --color-accent or a non-default palette paints the default hue",
  );
  assert.match(
    store,
    /role === "accent" \? source\["--color-cyanx"\]/,
    'channel vars annotated `accent` must resolve to the palette\'s --color-cyanx',
  );
});

test("canvas scope: no hardcoded hex in any painted value (comments + var fallbacks excepted)", () => {
  const start = css.indexOf(".ast-canvas {");
  const region = css.slice(start);
  // Strip comments first so annotated tokens don't false-positive.
  const code = region.replace(/\/\*[\s\S]*?\*\//g, "");
  // Extract only painted values: everything after a ':' until ';' or '}', plus
  // color-mix args. A hex here must be a var() fallback.
  for (const m of code.matchAll(/[:,\s](#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}))(?=[\s;,)])/g)) {
    const before = code.slice(Math.max(0, (m.index ?? 0) - 80), m.index ?? 0);
    const isFallback = /var\((?:[^()]|\([^()]*\))*$/.test(before) || /,[^)]*$/.test(before) && before.includes("var(");
    if (isFallback) continue;
    assert.fail(`hardcoded hex ${m[1]} painted in canvas CSS near: …${before.replace(/\s+/g, " ").slice(-60)}`);
  }
});

test("canvas CSS carries no coloured edge rails (owner law 3)", () => {
  const start = css.indexOf(".ast-canvas {");
  const region = css.slice(start).replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of region.matchAll(/([^{}]+)\{[^}]*border-left/g)) {
    const sel = m[1].trim().split("\n").pop()!.trim().slice(-70);
    const structural = /ast-cv-tl|ast-cv-tree/.test(m[1]);
    if (!structural) assert.fail(`edge-rail selector: ${sel}`);
  }
});

test("unroled channel vars are neutrals or the 12 documented role-carrying exceptions", () => {
  // Discovery 2026-10-04: 50/171 channels unroled (commit 08ea62f2's "29 neutrals"
  // claim was wrong — re-measured). Neutrals stay fixed by design; the non-neutral
  // ones below sit in status/overlay/login roles the engine deliberately leaves.
  const allowed = new Set([
    "--c-14", "--c-38", "--c-39", "--c-42", "--c-43", "--c-45", "--c-47", "--c-81",
    "--c-114", "--c-115", "--c-120", "--c-188",
  ]);
  // neutral() allows a small cast (slate greys ride Δ36 on hue-invariant RGB;
  // measured sat ≤ 8 misses slate-400/500). What the check actually guards is a
  // saturated ACCENT leaking unroled, which rides Δ > 60.
  const neutral = (t: string) => {
    const [r, g, b] = t.split(" ").map(Number);
    return Math.max(r, g, b) - Math.min(r, g, b) <= 40;
  };
  // roleOf: --r-c-N or --r-light-c-N annotation = the engine re-points this channel.
  const roled = new Set(
    [...css.matchAll(/^\s*--r-(?:light-)?(c-\d+):/gm)].map((m) => m[1]),
  );
  const offenders: string[] = [];
  for (const m of css.matchAll(/^\s*--c-(\d+):\s*(\d+ \d+ \d+);/gm)) {
    const name = `--c-${m[1]}`;
    if (roled.has(`c-${m[1]}`)) continue;
    if (neutral(m[2]) || allowed.has(name)) continue;
    offenders.push(`${name} = ${m[2]}`);
  }
  assert.deepEqual(offenders, [], `unroled saturated channels leaked: ${offenders.join(", ")}`);
});
