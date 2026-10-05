// Syntax highlighting for `code` / `diff` / `terminal` blocks — a LAZY chunk.
//
// WHY THIS IS ITS OWN MODULE: shiki's TextMate engine plus even one grammar is
// far bigger than a whole ordinary card. `canvas-blocks.tsx` imports this
// through `lazy(() => import("./canvas-code-hl"))`, so a report with no code
// block never fetches a byte of it, and the main chunk does not grow.
//
// FINE-GRAINED, NOT THE `shiki` BARREL: `import … from "shiki"` pulls the whole
// language registry. Here the core is `createHighlighterCore`, the regex engine
// is `@shikijs/engine-javascript` (~12 kB total, no WASM), and each LANGUAGE is
// its own dynamic import — so a card that only shows SQL pays for SQL alone.
//
// THEMED BY CSS VARIABLES, NEVER HEX: `createCssVariablesTheme` makes shiki
// emit `var(--code-<token>, <default>)` for every token. The defaults below are
// what a card renders if a token is missing; the real values live in index.css
// (declared in BOTH the root and the light scope), so a light/dark switch or a
// palette change retints code WITHOUT re-running the highlighter.
//
// The highlighter is a singleton: several code blocks in one card must share one
// engine instance, and re-creating it per block would re-tokenise the grammar.
import { createHighlighterCore, createCssVariablesTheme } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// The token set is the union of what a report actually shows. Defaults are
// theme ROLE names where the canvas already has one, so an undefined variable
// still lands on a colour the card's theme understands.
const THEME = createCssVariablesTheme({
  name: "astra",
  variablePrefix: "--code-",
  fontStyle: true,
  variableDefaults: {
    "token-foreground": "var(--color-brandtext)",
    "token-comment": "var(--color-muted)",
    "token-string": "var(--color-emerald)",
    "token-number": "var(--color-amber)",
    "token-keyword": "var(--color-accent)",
    "token-function": "var(--color-accent)",
    "token-type": "var(--color-emerald)",
    "token-variable": "var(--color-brandtext)",
    "token-constant": "var(--color-amber)",
    "token-punctuation": "var(--color-muted)",
    "token-tag": "var(--color-redx)",
    "token-attr": "var(--color-amber)",
  },
});

/** Grammar per supported language. Each entry is its OWN chunk; the barrel
 *  `@shikijs/langs` is ~8.4 MB on disk and must never be imported. */
const LANGS: Record<string, () => Promise<{ default: unknown }>> = {
  typescript: () => import("@shikijs/langs/typescript"),
  tsx: () => import("@shikijs/langs/tsx"),
  javascript: () => import("@shikijs/langs/javascript"),
  jsx: () => import("@shikijs/langs/jsx"),
  json: () => import("@shikijs/langs/json"),
  python: () => import("@shikijs/langs/python"),
  bash: () => import("@shikijs/langs/bash"),
  shell: () => import("@shikijs/langs/bash"),
  sql: () => import("@shikijs/langs/sql"),
  css: () => import("@shikijs/langs/css"),
  html: () => import("@shikijs/langs/html"),
  diff: () => import("@shikijs/langs/diff"),
};

/** What the author wrote vs what a grammar is called. Models emit all of these. */
const ALIAS: Record<string, string> = {
  ts: "typescript", js: "javascript", node: "javascript", "c++": "cpp", c: "cpp",
  py: "python", sh: "bash", zsh: "bash", shell: "bash", console: "bash",
  yml: "yaml", htm: "html", md: "markdown", golang: "go", rs: "rust",
};

/** Normalise an author-supplied language tag to a grammar we ship, else null. */
export function resolveLang(language?: string): string | null {
  if (!language) return null;
  const raw = language.trim().toLowerCase();
  const name = ALIAS[raw] ?? raw;
  return name in LANGS ? name : null;
}

type Highlighter = {
  codeToHtml: (code: string, o: { lang: string; theme: string }) => string;
  loadLanguage: (l: unknown) => Promise<void>;
  getLoadedLanguages: () => string[];
};

let pending: Promise<Highlighter> | null = null;

/** The engine, created once. `langs: []` + lazy loadLanguage is what keeps the
 *  always-loaded cost to the core: a grammar arrives only when a card uses it. */
function engine(): Promise<Highlighter> {
  if (!pending) {
    pending = createHighlighterCore({
      themes: [THEME],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    }) as unknown as Promise<Highlighter>;
  }
  return pending;
}

/**
 * Highlight `code` to HTML, or return null when it cannot be done.
 *
 * FAIL-SOFT IS THE CONTRACT: an unknown language, a missing grammar or a
 * tokenizer throw all return null, and the caller renders the current bare
 * `<pre><code>` it rendered before. Highlighting is an enhancement — it must
 * never be the reason a card fails to paint.
 */
export async function highlight(code: string, language?: string): Promise<string | null> {
  const lang = resolveLang(language);
  if (!lang) return null;
  try {
    const hl = await engine();
    if (!hl.getLoadedLanguages().includes(lang)) {
      const loader = LANGS[lang];
      // A failed grammar import must not poison the shared engine promise.
      await Promise.resolve(loader()).then((m) => hl.loadLanguage(m.default)).catch(() => {});
    }
    if (!hl.getLoadedLanguages().includes(lang)) return null;
    return hl.codeToHtml(code, { lang, theme: "astra" });
  } catch {
    return null;
  }
}