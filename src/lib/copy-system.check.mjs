// Copy-system single-source check (2026-10-08): every copy affordance must go
// through ONE system — copyText() for the write, AnimatedCopyButton /
// wireCodeCopyButtons for the UI, the .chat-copy-swap CSS block for the swap.
// Asserts the invariants that keep it that way. Static by design: no DOM.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "src");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|css)$/.test(name)) yield p;
  }
}

let failures = 0;
const files = [...walk(SRC)];
const read = (p) => readFileSync(p, "utf8");

// 1. navigator.clipboard is only touched inside copy-text.ts (the one choke point).
for (const p of files) {
  if (p.endsWith("copy-text.ts")) continue;
  if (/navigator\.clipboard/.test(read(p))) {
    console.error(`FAIL clipboard bypass: ${p} touches navigator.clipboard directly`);
    failures++;
  }
}

// 2. Hand-rolled copied-state buttons must not come back (state machine + icon
//    ternary outside the system). Icons Copy/Check co-imported from lucide in a
//    component is the smell.
const animatedCopy = read(join(SRC, "lib", "animated-copy.tsx"));
if (!/chat-copy-swap/.test(animatedCopy) || !/is-check/.test(animatedCopy)) {
  console.error("FAIL animated-copy.tsx no longer drives the shared swap classes");
  failures++;
}

// 3. Exactly ONE definition each of the swap + skin rules in CSS.
const css = read(join(SRC, "index.css"));
const count = (re) => (css.match(re) || []).length;
for (const [rule, n] of [
  [/^\.chat-copy-swap \{/gm, 1],
  [/^\.chat-actions-copy \{/gm, 1],
  [/^\.chat-copy-chip \{/gm, 1],
  [/^\.chat-code-copy \{/gm, 1],
]) {
  if (count(rule) !== n) {
    console.error(`FAIL css: ${rule} defined ${count(rule)}x (want ${n})`);
    failures++;
  }
}

// 4. Superseded one-off skins stay deleted.
for (const cls of [".ai-term-copy", ".ast-canvas-copy", ".ast-cv-copy-swap"]) {
  if (css.includes(cls)) {
    console.error(`FAIL css: dead skin ${cls} is back`);
    failures++;
  }
}

// 5. Rich-pre DOM buttons share the React classes (no private .cc-* islands).
const richPre = read(join(SRC, "lib", "rich-pre.ts"));
if (/cc-swap|cc-copy|cc-check/.test(richPre + css)) {
  console.error("FAIL rich-pre: private cc-* copy classes reintroduced");
  failures++;
}

if (failures) {
  console.error(`copy-system check: ${failures} failure(s)`);
  process.exit(1);
}
console.log(`copy-system check: ok (${files.length} files scanned)`);
