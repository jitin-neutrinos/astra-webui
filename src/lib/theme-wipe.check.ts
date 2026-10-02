import { test } from "node:test";
import assert from "node:assert/strict";
import { wipeClipFromRect, radiusPct } from "./theme-wipe";

const W = 1280, H = 800;

// The owner-reported bug: the wipe must originate from the BUTTON, not from
// document.activeElement. These pin the origin to the rect passed in, so a
// regression to activeElement (or to screen centre) fails here.
test("origin is the centre of the button rect", () => {
  const btn = { left: 100, top: 600, width: 240, height: 44 };
  const { x, y } = wipeClipFromRect(btn, W, H);
  assert.equal(x, 220);
  assert.equal(y, 622);
  assert.match(wipeClipFromRect(btn, W, H).clip[0], /circle\(0% at 220px 622px\)/);
});

test("a button in the far corner still originates there, not centre", () => {
  const btn = { left: 1240, top: 740, width: 40, height: 40 };
  const { x, y } = wipeClipFromRect(btn, W, H);
  assert.equal(x, 1260);
  assert.equal(y, 760);
  assert.notEqual(x, W / 2);
});

test("two different buttons give two different origins", () => {
  const a = wipeClipFromRect({ left: 0, top: 0, width: 40, height: 40 }, W, H);
  const b = wipeClipFromRect({ left: 1240, top: 740, width: 40, height: 40 }, W, H);
  assert.notDeepEqual(a.clip, b.clip);
});

test("falls back to screen centre only for an unusable rect", () => {
  for (const bad of [null, undefined, { left: 5, top: 5, width: 0, height: 40 }]) {
    const { x, y } = wipeClipFromRect(bad, W, H);
    assert.equal(x, W / 2, "x falls back to centre");
    assert.equal(y, H / 2, "y falls back to centre");
  }
});

test("radius grows with distance from the button and always covers the page", () => {
  // radiusPct uses MAX(x, w-x) and MAX(y, h-y) — the distance to the FARTHEST
  // corner — so opposite corners are symmetric. Only a centred button is smaller.
  const nearCorner = radiusPct(10, 10, W, H);
  const otherCorner = radiusPct(W - 10, H - 10, W, H);
  const centre = radiusPct(W / 2, H / 2, W, H);
  assert.ok(Math.abs(nearCorner - otherCorner) < 0.01, "opposite corners are symmetric");
  assert.ok(nearCorner > centre, "an edge/corner button needs a bigger circle than centre");
  // the corner case is the max, and must exceed 100% to cover the whole box
  assert.ok(nearCorner > 100, `corner radius covers the viewport (got ${nearCorner.toFixed(1)}%)`);
});

test("the end keyframe uses the same origin as the start", () => {
  const { clip } = wipeClipFromRect({ left: 300, top: 500, width: 200, height: 44 }, W, H);
  const at = (s: string) => s.match(/at (-?[\d.]+)px (-?[\d.]+)px/)!.slice(1).map(Number);
  assert.deepEqual(at(clip[0]), at(clip[1]), "origin is stable across the wipe");
});
