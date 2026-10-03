import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewBodyToBlocks, fixBodyToBlocks, reportBodyToBlocks } from "./canvas-gates";

test("review body → severity KPI row + findings table", () => {
  const blocks = reviewBodyToBlocks({
    findings: [
      { id: "1", severity: "critical", title: "SQL injection", file: "a.ts", line: 3, detail: "d" },
      { id: "2", severity: "critical", title: "No auth", file: "b.ts", detail: "d" },
      { id: "3", severity: "low", title: "Typo", file: "c.ts", detail: "d" },
    ],
  });
  assert.equal(blocks[0].type, "kpi");
  assert.equal((blocks[0 as any] as any).value, 2); // critical count
  const table = blocks.find((b) => b.type === "table") as any;
  assert.equal(table.rows.length, 3);
  assert.equal(table.rows[0][1], "SQL injection");
});

test("empty review → KPI row only, no table", () => {
  const blocks = reviewBodyToBlocks({ findings: [] });
  assert.equal(blocks.filter((b) => b.type === "kpi").length, 4);
  assert.equal(blocks.some((b) => b.type === "table"), false);
});

test("fix body → checklist with mapped statuses", () => {
  const fixes = [
    { id: "1", status: "applied" as const, title: "Guard added", file: "a.ts", detail: "d" },
    { id: "2", status: "skipped" as const, title: "Skipped one", detail: "d" },
    { id: "3", status: "proposed" as const, title: "Pending", detail: "d" },
  ];
  const blocks = fixBodyToBlocks({ fixes });
  assert.equal(blocks.length, 1);
  const cl = blocks[0] as any;
  assert.deepEqual(cl.items.map((i: any) => i.status), ["done", "fail", "open"]);
});

test("report body → verdict callout + KPIs + steps + radial gauges", () => {
  const blocks = reportBodyToBlocks({
    verdict: "partial",
    stats: [{ label: "Tests", value: 24, delta: 3 }, { label: "Fail", value: 0 }],
    phases: [
      { name: "build", status: "pass", ms: 1200 },
      { name: "test", status: "fail", ms: 300 },
    ],
    gauges: [{ label: "Coverage", value: 82, max: 100, unit: "%" }],
  });
  assert.equal(blocks[0].type, "callout");
  assert.equal((blocks[0] as any).tone, "warn"); // partial → warn
  assert.equal(blocks.filter((b) => b.type === "kpi").length, 2);
  const steps = blocks.find((b) => b.type === "steps") as any;
  assert.equal(steps.items[0].status, "done");
  assert.ok(steps.items[0].title.includes("1.2s"));
  const gauge = blocks.find((b) => b.type === "chart") as any;
  assert.equal(gauge.series[0].points[0], 82);
});

test("report stats units and deltas compose", () => {
  const blocks = reportBodyToBlocks({ verdict: "pass", stats: [{ label: "Rows", value: 47, unit: "k", delta: -2 }] } as any);
  const kpi = blocks.find((b) => b.type === "kpi") as any;
  assert.equal(kpi.value, "47k");
  assert.equal(kpi.delta, "-2");
  assert.equal(kpi.trend, "down");
});
