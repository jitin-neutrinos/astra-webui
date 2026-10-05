// Syntax-highlighting contract (canvas v1 expansion).
//
// Three properties this pins, in order of how badly they hurt when broken:
//
//   1. THEMEABLE. shiki must emit ONLY `var(--code-…)` colour values. A single
//      painted hex in the token output is a block that ignores the theme engine,
//      and the canvas-theme audit cannot see it (it reads index.css, not output).
//   2. FAIL-SOFT. An unknown language, a missing grammar, a tokenizer throw or a
//      pathological payload must return null so the caller renders the bare
//      <pre> it always rendered. Highlighting may never be why a card is blank.
//   3. LAZY. The module must not be reachable from the eager canvas path: a card
//      with no code block must not fetch shiki.
//
// Run: npx tsx --test src/lib/canvas-code-hl.check.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { highlight, resolveLang } from "../components/canvas/canvas-code-hl.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("every painted colour in shiki output is a CSS variable — never a hex", async () => {
  const html = await highlight("const x: number = 1; // note\nconsole.log(`v=${x}`);", "ts");
  assert.ok(html, "typescript must highlight");
  // Every `style="…"` and every `color:` inside the output must be var()-based.
  const painted = [...html.matchAll(/(?:color|background(?:-color)?)\s*:\s*([^;"]+)/g)].map((m) => m[1].trim());
  assert.ok(painted.length > 0, "the output paints something");
  for (const v of painted) {
    assert.match(v, /var\(--code-|var\(--color-/, `painted value is not a CSS var: ${v}`);
    assert.doesNotMatch(v, /#[0-9a-fA-F]{3,8}\b/, `hardcoded hex leaked into the output: ${v}`);
  }
  assert.match(html, /var\(--code-/, "tokens ride the --code- namespace");
});

test("the --code-* tokens are declared in BOTH the dark and the light scope", () => {
  const css = readFileSync(join(here, "../index.css"), "utf8");
  // The two scopes are REAL blocks; matching text alone would accept declarations
  // that sit outside any selector (a bug this file shipped once: the dark tokens
  // were appended to the line that CLOSES the light block, so light mode was the
  // only mode that had them and the dark defaults silently resolved to nothing).
  const blocks = (selector: string) =>
    [...css.matchAll(new RegExp(`(?:^|\\n)\\s*${selector}\\s*\\{`, "g"))]
      .map((m) => m.index!)
      .map((at) => {
        let depth = 0;
        for (let i = css.indexOf("{", at); i < css.length; i++) {
          if (css[i] === "{") depth++;
          else if (css[i] === "}") { depth--; if (depth === 0) return css.slice(at, i + 1); }
        }
        return css.slice(at);
      });
  const names = (s: string) => new Set([...s.matchAll(/--code-[a-z-]+\s*:/g)].map((m) => m[0].replace(/\s*:/, "")));
  const dark = [...blocks(":root")].join("\n");
  const light = [...blocks('\\[data-theme="light"\\]')].join("\n");
  const darkNames = names(dark);
  assert.ok(darkNames.size >= 13, `the DARK scope declares the token set (found ${darkNames.size})`);
  const lightNames = names(light);
  for (const n of darkNames) {
    assert.ok(lightNames.has(n), `light scope is missing ${n} — that mode would paint an undefined var`);
  }
  // The canvas audit forbids hardcoded hex AFTER .ast-canvas{, so the tokens must
  // live in the theme scopes and never in the canvas rules.
  const canvasStart = css.indexOf(".ast-canvas {");
  const canvasRegion = css.slice(canvasStart).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(canvasRegion, /--code-[a-z-]+\s*:\s*#[0-9a-fA-F]{3}/, "a --code-* token declared with a hex inside the canvas scope");
});

test("unknown languages resolve to null (the caller keeps its bare <pre>)", () => {
  assert.equal(resolveLang("brainfuck"), null);
  assert.equal(resolveLang(""), null);
  assert.equal(resolveLang(undefined), null);
  assert.equal(resolveLang("not-a-language"), null);
  // The near-miss names models actually emit MUST resolve.
  assert.equal(resolveLang("ts"), "typescript");
  assert.equal(resolveLang("TypeScript"), "typescript");
  assert.equal(resolveLang("py"), "python");
  assert.equal(resolveLang("sh"), "bash");
  assert.equal(resolveLang("js"), "javascript");
  assert.equal(resolveLang("python"), "python");
});

test("fail-soft: unknown lang, no lang, empty and huge payloads never throw", async () => {
  assert.equal(await highlight("x", "brainfuck"), null);
  assert.equal(await highlight("x"), null);
  assert.equal(await highlight("", undefined), null);
  // A 200 kB payload must return (null or html), never throw into the card.
  // NOTE: `assert.doesNotThrow(async …)` does NOT await — the rejection would
  // escape the assertion entirely, which is the bug this test is here to catch.
  let out: string | null = null;
  await assert.doesNotReject(() => highlight("const a=1;\n".repeat(14000), "ts").then((r) => { out = r; }));
  assert.ok(out === null || typeof out === "string", "a 200 kB payload resolves to html or null");
  // A syntax-error-laden but valid-language source still highlights: the JS regex
  // engine runs in `forgiving` mode, so bad source degrades to plain tokens instead
  // of throwing. Measured — this returns html, which is the whole point of
  // `forgiving: true`.
  const broken = await highlight("def f(:\n  ???", "python");
  assert.ok(broken, "a broken grammar input still returns html (forgiving engine), never a throw");
  assert.ok(!/<\/span>\s*undefined/.test(broken!), "no undefined leaks into the token output");
});

test("the highlighter is LAZY — no eager import of the engine from the canvas path", () => {
  const src = readFileSync(join(here, "../components/canvas/canvas-blocks.tsx"), "utf8");
  // canvas-blocks is statically imported by the gate path; a static `from
  // "shiki"` / `from "./canvas-code-hl"` there would put the engine in the main
  // chunk. The only legal reference is the dynamic import() inside the effect.
  assert.doesNotMatch(src, /^\s*import[^\n]*canvas-code-hl/m, "canvas-code-hl must not be statically imported");
  assert.doesNotMatch(src, /from\s+["']shiki["']/, "the shiki barrel must never be imported by canvas-blocks");
  assert.match(src, /import\(["']\.\/canvas-code-hl["']\)/, "the engine is reached through a dynamic import()");
  // The barrel is the trap: it pulls every grammar. The fine-grained module must
  // import @shikijs/core + the JS engine and pull grammars one at a time.
  // Strip comments first: the module's own header NAMES the bare barrel in prose
  // ("`import … from \"shiki\"` pulls the whole language registry"), and a text
  // scan that does not strip comments flags the explanation as the defect.
  const hl = readFileSync(join(here, "../components/canvas/canvas-code-hl.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  // The barrel is the trap: it pulls every grammar. The fine-grained module must
  // import @shikijs/core + the JS engine and pull grammars one at a time. Only
  // the SUB-PATH `shiki/engine/javascript` is legal (the regex engine).
  const bareShiki = [...hl.matchAll(/from\s+["'](shiki(?:\/[^"']*)?)["']/g)].map((m) => m[1]);
  for (const spec of bareShiki) {
    assert.notEqual(spec, "shiki", "the shiki barrel must never be imported (it bundles every grammar)");
    assert.match(spec, /^shiki\/engine\/javascript$/, `only the shiki JS regex engine may come from the barrel: ${spec}`);
  }
  assert.match(hl, /createHighlighterCore/, "fine-grained core, not the barrel");
  assert.match(hl, /createJavaScriptRegexEngine/, "the JS regex engine, not oniguruma WASM");
  assert.match(hl, /@shikijs\/langs\//, "grammars are per-language dynamic imports");
  assert.doesNotMatch(hl, /from\s+["']@shikijs\/langs["']/, "the @shikijs/langs barrel is ~8.4 MB — never import it");
});