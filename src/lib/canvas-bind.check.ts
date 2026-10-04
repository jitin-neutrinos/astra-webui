// Self-check for canvas-bind (reactive binding layer).
// Run: npx tsx --test src/lib/canvas-bind.check.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBinding, bindNumber, bindPoints, bindVisible, collectData, resolveFrom, applySort } from "./canvas-bind.ts";

const S = { price: 49, seats: 20, on: true, off: false, name: "EU", list: [1, 2, 3], empty: 0, rows: [
  { env: "prod", svc: "gateway", p95: 212 }, { env: "prod", svc: "chat", p95: 870 }, { env: "stage", svc: "gateway", p95: 198 },
] };

test("pointer forms resolve from state only; missing keys unset", () => {
  assert.equal(resolveBinding("$price", S).value, 49);
  assert.equal(resolveBinding("/price", S).value, 49);
  assert.equal(resolveBinding("$tax", S).unset, true);
  assert.equal(resolveBinding("/missing", S).unset, true);
  assert.equal(resolveBinding({ path: "/on" }, S).value, true);
  assert.equal(resolveBinding({ $state: "/price" }, S).value, 49);
});

test("expression bindings evaluate; failures unset (never throw)", () => {
  assert.equal(resolveBinding({ $expr: "price * seats" }, S).value, 980);
  assert.equal(resolveBinding({ expr: "price + 1" }, S).value, 50);
  assert.equal(resolveBinding({ $expr: "price * typo" }, S).unset, true);
  assert.equal(resolveBinding({ $expr: "constructor" }, {}).unset, true);
});

test("bindNumber narrows scalars, numeric strings and booleans", () => {
  assert.equal(bindNumber("$price", S), 49);
  assert.equal(bindNumber({ $expr: "'1,234' * 2" }, S), 2468); // lenient numeric strings inside expressions
  assert.equal(bindNumber("$off", S), 0);
  assert.equal(bindNumber("$on", S), 1);
  assert.equal(bindNumber("$name", S), null);
  assert.equal(bindNumber("$tax", S), null);
});

test("bindPoints: number arrays only; ragged/null entries dropped", () => {
  assert.deepEqual(bindPoints("$list", S), [1, 2, 3]);
  assert.deepEqual(bindPoints({ $expr: "list * 2" }, S), [2, 4, 6]);
  assert.equal(bindPoints({ $expr: "list + [1, 'x']" }, S), null);
  assert.equal(bindPoints("$name", S), null);
});

test("bindVisible: unset/true shows, false and empty hide", () => {
  assert.equal(bindVisible("$on", S), true);
  assert.equal(bindVisible("$off", S), false);
  assert.equal(bindVisible("$tax", S), true); // unset ⇒ visible
  assert.equal(bindVisible(null, S), true);
  assert.equal(bindVisible({ $expr: "len(list) > 2" }, S), true);
  assert.equal(bindVisible({ $expr: "list" }, { list: [] }), false);
});

test("collectData from a data block + resolveFrom filters/sorts/tops", () => {
  const d = collectData([{ type: "data", name: "latency", columns: ["env", "svc", "p95"], rows: [["prod", "gateway", 212], ["prod", "chat", 870], ["stage", "gateway", 198]] }]);
  assert.equal(d.get("latency")!.length, 3);
  assert.deepEqual(d.get("latency")![0], { env: "prod", svc: "gateway", p95: 212 });

  const rows = resolveFrom({ $from: "latency", filter: [{ col: "env", op: "==", value: "$env" }] }, d, { env: "prod" });
  assert.equal(rows.length, 2);
  assert.equal(resolveFrom({ $from: "latency", filter: [{ col: "env", op: "==", value: "$env" }], sort: { by: "p95", dir: "desc" } }, d, { env: "prod" })[0].svc, "chat");
  assert.equal(resolveFrom({ $from: "latency", filter: [{ col: "env", op: "==", value: "$env" }], top: 1 }, d, { env: "prod" }).length, 1);
  assert.deepEqual(resolveFrom({ $from: "missing" }, d, {}), []);
  // header-inference: string row 0 becomes the header, data starts at row 1
  const d2 = collectData([{ type: "data", name: "x", rows: [["env", "v"], ["prod", 10]] }]);
  assert.deepEqual(d2.get("x")![0], { env: "prod", v: 10 });
});

test("where fail-soft: unknowable ops never blank the row set; in-list membership", () => {
  const d = collectData([{ type: "data", name: "x", columns: ["env", "v"], rows: [["prod", 1], ["stage", 2]] }]);
  const rows = resolveFrom({ $from: "x", filter: [{ col: "env", op: "in" as never, value: "$env" }] }, d, { env: ["prod", "stage"] });
  assert.equal(rows.length, 2);
  const unsetBinding = resolveFrom({ $from: "x", filter: [{ col: "env", op: "==", value: "$tax" }] }, d, {});
  assert.equal(unsetBinding.length, 2); // unset filter ⇒ keep everything
});

test("applySort asc/desc + string tiebreak", () => {
  const rows = [{ a: 3, n: "c" }, { a: 1, n: "b" }, { a: 2, n: "a" }];
  assert.deepEqual(applySort(rows, { by: "a" }).map((r) => r.a), [1, 2, 3]);
  assert.deepEqual(applySort(rows, { col: "a", dir: "desc" }).map((r) => r.a), [3, 2, 1]);
});

test("money() resolves to a FORMATTED STRING — a KPI value must not go through bindNumber", () => {
  // Documents why KpiTile uses resolveBinding: bindNumber strips "$" and ","
  // and would render 5000 where the expression asked for "$5,000.00".
  const r = resolveBinding({ $expr: "money(5 * 10)" }, {});
  assert.equal(r.unset, false);
  assert.equal(r.value, "$50.00");
  assert.equal(typeof r.value, "string");
});
