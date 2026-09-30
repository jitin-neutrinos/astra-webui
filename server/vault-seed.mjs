// vault-seed.mjs — harvest env vars from across the machine into the vault registry.
//
//   node server/vault-seed.mjs           # seed (values encrypted at rest)
//   node server/vault-seed.mjs --dry     # report what would be seeded, no write
//
// Why: the vault page shipped with a working backend and an empty registry, so
// it rendered "vault registry missing". Values are encrypted with a key derived
// from ASTRA_VAULT_SECRET and never written in plaintext; the registry is 0600
// and gitignored.
//
// NEVER prints a secret value — counts and key names only.
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

/** Short, stable, non-reversible id for a value — never the value itself. */
function hash(v) {
  return createHash("sha256").update(String(v)).digest("hex").slice(0, 8);
}

const ROOT = resolve(import.meta.dirname, "..");
const DRY = process.argv.includes("--dry");
const HOME = homedir();

const SECRETISH =
  /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|BEARER|CERT|DSN)/i;

// Noise: paths, ports, feature flags, URLs with no secret in them.
const SKIP_EXACT = new Set([
  "PATH", "HOME", "PWD", "SHELL", "USER", "LOGNAME", "TERM", "LANG",
  "NODE_ENV", "PORT", "HOST", "PUID", "PGID", "TZ", "EDITOR", "PAGER",
]);
const SKIP_PREFIX = /^(npm_|NPM_|GIT_|LESSOPEN|XDG_|DBUS_|SYSTEMD_|LS_COLORS|LS_)/;

function parseDotEnv(text) {
  const out = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out.push([key, value]);
  }
  return out;
}

/** Pull key/value pairs out of an arbitrary MCP config, whatever its shape. */
function walkForEnv(node, path = [], out = [], depth = 0) {
  if (depth > 8 || node === null || typeof node !== "object") return out;
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      walkForEnv(v, [...path, k], out, depth + 1);
    } else if (
      typeof v === "string" &&
      SECRETISH.test(k) &&
      v.length > 6 &&
      !/^(\$\{|\{env:)/.test(v)
    ) {
      out.push([[...path, k].join("."), v]);
    }
  }
  return out;
}

const SOURCES = [
  {
    project: "astra", harness: "astra-webui", category: "app", device: "kurama-core",
    service: "astra", file: join(HOME, ".config/astra-webui/env"), kind: "dotenv",
  },
  {
    project: "headroom", harness: "", category: "service", device: "kurama-core",
    service: "headroom", dir: join(HOME, ".headroom/config"), glob: ".env", kind: "dotenv",
  },
  {
    project: "agent-fleet", harness: "claude", category: "tool", device: "kurama-core",
    file: join(HOME, ".claude.json"), kind: "json", pick: (o) => o.mcpServers,
  },
  {
    project: "agent-fleet", harness: "agy", category: "tool", device: "kurama-core",
    file: join(HOME, ".gemini/config/mcp_config.json"), kind: "json", pick: (o) => o.mcpServers,
  },
  {
    project: "agent-fleet", harness: "opencode", category: "tool", device: "kurama-core",
    file: join(HOME, ".config/opencode/opencode.json"), kind: "json", pick: (o) => o.mcp,
  },
  {
    project: "agent-fleet", harness: "gemini", category: "tool", device: "kurama-core",
    file: join(HOME, "Work/infra/agent-fleet/mcp/gemini.json"), kind: "json",
  },
  {
    project: "agent-fleet", harness: "opencode", category: "tool", device: "kurama-core",
    file: join(HOME, "Work/infra/agent-fleet/mcp/opencode.json"), kind: "json",
  },
  {
    project: "astra", harness: "astra-webui", category: "service", device: "kurama-core",
    file: join(ROOT, ".env"), kind: "dotenv", optional: true,
  },
];

// ── Making each secret explain itself ────────────────────────────────────
// A raw key like `context7.headers.Authorization` says nothing. Each entry
// gets the SERVICE it belongs to, what that service is, and a plain-English
// purpose, so the list reads as "Context7 — API token for the docs MCP"
// instead of a JSON path fragment.

const SERVICES = {
  context7: {
    name: "Context7",
    purpose: "Library documentation lookup used by the coding harnesses",
    url: "https://context7.com",
    kind: "MCP server",
  },
  github: {
    name: "GitHub",
    purpose: "Repository access: clone, push and CI from the harness",
    url: "https://github.com",
    kind: "MCP server",
  },
  "laya-decisions": {
    name: "Laya decisions",
    purpose: "Local decision engine: routing, risk gates, done-gates",
    url: "https://laya-decision-mcp.jitinnair.com/mcp",
    kind: "MCP server",
  },
  "mission-control": {
    name: "Mission Control",
    purpose: "AgeOS project and run management",
    url: "http://127.0.0.1:3100",
    kind: "MCP server",
  },
  astra: {
    name: "Astra web UI",
    purpose: "This app: sign-in, session signing and vault encryption",
    url: "https://astra.jitinnair.com",
    kind: "Application",
  },
  headroom: {
    name: "Headroom proxy",
    purpose: "Model-call proxy in front of every LLM provider on this box",
    url: null,
    kind: "Service",
  },
  ntfy: {
    name: "ntfy",
    purpose: "Push notifications to your phone from this host",
    url: "https://ntfy.sh",
    kind: "Service",
  },
};

const KEY_PURPOSE = {
  ASTRA_WEBUI_PASSWORD: "The password you type to sign in",
  ASTRA_HERMES_PASSWORD: "Password for the Hermes backend Astra talks to",
  ASTRA_WEBUI_SECRET: "Signs the session cookie so the browser stays logged in",
  ASTRA_VAULT_SECRET: "Derives the key that encrypts every stored value",
  NTFY_AUTH: "Authorises this host to publish to your ntfy topic",
  LAYA_MCP_TOKEN: "Bearer token for the Laya decision MCP",
  GITHUB_PERSONAL_ACCESS_TOKEN: "GitHub personal access token",
  MC_API_KEY: "API key for Mission Control",
  Authorization: null, // resolved per-service below: the service purpose is the useful description
};

/** Pull the service name out of a JSON path, ignoring the noise around it. */
// ntfy is a distinct service even though its token lives in the astra env file.
const KEY_SERVICE = { NTFY_AUTH: "ntfy" };

function serviceOf(key) {
  const bare = bareKey(key);
  if (KEY_SERVICE[bare]) return KEY_SERVICE[bare];
  const parts = key.split(".");
  // skip structural segments: mcpServers, headers, env, servers
  const meaningful = parts.filter(
    (p) => !["mcpServers", "servers", "headers", "env", "mcp"].includes(p)
  );
  const candidate = (meaningful[0] || parts[0] || "").toLowerCase();
  if (SERVICES[candidate]) return candidate;
  const prefix = key.split(".")[0].toLowerCase();
  return SERVICES[prefix] ? prefix : "other";
}

/** The bare key, with the JSON path stripped. */
function bareKey(key) {
  const parts = key.split(".").filter(
    (p) => !["mcpServers", "servers", "headers", "env", "mcp"].includes(p)
  );
  return parts[parts.length - 1] || key;
}

function describe(key, serviceId, src) {
  // A dotenv source has no prefix in the key name, so it cannot be inferred.
  // The source knows what it is; fall back to that.
  if ((serviceId === "other" || !SERVICES[serviceId]) && src && src.service) {
    const svc = SERVICES[src.service];
    if (svc) {
      const bare0 = bareKey(key);
      return {
        service: svc.name,
        purpose: KEY_PURPOSE[bare0] || svc.purpose,
        kind: svc.kind,
        url: svc.url,
        bare: bare0,
      };
    }
  }
  const svc = SERVICES[serviceId] || {
    name: serviceId === "other" ? "Unclassified" : serviceId,
    purpose: "Credential harvested from the local configuration",
    kind: "Unknown",
  };
  const bare = bareKey(key);
  // "Authorization" alone says nothing, so borrow the service's own purpose and
  // name the credential type explicitly.
  const purpose =
    KEY_PURPOSE[bare] ||
    (bare === "Authorization" ? `${svc.purpose} — sent as a bearer credential` : null) ||
    KEY_PURPOSE[serviceId] ||
    svc.purpose;
  return { service: svc.name, purpose, kind: svc.kind, url: svc.url, bare };
}
function acceptable(key, value) {
  if (SKIP_EXACT.has(key)) return false;
  if (SKIP_PREFIX.test(key)) return false;
  if (!SECRETISH.test(key)) return false;
  if (!value || value.length < 6) return false;
  return true;
}

async function collect() {
  const items = [];
  const seen = new Set();
  const perSource = [];

  for (const src of SOURCES) {
    let text = "";
    try {
      if (src.file) {
        if (!existsSync(src.file)) continue;
        text = await readFile(src.file, "utf8");
      } else if (src.dir) {
        if (!existsSync(src.dir)) continue;
        for (const f of await readdir(src.dir)) {
          if (src.glob && !f.endsWith(src.glob)) continue;
          text += "\n" + await readFile(join(src.dir, f), "utf8");
        }
      }
    } catch {
      continue;
    }
    if (!text.trim()) continue;

    let pairs = [];
    if (src.kind === "dotenv") {
      pairs = parseDotEnv(text);
    } else {
      try {
        const parsed = JSON.parse(text);
        const subtree = src.pick ? src.pick(parsed) : parsed;
        pairs = walkForEnv(subtree);
      } catch {
        continue;
      }
    }

    let added = 0;
    for (const [key, value] of pairs) {
      if (!acceptable(key, value)) continue;
      const svcId = serviceOf(key) === "other" && src.service ? src.service : serviceOf(key);
      const info = describe(key, svcId, src);
      // The same credential configured in three harnesses is ONE thing to the
      // reader, not three. Key on the value so it collapses to a single row
      // carrying every harness it is wired into.
      const id = `v:${info.bare}:${hash(value)}`;
      const existing = items.find((it) => it.id === id);
      if (existing) {
        if (!existing.harnesses.includes(src.harness || "app env")) {
          existing.harnesses.push(src.harness || "app env");
        }
        continue;
      }
      items.push({
        id,
        key: info.bare,
        rawKey: key,
        value,
        project: src.project,
        harness: src.harness,
        harnesses: [src.harness || "app env"],
        category: src.category,
        device: src.device,
        service: info.service,
        serviceId: svcId,
        purpose: info.purpose,
        kind: info.kind,
        url: info.url,
      });
      added++;
    }
    perSource.push({ source: `${src.project}/${src.harness || "-"}`, added });
  }
  return { items, perSource };
}

async function main() {
  const { items, perSource } = await collect();

  console.log(`harvested ${items.length} candidate vars`);
  for (const s of perSource) console.log(`  ${s.source.padEnd(28)} ${s.added}`);

  if (!items.length) {
    console.log("nothing to seed");
    return;
  }
  if (DRY) {
    console.log("\nkeys that would be seeded (values not printed):");
    for (const it of items) console.log(`  ${it.project}/${it.harness || "-"}  ${it.key}`);
    return;
  }

  if (!process.env.ASTRA_VAULT_SECRET) {
    console.error(
      "ASTRA_VAULT_SECRET is not set. Add it to ~/.config/astra-webui/env, e.g.\n" +
        '  ASTRA_VAULT_SECRET=$(openssl rand -hex 32)\n' +
        "then restart astra-webui.service. The registry cannot be written without it."
    );
    process.exit(1);
  }

  const { seedRegistry, listVault } = await import("./vault.mjs");
  const n = await seedRegistry(items, true);
  const after = await listVault();

  const regPath = join(ROOT, "data", "vault-registry.json");
  const st = await stat(regPath);
  console.log(`seeded ${n} entries -> ${regPath} (${st.size} bytes, mode ${(st.mode & 0o777).toString(8)})`);
  console.log(`readback ok=${after.ok} entries=${after.entries?.length}`);

  // prove nothing readable leaked into the file
  const raw = await readFile(regPath, "utf8");
  const leaked = items.filter((it) => raw.includes(`"${it.value}"`)).map((it) => it.key);
  console.log(`plaintext leak check: ${leaked.length === 0 ? "clean" : "LEAKED " + leaked.join(", ")}`);
  if (leaked.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});