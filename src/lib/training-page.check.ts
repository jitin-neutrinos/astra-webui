// Assert-based check for the training-page summary tiles + retry countdown.
//   npx tsx src/lib/training-page.check.ts
//
// Imports the SAME module the component ships (training-view.ts) — a spec that
// restated the logic would only test its own copy and pass even after the page
// broke.

import { jobCounts, fmtCountdown, countdownUntil } from "./training-view.ts";

function main() {
  let failures = 0;
  function check(name: string, cond: boolean, got?: unknown) {
    if (cond) { console.log(`  ok   ${name}`); return; }
    failures++;
    console.error(`  FAIL ${name}`, got !== undefined ? JSON.stringify(got) : "");
  }

  // Countdown branches, including the expired case that clamps to 0s.
  check("hours+minutes branch", fmtCountdown(3600000 + 5 * 60000) === "1h 5m", fmtCountdown(3600000 + 5 * 60000));
  check("minutes+seconds branch", fmtCountdown(125000) === "2m 5s", fmtCountdown(125000));
  check("seconds-only branch", fmtCountdown(9000) === "9s", fmtCountdown(9000));
  check("expired clamps to 0s", fmtCountdown(0) === "0s", fmtCountdown(0));
  check("negative clamps to 0s", fmtCountdown(-5000) === "0s", fmtCountdown(-5000));
  check("boundary 59s stays seconds", fmtCountdown(59999) === "59s", fmtCountdown(59999));
  check("boundary 60s rolls to minutes", fmtCountdown(60000) === "1m 0s", fmtCountdown(60000));

  // countdownUntil: the epoch-ms wrapper the page calls.
  check("unset retry target yields empty string", countdownUntil(null) === "", countdownUntil(null));
  check("zero retry target yields empty string", countdownUntil(0) === "", countdownUntil(0));
  const future = Date.now() + 125000;
  check("future retry target formats", countdownUntil(future) === "2m 5s", countdownUntil(future));
  check("past retry target clamps", countdownUntil(Date.now() - 90000) === "0s");

  // Mixed list incl. an unknown status: counted in total, not in active.
  const mixed = jobCounts([
    { status: "dumping" }, { status: "reviewing" }, { status: "awaiting_retry" },
    { status: "failed" }, { status: "failed" }, { status: "done" },
    { status: "quantum_review" },
  ]);
  check("active counts the three in-flight states", mixed.active === 3, mixed);
  check("failed counted", mixed.failed === 2, mixed);
  check("done counted", mixed.done === 1, mixed);
  check("unknown status lands in total only", mixed.total === 7 && mixed.active === 3, mixed);

  check("empty list is all zeros",
    JSON.stringify(jobCounts([])) === JSON.stringify({ active: 0, failed: 0, done: 0, total: 0 }),
    jobCounts([]));
  check("all-active list has no failed/done",
    jobCounts([{ status: "reviewing" }, { status: "dumping" }]).failed === 0);
  // A row with no status at all must not throw (SQLite NULL slips through).
  check("null/undefined status is tolerated",
    (() => { const c = jobCounts([{}, { status: null }]); return c.total === 2 && c.active === 0; })());

  console.log(failures === 0 ? "PASS: training-page checks" : `FAIL: ${failures} training-page check(s) failed`);
  if (failures) process.exit(1);
}

main();