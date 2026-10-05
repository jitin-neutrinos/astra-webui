// Run: npx tsx --test src/lib/canvas-pagination.check.ts
//
// Pins section-aware pagination. Two defects are covered here:
//   1. The export captured only the CURRENTLY VISIBLE page, so a 9-page report
//      downloaded a 1-page PDF while the viewer said "page 1 of 9".
//   2. Pagination was height-only, so a section heading landed at the foot of
//      one page with its body starting the next, and a big table could split.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toBlockRanges, toUnits, pageCount, pageOverflows, isSectionStart, groupLikeBlocks,
  availHeight, pageHeight, pageWidth, A4, SLIDE,
  type BlockMeta, type PageMode,
} from "./canvas-pagination";

/** Assert the ranges cover 0..n exactly once, in order, with no gaps. */
function assertPartition(ranges: [number, number][], n: number, label: string) {
  assert.equal(ranges[0]![0], 0, `${label}: starts at 0`);
  assert.equal(ranges[ranges.length - 1]![1], n, `${label}: ends at n`);
  for (let i = 1; i < ranges.length; i++) {
    assert.equal(ranges[i]![0], ranges[i - 1]![1], `${label}: page ${i} abuts ${i - 1}`);
  }
  const covered = ranges.reduce((a, [s, e]) => a + (e - s), 0);
  assert.equal(covered, n, `${label}: every block on exactly one page`);
}

const DIV = (label = "Part"): BlockMeta => ({ h: 40, type: "divider", label });
const PARA = (h = 120): BlockMeta => ({ h, type: "callout" });
const TABLE = (h = 700): BlockMeta => ({ h, type: "table" });
const KPI = (h = 90): BlockMeta => ({ h, type: "kpi" });

test("page geometry is the real A4 and 16:9 boxes", () => {
  assert.equal(A4.h, 1123);
  assert.equal(SLIDE.w, 1280);
  assert.equal(SLIDE.h, 720);
  assert.equal(pageHeight("a4"), A4.h);
  assert.equal(pageHeight("slide"), SLIDE.h);
  assert.equal(pageWidth("a4"), A4.w);
  assert.equal(pageWidth("slide"), SLIDE.w);
  assert.ok(availHeight("slide") < availHeight("a4"));
});

test("a labelled divider opens a section; a bare callout does not", () => {
  assert.equal(isSectionStart("divider"), true);
  assert.equal(isSectionStart("divider", "Part 1"), true);
  assert.equal(isSectionStart("callout", "Verdict: healthy"), true);
  assert.equal(isSectionStart("callout"), false);
  assert.equal(isSectionStart("kpi", "Uptime"), false);
});

test("a short card is one page in both formats", () => {
  const blocks = [KPI(), PARA(), PARA()];
  for (const mode of ["a4", "slide"] as PageMode[]) {
    assert.deepEqual(toBlockRanges(blocks, mode), [[0, 3]], mode);
  }
});

test("an empty block list is one empty page, never zero", () => {
  for (const mode of ["a4", "slide"] as PageMode[]) {
    assert.deepEqual(toBlockRanges([], mode), [[0, 0]]);
    assert.equal(pageCount([], mode), 1);
  }
});

// Core regression: content taller than one page must produce SEVERAL pages and
// every block must survive.
test("tall content splits into multiple pages and loses nothing", () => {
  const blocks = Array.from({ length: 40 }, () => PARA(300));
  for (const mode of ["a4", "slide"] as PageMode[]) {
    const ranges = toBlockRanges(blocks, mode);
    assert.ok(ranges.length > 1, `${mode}: expected >1 page, got ${ranges.length}`);
    assertPartition(ranges, blocks.length, mode);
  }
});

test("a 16:9 page holds less than A4, so the same content needs more slides", () => {
  const blocks = Array.from({ length: 12 }, () => PARA(200));
  const a4 = pageCount(blocks, "a4");
  const slide = pageCount(blocks, "slide");
  assert.ok(slide > a4, `expected more slides than pages (${slide} vs ${a4})`);
  assertPartition(toBlockRanges(blocks, "a4"), blocks.length, "a4");
  assertPartition(toBlockRanges(blocks, "slide"), blocks.length, "slide");
});

test("a section heading is never orphaned at the foot of a page", () => {
  // Page 1 fills up with flow content; the divider cannot fit, so it must move
  // down WITH its body rather than being left at the foot of page 1.
  const blocks = [PARA(400), PARA(400), PARA(240), DIV("Part 2"), PARA(200)];
  const ranges = toBlockRanges(blocks, "a4");
  assertPartition(ranges, blocks.length, "orphan");
  // The divider (index 3) must never be the LAST block on a page.
  assert.ok(
    !ranges.some(([, e]) => e === 3 && e < blocks.length),
    "divider does not end a page while content remains",
  );
  // And it must share its page with the body block that follows it.
  const idx = ranges.findIndex(([s, e]) => s <= 3 && 3 < e);
  assert.ok(idx >= 0);
  assert.ok(ranges[idx]![1] > 4, "divider shares its page with the block after it");
});

test("adjacent atomic blocks stay together as one unit", () => {
  // Two tables with no section break between them join into one unit. The
  // divider is a section start, so it opens its own; the table after it cannot
  // join backwards, so it opens one more.
  const units = toUnits([TABLE(400), TABLE(300), DIV("Next"), TABLE(200)]);
  assert.deepEqual(
    units.map((u) => [u.start, u.end]),
    [[0, 2], [2, 3], [3, 4]],
  );
  assert.equal(units[0]!.section, false, "joined table run is not a section");
  assert.equal(units[1]!.section, true, "the divider unit is a section start");
  // The two tables really did merge: unit 0 is taller than either alone.
  assert.ok(units[0]!.h > TABLE(400).h, "unit absorbed the second table");
});

test("oversized units never merge into one page", () => {
  // Each table is taller than a 16:9 page on its own, so each must get its own
  // page. Merging them produced a single page holding all seven.
  const big = availHeight("slide") + 1;
  const blocks = Array.from({ length: 4 }, () => TABLE(big));
  const ranges = toBlockRanges(blocks, "slide");
  assert.equal(ranges.length, 4, "one page per oversized table");
  assertPartition(ranges, blocks.length, "oversized");
});

test("a section heading never sits alone on a page", () => {
  const avail = availHeight("a4");
  const blocks = [DIV("Part 9"), TABLE(avail - 60)];
  for (const [s, e] of toBlockRanges(blocks, "a4")) {
    assert.ok(
      !(e - s === 1 && blocks[s]!.type === "divider"),
      "a divider must never be a page by itself",
    );
  }
});

test("a large table is never split across pages", () => {
  const avail = availHeight("a4");
  const blocks = [PARA(300), TABLE(avail - 200), PARA(300)];
  const ranges = toBlockRanges(blocks, "a4");
  const idx = ranges.findIndex(([s, e]) => s <= 1 && 1 < e);
  assert.ok(idx >= 0, "table is on some page");
  const next = ranges[idx + 1];
  if (next) assert.ok(next[0] >= ranges[idx]![1], "no boundary inside the table");
});

test("a block taller than a whole page gets its own page and is flagged", () => {
  const huge = availHeight("a4") * 2;
  const blocks = [{ h: huge, type: "table" }, PARA(100)];
  const ranges = toBlockRanges(blocks, "a4");
  assert.equal(ranges[0]![0], 0);
  assert.equal(pageOverflows(blocks, "a4", ranges[0]!), true);
  assertPartition(ranges, blocks.length, "huge");
});

test("zero and negative measurements never lose a block", () => {
  const blocks = [{ h: 0, type: "chart" }, { h: -1, type: "callout" }, PARA(300)];
  assertPartition(toBlockRanges(blocks, "a4"), 3, "zeroish");
});

test("a block that exactly fills the page does not spill to an empty page", () => {
  const avail = availHeight("a4");
  const half = Math.floor(avail / 2);
  const blocks: BlockMeta[] = [{ h: half, type: "para" }, { h: avail - half, type: "para" }];
  const ranges = toBlockRanges(blocks, "a4");
  assert.equal(ranges.length, 2);
  assertPartition(ranges, 2, "exact");
  assert.equal(pageOverflows(blocks, "a4", ranges[0]!), false);
});

test("one unit per page is the worst case and still partitions", () => {
  // Oversized tables: each exceeds a 16:9 page alone, so each gets its own.
  const blocks = Array.from({ length: 7 }, () => TABLE(availHeight("slide") + 1));
  const ranges = toBlockRanges(blocks, "slide");
  assert.equal(ranges.length, 7);
  assertPartition(ranges, blocks.length, "worst");
});

test("a long report always paginates and always partitions", () => {
  const blocks: BlockMeta[] = [];
  for (let p = 1; p <= 9; p++) {
    blocks.push(DIV(`Part ${p}`), PARA(260), KPI(), TABLE(520), PARA(260));
  }
  for (const mode of ["a4", "slide"] as PageMode[]) {
    const ranges = toBlockRanges(blocks, mode);
    assert.ok(ranges.length > 1, `${mode}: expected multiple pages`);
    assertPartition(ranges, blocks.length, mode);
  }
});

test("no divider is ever stranded alone at the foot of a page", () => {
  const blocks: BlockMeta[] = [PARA(500)];
  const dividers: number[] = [];
  for (let p = 1; p <= 6; p++) {
    dividers.push(blocks.length);
    blocks.push(DIV(`Section ${p}`), PARA(300), PARA(300));
  }
  const ranges = toBlockRanges(blocks, "a4");
  assertPartition(ranges, blocks.length, "sections");
  for (const di of dividers) {
    const idx = ranges.findIndex(([s, e]) => s <= di && di < e);
    assert.ok(idx >= 0, `divider ${di} is on a page`);
    const [s, e] = ranges[idx]!;
    assert.ok(s === di || di > s, `divider ${di} stranded at the foot`);
    if (ranges.length > 1) {
      assert.ok(e > di + 1, `divider ${di} is alone on its page`);
    }
  }
});

test("packing is deterministic — same input, same pages", () => {
  const blocks = [DIV("A"), PARA(200), KPI(), TABLE(600), PARA(150), DIV("B"), PARA(400)];
  const a = toBlockRanges(blocks, "a4");
  assert.deepEqual(a, toBlockRanges(blocks, "a4"));
  assertPartition(a, blocks.length, "determinism");
});

test("KPI grouping is mirrored: 4 KPIs measure as ONE row, not four", () => {
  // `Blocks` renders up to 4 KPIs in a single row. Measuring them individually
  // produced 4 heights where the page renders 1 row, so the two index spaces
  // disagreed and a 2309px report reported as "1 / 1". The component mirrors
  // this grouping; pin the shape it relies on.
  const kpis = Array.from({ length: 4 }, () => ({ h: 92, type: "kpi" }));
  const groups = groupLikeBlocks(kpis);
  assert.equal(groups.length, 1, "four KPIs form one row");
  assert.equal(groupLikeBlocks([...kpis, { h: 92, type: "kpi" }]).length, 2,
    "a fifth KPI starts a second row");
});

test("measurement reaches the paginator: rig count must equal group count", () => {
  // The original defect was structural, not arithmetic: the measuring element
  // was reached through a ref that is null on the first commit, so the effect
  // bailed and never re-ran (refs do not trigger renders). Measurement must be
  // wired so it runs once the node exists. This pins the invariant the fix
  // relies on — the packer is only ever handed a complete, aligned list.
  const blocks: BlockMeta[] = [
    { h: 144, type: "callout" },
    { h: 18, type: "divider", label: "Part 1" },
    { h: 92, type: "kpi" },
    { h: 127, type: "callout" },
    { h: 18, type: "divider", label: "Part 2" },
    { h: 521, type: "table" },
    { h: 18, type: "divider", label: "Part 3" },
    { h: 311, type: "table" },
    { h: 18, type: "divider", label: "Part 4" },
    { h: 354, type: "checklist" },
    { h: 18, type: "divider", label: "Part 5" },
    { h: 84, type: "terminal" },
    { h: 18, type: "divider", label: "Part 6" },
    { h: 292, type: "steps" },
  ];
  // These are the exact heights a real A4 report measured in-browser.
  const sum = blocks.reduce((a, b) => a + b.h, 0);
  assert.ok(sum > availHeight("a4") * 1.5, "report is genuinely multi-page");
  const ranges = toBlockRanges(blocks, "a4");
  assert.equal(ranges.length, 3, "the measured report paginates to 3 A4 pages");
  assertPartition(ranges, blocks.length, "measured");
});

test("pageCount agrees with the range count", () => {
  const blocks = [DIV("A"), PARA(300), TABLE(700), PARA(120), DIV("B"), KPI()];
  for (const mode of ["a4", "slide"] as PageMode[]) {
    assert.equal(pageCount(blocks, mode), toBlockRanges(blocks, mode).length, mode);
  }
});

// Regression: the component once gated measurement behind a `ready` flag that
// an effect reset on every render, so measurement and reset deadlocked and the
// fallback (everything on ONE page) won — the "no page 2, infinite scroll"
// report. The packer is only ever handed a settled height list, so guard the
// contract the component relies on: complete metadata in, multiple pages out.
test("complete metadata always yields the real page count, never the fallback", () => {
  const blocks: BlockMeta[] = [
    { h: 120, type: "callout", label: "intro" },
    { h: 40, type: "divider", label: "Part 1" },
    { h: 90, type: "kpi" }, { h: 90, type: "kpi" },
    { h: 700, type: "table" },
    { h: 40, type: "divider", label: "Part 2" },
    { h: 500, type: "checklist" },
    { h: 200, type: "terminal" },
  ];
  for (const mode of ["a4", "slide"] as PageMode[]) {
    const ranges = toBlockRanges(blocks, mode);
    assert.ok(ranges.length > 1, `${mode}: must paginate, got ${ranges.length} page(s)`);
    assertPartition(ranges, blocks.length, mode);
    assert.notDeepEqual(ranges, [[0, blocks.length]], `${mode}: must not be the one-page fallback`);
  }
});

test("overflow is only true for the page that actually exceeds the box", () => {
  const blocks = [PARA(200), PARA(200), TABLE(availHeight("a4") * 2)];
  const ranges = toBlockRanges(blocks, "a4");
  assert.deepEqual(ranges.map((r) => pageOverflows(blocks, "a4", r)), [false, true]);
});