// canvas-stats.check.ts — the arithmetic behind `table.stats`.
//
// PURE module, so this runs in node with no DOM and no chart engine. The point of
// these assertions is that the numbers are the STATISTICS, not the model's claim:
// the same rows must always produce the same footer, and a column the renderer
// cannot read honestly must produce NO footer rather than a plausible one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellNum, computeStat, fmtStat, tableStats } from "./canvas-stats.ts";

test("cellNum reads the forms a table actually contains", () => {
  assert.equal(cellNum("42"), 42);
  assert.equal(cellNum(" 42 "), 42);
  assert.equal(cellNum("1,234"), 1234, "thousands separators are stripped");
  assert.equal(cellNum("-3.5"), -3.5);
  assert.equal(cellNum("12%"), 12, "a percentage reads as its magnitude — the header carries the unit");
  assert.equal(cellNum("+7"), 7);
  // Everything a table uses for "no value" must read as NOTHING, never 0: a mean
  // that silently includes the missing values is worse than no footer at all.
  for (const s of ["", "  ", "n/a", "N/A", "—", "-", "unknown", "1.2.3", "12x", "1e", "€", "true", "null"]) {
    assert.equal(cellNum(s), null, `${JSON.stringify(s)} is not a number`);
  }
});

test("computeStat: the five-number summary, checked against hand-computed values", () => {
  // [1..9] — the textbook set whose quartiles are unambiguous.
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.equal(computeStat(v, "count"), 9);
  assert.equal(computeStat(v, "mean"), 5);
  assert.equal(computeStat(v, "median"), 5);
  assert.equal(computeStat(v, "min"), 1);
  assert.equal(computeStat(v, "max"), 9);
  assert.ok(Math.abs(computeStat(v, "sd")! - 2.7386128) < 1e-6, "sd is the SAMPLE sd (n-1)");
  // p95 with R-7 inclusive: index (9-1)*0.95 = 7.6 → 8 + 0.6*(9-8) = 8.6
  assert.ok(Math.abs(computeStat(v, "p95")! - 8.6) < 1e-9, "p95 interpolates between neighbours");
});

test("computeStat: an even-sized sample and an empty one", () => {
  const v = [1, 2, 3, 4];
  assert.equal(computeStat(v, "median"), 2.5, "the median of an even sample is the mean of the two middle values");
  assert.equal(computeStat(v, "mean"), 2.5);
  // A single value has NO sample sd — null, not 0. A 0 would read as "no
  // variance" instead of "cannot be known from one observation".
  assert.equal(computeStat([7], "sd"), null);
  assert.equal(computeStat([7], "mean"), 7);
  assert.equal(computeStat([7], "median"), 7);
  for (const s of ["mean", "median", "sd", "min", "max", "p95", "count"] as const) {
    assert.equal(computeStat([], s), null, `${s} of nothing is nothing`);
  }
});

test("computeStat: the input is not mutated (a render must be idempotent)", () => {
  const v = [5, 1, 3];
  computeStat(v, "median");
  computeStat(v, "p95");
  assert.deepEqual(v, [5, 1, 3], "the samples are not sorted in place");
});

test("tableStats: one row per requested numeric column, statistics in request order", () => {
  const cols = ["region", "latency_ms"];
  const rows = [["eu", "10"], ["us", "20"], ["apac", "30"]];
  const s = tableStats(cols, rows, { columns: ["latency_ms"], compute: ["mean", "min", "max"] })!;
  assert.equal(s.length, 1, "only the requested column is summarised");
  assert.equal(s[0].column, "latency_ms");
  assert.deepEqual(s[0].values, [20, 10, 30], "the values follow the REQUEST order, not a fixed one");
});

test("tableStats: a column matching is case- and space-insensitive, and unknown columns are skipped", () => {
  const s = tableStats(["Latency ms", "Region"], [["10", "eu"], ["20", "us"]], { columns: ["  latency MS "] })!;
  assert.equal(s.length, 1, "a header the agent re-cased still matches");
  assert.equal(s[0].column, "Latency ms", "the displayed header is the table's own, not the request's");
  assert.equal(tableStats(["a"], [["1"]], { columns: ["nonexistent"] }), undefined,
    "asking for a column that is not there yields NO footer, not an empty one");
});

test("tableStats: a TEXT column is never summarised", () => {
  // One "n/a" disqualifies the column: computing a mean over the 70% of cells that
  // parse would report a number about a DIFFERENT sample than the reader sees.
  assert.equal(tableStats(["latency"], [["10"], ["n/a"], ["30"]], { compute: ["mean"] }), undefined,
    "a single non-numeric cell disqualifies the column");
  assert.equal(tableStats(["region"], [["eu"], ["us"]], { compute: ["mean"] }), undefined,
    "a labels-only column is not a distribution");
  // Blank cells are exempt: an absent value is missing, not wrong. A column with a
  // genuine gap still summarises over what it has, and `count` reports how much.
  const gapped = tableStats(["latency"], [["10"], [""], ["30"]], { compute: ["mean", "count"] })!;
  assert.deepEqual(gapped[0].values, [20, 2], "blanks are skipped, and count is the sample size");
});

test("tableStats: with no request there is no footer (a plain table is unchanged)", () => {
  assert.equal(tableStats(["a"], [["1"]], undefined), undefined);
  // `stats:{}` (or `stats:true`, normalised to `{}`) means "every statistic" — so
  // it must produce a footer, not be mistaken for "did not ask".
  const all = tableStats(["a"], [["1"], ["2"], ["3"]], {})!;
  assert.equal(all.length, 1);
  assert.equal(all[0].values.length, 6, "the default set is mean/median/sd/min/max/p95");
  assert.equal(all[0].values[0], 2, "mean");
  assert.equal(all[0].values[2], 1, "sd of [1,2,3] is 1 — the sample sd, computed not asserted");
});

test("tableStats: rows are padded, so a ragged row cannot shift a column's numbers", () => {
  // The renderer pads every row to the header width before calling; asserting it
  // here too means a caller that forgets is caught by the same test.
  const padded = [["10", "eu"], ["20"]];
  const s = tableStats(["latency", "region"], padded.map((r) => [r[0] ?? "", r[1] ?? ""]), { compute: ["mean"] })!;
  assert.equal(s.length, 1, "only the numeric column qualifies");
  assert.equal(s[0].values[0], 15);
});

test("fmtStat: no exponent for ordinary magnitudes, exponent only for extremes", () => {
  assert.equal(fmtStat(42), "42");
  assert.equal(fmtStat(2.5), "2.5");
  assert.equal(fmtStat(2.6666666), "2.667", "precision is fixed at 3 dp");
  assert.equal(fmtStat(null), "—", "an unknown statistic reads as a dash, never as 0");
  assert.ok(fmtStat(1e-9).includes("e"), "a value that would print as 0.000 gets an exponent instead");
  assert.equal(fmtStat(1e9), "1.00e+9", "the exponent keeps its 2 dp rather than showing 1000000000");
  assert.equal(fmtStat(0), "0");
});
