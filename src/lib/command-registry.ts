// Slash-command registry client.
//
// The list is fetched from our own proxy (/api/hx/commands), which reads the
// upstream Hermes CLI registry live — so the palette always matches what the
// terminal session actually supports. Nothing here hardcodes a command name.

export interface CommandEntry {
  name: string;
  description: string;
  category: string;
  aliases: string[];
  args_hint: string;
  cli_only?: boolean;
  gateway_only?: boolean;
}

interface RegistryResponse {
  commands?: CommandEntry[];
  source?: string;
  count?: number;
}

/** Module-scope memo so reopening the palette costs nothing. */
let cached: CommandEntry[] | null = null;
let inflight: Promise<CommandEntry[]> | null = null;

export async function fetchCommandRegistry(force = false): Promise<CommandEntry[]> {
  if (!force && cached) return cached;
  if (!force && inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/hx/commands", { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RegistryResponse;
      const list = Array.isArray(data.commands) ? data.commands.filter((c) => c && c.name) : [];
      cached = list;
      return list;
    } catch {
      // Fail-open: an empty palette degrades to "type the command yourself"
      // instead of blocking the composer. Never surface a throw to the user.
      return cached ?? [];
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Test seam — lets checks drive the cached path without a fetch. */
export function __setRegistryCache(list: CommandEntry[] | null): void {
  cached = list;
}

/**
 * Command NAMES from the cache, synchronously.
 *
 * The send path needs to answer "is this a real command?" the instant the user
 * hits Enter, so it cannot await a fetch here. Returns null before the first
 * load, which is safe: surfaceFor then trusts only the curated table.
 */
export function knownCommandNames(): Set<string> | null {
  if (!cached) return null;
  const names = new Set<string>();
  for (const c of cached) {
    names.add(c.name);
    for (const a of c.aliases ?? []) names.add(a);
  }
  return names;
}

/**
 * Rank commands against a query typed after the slash.
 *
 * Subsequence match (so "bg" finds "background"), case-insensitive, ordered by
 * how strong the hit is: exact name > name prefix > name subsequence >
 * alias hit > description hit. An empty query preserves registry order.
 */
export function filterCommands(list: CommandEntry[], query: string): CommandEntry[] {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return list;

  const scored: { cmd: CommandEntry; score: number; at: number }[] = [];
  list.forEach((cmd, at) => {
    const name = cmd.name ?? "";
    let score = 0;

    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80 - Math.min(20, name.length - q.length);
    else if (isSubsequence(q, name)) score = 60;
    else if (cmd.aliases?.some((a) => a === q)) score = 55;
    else if (cmd.aliases?.some((a) => a.startsWith(q))) score = 45;
    else if (cmd.aliases?.some((a) => isSubsequence(q, a))) score = 35;
    else if ((cmd.description ?? "").toLowerCase().includes(q)) score = 20;

    if (score > 0) scored.push({ cmd, score, at });
  });

  // Stable: score desc, then registry order so equal matches don't shuffle.
  scored.sort((a, b) => (b.score - a.score) || (a.at - b.at));
  return scored.map((s) => s.cmd);
}

function isSubsequence(needle: string, hay: string): boolean {
  if (!needle) return false;
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return false;
}

/**
 * The command token currently being typed, or null when the caret is not
 * sitting in a slash command. Opening is anchored to the START of the input so
 * a "/" mid-sentence (a path, a date) never hijacks the palette.
 */
export function activeSlashQuery(value: string, caret: number): { query: string; start: number } | null {
  const upto = (value ?? "").slice(0, caret);
  const atLineStart = upto.length === 0 || /(^|\n)\s*$/.test(upto.slice(0, upto.lastIndexOf("\n") + 1));
  const m = /(?:^|\n)\s*\/([^\s/]*)$/.exec(upto);
  if (!m) return null;
  const start = caret - m[1].length - 1;
  // Only treat it as a command when nothing but the token precedes it.
  if (!atLineStart && !/^\s*$/.test(upto.slice(0, start))) return null;
  return { query: m[1], start };
}

/**
 * Replace the in-progress token with a chosen command.
 *
 * The token being replaced runs from `start` to the CARET (that is what
 * activeSlashQuery matched against), so anything the user already typed after
 * the caret is preserved.
 */
export function applySlashCommand(
  value: string,
  start: number,
  caret: number,
  cmd: CommandEntry,
): { text: string; caret: number } {
  // Show the first arg placeholder so the shape of the command is visible,
  // and place the caret inside it ready to type.
  const firstArg = cmd.args_hint?.trim().split(/\s+/)[0] ?? "";
  const stub = firstArg && !firstArg.startsWith("-") ? ` ${firstArg}` : "";
  const insert = `/${cmd.name}${stub}`;
  const head = (value ?? "").slice(0, start);
  const tail = (value ?? "").slice(caret);
  return { text: head + insert + tail, caret: start + insert.length };
}