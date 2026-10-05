// canvas-stats.ts — the summary statistics `table.stats` asks for, COMPUTED HERE.
//
// Why the renderer does the arithmetic: a mean quoted in prose is a number the
// model produced, and a model that miscounts a mean is indistinguishable from one
// that is right. Asking for `stats:["mean","p95"]` means the number on the card is
// the number the rows actually imply — the footer cannot be wrong because the
// model never wrote it.
//
// This module is PURE and dependency-free (it imports nothing from d3), so it is
// unit-testable in node without a DOM and it costs the eager path zero bytes: it
// is imported only by the lazy table renderer.
import type { TableStat } from "./canvas-schema";

/** What a computed stat can be: a number, or nothing (an empty column). */
export type StatValue = number | null;

export interface ColumnStat {
  /** The column header it was computed from. */
  column: string;
  /** Every requested statistic, in REQUEST order (never sorted or reordered). */
  values: StatValue[];
}

/** Human labels for the footer header. Abbreviations only where the word is long
 *  enough to crowd a column (`sd`, `p95`); everything else stays readable.
 *  `n` for count is the one non-obvious one: it is the convention every stats
 *  table uses, and the footer's own row header already names the column.
 *
 *  There is deliberately NO fixed order here: the footer shows the statistics in
 *  the order the card ASKED for (see `statNames` in canvas-blocks), so the header
 *  is built from the request rather than from a canonical list. */
export const STAT_LABEL: Record<TableStat, string> = {
  count: "n",
  mean: "mean",
  median: "median",
  sd: "sd",
  min: "min",
  max: "max",
  p95: "p95",
};

const NUMERIC = /^[\s-+]?[\d,]*\.?\d+\s*%?$/;

/**
 * Parse a table cell as a number, or null.
 *
 * Deliberately strict: it strips the SAME separators the table renderer aligns on
 * (thousands commas, a currency or percent suffix, surrounding space) and refuses
 * everything else. A loose parser here would read "n/a" as 0 and then report a
 * mean that includes the missing values — a footer that is worse than no footer.
 * Percentages are read as their numeric magnitude (12% -> 12), so a column mixing
 * "12%" and "40" is summarised as one scale; the column header carries the unit.
 */
export function cellNum(s: string): number | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t || !NUMERIC.test(t)) return null;
  const n = Number(t.replace(/[,\s]/g, "").replace(/%$/, ""));
  return Number.isFinite(n) ? n : null;
}

/** Quantile of an ALREADY-SORTED array (R-7 / d3's quantileSorted, inclusive). */
function quantileSorted(sorted: number[], p: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  if (n === 1) return sorted[0];
  const i = (n - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Sample standard deviation (n-1). A single value has NO sample sd, so it is
 *  null rather than 0 — a 0 would read as "no variance" instead of "unknown". */
function sd(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const ss = values.reduce((a, b) => a + (b - mean) ** 2, 0);
  return Math.sqrt(ss / (n - 1));
}

export function computeStat(values: number[], stat: TableStat): StatValue {
  if (values.length === 0) return null;
  switch (stat) {
    case "count": return values.length;
    case "mean": return values.reduce((a, b) => a + b, 0) / values.length;
    case "sd": return sd(values);
    case "min": case "max": case "median": case "p95": break;
  }
  const sorted = [...values].sort((a, b) => a - b);
  switch (stat) {
    case "min": return sorted[0];
    case "max": return sorted[sorted.length - 1];
    case "median": return quantileSorted(sorted, 0.5);
    case "p95": return quantileSorted(sorted, 0.95);
  }
  return null;
}

/**
 * The footer rows for a table.
 *
 * A column is summarised when it is NUMERIC — at least one cell parses and every
 * non-empty cell parses. A text column (`"n/a"` beside `9`) is skipped rather
 * than guessed at: a mean over a column of labels is a lie, and the header already
 * says which columns are numbers.
 *
 * Returns `undefined` when no column qualifies, so the caller renders no footer
 * at all instead of an empty one.
 */
export function tableStats(
  columns: string[],
  rows: string[][],
  request: { columns?: string[]; compute?: TableStat[] } | undefined,
): ColumnStat[] | undefined {
  if (!request) return undefined;
  const wanted = request.columns?.length
    ? new Set(request.columns.map((c) => c.trim().toLowerCase()))
    : undefined;
  const stats = request.compute?.length ? request.compute : (["mean", "median", "sd", "min", "max", "p95"] as TableStat[]);

  const out: ColumnStat[] = [];
  columns.forEach((col, j) => {
    if (wanted && !wanted.has(col.trim().toLowerCase())) return;
    const cells = rows.map((r) => (r[j] ?? "").trim()).filter((c) => c !== "");
    if (cells.length === 0) return;
    const parsed = cells.map(cellNum);
    const numbers = parsed.filter((n): n is number => n !== null);
    // "every non-empty cell is a number" — one "n/a" disqualifies the column
    // rather than quietly shrinking the sample the statistic is computed over.
    if (numbers.length !== cells.length) return;
    out.push({ column: col, values: stats.map((s) => computeStat(numbers, s)) });
  });
  return out.length > 0 ? out : undefined;
}

/** Format a computed stat for the footer: fixed precision, no exponent, no locale. */
export function fmtStat(v: StatValue): string {
  if (v === null) return "—";
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e7)) return v.toExponential(2);
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toFixed(3)));
}
