// row-inline.check.ts — sidebar sub-line rendering invariants (owner 10-06).
// Assert-based, no framework (repo convention).
import { inlineMarkdownHtml, isCanvasPreview, isGreetPreview } from "./row-inline";

let pass = 0, fail = 0;
function eq(actual: unknown, expected: unknown, name: string) {
  if (actual === expected) { pass++; }
  else { fail++; console.error(`FAIL ${name}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`); }
}

// escaping FIRST — model output is untrusted
eq(inlineMarkdownHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;", "html escaped");
// inline emphasis converts
eq(inlineMarkdownHtml("**Built**: today"), "<strong>Built</strong>: today", "bold");
eq(inlineMarkdownHtml("use `npm run check`"), "use <code>npm run check</code>", "code");
eq(inlineMarkdownHtml("*soft* edge"), "<em>soft</em> edge", "italic");
// links reduce to text (not tappable at 10.5px)
eq(inlineMarkdownHtml("[docs](https://x.io)"), "docs", "link → text");
// fence body collapses
eq(inlineMarkdownHtml("before ```\ncode\n``` after"), "before … after", "fence collapsed");
// proxy 220-char cut can strip a closer — dangling marker dropped, not painted
eq(inlineMarkdownHtml("value is **bold until cut"), "value is bold until cut", "dangling ** dropped");
eq(inlineMarkdownHtml("run it with `npm ru"), "run it with npm ru", "dangling ` dropped");
// paired markers inside intact text survive
eq(inlineMarkdownHtml("a `x` b **y** c"), "a <code>x</code> b <strong>y</strong> c", "pairs intact");
// canvas + greet detectors
eq(isCanvasPreview('```astra-canvas {"v":1}'), true, "canvas fence detected");
eq(isCanvasPreview("plain text"), false, "plain not canvas");
eq(isGreetPreview("New chat just started. Greet me briefly…"), true, "greet detected");
eq(isGreetPreview("A real reply."), false, "reply not greet");
// whitespace collapse (markdown newlines inside one truncated line are noise)
eq(inlineMarkdownHtml("line one\nline two"), "line one line two", "newlines collapsed");

console.log(`# pass ${pass}\n# fail ${fail}`);
if (fail > 0) process.exit(1);
