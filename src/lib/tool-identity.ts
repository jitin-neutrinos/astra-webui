// Rich tool identity: every collapsed step header shows WHAT ran — typed name,
// human meta line, and structured INPUT/OUTPUT bodies (owner requirement:
// MCP/plugin/skill/file/terminal calls identified by name with input+output).
// 2026-09-29 upgrade: the DISPLAY NAME is the concrete thing (skill name, MCP
// tool+server, browser step comment) — never a generic "Tool call"/"MCP".

export interface ToolInfo {
  kind: "mcp" | "skill" | "terminal" | "file" | "web" | "browser" | "memory" | "delegate" | "search" | "tool";
  name: string;        // display name, e.g. "astra-webui" or "get_doc_page"
  meta?: string;       // short human line for the header, e.g. "neutrinos-docs MCP"
  input?: string;      // labeled INPUT body (falls back to raw args)
  inputLabel?: string; // e.g. "COMMAND", "FILE", "SKILL", "QUERY"
}

// Only these get their own kind; everything else stays generic "tool".
// MCP ids are mcp__<server>__<tool> where the SERVER may itself contain single
// underscores (mcp__neutrinos_docs__get_doc_page) — the separator is always
// the LAST double underscore; tool names never contain "__".
function parseMcp(raw: string): { server: string; tool: string } | null {
  if (!raw.startsWith("mcp__")) return null;
  const parts = raw.split("__");
  if (parts.length < 3) return null;
  const tool = parts[parts.length - 1];
  if (!tool || !/^[a-z0-9_]+$/i.test(tool)) return null;
  const server = parts.slice(1, -1).join("-").replace(/_+/g, "-");
  if (!server) return null;
  return { server, tool };
}

function parseArgs(argsText: string | undefined): Record<string, any> | null {
  if (!argsText) return null;
  try {
    const v = JSON.parse(argsText);
    return v && typeof v === "object" ? v : null;
  } catch { return null; }
}

function firstStr(a: Record<string, any> | null, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = a?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

// Browser-exec scripts start with a one-line "# step comment" — that IS the
// human description of what the browser is doing.
function browserStep(args: Record<string, any> | null): string | undefined {
  const code = firstStr(args, ["code"]);
  if (!code) return undefined;
  const m = code.match(/^[^\S\n]*#[^\S\n]*#?[^\S\n]*([^\n]+?)\s*$/m);
  if (!m) return undefined;
  return m[1].trim().slice(0, 110);
}

export function describeTool(label: string | undefined, argsText: string | undefined, command?: string): ToolInfo {
  const raw = (label || "").trim();
  const args = parseArgs(argsText);

  // MCP: provider convention mcp__<server>__<tool>
  const mcp = parseMcp(raw);
  if (mcp) {
    return {
      kind: "mcp", name: mcp.tool,
      meta: `${mcp.server} MCP`,
      input: firstStr(args, ["query", "path", "url", "name", "topic", "command"]) ?? argsText,
      inputLabel: "INPUT",
    };
  }

  // Skill lifecycle — the card's NAME is the skill itself
  if (raw === "skill_view") {
    const s = firstStr(args, ["name"]);
    return { kind: "skill", name: s || "Skill", meta: "skill read", input: argsText, inputLabel: "SKILL" };
  }
  if (raw === "skill_manage") {
    const ops = args?.operations;
    const first = Array.isArray(ops) ? ops[0] : undefined;
    const skill = (first && (first.name || (first.content && first.new_text === undefined))) ? first.name : first?.name;
    const n = Array.isArray(ops) ? ops.length : undefined;
    return { kind: "skill", name: skill || "Skill update", meta: n ? `${n} change${n > 1 ? "s" : ""}` : "skill write", input: argsText, inputLabel: "CHANGES" };
  }
  if (raw === "skills_list") return { kind: "skill", name: "Skills catalog", meta: "all installed skills", input: argsText, inputLabel: "INPUT" };

  // Terminal — the command IS the identity
  if (raw === "terminal" || raw === "bash" || raw === "shell") {
    return { kind: "terminal", name: "Terminal", meta: command || firstStr(args, ["command"]), input: argsText, inputLabel: "COMMAND" };
  }

  // File tools — show the path
  if (raw === "read_file" || raw === "write_file") {
    const p = firstStr(args, ["path"]);
    return { kind: "file", name: raw === "read_file" ? "Read file" : "Write file", meta: p, input: argsText, inputLabel: p ? "FILE" : "INPUT" };
  }
  if (raw === "patch") {
    const p = firstStr(args, ["path"]);
    return { kind: "file", name: "Edit file", meta: p, input: argsText, inputLabel: "FILE" };
  }

  // Web
  if (raw === "web_search" || raw === "web_extract") {
    const q = firstStr(args, ["query", "urls"]);
    return { kind: "web", name: raw === "web_search" ? "Web search" : "Fetch page", meta: q, input: argsText, inputLabel: raw === "web_search" ? "QUERY" : "URL" };
  }

  // Browser — name = the step comment ("Searching Amazon…"), meta = tool
  if (raw.startsWith("browser")) {
    const step = browserStep(args);
    return {
      kind: "browser",
      name: step || (raw === "browser_exec" ? "Browser" : raw.replace(/^browser_?/, "Browser · ")),
      meta: step ? "browser" : firstStr(args, ["code", "url"])?.replace(/\s+/g, " ").slice(0, 120),
      input: argsText, inputLabel: "SCRIPT",
    };
  }

  // Memory / knowledge
  if (raw === "memory" || raw === "fact_store") {
    return { kind: "memory", name: raw === "memory" ? "Memory" : "Fact store", meta: firstStr(args, ["action"]) ? `action: ${firstStr(args, ["action"])}` : undefined, input: argsText, inputLabel: "INPUT" };
  }

  // Delegation — name = first task goal
  if (raw === "delegate_task") {
    const tasks = Array.isArray(args?.tasks) ? (args!.tasks as any[]) : [];
    const goal = tasks[0]?.goal;
    return { kind: "delegate", name: typeof goal === "string" ? excerptOf(goal, 80) : "Delegate", meta: tasks.length > 1 ? `+${tasks.length - 1} more task${tasks.length > 2 ? "s" : ""}` : "subagent", input: argsText, inputLabel: "TASK" };
  }

  // Search
  if (raw === "search_files" || raw === "tool_search" || raw === "tool_describe") {
    return { kind: "search", name: raw === "search_files" ? "Search files" : raw === "tool_search" ? "Find tools" : "Tool docs", meta: firstStr(args, ["pattern", "queries", "names"]), input: argsText, inputLabel: "INPUT" };
  }

  // Generic tool (plugin calls, unknown MCP shapes) — pretty name + args
  return { kind: "tool", name: prettyName(raw) || "Tool", meta: firstStr(args, ["path", "query", "name", "command"]), input: argsText, inputLabel: "INPUT" };
}

function excerptOf(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

function prettyName(raw: string): string {
  if (!raw) return "";
  return raw.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
