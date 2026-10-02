// Live slash-command registry.
//
// Source of truth is the upstream Hermes CLI registry
// (hermes_cli/commands.py :: COMMAND_REGISTRY) — 102 commands as of 2026-10-02.
// We read it by spawning the package's own venv python and importing it; we do
// NOT copy the list into JS, because a copied list silently goes stale on every
// `hermes update`, and the whole point here is that the palette is wired to
// what the terminal session actually supports.
//
// OWNER MANDATE: ~/.hermes/hermes-agent is read-only. This module imports it,
// never edits it.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, "..", ".cache");
const CACHE_FILE = join(CACHE_DIR, "command-registry.json");

const HERMES_REPO = "/home/notjitin/.hermes/hermes-agent";
const PYTHON = join(HERMES_REPO, "venv", "bin", "python");
// mtime of the registry file is the cache key: a `hermes update` that changes
// the command set invalidates the cache without any explicit version bump.
const REGISTRY_SRC = join(HERMES_REPO, "hermes_cli", "commands.py");

const TTL_MS = 10 * 60 * 1000;
const PY_TIMEOUT_MS = 20_000;

// Dumps the registry via the package's own interpreter. Injectable so the
// fail-open path is testable without breaking the real interpreter.
export const DUMP_SCRIPT = [
  "import json",
  "from hermes_cli.commands import COMMAND_REGISTRY",
  "print(json.dumps([{",
  "'name': c.name,",
  "'description': getattr(c, 'description', ''),",
  "'category': getattr(c, 'category', ''),",
  "'aliases': list(getattr(c, 'aliases', None) or ()),",
  "'args_hint': getattr(c, 'args_hint', '') or '',",
  "'cli_only': bool(getattr(c, 'cli_only', False)),",
  "'gateway_only': bool(getattr(c, 'gateway_only', False)),",
  "} for c in COMMAND_REGISTRY]))",
].join("\n");

/**
 * Coerce one raw registry record into the shape the client renders.
 * Upstream may add fields or return odd types; this must never throw.
 */
export function normaliseCommand(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name ?? "").trim().toLowerCase();
  if (!name) return null;
  const aliases = Array.isArray(raw.aliases) ? raw.aliases : [];
  return {
    name,
    description: String(raw.description ?? "").trim(),
    category: String(raw.category ?? "").trim() || "Other",
    // Filter null/undefined BEFORE String(), or a null alias silently becomes
    // the literal string "null" and renders as a real alias in the palette.
    aliases: aliases
      .filter((a) => a != null && String(a).trim() !== "")
      .map((a) => String(a).trim().toLowerCase()),
    args_hint: String(raw.args_hint ?? "").trim(),
    cli_only: Boolean(raw.cli_only),
    gateway_only: Boolean(raw.gateway_only),
  };
}

function sourceMtime() {
  try {
    return statSync(REGISTRY_SRC).mtimeMs;
  } catch {
    return 0;
  }
}

function readCache() {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const blob = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    if (!blob || !Array.isArray(blob.commands)) return null;
    return { ...blob, at: Number(blob.at) || 0 };
  } catch {
    return null;
  }
}

function writeCache(payload) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(payload), "utf8");
  } catch {
    /* cache is an optimisation; a read-only disk must not break the palette */
  }
}

function runDump() {
  return new Promise((resolve) => {
    execFile(
      PYTHON,
      ["-c", DUMP_SCRIPT],
      { cwd: HERMES_REPO, timeout: PY_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        try {
          const parsed = JSON.parse(stdout);
          resolve(Array.isArray(parsed) ? parsed.map(normaliseCommand).filter(Boolean) : null);
        } catch {
          resolve(null);
        }
      },
    );
  });
}

let memory = null; // { commands, at, mtime }
let inFlight = null;

async function refresh() {
  const fresh = await runDump();
  // FAIL-OPEN: a failed dump keeps the last good copy rather than blanking the
  // palette. The registry is a convenience, never a dependency of the chat.
  if (!fresh || !fresh.length) return false;
  memory = { commands: fresh, at: Date.now(), mtime: sourceMtime() };
  writeCache(memory);
  return true;
}

/**
 * Command list for the palette. Always resolves; never throws.
 * Stale-while-revalidate: a usable cache is served immediately and a refresh
 * runs in the background, so opening the palette is never slow.
 */
export async function getCommandRegistry() {
  const now = Date.now();
  const mtime = sourceMtime();

  if (memory && memory.mtime === mtime && now - memory.at < TTL_MS) {
    return { commands: memory.commands, source: "live" };
  }

  if (!memory) {
    const disk = readCache();
    if (disk && disk.mtime === mtime) {
      memory = { commands: disk.commands, at: disk.at || 0, mtime: disk.mtime };
      return { commands: memory.commands, source: "cache" };
    }
  }

  // No usable memory: disk cache (any mtime) beats blocking on python.
  if (!memory) {
    const disk = readCache();
    if (disk) {
      memory = { commands: disk.commands, at: disk.at || 0, mtime: disk.mtime };
      if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
      return { commands: memory.commands, source: "cache" };
    }
  }

  if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
  const ok = await inFlight;
  if (!ok || !memory) return { commands: [], source: "empty" };
  return { commands: memory.commands, source: "live" };
}