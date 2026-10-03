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

test("light scope defines the accent literally (may not self-reference)", () => {
  const light = css.slice(css.indexOf('[data-theme="light"]'));
  const decl = light.match(/--color-cyanx:\s*([^;]+);/);
  assert.ok(decl, "light accent declared");
  const v = decl![1].trim();
  assert.ok(
    /^#[0-9a-fA-F]{6}$/.test(v) || /^rgb\(/.test(v) || v.startsWith("var(--c-"),
    `light --color-cyanx must be a literal colour, got: ${v} (self-reference var(--color-cyanx) resolves to nothing)`,
  );
  assert.ok(!/--color-cyanx:\s*var\(--color-cyanx\)/.test(light), "self-referential light accent found");
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
