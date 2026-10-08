// run-backfill.mjs — detached parallel backfill runner.
//
// Started OUT of process so the full backlog run survives this agent's tool
// timeouts and the web session's lifetime. Takes the backlog lock so the
// service's own 30-min timer yields instead of double-working the queue.
//
// Usage: node scripts/run-backfill.mjs [concurrency] [limit]
//   concurrency  parallel reviewers (default 6)
//   limit        max chats this run (0 / omitted = whole backlog)
import { acquireLock, releaseLock, runParallelBackfill, backfillStatus } from "../server/backfill.mjs";
import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const concurrency = Number(process.argv[2] || 6);
const limit = Number(process.argv[3] || 0);
const DATA_DIR = process.env.TRAINING_DATA_DIR || join(process.cwd(), "data");
const LOG = join(DATA_DIR, "backfill-run.log");
mkdirSync(DATA_DIR, { recursive: true });

const say = (msg) => {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log(line);
  try { appendFileSync(LOG, line + "\n"); } catch { /* logging is best-effort */ }
};

if (!acquireLock()) {
  say("another runner holds the lock — exiting");
  process.exit(0);
}

const before = backfillStatus();
say(`START concurrency=${concurrency} limit=${limit || "all"} pending=${before.pending} analysed=${before.analysed}`);

let last = Date.now();
try {
  const summary = await runParallelBackfill({
    concurrency,
    limit,
    onProgress: (p) => {
      // One line per completion (throttled) so the log stays readable.
      const now = Date.now();
      if (now - last > 2000 || p.retry) {
        last = now;
        const s = p.summary || {};
        say(`  ${p.retry ? "retry " : "done  "}${String(p.sid).slice(-9)} ${p.ok === false ? "FAIL " + (p.error || "") : "ok"} | ok=${s.ok} fail=${s.failed} collided=${s.collisions} of ${s.attempted}`);
      }
    },
  });
  const after = backfillStatus();
  say(`SUMMARY ${JSON.stringify({ ...summary, errors: summary.errors.slice(0, 10) })}`);
  say(`END pending=${after.pending} analysed=${after.analysed} failed=${after.failed}`);
} catch (e) {
  say(`FATAL ${e && e.message}`);
} finally {
  releaseLock();
}
