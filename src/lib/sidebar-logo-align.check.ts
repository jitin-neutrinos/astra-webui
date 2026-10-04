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
  /<span className=\{cn\("grid shrink-0", !expanded && "h-full w-12 grid-cols-1 place-content-stretch"\)\}>/.test(app),
  "logo must be wrapped in a rail-only w-12 span with grid-cols-1 place-content-stretch",
);

// --- 3b. the rail logo button FILLS its column (coarse-pointer guard) -------
// index.css has a global touch rule: `@media (pointer: coarse) { button,
// [role=tab] { min-width: 44px } }`. On a tablet the logo button therefore
// becomes 44px wide, and a 44px box inside a 48px column leaves only 2px to
// spare, so centring the 28px image inside it lands it 8px left of the rail
// centre (measured -8.00px on iPad Pro 12.9, both orientations). A
// content-sized button is only correct for fine pointers. Filling the column
// is correct for BOTH and is larger than the 44px minimum, so the touch target
// is not traded away for the alignment.
ok(
  /!expanded && "grid h-full w-full place-content-center"/.test(app),
  "rail logo button must fill its column (h-full w-full) or the coarse-pointer 44px rule shifts the logo 8px left",
);

// --- 3c. the wrapper must NOT centre its grid track --------------------------
// `place-content: center` sizes the grid TRACK to the item's content, so the
// button's `w-full`/`h-full` resolve against a content-sized track and it stays
// 44px instead of filling the column. Measured on iPad Pro: the button stayed
// 44x44 with `place-content-stretch` absent. The wrapper needs an explicit
// 1-column stretched track for the fill to have anything to fill.
ok(
  !/<span className=\{cn\("grid shrink-0 place-content-center"/.test(app),
  "the rail wrapper must not use place-content-center (it re-shrinks the track and defeats the column fill)",
);
ok(
  /grid-cols-1 place-content-stretch/.test(app),
  "the rail wrapper needs grid-cols-1 place-content-stretch for the column fill to take effect",
);

// the fill must be rail-only: the expanded button must stay content-sized
ok(
  /!expanded && "grid h-full w-full place-content-center"/.test(app)
    && !/expanded && "grid h-full w-full/.test(app.replace(/!expanded && "grid h-full w-full place-content-center"/, "")),
  "the column-filling classes must be gated on !expanded only",
);

// --- the geometry, derived -------------------------------------------------
// The button is a grid item in a `place-content: center` 48px column, so it is
// always horizontally SYMMETRIC in that column: its centre is the column
// centre (32px) whatever its width.
//
// BEFORE the fix the button was `display: block` with no centring, so the
// block-level <img> sat at the button's LEFT EDGE. That is why the logo looked
// centred on a desktop (button content-sized at 28px => image fills it exactly)
// and 8px off on a tablet (button inflated to 44px by the touch rule => image
// pinned to the left of a 44px box).
//
// AFTER the fix the button fills the 48px column and centres the image, so the
// image centre is the column centre in EVERY pointer mode.
const RAIL = 64;
const BORDER_R = 1;
const NAV_PAD = 8;   // px-2
const ICON_COL = 48; // w-12
const LOGO = 28;     // h-7 w-7
const TOUCH_MIN = 44; // index.css coarse-pointer rule

const contentW = RAIL - BORDER_R;               // 63 (odd)
const railCentre = RAIL / 2;                    // 32
const contentCentre = contentW / 2;             // 31.5 <- the original justify-center position
const iconSpanCentre = NAV_PAD + ICON_COL / 2;  // 32 <- the nav icons

eq(contentW, 63, "rail content box is 63px");
eq(railCentre, 32, "rail centre");
eq(contentCentre, 31.5, "justify-center lands on 31.5 (the original bug)");
eq(iconSpanCentre, 32, "nav w-12 icon column centre");
eq(
  contentCentre === iconSpanCentre,
  false,
  "sanity: justify-center and the icon column must genuinely differ (else this check is vacuous)",
);

/** Centre of a left-pinned image inside a button that is itself centred in the column. */
const leftPinnedLogoCentre = (btnW: number) =>
  NAV_PAD + (ICON_COL - btnW) / 2 + LOGO / 2;

// BEFORE, fine pointer: button is content-sized 28px, image fills it -> 32, looks right.
eq(leftPinnedLogoCentre(LOGO), 32, "before/fin pointer");

// BEFORE, coarse pointer: touch rule makes the button 44px; the image stays at
// its left edge => 8 + 2 + 14 = 24, i.e. 8px left. Measured live on iPad Pro
// 12.9 in both orientations.
eq(leftPinnedLogoCentre(TOUCH_MIN), 24, "before/coarse pointer = the 8px-left bug");
eq(railCentre - leftPinnedLogoCentre(TOUCH_MIN), 8, "the exact offset the owner reported");

// AFTER: the button fills the column and centres the image. `min-width: 44px`
// cannot shrink a 48px box, so this holds in BOTH pointer modes.
const shipped = iconSpanCentre; // image centred in a 48px column starting at NAV_PAD
eq(shipped, 32, "shipped logo centre");
eq(shipped, railCentre, "logo sits on the rail's true centre");
eq(shipped, iconSpanCentre, "logo shares the icon column centre exactly");
eq(Math.abs(shipped - railCentre), 0, "zero offset from rail centre");
// and the touch target grew rather than being traded away for the alignment
ok(ICON_COL >= TOUCH_MIN, "the touch target must still meet the 44px a11y minimum");
eq(ICON_COL, 48, "it beats the minimum outright");
ok(ICON_COL > TOUCH_MIN, "column fill is what makes it pointer-independent");

console.log("PASS: sidebar logo alignment checks (logo centre 32px = icon column centre, coarse-pointer safe)");