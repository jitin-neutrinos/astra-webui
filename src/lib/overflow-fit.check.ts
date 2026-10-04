// overflow-fit.check.ts — asserts the Priority+ fit decision.
// Run: npx tsx --test src/lib/overflow-fit.check.ts
//
// WHY: a wrong answer here does not crash. It hides a control the user needed, or
// leaves the row overflowing on a phone — both of which are silent, and both of which
// look like "the feature is broken" rather than "the maths is off by one".

import { test } from "node:test";
import assert from "node:assert/strict";
import { fitCount, splitVisible, COLLAPSE_ORDER, type FitItem } from "./overflow-fit.ts";

const YOLO = 80, EFFORT = 100, ATTACH = 34; // intrinsic widths, px

test("fitCount fits greedily in the order given", () => {
  const w = [YOLO, EFFORT, ATTACH];
  assert.equal(fitCount(w, 1000), 3, "everything fits in a wide row");
  assert.equal(fitCount(w, 300), 3, "300px is still plenty for 214px of items");
  assert.equal(fitCount(w, 200), 2, "yolo+effort fit, attach does not");
  assert.equal(fitCount(w, 150), 1, "only yolo fits");
  assert.equal(fitCount(w, 40), 0, "nothing fits when the row is tiny");
});

test("fitCount honours the reserved width", () => {
  const w = [YOLO, EFFORT, ATTACH];
  assert.equal(fitCount(w, 300, 0), 3);
  // 100px of furniture leaves 200 -> yolo + effort.
  assert.equal(fitCount(w, 300, 100), 2);
  // 250px of furniture leaves 50 -> nothing.
  assert.equal(fitCount(w, 300, 250), 0);
});

test("an item wider than the whole budget collapses rather than overflowing", () => {
  // The critical safety property: a 500px control in a 100px row must NOT be
  // reported as visible, or the toolbar overflows the viewport.
  assert.equal(fitCount([500, 20], 100), 0);
  assert.equal(fitCount([500, 20], 100, 0), 0);
});

test("unmeasured (NaN / zero / negative) widths are ignored, not reserved", () => {
  // During the first paint the DOM has no widths yet. Treating NaN as "huge" would
  // collapse everything on every reload; treating it as free is correct.
  //
  // fitCount returns how many items are VISIBLE, and a skipped item is still visible
  // (it just reserves no space yet) — so the count here stays 3, not 2. What matters
  // is that effort+attach (134px) still fit inside 300px: a NaN treated as huge would
  // have returned 0 and collapsed the whole row on every reload.
  assert.equal(fitCount([NaN, EFFORT, ATTACH], 300), 3, "NaN skipped, the rest still fits");
  assert.equal(fitCount([0, 0, 0], 100), 3, "zero-width items are free");
  // A skipped item is still VISIBLE (it just reserves no space yet), so a negative
  // width behaves like NaN here: counted, not charged. What must not happen is a
  // collapse, because treating an unmeasured width as "huge" would collapse the row
  // on every first paint.
  assert.equal(fitCount([-5, EFFORT], 300), 2, "negative counted but not charged");
  assert.equal(fitCount([-5, EFFORT], 10), 1, "a negative must not force a collapse");
});

test("the boundary is EXACT — the last pixel decides", () => {
  // yolo(80) + effort(100) = 180 exactly.
  assert.equal(fitCount([YOLO, EFFORT], 180), 2, "exactly enough fits");
  assert.equal(fitCount([YOLO, EFFORT], 179), 1, "one pixel short drops the second");
});

test("splitVisible collapses in COLLAPSE_ORDER: yolo, then effort, then attach", () => {
  const items: FitItem[] = [
    { key: "attach", width: ATTACH },
    { key: "provider", width: 0, pinned: true },
    { key: "model", width: 0, pinned: true },
    { key: "effort", width: EFFORT },
    { key: "yolo", width: YOLO },
  ];
  // Wide: all three collapsible visible, provider/model pinned (menu-only).
  const wide = splitVisible(items, 1000);
  assert.deepEqual(wide.visible, ["yolo", "effort", "attach"], "wide row shows all, in priority order");
  assert.deepEqual(wide.hidden, []);

  // Tighten one step at a time and assert exactly WHICH item leaves the bar each time.
  const steps: Array<[number, string[]]> = [
    [300, ["yolo", "effort", "attach"]],
    [180, ["yolo", "effort"]],
    [80, ["yolo"]],
    [10, []],
  ];
  for (const [avail, expectVisible] of steps) {
    const r = splitVisible(items, avail);
    assert.deepEqual(r.visible, expectVisible, `at ${avail}px the bar keeps ${expectVisible.join(",") || "nothing"}`);
  }
});

test("pinned items NEVER appear on the bar, only in the menu", () => {
  // The owner's rule: provider and model live in the options menu at ALL widths.
  const items: FitItem[] = [
    { key: "provider", width: 0, pinned: true },
    { key: "model", width: 0, pinned: true },
    { key: "effort", width: EFFORT },
    { key: "yolo", width: YOLO },
  ];
  for (const avail of [0, 50, 200, 5000]) {
    const r = splitVisible(items, avail);
    assert.ok(!r.visible.includes("provider"), `provider must stay in the menu at ${avail}px`);
    assert.ok(!r.visible.includes("model"), `model must stay in the menu at ${avail}px`);
  }
});

test("an unknown key collapses LAST — it is safer to keep than to lose", () => {
  const items: FitItem[] = [
    { key: "mystery", width: 40 },
    { key: "yolo", width: YOLO },
    { key: "effort", width: EFFORT },
  ];
  // Only room for one: yolo wins, the unknown key is not preferred over it.
  const r = splitVisible(items, 90);
  assert.deepEqual(r.visible, ["yolo"], "the known-priority control is kept");
  assert.deepEqual(r.hidden.sort(), ["effort", "mystery"]);
});

test("visible + hidden always accounts for every collapsible item exactly once", () => {
  // The invariant that actually matters to the user: no button can be LOST. If an item
  // appeared in neither list it would be unreachable; in both, it would be duplicated.
  const items: FitItem[] = [
    { key: "attach", width: ATTACH },
    { key: "provider", width: 0, pinned: true },
    { key: "model", width: 0, pinned: true },
    { key: "effort", width: EFFORT },
    { key: "yolo", width: YOLO },
  ];
  const collapsible = items.filter((i) => !i.pinned).map((i) => i.key).sort();
  for (const avail of [0, 5, 79, 80, 81, 179, 180, 181, 300, 5000]) {
    const r = splitVisible(items, avail);
    const seen = [...r.visible, ...r.hidden].sort();
    assert.deepEqual(seen, collapsible, `at ${avail}px every collapsible control is reachable exactly once`);
    const overlap = r.visible.filter((k) => r.hidden.includes(k));
    assert.deepEqual(overlap, [], `at ${avail}px nothing is both shown and hidden`);
  }
});

test("the collapse order constant is the documented one", () => {
  assert.deepEqual([...COLLAPSE_ORDER], ["yolo", "effort", "attach"],
    "least-used collapses first, attach (used every time) is the last to go");
});

test("monotonic: more space never shows FEWER controls", () => {
  // A toolbar that drops a button when you widen the window is obviously broken, and
  // it is exactly what a naive measure-and-truncate implementation produces.
  const items: FitItem[] = [
    { key: "attach", width: ATTACH },
    { key: "effort", width: EFFORT },
    { key: "yolo", width: YOLO },
  ];
  let prev = -1;
  for (let avail = 0; avail <= 400; avail += 5) {
    const n = splitVisible(items, avail).visible.length;
    assert.ok(n >= prev, `at ${avail}px visible=${n} must not drop below ${prev}`);
    prev = n;
  }
});
