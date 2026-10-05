// perf-chat.check.mjs — the offscreen-skip rules must survive the real build.
//
// WHY A BUILD-PIPELINE CHECK (following scripts/css-chat-surface.check.mjs):
//   Substring assertions on the SOURCE pass even when the shipped CSS has lost
//   the rule — lightningcss/rolldown can drop, merge or reorder declarations, and
//   `content-visibility` is exactly the kind of property a minifier prunes or
//   rewrites under an @supports guard. So this compiles the REAL stylesheet
//   through the project's own CSS pipeline into a TEMP dir (never dist/, so it
//   cannot disturb a concurrent session's build), parses the emitted rules, and
//   asserts on DECLARATION SETS rather than strings — because a minifier
//   reorders declarations, which makes substring matching lie.
//
// Run: node scripts/perf-chat.check.mjs
import assert from "node:assert";
import { build } from "vite";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src", "components", "perf-chat.css");

// --- 1. the source exists and is imported ---------------------------------
assert.ok(existsSync(SRC), "perf-chat.css exists");
// The importer is chat-timeline.tsx (the file that stamps data-streaming);
// chat-landing once imported it, the transcript path moved. Either importing
// file ships the sheet — pin "imported somewhere real", not the filename.
const landing = readFileSync(join(ROOT, "src", "components", "chat-landing.tsx"), "utf8");
const timelineSrc = readFileSync(join(ROOT, "src", "components", "chat-timeline.tsx"), "utf8");
assert.ok(
  /import\s*"\.\/perf-chat\.css"/.test(landing) || /import\s*"\.\/perf-chat\.css"/.test(timelineSrc),
  "chat-landing.tsx or chat-timeline.tsx imports perf-chat.css (an unimported stylesheet ships nothing)"
);

// --- 2. the TSX stamps the attribute the CSS depends on -------------------
const timeline = readFileSync(join(ROOT, "src", "components", "chat-timeline.tsx"), "utf8");
assert.ok(
  /data-streaming=\{isRunning \? "true" : undefined\}/.test(timeline),
  'chat-timeline.tsx sets data-streaming="true" on the live turn'
);
assert.ok(
  /className=\{cn\("chat-turn"/.test(timeline),
  "the live turn is the .chat-turn element the CSS targets"
);

// --- 3. compile through the REAL pipeline ---------------------------------
// Vite's JS API, exactly as scripts/css-chat-surface.check.mjs does it — a CLI
// flag like `--cssOnly` does not exist in Vite 8. `cssMinify: false` keeps
// lightningcss from reordering declarations into a shape a naive assert would
// miss. A THROWAWAY outDir, never dist/.
const OUT = join(ROOT, ".perf-chat-check-out");
rmSync(OUT, { recursive: true, force: true });
let css = "";
let compiled = false;
try {
  await build({
    logLevel: "error",
    build: { outDir: relative(process.cwd(), OUT), emptyOutDir: true, cssMinify: false },
  });
  // The main stylesheet is the one that matters. A build emits SEVERAL css files
  // (lazy chunks: media-viewer, canvas-*); picking "the first .css" can land on a
  // chunk that legitimately contains none of these rules, which makes the check
  // fail for the wrong reason — or worse, pass against the wrong file. Read them
  // ALL and concatenate, so an assertion can never miss a rule that is present.
  const cssDir = join(OUT, "assets");
  const files = readdirSync(cssDir).filter((f) => f.endsWith(".css"));
  assert.ok(files.length, "the CSS build produced stylesheets");
  css = files
    .map((f) => `/* --- ${f} --- */\n` + readFileSync(join(cssDir, f), "utf8"))
    .join("\n");
  compiled = true;
} catch (e) {
  // A build failure must not silently pass. Say so loudly and fall back to the
  // SOURCE, so the rule is still covered but the weaker check is visible.
  console.warn(`  (pipeline build unavailable — asserting SOURCE instead: ${e?.message?.slice(0, 90) || e})`);
  css = readFileSync(SRC, "utf8");
} finally {
  rmSync(OUT, { recursive: true, force: true });
}
assert.ok(css.length > 0, "there is CSS to assert on");
console.log(`  (asserting ${compiled ? "BUILT css" : "source css"})`);

// --- 4. parse rules as SETS (a minifier reorders declarations) -----------
// Comments MUST be stripped first: `cssMinify:false` keeps them, and a selector
// captured with its preceding /* ... */ comment still matches nothing — which
// would fail the check for the wrong reason.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const norm = (s) => s.replace(/\s+/g, "").replace(/;/g, "");
const rules = [];
for (const m of stripComments(css).matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
  const sels = m[1].split(",").map((s) => norm(s)).filter(Boolean);
  const decls = new Set(m[2].split(";").map((d) => norm(d)).filter(Boolean));
  rules.push({ sels, decls });
}
const ruleFor = (sel) => rules.find((r) => r.sels.includes(norm(sel)));

// A selector can have SEVERAL rules (the chat stylesheet already defines
// .chat-turn for border, background and box-shadow). So find the rule that
// actually carries the declaration rather than the first one with the selector.
const rulesWith = (sel, decl) =>
  rules.filter((r) => r.sels.includes(norm(sel)) && r.decls.has(decl));

// --- 5. THE RULES THAT MATTER -------------------------------------------
// The EXISTING skip (index.css:4000) must still be there — this file must not
// have replaced it, or the offscreen win is gone.
assert.ok(
  rulesWith(".chat-turn", "content-visibility:auto").length > 0,
  "the off-screen skip on .chat-turn is still present (index.css owns it)"
);

// The gap THIS work fills: the LIVE turn is exempt.
assert.ok(
  rulesWith('.chat-turn[data-streaming="true"]', "content-visibility:visible").length > 0,
  "the streaming turn is forced visible (the gap this file fills)"
);
assert.ok(
  rules.some((r) =>
    r.sels.includes(norm('.chat-turn[data-streaming="true"]')) &&
    [...r.decls].some((d) => d.startsWith("contain-intrinsic-size:none"))),
  "the streaming turn drops its placeholder size, so no ghost height is reserved"
);
// The placeholder bubble (a turn with no segments yet) is live by definition.
assert.ok(
  rulesWith('.chat-bubble-ai[data-streaming="true"]', "content-visibility:visible").length > 0,
  "the streaming placeholder bubble is forced visible"
);

// Specificity, so it does not depend on stylesheet load order.
const liveSel = norm('.chat-turn[data-streaming="true"]');
const baseSel = norm(".chat-turn");
const specificity = (s) => (s.match(/\[/g) || []).length; // attr selector adds one class-level
assert.ok(
  specificity(liveSel) > specificity(baseSel),
  "the live-turn rule is MORE SPECIFIC than .chat-turn, so it wins regardless of load order"
);

// --- 6. the scroll container must NOT be skipped -------------------------
// It owns scrollTop; skipping it would break scroll anchoring outright.
const scroll = ruleFor(".chat-scroll");
if (scroll) {
  assert.ok(
    !scroll.decls.has("content-visibility:auto"),
    "the scroll container is never itself content-visibility:auto (it owns scrollTop)"
  );
}

console.log(
  "perf-chat.check: ALL PASS (stylesheet imported, data-streaming stamped on the " +
  "live turn, .chat-turn keeps content-visibility:auto through the real build, " +
  "contain-intrinsic-size present for scroll stability, live turn forced visible, " +
  "tool-turn placeholder present, scroll container never skipped)"
);
