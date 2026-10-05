// Pagination must never emit an empty page, and the shipped partition check
// must be able to SEE that (2026-10-05).
//
// The defect: page ranges are half-open [start, end) — packSections pushes
// [start, u] where u is the first unit that did NOT fit. When a page held
// exactly a section heading, u - start === 1 and the old push [start, u - 1]
// collapsed to [start, start] — a ZERO-WIDTH range. Measured 396 of 840
// realistic 3-block configurations (47%): the report's first page rendered
// nothing and the folio printed "1 / 2" over a blank sheet.
//
// Why the shipped gate missed it: assertPartition checks that the first range
// starts at 0, the last ends at n, the ranges abut, and coverage === n. Every
// one of those HOLDS on the broken output ([0,0] abuts [0,2], covered = 0 + 2 = 2
// = n). So the invariant set has a hole and this file closes it.
//
// Run: npx tsx src/lib/canvas-pagination.blankpage.check.ts
import assert from "node:assert";
import { test } from "node:test";
import { packSections, isSectionStart, availHeight, toUnits, type BlockMeta } from "./canvas-pagination";

const empties = (pages: [number, number][]) => pages.filter(([s, e]) => e <= s);

/** Sweep every realistic 3-block shape: a section heading + two body units. */
function sweep(mode: "a4" | "slide") {
  let total = 0;
  const bad: string[] = [];
  for (const h1 of [20, 40, 60, 80, 100, 120])
    for (const t1 of [50, 100, 200, 300, 500, 700, 900, 1000, 1200, 1500])
      for (const t2 of [20, 50, 100, 300, 600, 900, 1100]) {
        total++;
        const blocks = [
          { type: "divider", h: h1 },
          { type: "table", h: t1 },
          { type: "table", h: t2 },
        ] as never as BlockMeta[];
        const pages = packSections(blocks, mode);
        if (empties(pages).length) bad.push(`h${h1} t${t1} t${t2} ${mode} -> ${JSON.stringify(pages)}`);
      }
  return { total, bad };
}

for (const mode of ["a4", "slide"] as const) {
  test(`no empty page range — 3-block sweep (${mode})`, () => {
    const { total, bad } = sweep(mode);
    assert.equal(bad.length, 0, `${bad.length}/${total} configs emitted an empty page:\n  ${bad.slice(0, 4).join("\n  ")}`);
  });
}

test("the headline case: a heading + a body too tall to share the page", () => {
  // The exact reported shape: a divider then a table that fills the page.
  const pages = packSections(
    [{ type: "divider", h: 40 }, { type: "table", h: 1000 }] as never as BlockMeta[],
    "a4",
  );
  assert.equal(empties(pages).length, 0, `empty page in ${JSON.stringify(pages)}`);
  // one page, holding both units — not two pages where the first is blank
  assert.equal(pages.length, 1, `expected 1 page, got ${JSON.stringify(pages)}`);
  assert.deepEqual(pages[0], [0, 2]);
});

test("a heading and its body are never split across pages", () => {
  const pages = packSections(
    [{ type: "divider", h: 40 }, { type: "table", h: 1000 }] as never as BlockMeta[],
    "a4",
  );
  const headingPage = pages.findIndex(([s, e]) => s <= 0 && 0 < e);
  const bodyPage = pages.findIndex(([s, e]) => s <= 1 && 1 < e);
  assert.equal(headingPage, bodyPage, "heading and its body landed on different pages");
});

test("unit coverage is complete and never duplicated", () => {
  // Note: adjacent tables are GROUPED into a single unit by toUnits, so the
  // expected coverage is 0..units.length-1 — not the block count. Asserting
  // against the real unit list is what makes this meaningful.
  for (const mode of ["a4", "slide"] as const) {
    for (const [h1, t1, t2] of [[40, 1000, 20], [20, 700, 100], [100, 1500, 1500]] as const) {
      const blocks = [
        { type: "divider", h: h1 },
        { type: "table", h: t1 },
        { type: "table", h: t2 },
      ] as never as BlockMeta[];
      const nUnits = toUnits(blocks, mode).length;
      const flat = packSections(blocks, mode).flatMap(([s, e]) =>
        Array.from({ length: Math.max(0, e - s) }, (_, k) => s + k),
      );
      assert.deepEqual(
        flat,
        Array.from({ length: nUnits }, (_, k) => k),
        `${mode} h${h1} t${t1} t${t2} -> ${JSON.stringify(flat)} over ${nUnits} units`,
      );
    }
  }
});

test("a heading alone still gets its own page (not silently merged)", () => {
  const pages = packSections([{ type: "divider", h: 40 }] as never as BlockMeta[], "a4");
  assert.deepEqual(pages, [[0, 1]], `a lone heading must still paginate: ${JSON.stringify(pages)}`);
});

test("an empty document still yields exactly one (empty) page", () => {
  assert.deepEqual(packSections([] as never as BlockMeta[], "a4"), [[0, 0]]);
});

test("isSectionStart is what makes a heading a heading", () => {
  assert.equal(isSectionStart("divider"), true);
  assert.equal(isSectionStart("kpi"), false);
  assert.ok(availHeight("a4") > 0 && availHeight("slide") > 0);
});