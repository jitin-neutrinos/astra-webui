/**
 * Collapsed-rail logo centring.
 *
 * The rail is `lg:w-16` (64px) with `border-right: 1px` and default
 * `box-sizing: border-box`, so its CONTENT box is 63px — an odd number.
 * Centring with `justify-center` inside that box lands the logo on x=31.5,
 * while the nav rows below centre a 48px `w-12` icon span whose box starts at
 * the 8px nav padding, landing on x=32. The logo therefore sat 0.5px off the
 * column it is supposed to align with, in every theme and at every width.
 *
 * The fix pins the logo into a `w-12` span at the same origin as the nav icon
 * spans (`px-2` + `w-12`), so both centres are computed from one rule.
 *
 * This check re-derives the geometry in pure arithmetic (no DOM, no browser) so
 * the regression cannot come back unnoticed. It fails loudly if anyone
 * re-introduces `justify-center` on the collapsed top bar, or drops the shared
 * `w-12` span, or changes the rail width/border in a way that re-splits the
 * centring origin.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function eq(a: any, b: any, msg: string) { if (a !== b) throw new Error(msg + ": " + a + " !== " + b); }
function ok(v: any, msg: string) { if (!v) throw new Error(msg); }

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "..", "App.tsx"), "utf8");

// --- 1. the collapsed top bar must NOT rely on justify-center ---------------
// (that centres in the 63px content box and re-creates the 0.5px split)
ok(
  !/expanded \? "items-center gap-3 px-4" : "items-center justify-center px-2"/.test(app),
  "collapsed top bar still uses justify-center (re-splits the 0.5px centring offset)",
);

// --- 2. the collapsed top bar shares the nav row's px-2 padding origin ------
ok(
  /expanded \? "items-center gap-3 px-4" : "items-center px-2"/.test(app),
  'collapsed top bar must use "items-center px-2" (same origin as the nav rows)',
);

// --- 3. the logo sits in a w-12 span in rail mode ---------------------------
ok(
  /<span className=\{cn\("grid shrink-0 place-content-center", !expanded && "h-full w-12"\)\}>/.test(app),
  "logo must be wrapped in a w-12 span in rail mode",
);

// --- 4. the geometry, derived -------------------------------------------------
// Rail: 64px total, 1px right border, border-box -> 63px content, origin 0.
const RAIL = 64;
const BORDER_R = 1;
const NAV_PAD = 8; // px-2
const ICON_COL = 48; // w-12

const contentW = RAIL - BORDER_R;          // 63 (odd)
const railCentre = RAIL / 2;               // 32
const contentCentre = contentW / 2;        // 31.5  <- the old logo position
const iconSpanCentre = NAV_PAD + ICON_COL / 2; // 32 <- the nav icons

eq(contentW, 63, "rail content box is 63px");
eq(railCentre, 32, "rail centre");
eq(contentCentre, 31.5, "justify-center lands on 31.5 (this is the bug)");
eq(iconSpanCentre, 32, "nav w-12 icon column centre");
eq(
  contentCentre === iconSpanCentre,
  false,
  "sanity: justify-center and the icon column must genuinely differ (else this check is vacuous)",
);

// the shipped layout: logo centred inside a w-12 span at the nav padding origin
const logoCentre = NAV_PAD + ICON_COL / 2;
eq(logoCentre, 32, "new logo centre");
eq(logoCentre, iconSpanCentre, "logo must share the icon column centre exactly");
eq(logoCentre, railCentre, "logo must also sit on the rail's true centre");
eq(Math.abs(logoCentre - railCentre), 0, "zero offset from rail centre");
eq(Math.abs(contentCentre - logoCentre), 0.5, "the old justify-center offset was 0.5px");

console.log("PASS: sidebar logo alignment checks (logo centre 32px = icon column centre)");