// astra vault: env-var registry with encrypted-at-rest values + password re-gate.
// ponytail: one module, node:crypto only, no deps.
// Registry: data/vault-registry.json (gitignored, mode 600) — values stored as
// AES-256-GCM ciphertext; the data key is derived (scrypt) from the vault
// secret + per-file salt, never written to disk.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Overridable so a test run can never touch the real registry.
const REGISTRY = process.env.ASTRA_VAULT_REGISTRY
  || resolve(import.meta.dirname, "..", "data", "vault-registry.json");
const VAULT_SECRET = process.env.ASTRA_VAULT_SECRET; // set in env file; if absent, vault read-only errors out
const VAULT_TTL_MS = Number(process.env.ASTRA_VAULT_TTL_MS || 10 * 60 * 1000); // 10 min unlock window

function deriveKey(salt) {
  return scryptSync(String(VAULT_SECRET), salt, 32);
}

function encryptValue(plain, salt) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(salt), iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}

function decryptValue(payload, salt) {
  const [ivB, tagB, ctB] = String(payload).split(".");
  if (!ivB || !tagB || !ctB) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(salt), Buffer.from(ivB, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null; // wrong salt/secret or tampered
  }
}

async function readRegistry() {
  try {
    const raw = await readFile(REGISTRY, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.salt !== "string" || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// One-time seed from the env the server already holds: entries are imported
// with values encrypted; plaintext never touches the registry file.
export async function seedRegistry(items, log = false) {
  if (!VAULT_SECRET) throw new Error("ASTRA_VAULT_SECRET not set");
  await mkdir(dirname(REGISTRY), { recursive: true });
  let salt;
  try {
    const existing = JSON.parse(await readFile(REGISTRY, "utf8"));
    salt = existing.salt;
  } catch {
    salt = randomBytes(16).toString("hex");
  }
  // service/purpose/kind/url are descriptive only — never the value. They are
  // what turn "ASTRA_WEBUI_PASSWORD" into "the password you type to sign in".
  const entries = items.map((it) => ({
    id: it.id || randomBytes(6).toString("hex"),
    key: String(it.key),
    project: String(it.project || "unsorted"),
    harness: String(it.harness || ""),
    harnesses: Array.isArray(it.harnesses) ? it.harnesses.map(String) : [],
    category: String(it.category || "app"), // app|website|tool|service
    device: String(it.device || "kurama-core"),
    service: String(it.service || it.project || "unsorted"),
    serviceId: String(it.serviceId || ""),
    purpose: String(it.purpose || ""),
    kind: String(it.kind || ""),
    url: it.url ? String(it.url) : null,
    updated: Date.now(),
    value: encryptValue(String(it.value), salt),
  }));
  await writeFile(REGISTRY, JSON.stringify({ salt, entries }, null, 2), { mode: 0o600 });
  if (log) console.log(`astra-vault: seeded ${entries.length} entries`);
  return entries.length;
}

// Public (no value) listing — safe even without an unlock.
export async function listVault() {
  const reg = await readRegistry();
  if (!reg) return { ok: false, error: "vault registry missing" };
  return {
    ok: true,
    entries: reg.entries.map(
      ({ id, key, project, harness, harnesses, category, device, service, serviceId, purpose, kind, url, updated }) => ({
        id, key, project, harness, harnesses: harnesses || [], category, device,
        service, serviceId, purpose, kind, url, updated,
      })
    ),
  };
}

// Values only: requires the registry + ASTRA_VAULT_SECRET to decrypt.
export async function vaultValues() {
  const reg = await readRegistry();
  if (!reg) return { ok: false, error: "vault registry missing" };
  if (!VAULT_SECRET) return { ok: false, error: "vault locked (no secret configured)" };
  const out = {};
  for (const e of reg.entries) {
    const plain = decryptValue(e.value, reg.salt);
    out[e.id] = plain === null ? null : plain;
  }
  return { ok: true, values: out };
}

// Devices tracked in the registry (for the devices tab).
export async function vaultDevices() {
  const reg = await readRegistry();
  if (!reg) return { ok: false, error: "vault registry missing" };
  const devices = {};
  for (const e of reg.entries) {
    devices[e.device] = devices[e.device] || { name: e.device, count: 0, projects: new Set() };
    devices[e.device].count++;
    devices[e.device].projects.add(e.project);
  }
  return {
    ok: true,
    devices: Object.values(devices).map((d) => ({ name: d.name, count: d.count, projects: [...d.projects] })),
  };
}

export const VAULT_TTL = VAULT_TTL_MS;

// --- unlock token: same HMAC scheme as the session, shorter TTL, separate cookie ---
export function vaultSign(secret, payload) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function vaultVerify(secret, token) {
  if (typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const exp = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(vaultSign(secret, exp));
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return false;
  return Number(exp) > Date.now();
}
