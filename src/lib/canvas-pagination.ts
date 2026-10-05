// Section-aware pagination for canvas export.
//
// A report is not a stream of equal blocks. It is a document with SECTIONS:
// a heading, the content that belongs to it, then a break. Splitting purely by
// height drops a section's heading onto one page and its body onto the next,
// which is why height-only pagination feels wrong even when the math is right.
//
// Rules, in order of strength:
//   1. ATOMIC units never split. Half a table is not a page of a report.
//   2. A section heading that would be orphaned at the foot of a page moves
//      down with its body.
//   3. A section heading never sits alone on a page.
//   4. Otherwise, fill greedily.
//
// `packPages` (height-only) is kept as the degenerate case: with no section
// markers anywhere, toUnits() yields one unit per block and this function
// reduces to the original greedy fill.

export const A4 = { w: 794, h: 1123, label: "A4 portrait" } as const;
export const SLIDE = { w: 1280, h: 720, label: "16:9 landscape" } as const;

/**
 * Page margins, in px. ONE source of truth: the component feeds these to CSS
 * as `--pad-x` / `--pad-y`, and availHeight() subtracts them, so the measured
 * content height and the painted page box can never disagree (which silently
 * mis-paginates every report).
 */
export const PAD_X = 48;
export const PAD_Y = 44;

/** Vertical gap between blocks inside a page. */
export const GAP = 18;

export type PageMode = "a4" | "slide";

/** Blocks that must never be broken across a page boundary. */
const ATOMIC = new Set([
  "chart", "table", "heatmap", "diagram", "graph", "image", "gallery", "video",
  "code", "terminal", "diff", "spreadsheet", "tree", "keyvalue", "compare",
]);

/**
 * Blocks that open a new section. A labelled `divider` is the common case
 * ("Part 3 — Defects"); a labelled callout or quote also counts, since authors
 * use those as section headers too.
 */
export function isSectionStart(type: string, label?: string): boolean {
  if (type === "divider") return true;
  if (!label) return false;
  return type === "callout" || type === "quote";
}

export type UnitKind = "atomic" | "flow";

export function kindOf(type: string): UnitKind {
  return ATOMIC.has(type) ? "atomic" : "flow";
}

export function pageHeight(mode: PageMode): number {
  return mode === "a4" ? A4.h : SLIDE.h;
}

export function pageWidth(mode: PageMode): number {
  return mode === "a4" ? A4.w : SLIDE.w;
}

/** Usable content height on one page. */
export function availHeight(mode: PageMode): number {
  return pageHeight(mode) - PAD_Y * 2;
}

export interface BlockMeta {
  /** Measured height in px. A 0/absent measurement falls back to 100. */
  h: number;
  type: string;
  /** Divider/callout/quote label, used to detect section starts. */
  label?: string;
}

/** An unbreakable run of one or more blocks. */
export interface Unit {
  /** Index of the first block in this unit. */
  start: number;
  /** Exclusive end index. */
  end: number;
  /** True when the unit opens a new section. */
  section: boolean;
  /** Unit height, gaps included. */
  h: number;
}

/**
 * Group blocks exactly the way `Blocks` renders them.
 *
 * `Blocks` puts KPI and progress blocks into rows — up to 4 KPIs per row, one
 * progress bar per row — and leaves every other block standalone
 * (canvas-blocks.tsx). Measurement MUST use this grouping: measuring each block
 * in isolation yields one height per BLOCK while the page renders one row per
 * GROUP, so the two index spaces disagree. Measured live: 17 isolated blocks
 * against 14 rendered rows, and a 2309px report (three A4 pages) reported as a
 * single "1 / 1" page.
 *
 * Kept here rather than in the component so it is directly testable — if
 * `Blocks` changes its grouping, this must change with it.
 */
export function groupLikeBlocks<T extends { type: string }>(blocks: readonly T[]): T[][] {
  const ROWY = new Set(["kpi", "progress"]);
  const groups: T[][] = [];
  let rowRun: T[] = [];
  const flush = () => { if (rowRun.length > 0) { groups.push(rowRun); rowRun = []; } };
  for (const b of blocks) {
    if (ROWY.has(b.type)) {
      rowRun.push(b);
      if (b.type === "kpi") {
        if (rowRun.filter((x) => x.type === "kpi").length >= 4) flush();
      } else {
        flush();
      }
    } else {
      flush();
      groups.push([b]);
    }
  }
  flush();
  return groups;
}

function heightOf(m: BlockMeta): number {
  return m.h > 0 ? m.h : 100;
}

/**
 * Group blocks into unbreakable units.
 *
 * An atomic block absorbs any atomic neighbours that follow it without a section
 * break, so a wide table plus the key-value strip beside it stay together
 * instead of leaving a stray narrow column on the next page.
 */
export function toUnits(blocks: readonly BlockMeta[], mode: PageMode = "a4"): Unit[] {
  const availHeightGuess = availHeight(mode);
  const units: Unit[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    const section = isSectionStart(b.type, b.label);
    let end = i + 1;
    let h = heightOf(b);
    if (kindOf(b.type) === "atomic") {
      while (end < blocks.length
        && kindOf(blocks[end]!.type) === "atomic"
        && !isSectionStart(blocks[end]!.type, blocks[end]!.label)) {
        // Never merge past a page boundary: a run of oversized tables chained
        // into one unit produced a single page holding all of them.
        if (h + GAP + heightOf(blocks[end]!) > availHeightGuess) break;
        h += GAP + heightOf(blocks[end]!);
        end++;
      }
    }
    units.push({ start: i, end, section, h });
    i = end;
  }
  return units;
}

/**
 * Pack units into pages, honouring section boundaries.
 *
 * @returns `[startUnit, endUnitExclusive)` per page. Convert to block ranges
 *          with `units[start].start .. units[end-1].end`.
 */
export function packSections(blocks: readonly BlockMeta[], mode: PageMode): [number, number][] {
  if (blocks.length === 0) return [[0, 0]];
  const avail = availHeight(mode);
  const units = toUnits(blocks, mode);
  const pages: [number, number][] = [];

  let start = 0;   // unit index where the current page began
  let used = 0;    // height consumed on the current page

  for (let u = 0; u < units.length; u++) {
    const unit = units[u]!;
    const isFirst = u === start;
    const add = isFirst ? unit.h : GAP + unit.h;

    if (!isFirst && used + add <= avail) {
      // SECTION RULE: a new section starts a fresh page when at least half the
      // page is still free — that reads as a deliberate section break, the way
      // a printed report does it. Filling every gap instead produced a
      // continuous scroll with headings buried mid-page, which is exactly the
      // "not section aware" complaint. A heading with only a sliver of room
      // still flows on, so short sections do not each waste a page.
      if (!unit.section || used * 2 <= avail) { used += add; continue; }
    }

    if (isFirst) {
      // Only a genuinely oversized unit gets its own page here. A unit that
      // merely opens a page is left alone: emitting a page for it AND then
      // re-testing it as `!isFirst` next iteration is what split every short
      // card one-block-per-page.
      if (unit.h > avail) {
        pages.push([u, u + 1]);
        start = u + 1;
        used = 0;
      } else {
        used = unit.h;
      }
      continue;
    }

    // Does not fit. Rule 2: never orphan a section heading at the page foot.
    if (unit.section) {
      pages.push([start, u]);
      start = u;
      used = unit.h;
      // Rule 3: a heading must not sit alone — if its first body unit cannot
      // share the page, carry the heading down WITH that body unit.
      const next = units[u + 1];
      if (next && unit.h + GAP + next.h > avail) {
        pages.push([u, u + 1]);
        start = u + 1;
        used = 0;
      }
      continue;
    }

    // Rule 3, the other direction: a page holding only a section heading (its
    // body did not fit) carries the heading down with that body unit rather
    // than stranding the heading alone at the foot.
    if (u - start === 1 && units[start]!.section) {
      pages.push([start, u - 1]);
      start = u - 1;
      used = units[u - 1]!.h + GAP + unit.h;
      continue;
    }

    pages.push([start, u]);
    start = u;
    used = unit.h;
  }

  // Close the last page only if the loop left one open. Pushing
  // unconditionally emitted an empty trailing page whenever the final unit
  // had already been flushed above.
  if (start < units.length) pages.push([start, units.length]);
  return pages;
}

/** Map packed unit ranges to block-index ranges. */
export function toBlockRanges(
  blocks: readonly BlockMeta[],
  mode: PageMode,
): [number, number][] {
  const units = toUnits(blocks, mode);
  return packSections(blocks, mode).map(([s, e]) => [
    units[s]?.start ?? 0,
    e === 0 ? 0 : (units[e - 1]?.end ?? blocks.length),
  ]);
}

/** Height-only greedy pack — retained for callers with no block metadata. */
export function packPages(heights: readonly number[], mode: PageMode): [number, number][] {
  const avail = availHeight(mode);
  if (heights.length === 0) return [[0, 0]];
  const pages: [number, number][] = [];
  let start = 0;
  let used = 0;
  for (let i = 0; i < heights.length; i++) {
    const h = heightOf({ h: heights[i], type: "" });
    const add = i === start ? h : GAP + h;
    if (i > start && used + add > avail) {
      pages.push([start, i]);
      start = i;
      used = h;
    } else {
      used += add;
    }
  }
  pages.push([start, heights.length]);
  return pages;
}

/** How many pages a run of blocks fills. */
export function pageCount(blocks: readonly BlockMeta[], mode: PageMode): number {
  return toBlockRanges(blocks, mode).length;
}

/**
 * True when a page's content exceeds its box — i.e. one unbreakable unit is
 * taller than a page and will be clipped. Surfaced, not silently cut.
 */
export function pageOverflows(
  blocks: readonly BlockMeta[],
  mode: PageMode,
  range: readonly [number, number],
): boolean {
  const units = toUnits(blocks, mode);
  const avail = availHeight(mode);
  let used = 0;
  for (let i = range[0]; i < range[1]; i++) {
    const u = units[i];
    if (!u) continue;
    used += i === range[0] ? u.h : GAP + u.h;
  }
  return used > avail;
}