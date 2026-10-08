// Regression check for the chat surface CSS (owner 10-03: bottom-anchored landing
// card, hidden composer rail, accent-primary scrollbars that follow the theme).
//
//   node scripts/css-chat-surface.check.mjs
//
// Compiles src/index.css through the real Vite/Tailwind pipeline into a THROWAWAY
// outDir — deliberately NOT `npm run build`, which runs `tsc -b` over the whole
// tree and lets unrelated in-flight TS errors mask a CSS regression. dist/ (the
// thing the server serves) is never touched.
//
// Matching note — three things this must NOT be fooled by:
//   * lightningcss reorders declarations inside a rule (display after
//     flex-direction), so rules are parsed and compared as SETS, not substrings;
//   * it expands a colour-mix() into `<literal hex>` + an @supports-guarded
//     var() form. The hex is only a pre-color-mix fallback; the @supports branch
//     is what every modern browser uses, and that is the theme-reactive one;
//   * it keeps author spacing (` > `, `:has( > .x)`), so selectors are normalised.

import { build } from 'vite';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'dist-cssverify');

await build({
  logLevel: 'error',
  build: { outDir: path.relative(process.cwd(), OUT), emptyOutDir: true, cssMinify: false },
});

const cssDir = path.join(OUT, 'assets');
const file = readdirSync(cssDir).filter((f) => f.endsWith('.css')).sort((a, b) => statSync(path.join(cssDir, b)).size - statSync(path.join(cssDir, a)).size)[0];
if (!file) { console.log('FAIL — no css emitted'); process.exit(1); }
const css = readFileSync(path.join(cssDir, file), 'utf8');

const norm = (s) => s.replace(/\s+/g, '').replace(/;/g, '');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** All `selector { decls }` rules as {selectors:Set, decls:Set, raw}. */
function rules(src) {
  const out = [];
  for (const m of stripComments(src).matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((s) => norm(s)).filter(Boolean);
    const decls = new Set(m[2].split(';').map((d) => norm(d)).filter(Boolean));
    out.push({ sels, decls, raw: norm(m[0]) });
  }
  return out;
}
const ALL = rules(css);
const matches = (sel) => {
  const t = norm(sel);
  return ALL.filter((r) => r.sels.includes(t));
};
/** Last rule wins for a given selector (cascade order), like the browser. */
const ruleFor = (sel) => {
  const hits = matches(sel);
  return hits.length ? hits[hits.length - 1] : null;
};
/**
 * Effective value of one property. CSS merges declarations ACROSS rules that
 * match the selector — a later rule setting `z-index` does not erase an earlier
 * rule's `scrollbar-width`. So scan every matching rule, last writer per property.
 */
const valOf = (sel, prop) => {
  const p = norm(prop) + ':';
  let val = null;
  for (const r of matches(sel)) {
    for (const d of r.decls) if (d.startsWith(p)) val = d.slice(p.length);
  }
  return val;
};

let bad = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ok   ${name}${extra ? ' — ' + extra : ''}`);
  else { console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); bad++; }
};

// --- 1. landing intro card floats centered in the free space -----------------
// The parent turns into a flex column ONLY in the landing state (the transcript
// must stay a plain block scroll container), and the card gets auto/auto
// margins — centered between header and composer. (Owner 10-05: the old
// margin-top:auto bottom-anchor piled ALL leftover space above the card,
// 341px vs 10px — uneven.) Media-query rules are skipped: valOf scans every
// matching rule without media context, and `width` in a mobile block would
// read back as the card's width at desktop too.
const LANDING = '.chat-scroll:has(>.chat-welcome)';
check('landing state turns the scroller into a flex column',
  valOf(LANDING, 'display') === 'flex' && valOf(LANDING, 'flex-direction') === 'column',
  `display:${valOf(LANDING, 'display')} flex-direction:${valOf(LANDING, 'flex-direction')}`);
check('welcome card is a flex item of it', ruleFor('.chat-scroll>.chat-welcome') !== null);
check('welcome card centered (margin-top:auto + margin-bottom:auto)',
  valOf('.chat-scroll>.chat-welcome', 'margin-top') === 'auto'
    && valOf('.chat-scroll>.chat-welcome', 'margin-bottom') === 'auto',
  `margin-top:${valOf('.chat-scroll>.chat-welcome', 'margin-top')}`
  + ` margin-bottom:${valOf('.chat-scroll>.chat-welcome', 'margin-bottom')}`);
check('no stale fixed bottom gap (old margin-bottom:10px must not return)',
  !matches('.chat-scroll>.chat-welcome').some((r) => r.decls.has('margin-bottom:10px')));
// auto margins only center inside a FLEX container: guard against a later edit
// dropping display:flex and silently reverting the card to the top.
check('the two rules coexist (auto cannot resolve without flex)',
  !!ruleFor(LANDING) && !!ruleFor('.chat-scroll>.chat-welcome'));
// Mobile (owner 10-05): the welcome card must never bleed wider than the chat
// bubbles. Emitted inside @media — grep the media-gated rule directly, on the
// whitespace-normalised css (the built form keeps `calc(100vw - 32px)`).
const cssN = norm(css);
const MEDIA_ONE = /@media\(max-width:1023px\)\{\.chat-welcome\{[^}]*max-width:calc\(100vw-32px\)/;
check('mobile welcome card clamps to the bubble rail (max-width:100vw-32px)',
  MEDIA_ONE.test(cssN),
  (cssN.match(MEDIA_ONE)?.[0] ?? '').slice(0, 120));

// --- 2. composer input: no visible scrollbar, scroll behaviour intact -------
check('composer input scrollbar hidden (Firefox/standards)',
  valOf('.chat-composer-input', 'scrollbar-width') === 'none',
  'scrollbar-width:' + valOf('.chat-composer-input', 'scrollbar-width'));
check('composer input scrollbar hidden (WebKit/Chromium)',
  valOf('.chat-composer-input::-webkit-scrollbar', 'display') === 'none');
check('composer input still scrolls once it exceeds max-height',
  valOf('.chat-composer-input', 'overflow-y') === 'auto');

// --- 2b. composer parent plate (owner 10-05) ---------------------------------
// The shell is the parent rounded rectangle wrapping both cards. NB: later
// media-gated `.chat-composer-shell` rules exist (max-lg tweaks), and both
// ruleFor and valOf ignore media context — so identify the PLATE rule by its
// unique `border:1px…` declaration instead of by position.
const shellRule = matches('.chat-composer-shell').find((r) => [...r.decls].some((d) => d.startsWith('border:1px')));
check('composer shell is the parent plate (border + radius + padding)',
  !!shellRule && shellRule.decls.has('border-radius:16px')
    && shellRule.decls.has('padding:4px'),
  shellRule ? [...shellRule.decls].filter((d) => d.startsWith('border') || d.startsWith('padding') || d.startsWith('border-radius')).join(' | ') : 'no rule');
check('composer plate gap is the subtle 5px (not the old 8px)',
  shellRule?.decls.has('gap:5px') === true,
  'gap:' + valOf('.chat-composer-shell', 'gap'));
check('composer plate carries NO backdrop-filter (nested blur janks the APK)',
  !shellRule?.decls.size || ![...shellRule.decls].some((d) => d.startsWith('backdrop-filter')));

// --- 2c. trace + glow (owner 10-05) ------------------------------------------
// The comet now runs on the SHELL (parent plate), and focus-hiding is scoped
// to the shell — the old .chat-composer-scoped rule could never fire once the
// SVG re-parented. Assert the new selector exists and the stale one is gone.
check('trace focus-hide scoped to the shell (comet runs on the plate)',
  cssN.includes('.chat-composer-shell:focus-within.composer-trace{opacity:0}'),
  'selector scoping rule');
check('stale composer-scoped trace hide rule is gone',
  !cssN.includes('.chat-composer:focus-within.composer-trace'));
// Owner 10-08 (steer, supersedes the old persistent-glow pin): the inner cards
// carry NO outline and NO accent glow ring any more — the SHELL plate carries
// the bubble material (fill/border/blur/glow). Pin the new contract: cards are
// borderless, the shell keeps both.
for (const card of ['.composer-input-card', '.composer-bar-card']) {
  check(`inner card outline removed: ${card}`, !matches('.chat-composer' + card).some((r) => [...r.decls].some((d) => d.startsWith('border:') && d.includes('solid'))),
    'border:none expected');
}
check('shell carries the bubble outline', matches('.chat-composer-shell').some((r) => [...r.decls].some((d) => d.startsWith('border:') && d.includes('var(--bubble-ai-border'))),
  'bubble border token on the shell');

// --- 3. chat scrollbars on brand accent primary, theme-reactive -------------
// The @supports branch is the one real browsers take; assert the var() form is
// what lives there (the bare-hex sibling is the pre-color-mix fallback).
// NB: can't regex the @supports prelude — it contains nested parens
// (`color-mix(in lab, red, red)`). Take every `:root { … }` body inside an
// @supports block by brace matching instead.
function supportsRootDecls(src) {
  const bodies = [];
  let i = 0;
  while ((i = src.indexOf('@supports', i)) !== -1) {
    let j = src.indexOf('{', i);
    if (j === -1) break;
    let depth = 0, k = j;
    for (; k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}' && --depth === 0) break;
    }
    const inner = src.slice(j + 1, k);
    if (/:root\s*\{/.test(inner)) {
      for (const m of inner.matchAll(/:root\s*\{([^{}]*)\}/g)) bodies.push(m[1]);
    }
    i = k;
  }
  return bodies.join(' ').replace(/\s+/g, ' ');
}
const sbVars = supportsRootDecls(stripComments(css));
check('thumb token resolves off accent primary inside @supports',
  /--sb-thumb:\s*color-mix\(in srgb, var\(--color-accent\) 45%/.test(sbVars),
  sbVars.length ? '' : 'no @supports color-mix rule for --sb-thumb');
check('track token resolves off accent primary inside @supports',
  /--sb-track:\s*color-mix\(in srgb, var\(--color-accent\) 8%/.test(sbVars));

// the shared selector list must actually reach transcript + tool surfaces
const SHARED = ['.chat-scroll', '.chat-think-text', '.chat-term-out', '.suba-tail',
  '.ai-term-body', '.ai-io-val.tall', '.cmdpal-list', '.cmdsheet-list', '.cmenu-body'];
const shared = ALL.find((r) => r.sels.includes('.chat-scroll') && r.sels.includes('.chat-think-text'));
check('shared chat scrollbar block emitted', !!shared);
for (const sel of SHARED) check(`  covers ${sel}`, !!shared?.sels.includes(norm(sel)));
// Owner 10-05 superseded the tinted thumb: scrollbars are INVISIBLE on the chat
// surface by design (standard scrollbar-width:none + webkit fallback). Pin the
// CURRENT law — the shared block hides the rail; no thumb colour assertion.
check('shared block hides the rail (owner 10-05 law)',
  !!shared && shared.decls.has('scrollbar-width:none'));
// think-panel keeps the owner's deliberately wider, visible bar
check('think-panel rail is hidden like the rest (owner 10-05 law)',
  valOf('.chat-think-text::-webkit-scrollbar', 'width') === '0',
  'width:' + valOf('.chat-think-text::-webkit-scrollbar', 'width'));

// no rule outside that block may repaint a chat scrollbar with a baked channel
const stray = ALL.filter(
  (r) => r.sels.some((s) => SHARED.concat(['.chat-menu']).includes(s))
    && [...r.decls].some((d) => d.startsWith('scrollbar-color:'))
    && !r.decls.has('scrollbar-color:var(--sb-thumb)transparent'),
);
check('no chat rule overrides the shared scrollbar colour', stray.length === 0,
  stray.slice(0, 3).map((r) => r.raw.slice(0, 90)).join(' | '));

rmSync(OUT, { recursive: true, force: true });
console.log(bad === 0 ? '\nPASS — css compiled; all 3 owner asks present' : `\nFAIL — ${bad} check(s)`);
process.exit(bad === 0 ? 0 : 1);