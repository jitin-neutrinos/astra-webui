import assert from "node:assert/strict";
import { test } from "node:test";
import { easeFlip } from "./theme-ease.ts";

/** Playhead value the tween writes at progress p, mirroring ThemeArtwork. */
function frame(from: number, to: number, p: number) {
  return from + (to - from) * easeFlip(p);
}

test("clamps outside the unit interval", () => {
  assert.equal(easeFlip(-1), 0);
  assert.equal(easeFlip(0), 0);
  assert.equal(easeFlip(1), 1);
  assert.equal(easeFlip(9), 1);
});

test("is monotonic non-decreasing", () => {
  let prev = -1;
  for (let i = 0; i <= 100; i++) {
    const v = easeFlip(i / 100);
    assert.ok(v >= prev, `ease must not go backwards at p=${i / 100}`);
    prev = v;
  }
});

test("matches cubic-bezier(0.4, 0, 0.2, 1)", () => {
  // Reference values for CSS `cubic-bezier(0.4, 0, 0.2, 1)` ("standard" easing).
  // Deliberately NOT symmetric: this curve commits early and settles late, so
  // f(0.5) = 0.7756 is correct. An earlier version of this test asserted
  // symmetry and a 0.5 midpoint — that was a wrong assumption about the curve,
  // not a bug in it.
  const cases: [number, number][] = [
    [0.0, 0.0], [0.1, 0.0259], [0.25, 0.2366],
    [0.5, 0.7756], [0.75, 0.9594], [0.9, 0.9944], [1.0, 1.0],
  ];
  for (const [p, want] of cases) {
    assert.ok(Math.abs(easeFlip(p) - want) < 5e-3,
      `easeFlip(${p}) = ${easeFlip(p)}, want ~${want}`);
  }
});

test("pins both endpoints exactly", () => {
  // The tween relies on these: light lands on t=0 (day), dark on t=4 (night).
  assert.equal(easeFlip(0), 0);
  assert.equal(easeFlip(1), 1);
});

test("starts and ends slower than linear (the 'violent' fix)", () => {
  // A linear tween would give 0.1 at p=0.1. An ease-in-out must be BELOW that
  // early on and ABOVE it late on, which is what removes the snap.
  assert.ok(easeFlip(0.1) < 0.1, `start too fast: ${easeFlip(0.1)}`);
  assert.ok(easeFlip(0.9) > 0.9, `end too fast: ${easeFlip(0.9)}`);
});

test("dark->light tween runs the full range", () => {
  assert.equal(frame(4, 0, 0), 4);
  assert.equal(frame(4, 0, 1), 0);
  // Halfway through the flip the artwork sits part-way between night and day
  // (not an endpoint — that would mean it snapped rather than eased).
  const mid = frame(4, 0, 0.5);
  assert.ok(mid > 0 && mid < 4, `midpoint must be between the states, got ${mid}`);
});