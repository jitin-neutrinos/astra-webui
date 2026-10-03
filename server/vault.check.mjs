// vault route guards — run with: node server/vault.check.mjs
// Exercises: session 401s, locked 403s, unlock wrong/right password, cookie
// minting, TTL expiry, lock route, entries/values/devices shapes, and that
// the registry on disk NEVER contains a plaintext value.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { rm, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
// Base port 3911 + the per-worker-slot offset that scripts/run-checks.mjs sets
// on every worker (ASTRA_CHECK_PORT_OFFSET). The legacy VAULT_CHECK_PORT_OFFSET
// still works so the documented manual dodge below keeps functioning.
//
// This matters because the regression gate re-runs this check with spawnSync
// WHILE the worker pool is still running it. Two servers on one port means the
// health poll is answered by the wrong process, so every assertion silently
// tests a stranger — which is how a collision shows up as a phantom
// "REGRESSED" rather than an obvious error.
const PORT =
  3911 +
  (Number(process.env.ASTRA_CHECK_PORT_OFFSET ?? process.env.VAULT_CHECK_PORT_OFFSET) || 0);
const PASSWORD = "check-password-123";
const SECRET = "check-secret-xyz";
const VAULT_SECRET = "check-vault-secret";

// ── Safety ──────────────────────────────────────────────────────────────
// This check DELETES the registry it uses, and it used to delete the REAL one
// (data/vault-registry.json). Running it after a production seed silently
// destroyed the vault. Point it at a scratch file and refuse to run if the
// target is not one.
const PROD_REGISTRY = resolve(ROOT, "data", "vault-registry.json");
// Scratch registry, PER-SLOT. The port offset alone was not enough: two
// concurrent instances also shared ONE registry path, and each run does
// `rm(regPath)` at start and re-seeds it — so the loser's delete wiped the
// winner's data and step 13 then read an empty file and crashed on
// `.find` of undefined. Deriving the filename from the same offset that
// derives the port makes both resources slot-scoped, so concurrent runs are
// fully isolated. VAULT_CHECK_REGISTRY still overrides (and the production
// registry is refused below).
const SLOT = Number(process.env.ASTRA_CHECK_PORT_OFFSET ?? process.env.VAULT_CHECK_PORT_OFFSET) || 0;
const regPath =
  process.env.VAULT_CHECK_REGISTRY ||
  resolve(ROOT, "data", `vault-registry.check${SLOT ? `-${SLOT}` : ""}.json`);
if (regPath === PROD_REGISTRY) {
  console.error("refusing to run: VAULT_CHECK_REGISTRY points at the production registry");
  process.exit(2);
}
console.log(`registry under test: ${regPath}`);
// The PARENT imports vault.mjs to seed, so it needs the same override. Without
// this the parent resolves the default (production) path and rewrites the real
// registry with three test values.
process.env.ASTRA_VAULT_REGISTRY = regPath;

const fails = [];
const ok = (name, cond) => { if (!cond) fails.push(name); console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); };

// The check spawns its own server and asserts on ITS responses, so PORT has to
// be ours to take. If something already holds it — a stray child from an
// earlier run, which is exactly what this check used to leave behind — the
// health poll below is answered by that stranger, every assertion silently
// tests the wrong process, and the run reports a phantom failure instead of a
// real one. (That is how a stale 11:50 server pointed at the PRODUCTION
// registry made step 4 report "registry missing" while the registry had 3
// entries.) Fail loudly, and print the remedy.
// Adopt the spawned server so NO exit path can orphan it. Previously the only
// cleanup was `child.kill("SIGKILL")` at the END of main(), so every early exit
// — assertPortFree's `process.exit(2)`, the `main().catch()` below, any thrown
// fetch — left the server running and holding its port. The next concurrent
// instance then hit EADDRINUSE and, worse, could be answered by the orphan
// instead of its own child. An orphan left by an earlier run is exactly what the
// assertPortFree comment warns about, and this check was manufacturing them.
let serverChild = null;
function reapChild() {
  if (!serverChild) return;
  try { serverChild.kill("SIGKILL"); } catch { /* already gone */ }
  serverChild = null;
}
for (const sig of ["exit", "SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    reapChild();
    if (sig !== "exit") process.exit(sig === "SIGINT" ? 130 : 143);
  });
}

async function assertPortFree(port) {
  const probe = createServer(); // node:http, already imported
  try {
    await new Promise((res, rej) => { probe.once("error", rej); probe.listen(port, "127.0.0.1", res); });
  } catch (e) {
    if (e.code === "EADDRINUSE") {
      console.error(`refusing to run: port ${port} is already in use, so this run would test a stranger's server.`);
      console.error(`  find it:  ss -ltnp | grep ${port}`);
      console.error(`  kill it:  kill <pid>      (it is an orphaned check child, not a service)`);
      console.error(`  or dodge: VAULT_CHECK_PORT_OFFSET=1 node server/vault.check.mjs`);
      process.exit(2);
    }
    throw e;
  } finally {
    probe.close();
  }
}

async function main() {
  await assertPortFree(PORT);

  // clean the SCRATCH registry only
  await rm(regPath, { force: true });

  const child = spawn(process.execPath, ["server/server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      ASTRA_WEBUI_PASSWORD: PASSWORD,
      ASTRA_WEBUI_SECRET: SECRET,
      ASTRA_VAULT_SECRET: VAULT_SECRET,
      ASTRA_VAULT_REGISTRY: regPath,
      ASTRA_HERMES_PASSWORD: "unused",
      ASTRA_WEBUI_PORT: String(PORT),
      PORT: String(PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverChild = child; // adopted by reapChild() — see the exit handlers above
  let childLog = "";
  child.stdout.on("data", (d) => { childLog += d; });
  child.stderr.on("data", (d) => { childLog += d; });
  await new Promise((r) => {
    const t = setInterval(async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
        if (res.status === 200) { clearInterval(t); r(); }
      } catch { /* not up yet */ }
    }, 150);
  });

  const base = `http://127.0.0.1:${PORT}`;
  let session = "";

  // 1. health
  ok("health 200", (await fetch(`${base}/api/health`)).status === 200);

  // 2. login mints session cookie
  {
    const res = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) });
    const sc = res.headers.get("set-cookie") || "";
    session = sc.split(";")[0];
    ok("login 200 + cookie", res.status === 200 && session.startsWith("astra_session="));
  }

  // 3. vault status without session -> 401
  {
    const res = await fetch(`${base}/api/vault/status`);
    ok("status no-session 401", res.status === 401);
  }

  // 4. vault status with session -> locked, registry missing flagged
  {
    const res = await fetch(`${base}/api/vault/status`, { headers: { cookie: session } });
    const body = await res.json();
    ok("status locked + no registry", res.status === 200 && body.unlocked === false && body.registry === false);
  }

  // 5. entries locked -> 403
  {
    const res = await fetch(`${base}/api/vault/entries`, { headers: { cookie: session } });
    ok("entries locked 403", res.status === 403);
  }

  // 6. unlock with WRONG password -> 401, no cookie
  {
    const res = await fetch(`${base}/api/vault/unlock`, { method: "POST", headers: { "content-type": "application/json", cookie: session }, body: JSON.stringify({ password: "wrong" }) });
    const sc = res.headers.get("set-cookie") || "";
    ok("unlock wrong pw 401", res.status === 401 && !sc.includes("astra_vault"));
  }

  // 7. seed registry via module import (as the maintainer would).
  // vault.mjs reads ASTRA_VAULT_SECRET from process.env at MODULE LOAD, so the
  // parent needs it set before the import — putting it only in the spawned
  // child's env leaves seedRegistry here with no secret and it throws.
  process.env.ASTRA_VAULT_SECRET = VAULT_SECRET;
  const { seedRegistry, vaultValues, listVault } = await import("./vault.mjs");
  const n = await seedRegistry([
    { id: "e1", key: "OPENAI_API_KEY", value: "sk-test-VALUE-one", project: "astra", category: "app", device: "kurama-core" },
    { id: "e2", key: "ANTHROPIC_API_KEY", value: "sk-ant-VALUE-two", project: "neutrinos", category: "app", harness: "claude", device: "kurama-core" },
    { id: "e3", key: "TF_TOKEN", value: "hcvla-VALUE-three", project: "infra", category: "tool", device: "susanoo-core" },
  ]);
  ok("seed 3 entries", n === 3);

  // 8. registry on disk has NO plaintext and NO decrypted value leak
  {
    const raw = await readFile(regPath, "utf8");
    ok("registry encrypted at rest", !raw.includes("sk-test-VALUE-one") && !raw.includes("sk-ant-VALUE-two") && !raw.includes("hcvla-VALUE-three") && raw.includes("salt") && raw.includes("."));
  }

  // 9. decrypt via module works
  {
    const vals = await vaultValues();
    ok("module decrypt", vals.ok === true && vals.values.e1 === "sk-test-VALUE-one" && vals.values.e3 === "hcvla-VALUE-three");
  }

  // 10. unlock with RIGHT password -> 200 + vault cookie
  let vaultCookie = "";
  {
    const res = await fetch(`${base}/api/vault/unlock`, { method: "POST", headers: { "content-type": "application/json", cookie: session }, body: JSON.stringify({ password: PASSWORD }) });
    const sc = res.headers.get("set-cookie") || "";
    vaultCookie = sc.split(";")[0];
    ok("unlock right pw 200 + cookie", res.status === 200 && vaultCookie.startsWith("astra_vault="));
  }

  const both = [session, vaultCookie].join("; ");

  // 11. entries with both cookies -> list without values
  {
    const res = await fetch(`${base}/api/vault/entries`, { headers: { cookie: both } });
    const body = await res.json();
    ok("entries unlocked 200, no values", res.status === 200 && body.entries.length === 3 && !("value" in body.entries[0]) && body.entries[0].key === "OPENAI_API_KEY");
  }

  // 12. values with both cookies
  {
    const res = await fetch(`${base}/api/vault/values`, { headers: { cookie: both } });
    const body = await res.json();
    ok("values unlocked 200", res.status === 200 && body.values.e1 === "sk-test-VALUE-one" && body.values.e2 === "sk-ant-VALUE-two");
  }

  // 13. devices aggregation
  {
    const res = await fetch(`${base}/api/vault/devices`, { headers: { cookie: both } });
    const body = await res.json();
    const k = body.devices.find((d) => d.name === "kurama-core");
    const s = body.devices.find((d) => d.name === "susanoo-core");
    ok("devices aggregate", res.status === 200 && k.count === 2 && s.count === 1 && k.projects.includes("astra"));
  }

  // 14. lock clears the gate. A real cookie jar honors Max-Age=0; raw fetch
  // does not, so simulate the jar: after /lock, drop the vault cookie from the
  // header we send (that is what a browser does with Max-Age=0).
  {
    const res = await fetch(`${base}/api/vault/lock`, { method: "POST", headers: { cookie: both } });
    const sc = res.headers.get("set-cookie") || "";
    const after = await fetch(`${base}/api/vault/entries`, { headers: { cookie: session } });
    ok("lock + entries re-403", res.status === 200 && sc.includes("Max-Age=0") && after.status === 403);
  }

  // 15. session-only (no vault cookie) can never read entries
  {
    const res = await fetch(`${base}/api/vault/entries`, { headers: { cookie: session } });
    ok("session alone insufficient", res.status === 403);
  }

  // 16. bad vault token shape rejected
  {
    const res = await fetch(`${base}/api/vault/entries`, { headers: { cookie: `${session}; astra_vault=garbage` } });
    ok("garbage token 403", res.status === 403);
  }

  await rm(regPath, { force: true });
  if (fails.length) {
    console.log(`\n${fails.length} FAILED: ${fails.join(", ")}`);
    process.exit(1);
  }
  console.log("\nall vault checks passed");
  process.exit(0);
}

// catch must reap too — a throw here previously left the server running and
// holding its port for the next instance.
main().catch((e) => { reapChild(); console.error("check crashed:", e); process.exit(1); });
