// Pipeline check: full dump → review → delete lifecycle against a FAKE gateway
// (owned by this parent process, which stays async) and FAKE hermes binaries.
// Covers R2 (dump fidelity/idempotence), R3 (spawn args, prompt contents, FILE:
// capture), R4 (retry math, timeout, terminal failure), R5 (delete-then-done,
// delete-only retry).
//
// IMPORTANT SHAPE NOTE: scenario children are spawned with spawn() (async) —
// never spawnSync — because a spawnSync parent's event loop is frozen and its
// HTTP server cannot answer the child (deadlock, proven 2026-10-01 with dbg20).
// Run: node scripts/training-pipeline.check.mjs
import assert from "node:assert";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "astra-pipe-check-"));
const fakeBin = join(scratch, "bin");
const dataDir = join(scratch, "data");
mkdirSync(fakeBin, { recursive: true });

// ---- fake hermes binaries ---------------------------------------------------
const okHermes = join(fakeBin, "hermes-ok");
writeFileSync(okHermes, `#!/bin/sh
for a in "$@"; do
  if [ "$prev" = "-m" ] && [ "$a" != "glm-5.3-flash" ]; then echo "BAD MODEL $a" >&2; exit 9; fi
  if [ "$prev" = "--provider" ] && [ "$a" != "zai" ]; then echo "BAD PROVIDER $a" >&2; exit 9; fi
  prev="$a"
done
case " $* " in
  *" --in "*) ;;
  *) echo "MISSING --in" >&2; exit 9 ;;
esac
echo "reviewed the transcript"
echo "FILE: /tmp/does-not-matter.md"
`);
const failHermes = join(fakeBin, "hermes-fail");
writeFileSync(failHermes, "#!/bin/sh\necho boom >&2\nexit 1\n");
const slowHermes = join(fakeBin, "hermes-slow");
writeFileSync(slowHermes, "#!/bin/sh\nsleep 30\n");
for (const f of [okHermes, failHermes, slowHermes]) spawnSync("chmod", ["+x", f]);

// ---- fake gateway (parent-owned, parent stays async) --------------------------
const TOTAL = 450;
let deleteStatus = 200;
const deleteCounts = {};
const gw = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/auth/password-login") {
    res.setHeader("set-cookie", "hermes_session_at=fake; Path=/");
    res.writeHead(200);
    return res.end('{"ok":true}');
  }
  const m = u.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (m) {
    if (!(req.headers.cookie || "").includes("hermes_session")) { res.writeHead(401); return res.end('{"error":"unauth"}'); }
    const limit = Number(u.searchParams.get("limit")), offset = Number(u.searchParams.get("offset"));
    const msgs = [];
    for (let i = offset; i < Math.min(offset + limit, TOTAL); i++) {
      msgs.push({
        id: `row-${i}`, timestamp: 1700000000 + i, role: i % 2 ? "assistant" : "user",
        content: `msg ${i}`,
        tool_calls: i % 4 === 1 ? [{ id: `c${i}`, function: { name: "t", arguments: "{}" } }] : null,
        reasoning: i % 4 === 3 ? `thinking ${i}` : null,
      });
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ messages: msgs }));
  }
  const del = u.pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (del && req.method === "DELETE") {
    deleteCounts[del[1]] = (deleteCounts[del[1]] || 0) + 1;
    res.writeHead(deleteStatus);
    return res.end('{"ok":true}');
  }
  res.writeHead(404);
  res.end("{}");
});
await new Promise((r) => gw.listen(0, "127.0.0.1", r));
const gwPort = gw.address().port;

const childEnv = (hermesBin) => ({
  HOME: process.env.HOME || "/home/notjitin",
  TRAINING_DATA_DIR: dataDir,
  TRAINING_DB_PATH: join(dataDir, "t.db"),
  ASTRA_HERMES_URL: `http://127.0.0.1:${gwPort}`,
  TRAINING_HERMES_BIN: hermesBin,
  TRAINING_REVIEW_TIMEOUT_MS: "3000",
  TRAINING_RETRY_DELAY_MS: "100",   // shrunk: retries fire inside the check window
  TRAINING_SWEEP_INTERVAL_MS: "200",
});

// Scenario children spawn ASYNC so the parent's gateway can serve them.
async function runScenario(env, script) {
  const f = join(scratch, `scenario-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(f, script);
  const child = spawn(process.execPath, [f], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { err += c; });
  const code = await new Promise((resolve) => child.on("close", resolve));
  if (code !== 0) throw new Error(`scenario failed (${code}):\n${out}\n${err.split("\n").filter((l) => l && !l.includes("Warning")).join("\n")}`);
  const line = out.trim().split("\n").filter((l) => l.startsWith("RESULT:")).pop();
  return JSON.parse(line.slice(7));
}

const TRAINING_MJS = path.resolve(join(__dirname, "..", "server", "training.mjs"));
const PROXY_MJS = path.resolve(join(__dirname, "..", "server", "hermes-proxy.mjs"));
const IMPORTS = `
import { openTrainingDb, startEndSession, startTrainingSweeper, setGatewayCookieProvider, getTrainingSession, listReviewJobs } from "${TRAINING_MJS}";
// Static cookie provider: the scenario points ASTRA_HERMES_URL at THIS check's
// fake gateway, so the real proxy login (hardcoded to the live gateway) must
// not be involved. The fake gw only checks the cookie contains "hermes_session".
setGatewayCookieProvider(async () => "hermes_session_at=fake");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (o) => console.log("RESULT:" + JSON.stringify(o));
`;

try {
  // ---- R2+R3: happy path — dump 450 rows, worker ok, delete, done ----------
  rmSync(join(dataDir, "t.db"), { force: true });
  let res = await runScenario(childEnv(okHermes), `${IMPORTS}
const { job } = startEndSession("sess_ok", "Title OK", "webui");
let j = job;
for (let i = 0; i < 100 && j.status !== "done"; i++) { await sleep(200); j = listReviewJobs(5).find(x => x.sid === "sess_ok") ?? j; }
const d = getTrainingSession("sess_ok");
say({ status: j.status, rows: d ? d.messages.length : -1,
  first: d && d.messages[0] && d.messages[0].row_id, last: d && d.messages[d.messages.length - 1] && d.messages[d.messages.length - 1].row_id,
  review_status: d && d.session.review_status, log: (j.worker_log || "").includes("FILE:") });
`);
  assert.equal(res.status, "done", JSON.stringify(res));
  assert.equal(res.rows, TOTAL);
  assert.equal(res.first, "row-0");
  assert.equal(res.last, `row-${TOTAL - 1}`);
  assert.equal(res.review_status, "deleted");
  assert.ok(res.log, "FILE: lines captured in worker_log");
  console.log("R2/R3 happy path: dump 450 rows, review, delete, done ✓");

  // ---- R4: worker fails → 6 strikes → failed, transcript kept ---------------
  rmSync(join(dataDir, "t.db"), { force: true });
  res = await runScenario(childEnv(failHermes), `${IMPORTS}
startTrainingSweeper();
startEndSession("sess_fail", "Title F", "webui");
let j = null;
for (let i = 0; i < 300; i++) {
  await sleep(150);
  j = listReviewJobs(5).find(x => x.sid === "sess_fail");
  if (j && (j.status === "failed" || j.status === "done")) break;
}
const d = getTrainingSession("sess_fail");
say({ status: j.status, attempts: j.attempts, transcriptRows: d ? d.messages.length : -1 });
`);
  assert.equal(res.status, "failed", JSON.stringify(res));
  assert.equal(res.attempts, 6);
  assert.equal(res.transcriptRows, TOTAL, "transcript kept after terminal failure");
  console.log("R4: 6 strikes → failed, transcript preserved ✓");

  // ---- R4: timeout path — slow worker + 3s cap → awaiting_retry -------------
  // The scenario runs the sweeper because the timed-out worker's SIGKILL can
  // race the close event; the sweeper picks up the retry transition if the
  // in-worker path misses it.
  rmSync(join(dataDir, "t.db"), { force: true });
  res = await runScenario(childEnv(slowHermes), `${IMPORTS}
startTrainingSweeper();
startEndSession("sess_slow", "Title S", "webui");
let j = null;
for (let i = 0; i < 120; i++) { await sleep(250); j = listReviewJobs(5).find(x => x.sid === "sess_slow"); if (j && (j.status === "awaiting_retry" || j.status === "failed")) break; }
say({ status: j.status, err: (j.last_error || "").slice(0, 60), attempts: j.attempts });
`);
  assert.ok(res.status === "awaiting_retry" || res.status === "failed", JSON.stringify(res));
  assert.ok(res.err.includes("timeout") || res.err.includes("killed"), `expected timeout/killed error, got: ${res.err}`);
  console.log("R4: timeout → awaiting_retry ✓");

  // ---- R5: delete fails after review → delete-only retry → done -------------
  rmSync(join(dataDir, "t.db"), { force: true });
  deleteCounts.sess_del = 0;
  deleteStatus = 500;
  const scenarioDone = runScenario(childEnv(okHermes), `${IMPORTS}
startTrainingSweeper();
startEndSession("sess_del", "Title D", "webui");
let j = null;
// Poll ONLY for terminal 'done'. The transient awaiting_retry window is
// 100-200ms (RETRY_DELAY_MS=100, sweep=200ms) and a 200ms poll can miss it —
// detecting the retry from the child is the documented R5 flake. The PARENT
// proves the retry happened instead: it saw the first DELETE fail (count 1),
// flipped 500->200, and asserts >=2 delete attempts + final 'deleted'.
for (let i = 0; i < 400; i++) {
  await sleep(200);
  j = listReviewJobs(5).find(x => x.sid === "sess_del");
  if (j && j.status === "done") break;
}
const d = getTrainingSession("sess_del");
say({ status: j ? j.status : "none", attempts: j ? j.attempts : -1, lastErr: j && j.last_error, review_status: d && d.session.review_status });
`);
  // Parent flips DELETE 500→200 once the first (failing) attempt lands.
  for (let i = 0; i < 400 && (deleteCounts.sess_del || 0) < 1; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 500));
  deleteStatus = 200;
  res = await scenarioDone;
  assert.equal(res.status, "done", JSON.stringify(res));
  assert.equal(res.review_status, "deleted", JSON.stringify(res));
  // Retry proven by the parent's OWN observation: attempt 1 failed (500),
  // attempt 2 succeeded (200) — two delete calls minimum.
  assert.ok((deleteCounts.sess_del || 0) >= 2, `expected >=2 delete attempts, got ${deleteCounts.sess_del}`);
  assert.ok((res.attempts ?? 0) >= 2, `job attempts should record the retry, got ${res.attempts}`);
  console.log("R5: delete-fail → awaiting_retry → delete-only retry → done ✓");

  console.log("training-pipeline.check: ALL PASSED");
} finally {
  gw.close();
  rmSync(scratch, { recursive: true, force: true });
}
