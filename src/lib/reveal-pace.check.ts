// Assert-based checks for reveal pacing math. No framework.
// Run: npx tsx src/lib/reveal-pace.check.ts
import { revealCps } from "./reveal-pace.ts";

let failures = 0;
function ok(cond: boolean, msg: string) {
  if (!cond) { failures++; console.error("FAIL:", msg); }
}

const CPS_MIN = 40, CPS_MAX = 52;
// wobble(now) = 40 + (sin(now/900)+1)*(52-40)/2, range [40, 52]
// phases: sin=+1 -> 52 (top), sin=0 -> 46 (mid), sin=-1 -> 40 (floor)
const TOP = 900 * Math.PI / 2;      // sin = +1
const MID = 0;                       // sin = 0
const FLOOR = 900 * Math.PI * 1.5;  // sin = -1 (positive timestamp, like runtime)

// --- small backlog: wobble floor only, identical to the settled feel ---
ok(revealCps(5, false, TOP) === CPS_MAX, "wobble top = 52 at sin=+1");
ok(revealCps(5, false, MID) === (CPS_MIN + CPS_MAX) / 2, "wobble mid = 46");
ok(revealCps(5, false, FLOOR) === CPS_MIN, "wobble floor = 40 at sin=-1");
// trickle backlog below the scaling threshold (cpsMin*lagTarget = 24):
ok(revealCps(20, false, FLOOR) === CPS_MIN, "trickle backlog 20 stays at floor 40");
ok(revealCps(20, false, TOP) === CPS_MAX, "trickle backlog 20 still rides wobble top");

// --- burst backlog: pace scales with backlog, CAPPED so it stays visible ---
// above threshold, back/0.6 dominates the wobble, clamped at 240 cps (~5x reading)
ok(revealCps(300, false, FLOOR) === 240, "backlog 300 -> capped at 240 cps (visible catch-up)");
ok(revealCps(600, false, TOP) === 240, "backlog 600 still capped at 240 cps");
ok(revealCps(140, false, FLOOR) === 140 / 0.6, "backlog 140 under cap scales (~233 cps)");
ok(revealCps(100, false, FLOOR) > revealCps(50, false, FLOOR), "under cap: bigger backlog -> faster pace");
// cap region behaves: at cap, pace stays constant (cushion keeps animating)
ok(revealCps(1200, false, FLOOR) === 240, "1217-char real-world burst capped, drains ~5s visibly");

// --- done contract unchanged: identical formula to the old inline drain ---
ok(revealCps(180, true, 0) === 100, "done: back/1.8 branch (180 -> 100 cps)");
ok(revealCps(100, true, 0) === 80, "done: 100 backlog clamps to 80 cps");
ok(revealCps(36, true, 0) === 80, "done: tiny backlog clamps to 80 cps");
ok(revealCps(5000, true, 0) === Math.max(80, 5000 / 1.8), "done: huge backlog scales");

// --- reality check: the measured bug scenario ---
// 5.4s stall then a ~1900-char burst: old original code revealed at <=52cps -> ~36s
// tail; the UNCAPPED fix (v1) emptied the buffer instantly -> text froze mid-line
// at the next pause and the end-of-turn snap dropped a whole block (live complaint).
// v2: pace caps at 240 cps -> a 1900-char burst drains in ~8s, visibly, and a
// cushion keeps animating through pauses.
const burstBacklog = 1900;
const newCps = revealCps(burstBacklog, false, FLOOR);
ok(newCps === 240, "1900-char burst -> capped 240 cps, drains ~8s visibly");
ok(newCps < burstBacklog / 0.5, "catch-up never reaches instant-empty territory");
// a modest backlog must NOT hit the cap (only true bursts clamp)
ok(revealCps(120, false, FLOOR) === 200, "backlog 120 -> 200 cps, under cap");

if (failures) { console.error(`FAILURES: ${failures}`); process.exit(1); }
console.log("reveal-pace.check: all pass");
