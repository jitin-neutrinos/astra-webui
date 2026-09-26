// header-autohide checks (repo assert pattern). Run: npx tsx src/lib/header-autohide.check.ts
import { headerDecision, isScrollUp, HEADER_AUTO_HIDE_MS } from "./header-autohide";

let fails = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { fails++; console.error("FAIL:", msg); }
}

// Timer: visible until 10s.
ok(headerDecision(0, true, false, false).action === "wait", "0ms waits");
ok(headerDecision(9_999, true, false, false).action === "wait", "9999ms waits");
ok(headerDecision(HEADER_AUTO_HIDE_MS, true, false, false).action === "hide", "10000ms hides");

// Edge case: no overflow → persists forever.
ok(headerDecision(60_000, false, false, false).action === "persist", "no-overflow persists at 60s");
// Edge case: at top → persists (cannot scroll up from top).
ok(headerDecision(60_000, true, true, false).action === "persist", "at-top persists");

// Reveal on scroll-up request wins over everything.
ok(headerDecision(20_000, true, false, true).action === "show", "reveal honored after hide");
ok(headerDecision(20_000, false, false, true).action === "show", "reveal honored even without overflow");

// Scroll-up detection with slop.
ok(isScrollUp(500, 400), "100px up is scroll-up");
ok(!isScrollUp(500, 498), "2px jitter is not scroll-up");
ok(!isScrollUp(400, 500), "scrolling down is not scroll-up");
ok(!isScrollUp(500, 500), "same position is not scroll-up");

if (fails) throw new Error(`${fails} header-autohide check(s) failed`);
console.log("PASS: header-autohide checks");
