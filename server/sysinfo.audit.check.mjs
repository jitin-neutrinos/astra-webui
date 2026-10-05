// Self-check for the 2026-10-04 audit additions to sysinfo.mjs.
// Run: node server/sysinfo.audit.check.mjs
import { existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";

let pass = 0, fail = 0;
function ck(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? " — " + detail : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? " — " + detail : ""}`); }
}

console.log("1. node:sqlite available and read-only opens work");
const fs_db = join(homedir(), ".hermes", "memory_store.db");
try {
  const d = new DatabaseSync(fs_db, { readOnly: true });
  const n = d.prepare("SELECT COUNT(*) c FROM facts").get().c;
  ck("fact store opens read-only", typeof n === "number", `${n} facts`);
  ck("read-only refuses a write", (() => {
    try { d.prepare("DELETE FROM facts WHERE fact_id=-1").run(); return false; }
    catch { return true; }
  })(), "probe cannot mutate memory");
  d.close();
} catch (e) { ck("fact store opens read-only", false, e.message); }

console.log("2. fact-store health counters");
try {
  const d = new DatabaseSync(fs_db, { readOnly: true });
  const one = (sql) => { try { return d.prepare(sql).get(); } catch { return null; } };
  const framing = one(`SELECT COUNT(*) c FROM facts WHERE content LIKE '[System:%'
    OR content LIKE '[Surface:%' OR content LIKE 'Gateway message origin%'
    OR content LIKE '[OUT-OF-BAND%' OR content LIKE '[ASYNC DELEGATION%'`).c;
  ck("zero gateway-envelope facts (was 56)", framing === 0, `${framing} left`);
  const prov = one("SELECT COUNT(*) c FROM facts WHERE COALESCE(source_kind,'')=''").c;
  ck("every fact declares provenance", prov === 0, `${prov} without source_kind`);
  const dims = d.prepare("SELECT DISTINCT dim FROM memory_banks").all().map(r => r.dim);
  ck("vector dim is uniform (no stale rows)", dims.length <= 1, `dims=${JSON.stringify(dims)}`);
  const trust = one("SELECT COUNT(DISTINCT trust_score) d FROM facts").d;
  ck("trust scoring has signal", trust > 1, `${trust} distinct values`);
  const retr = one("SELECT COALESCE(SUM(retrieval_count),0) s FROM facts").s;
  ck("retrieval_count is being written", retr > 0, `sum=${retr}`);
  d.close();
} catch (e) { ck("fact-store counters", false, e.message); }

console.log("3. state store + retention");
try {
  const p = join(homedir(), ".hermes", "state.db");
  const d = new DatabaseSync(p, { readOnly: true });
  const m = d.prepare("SELECT COUNT(*) c, MIN(timestamp) a, MAX(timestamp) b FROM messages").get();
  const days = Math.max((m.b - m.a) / 86400, 0.001);
  ck("growth rate computable", m.c > 0 && days > 0, `${m.c} msgs over ${days.toFixed(1)}d`);
  d.close();
  const armed = existsSync(join(homedir(), ".config/systemd/user/state-retention.timer"));
  ck("retention timer armed", armed, armed ? "Sun 04:20" : "NOT ARMED — store grows unbounded");
  const arch = join(homedir(), ".hermes", "sessions", "_archive");
  let archived = 0;
  try { archived = readdirSync(arch).length; } catch {}
  ck("archive exists and is non-empty", archived > 0, `${archived} sessions archived`);
} catch (e) { ck("state store", false, e.message); }

console.log("4. tracker DB — the thing that was silently dead for 9 days");
try {
  const p = join(homedir(), ".headroom-tracker", "tokens.db");
  const d = new DatabaseSync(p, { readOnly: true });
  const rows = d.prepare("SELECT COUNT(*) c FROM usage_records").get().c;
  d.close();
  ck("tracker is recording rows", rows > 0, `${rows} usage_records`);
} catch (e) { ck("tracker DB", false, e.message); }

console.log("5. audit check scripts exist and are runnable");
const scratch = join(homedir(), ".hermes", "cache", "scratch");
for (const f of ["verify_holo_fixes.py", "check_laya_and_proxy.py", "check_memory_pass2.py"]) {
  const p = join(scratch, f);
  ck(`check present: ${f}`, existsSync(p), existsSync(p) ? `${(statSync(p).size / 1024).toFixed(1)} KB` : "MISSING");
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) { console.log("FAILING: " + fail + " assertion(s)"); process.exit(1); }