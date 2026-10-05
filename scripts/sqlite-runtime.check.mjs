// Runnable check: the SQLite engine Astra runs must not carry the WAL-reset bug.
//
// WHY (bug, not style — session 2026-10-05):
//   SQLite 3.7.0 (2010-07-21) .. 3.51.2 contains a data race between a checkpoint
//   and a WAL-resetting commit. The checkpointer records frames as backfilled when
//   they were not; a later checkpoint skips them; the committed transaction
//   silently evaporates. No error at write time, no error at checkpoint time.
//   Fixed in 3.51.3 (2026-03-13) — https://sqlite.org/releaselog/3_51_3.html
//
//   Discovered here because astra-webui bundles SQLite via `node:sqlite`, and the
//   dnf Node (22.22.2) shipped exactly 3.51.2 — the last vulnerable release.
//   It is now pinned to Node 22.23.3 (SQLite 3.51.3) at
//   ~/.config/systemd/user/astra-webui.service.
//
// WHY THIS IS A CHECK AND NOT A COMMENT:
//   Node bundles its own SQLite. A runtime bump (or a lockfile change, which is
//   how OpenAI's codex repo silently rolled a fixed SQLite back to a vulnerable
//   one in June 2026) can reintroduce this with no diff in this repo. So the
//   invariant is asserted against the LIVE interpreter, every run.
//
// NOT "version >= latest": newer is not monotonically safer here. Measured on this
// host — Node 24.9.0 bundles SQLite 3.50.4, OLDER than 22.23.3's 3.51.3. Upgrading
// Node by version number alone would have walked into the bug.
//
// Run: node scripts/sqlite-runtime.check.mjs
import assert from "node:assert";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIN_SAFE = "3.51.3"; // WAL-reset fix landed here
const UNIT = join(process.env.HOME, ".config/systemd/user/astra-webui.service");

const v = (s) => {
  const [a, b, c] = String(s).split(".").map((n) => parseInt(n, 10) || 0);
  return a * 1e6 + b * 1e3 + c;
};

// 1) The interpreter running THIS check must carry a fixed SQLite. This is the
//    check that fires on a future runtime regression.
const probe = execFileSync(
  process.execPath,
  ["-e", "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');process.stdout.write(d.prepare('select sqlite_version() v').get().v)"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
).trim();
assert.ok(
  v(probe) >= v(MIN_SAFE),
  `SQLite ${probe} is vulnerable to the WAL-reset bug (fixed in ${MIN_SAFE}). ` +
  `Running node ${process.version}. Upgrade the interpreter Astra uses — do NOT assume ` +
  `a higher Node version number means a newer SQLite: Node 24.9.0 bundles 3.50.4.`
);
assert.ok(
  v(probe) < v("3.52.0"),
  `SQLite ${probe} is 3.52.0, which upstream WITHDREW 7 days after release for an ` +
  `unrelated defect. Prefer 3.51.3+ or 3.53.0+.`
);

// 2) The service must actually run that interpreter. A green check under a pinned
//    binary is worthless if the unit still points at the vulnerable dnf Node.
if (existsSync(UNIT)) {
  const unit = readFileSync(UNIT, "utf8");
  const exec = unit.match(/^ExecStart=(.*)$/m)?.[1] || "";
  assert.ok(exec.length > 0, "astra-webui.service has an ExecStart");
  assert.ok(
    !/^\/usr\/bin\/node\b/.test(exec) && !/^node\b/.test(exec),
    `astra-webui.service still runs the dnf Node: "${exec}". That binary bundles a ` +
    `vulnerable SQLite (see the version probe above for the fixed path).`
  );
  assert.ok(
    /node-22\.23\.3|node-22\.2[3-9]|node-2[3-9]\./.test(exec),
    `astra-webui.service ExecStart does not name a reviewed Node build: "${exec}". ` +
    `Re-verify the bundled SQLite version before changing this.`
  );
}

// 3) The live database must be readable and self-consistent. Cheap, and it turns
//    a silent corruption into a failed check instead of a lost transcript.
const DB = process.env.ASTRA_DB_PATH || join(ROOT, "data", "astra-training.db");
if (existsSync(DB)) {
  const out = execFileSync(
    process.execPath,
    ["-e", `const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(${JSON.stringify("file:" + DB + "?mode=ro")},{readOnly:true});process.stdout.write(JSON.stringify({i:d.prepare('PRAGMA integrity_check').get(),s:d.prepare('SELECT count(*) c FROM sessions').get().c,m:d.prepare('SELECT count(*) c FROM messages').get().c}))`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const { i, s, m } = JSON.parse(out);
  assert.equal(i.integrity_check, "ok", `live DB failed integrity_check: ${JSON.stringify(i)}`);
  assert.ok(s > 0 && m > 0, `live DB looks empty (sessions=${s}, messages=${m})`);
  console.log(`live DB ok: ${s} sessions / ${m} messages, integrity_check=ok`);
}

console.log(
  `sqlite-runtime.check: ALL PASS (node ${process.version}, SQLite ${probe} >= ${MIN_SAFE}, ` +
  `unit pinned off the dnf Node)`
);
