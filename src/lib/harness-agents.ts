// Harness-CLI detection for the sub-agent panel.
//
// WHY: `subagent.list` (gateway RPC) only knows Hermes `delegate_task` children.
// External CLI agents — claude code, opencode, agy (antigravity), codex, gemini —
// are invoked through the plain `terminal` tool (`claude -p …`, `opencode run …`,
// `agy -p …`) and never enter that registry, so the panel showed nothing while a
// whole second agent ran for minutes inside a terminal row.
//
// This module recognizes those invocations from tool.start / tool.generating /
// tool.complete payloads and produces synthetic SubagentRow-shaped records the
// panel merges with the gateway roster. Detection is deliberately CONSERVATIVE:
// a command qualifies only when the harness binary appears as the command's
// first token or right after a shell wrapper (`bash -c …`, `sh -lc …`), with an
// agent-style flag (`-p` / `--print` / `run` / `--oneshot`) or no other command
// before it. `echo claude` / `grep agy` must NOT match.

export interface HarnessRow {
  subagent_id: string;         // synthetic: "harness-<tool_id>"
  parent_id: null;
  depth: null;
  goal: string;                // the command, truncated
  delegation_id: null;
  model: string;               // harness name (claude / opencode / agy / …)
  started_at: number;          // epoch seconds
  status: string;              // "running" | "done"
  tool_count: null;
  last_tool: string | null;    // last terminal output chunk hint (short)
  accepting_steer: false;
  harness: true;               // marker distinguishing synthetic rows
}

const HARNESS_BINARIES: Record<string, string> = {
  claude: "claude",
  opencode: "opencode",
  agy: "agy",
  antigravity: "agy",
  codex: "codex",
  gemini: "gemini",
};

// Agent-invocation shapes that confirm intent once the binary is the lead token.
const AGENT_FLAGS = new Set(["-p", "--print", "--oneshot", "run", "exec", "-q", "--query"]);

export function detectHarness(command: unknown): { name: string; goal: string } | null {
  if (typeof command !== "string" || !command.trim()) return null;
  const tokens = command.trim().split(/\s+/);
  // Skip shell/nohup/env wrappers so `bash -lc "claude -p …"` still matches.
  // `timeout 600 agy …` takes an INT argument; wrappers with args consume them.
  const WRAPPERS = new Set(["bash", "sh", "zsh", "nohup", "env", "timeout", "exec", "command"]);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const base = t.split("/").pop() || t;
    if (!WRAPPERS.has(base)) break;
    i++;
    // shell wrappers carry their own flags (-lc, -c, -e…) before the command;
    // the command itself may be a single quoted blob — strip quotes from tokens.
    if (["bash", "sh", "zsh"].includes(base)) {
      while (i < tokens.length && tokens[i].startsWith("-")) i++;
      if (i < tokens.length && /^['\"]/.test(tokens[i])) tokens[i] = tokens[i].replace(/^['\"]|['\"]$/g, "");
    }
    if (base === "timeout") { while (i < tokens.length && /^[\d.]+[smh]?$/.test(tokens[i])) i++; }
    if (base === "env") { while (i < tokens.length && tokens[i].includes("=")) i++; }
  }
  const lead = tokens[i];
  if (!lead) return null;
  const base = (lead.split("/").pop() || lead).replace(/^claude-.*$/, "claude");
  const name = HARNESS_BINARIES[base];
  if (!name) return null;
  // First non-wrapper token IS the harness: an agent CLI is never a file argument
  // of another command at position 0 (echo/grep/cat put it later — they stay lead).
  const next = tokens[i + 1] || "";
  const looksAgent = AGENT_FLAGS.has(next) || next === "" || !next.startsWith("-");
  if (!looksAgent) return null;
  const goal = command.trim().slice(0, 160);
  return { name, goal };
}

// Row id for a tool call (stable across start/generating/complete).
export function harnessRowId(toolId: unknown): string {
  const id = typeof toolId === "string" && toolId ? toolId : "";
  return `harness-${id}`;
}

// Row factory from a tool.start / tool.generating payload.
export function harnessRowFromToolStart(payload: any, toolId: unknown, nowSec: number): HarnessRow | null {
  const command = payload?.args?.command ?? payload?.args?.cmd ?? payload?.command;
  const hit = detectHarness(command);
  if (!hit) return null;
  const id = typeof toolId === "string" && toolId ? toolId : `harness-${Math.random().toString(36).slice(2, 8)}`;
  return {
    subagent_id: `harness-${id}`,
    parent_id: null, depth: null,
    goal: hit.goal, delegation_id: null,
    model: hit.name, started_at: nowSec, status: "running",
    tool_count: null, last_tool: null, accepting_steer: false,
    harness: true,
  };
}

// Merge gateway roster with synthetic harness rows (dedupe by subagent_id, gateway wins).
export function mergeRoster(gateway: any[], harness: HarnessRow[]): any[] {
  const byId = new Map<string, any>();
  for (const h of harness) byId.set(h.subagent_id, h);
  for (const g of gateway || []) byId.set(g.subagent_id, g);
  return [...byId.values()].sort((a, b) => (a.started_at ?? 0) - (b.started_at ?? 0));
}
