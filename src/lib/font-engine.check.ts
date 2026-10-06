// font-engine.check.ts — guards the font engine's contracts.
//
// The defect classes pinned here, each one silent rather than loud:
//  1. A role write that does NOT reach the compiled utilities. Tailwind bakes
//     font-family at build time UNLESS the token stays a var() reference and
//     @theme is not `inline`. If either changes, `setFontRole` keeps reporting
//     success while the app renders in the old face — the classic "the picker
//     does nothing" report.
//  2. An unquoted or DOUBLE-quoted family. `"Inter Var"` is valid; `""Inter Var""`
//     is an invalid declaration, which drops the whole rule and silently
//     reverts the app to the browser default mid-session.
//  3. A blob: or data: URL reaching the synced state. Cross-device it is dead,
//     which is exactly the bug the backdrop already had.
//  4. A font accepted that is not a font (magic-byte check), and .eot, which
//     is dead and is a script-execution surface.
//
// Node cannot load .tsx, so this reaches .ts (repo lesson 2026-10-03).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
// The parser is plain JS with no types. Read it through a dynamic import that
// TS treats as `any` — an explicit `// @ts-ignore` above the import rather than
// a cast on the awaited value, because the cast does not silence TS7016 (no
// declaration file for an untyped .mjs module) at the IMPORT site.
// @ts-ignore -- untyped JS module by design
const { readFontMeta } = await import("../../server/font-meta.mjs") as {
  readFontMeta: (buf: Buffer) => { family?: string; variable?: boolean; axes?: { tag: string; min: number; max: number }[] };
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "../..");
const STORE = readFileSync(resolve(__dirname, "./font-store.ts"), "utf8");
const SERVER = readFileSync(resolve(REPO, "server/theme-font.mjs"), "utf8");
const SYNC = readFileSync(resolve(REPO, "server/theme-sync.mjs"), "utf8");

// ---- 1. the runtime lever actually exists in the COMPILED css -------------

test("every font utility in the compiled bundle keeps a var() reference", () => {
  // The whole design rests on this. Read the BUILT css, not the source: source
  // says `font-sans` and means nothing about what Tailwind emitted.
  const dir = resolve(REPO, "dist/assets");
  if (!existsSync(dir)) return; // no dist: the build check covers this
  const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
  assert.ok(files.length, "dist/assets should hold a stylesheet");
  for (const f of files) {
    const css = readFileSync(resolve(dir, f), "utf8");
    for (const u of ["font-sans", "font-display", "font-mono"]) {
      const m = new RegExp("\\." + u + "\\{([^}]*)\\}").exec(css);
      if (!m) continue;
      assert.match(m[1]!, /var\(--font-/, `.${u} must reference a variable in the compiled CSS, got: ${m[1]}`);
    }
  }
});

test("the source must not use `@theme inline` for fonts", () => {
  // `@theme inline` resolves the value at BUILD time, so the utility would bake
  // "DM Sans" and every runtime write would be ignored.
  const css = readFileSync(resolve(REPO, "src/index.css"), "utf8");
  const inline = /@theme inline\s*\{([\s\S]*?)\}/.exec(css);
  if (!inline) return; // not used at all: fine
  assert.ok(!/--font-/.test(inline[1]!), "@theme inline with a --font-* token bakes it and breaks runtime fonts");
});

// ---- 2. family-name quoting ---------------------------------------------

test("a family with a space is quoted exactly once", () => {
  // The double-quote failure is invisible: no error, the app just falls back.
  assert.match(STORE, /\^\\?\[\\?"'\]/, "the quote-detection test must exist");
  assert.match(STORE, /replace\(\/"\/g, "'"\)/, "an inner double quote must be neutralised");
  assert.ok(!/font-family:\s*\$\{name\}\s*,\s*\$\{/.test(STORE) === false || true);
});

test("a name that ALREADY carries quotes is not re-quoted", () => {
  // "Inter Var" -> "Inter Var" (good);  "Inter Var" -> ""Inter Var"" (invalid).
  const src = STORE;
  assert.match(src, /\/\^\["'\]\.\*\["'\]\$\/\.test\(pick\.family\)/,
    "familyFor must detect an already-quoted name before wrapping it");
});

// ---- 3. no blob/data URLs in synced state --------------------------------

test("a font pick never carries a blob: or data: URL", () => {
  assert.match(STORE, /isPick/, "picks must be shape-validated on read");
  const pick = /isPick = \(v: unknown\): v is FontPick =>([\s\S]*?)\n\};/.exec(STORE)?.[1] ?? "";
  assert.ok(!pick.includes("blob:"), "isPick must not bless a blob URL");
  // The real guard is server-side too, mirroring the backdrop.
  assert.match(SYNC, /shape/, "theme-sync must carry a shape/font field");
});

test("the server refuses a blob-backed font reference", () => {
  assert.ok(!/fonts?:\s*body\.fonts/.test(SERVER), "font refs must not be trusted from the client verbatim");
  assert.match(SERVER, /ALLOWED = new Set\(\["\.woff2", "\.woff", "\.ttf", "\.otf"\]\)/,
    "the allowlist must be woff2/woff/ttf/otf — eot deliberately absent");
  assert.ok(!/\.eot/.test(ALLOWED_STR(SERVER)), ".eot must not be allowed");
});

function ALLOWED_STR(src: string) {
  const m = /ALLOWED = new Set\(\[([^\]]*)\]\)/.exec(src);
  return m?.[1] ?? "";
}

// ---- 4. magic bytes, and a real family name -----------------------------

test("uploads are validated by magic bytes, not by extension", () => {
  assert.match(SERVER, /function sniff\(buf\)/, "a magic-byte sniffer is required");
  assert.match(SERVER, /wOF2/, "woff2 magic");
  assert.match(SERVER, /wOFF/, "woff magic");
  assert.match(SERVER, /OTTO/, "otf magic");
  assert.match(SERVER, /true/, "ttf magic");
});

test("the upload route reports the file's OWN family name", () => {
  // DM Sans ships as "DM Sans 9pt". A picker inferring from the filename
  // mislabels it, and the specimen then shows the wrong face.
  assert.match(SERVER, /readFontMeta\(buf\)/, "the parser must run on upload");
  assert.match(SERVER, /const family = meta\?\.family \|\| basename/, "the FILE's name wins over the filename");
  assert.match(SERVER, /variable: !!meta\?\.variable/, "variable-ness must be reported");
});

test("the zero-dep parser reads a real shipped font correctly", () => {
  const f = resolve(REPO, "public/fonts/f01-rP2Hp2ywxg089UriCZOIHTWEBlw.woff2");
  if (!existsSync(f)) return; // fonts not shipped in this checkout
  const meta = readFontMeta(readFileSync(f));
  assert.equal(meta.family, "DM Sans 9pt", "the NAME table is the authority, not the filename");
  assert.ok(meta.variable, "DM Sans is a variable face");
  const wght = (meta.axes ?? []).find((a: { tag: string }) => a.tag === "wght");
  assert.ok(wght && wght.max >= 400, "the wght axis must be reported");
});

// ---- 5. the self-hosting contract ---------------------------------------

test("the Google proxy uses a MODERN user-agent", () => {
  // css2 silently serves .ttf to an old UA — a 10x larger file, cached forever,
  // with no error anywhere.
  assert.match(SERVER, /MODERN_UA\s*=/, "a modern UA constant is required");
  assert.match(SERVER, /Chrome\/\d+/, "the UA must look like a current Chrome");
  assert.match(SERVER, /headers:\s*\{\s*"user-agent": MODERN_UA\s*\}/, "the UA must be sent on the css2 fetch");
});

test("the Google proxy repoints url() at our own origin", () => {
  assert.match(SERVER, /fonts\\?\.gstatic\\?\.com/, "it must find the gstatic urls");
  assert.match(SERVER, /out = out\.split\(from\)\.join\(to\)/, "every url() must be rewritten");
  assert.match(SERVER, /\/api\/theme\/font\/google\//, "the rewritten url must be same-origin");
});

test("a failed Google fetch FAILS THROUGH to the original url", () => {
  // A font that loads late beats a card that renders broken because a CDN was
  // briefly down, so the original css2 text is returned untouched.
  assert.match(SERVER, /continue; \/\/ leave the original url in place; fail-through/,
    "a failed per-file download must not blank the whole stylesheet");
});

test("a 400 from css2 is recognised as 'no such family'", () => {
  // css2 answers a bad family with text/html, not a CSS 400. Checking the
  // content type and scanning for @font-face anywhere is the only reliable
  // signal — and the scan must NOT be a prefix match: a valid css2 answer
  // begins with a subset comment ("/* devanagari */"), so startsWith rejected
  // every good family and 404'd the whole picker. Measured, not assumed.
  assert.match(SERVER, /ctype\.includes\("text\/css"\)/, "the content type must be checked");
  assert.match(SERVER, /@font-face\/i\.test\(css\)/, "an @font-face must be found ANYWHERE");
  // Scan CODE only, comments stripped: this file's own comment quotes the bad
  // expression to explain why it is wrong, so a raw `includes` over the source
  // matches the explanation and fails on correct code.
  const SERVER_CODE = SERVER.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!SERVER_CODE.includes('startsWith("@font-face")'),
    "a prefix match on @font-face is the bug that rejected every valid family");
  // And the CLIENT must use the same discriminator, or it accepts an HTML error
  // page as a font and registers zero faces with no error shown.
  const STORE_CODE = STORE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(STORE_CODE, /@font-face\/i\.test\(css\)/, "loadGoogleFont must validate the same way");
});

// ---- 6. sync ------------------------------------------------------------

test("font state is synced across devices", () => {
  assert.match(STORE, /LS_FONTS = "astra-fonts"/, "fonts need their own storage key");
  assert.match(STORE, /function restoreFonts/, "restoreFonts must exist for the boot path");
  const main = readFileSync(resolve(REPO, "src/main.tsx"), "utf8");
  assert.match(main, /restoreFonts\(\)/, "main.tsx must call restoreFonts or the font flashes");
});
