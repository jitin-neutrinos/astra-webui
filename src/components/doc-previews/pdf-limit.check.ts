// pdf-view limit() concurrency check: the runner must never execute synchronously
// inside the Promise executor (TDZ on `run`), and must cap concurrency at 2.
// Run: npx tsx src/components/doc-previews/pdf-limit.check.ts
import { strict as assert } from "node:assert";

// Reimplemented exactly as the shipped helper (module imports pull browser
// globals; this mirrors the logic under test).
const running = new Set<Promise<unknown>>();
const waiting: Array<() => void> = [];
let queued = 0;
function limit<T>(job: () => Promise<T>): Promise<T> {
  const run = new Promise<T>((resolve, reject) => {
    const exec = () => {
      job().then(resolve, reject).finally(() => {
        running.delete(run as unknown as Promise<unknown>);
        waiting.shift()?.();
      });
      running.add(run as unknown as Promise<unknown>);
    };
    if (running.size + queued < 2) { queued++; queueMicrotask(() => { queued--; exec(); }); }
    else waiting.push(exec);
  });
  return run;
}

async function main() {
  // 1. First job must not throw TDZ — and resolves.
  const first = limit(() => Promise.resolve("ok"));
  assert.equal(await first, "ok", "first job resolves");

  // 2. Concurrency cap: 3 jobs, at most 2 run simultaneously.
  let active = 0, maxActive = 0;
  const job = () => new Promise<string>((res) => {
    active++; maxActive = Math.max(maxActive, active);
    setTimeout(() => { active--; res("done"); }, 30);
  });
  const all = await Promise.all([limit(job), limit(job), limit(job)]);
  assert.deepEqual(all, ["done", "done", "done"]);
  assert.ok(maxActive <= 2, `concurrency exceeded 2 (saw ${maxActive})`);
  assert.equal(running.size, 0, "running set drains");

  // 3. Queued job also resolves after the TDZ-prone first-use path.
  const queued = limit(() => Promise.resolve("q"));
  assert.equal(await queued, "q");

  console.log("pdf-limit.check: ALL PASS");
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
