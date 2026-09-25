// Rich tool identity: every collapsed step header shows WHAT ran — typed name,
// human meta line, and structured INPUT/OUTPUT bodies (owner requirement:
// MCP/plugin/skill/file/terminal calls identified by name with input+output).

export interface ToolInfo {
  kind: "mcp" | "skill" | "terminal" | "file" | "web" | "browser" | "memory" | "delegate" | "search" | "tool";
  name: string;        // display name, e.g. "get_doc_page" or "terminal"
  meta?: string;       // short human line for the header, e.g. "server: neutrinos-docs · doc page"
  input?: string;      // labeled INPUT body (falls back to raw args)
  inputLabel?: string; // e.g. "COMMAND", "FILE", "SKILL", "QUERY"
}

// Only these get their own kind; everything else stays generic "tool".
const MCP_RE = /^mcp__([^_]+(?:__[a-z0-9]+)*?)__([a-z0-9_]+)$/i;

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

export function describeTool(label: string | undefined, argsText: string | undefined, command?: string): ToolInfo {
  const raw = (label || "").trim();
  const args = parseArgs(argsText);

  // MCP: provider convention mcp__<server>__<tool> (server may carry __ in its id)
  const m = raw.match(MCP_RE);
  if (m) {
    const server = m[1].replace(/__/g, "-").replace(/_+/g, "-");
    const tool = m[2];
    return {
      kind: "mcp", name: tool,
      meta: `MCP · ${server}`,
      input: firstStr(args, ["query", "path", "url", "name", "topic", "command"]) ?? argsText,
      inputLabel: "INPUT",
    };
  }

  // Skill lifecycle — show WHICH skill was loaded and its details
  if (raw === "skill_view") {
    const s = firstStr(args, ["name"]);
    return { kind: "skill", name: "Load skill", meta: s ? `skill: ${s}` : "skill", input: argsText, inputLabel: "SKILL" };
  }
  if (raw === "skill_manage") {
    const ops = args?.operations;
    const n = Array.isArray(ops) ? ops.length : undefined;
    return { kind: "skill", name: "Update skill", meta: n ? `${n} operation${n > 1 ? "s" : ""}` : "skill write", input: argsText, inputLabel: "CHANGES" };
  }
  if (raw === "skills_list") return { kind: "skill", name: "List skills", meta: "skill catalog", input: argsText, inputLabel: "INPUT" };

  // Terminal — the command IS the identity
  if (raw === "terminal" || raw === "bash" || raw === "shell") {
    return { kind: "terminal", name: "Terminal", meta: command || firstStr(args, ["command"]) || undefined, input: argsText, inputLabel: "COMMAND" };
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
  if (raw.startsWith("browser")) {
    return { kind: "browser", name: raw === "browser_exec" ? "Browser" : raw, meta: firstStr(args, ["code", "url"])?.replace(/\s+/g, " ").slice(0, 120), input: argsText, inputLabel: "SCRIPT" };
  }

  // Memory / knowledge
  if (raw === "memory" || raw === "fact_store") {
    return { kind: "memory", name: raw === "memory" ? "Memory" : "Fact store", meta: firstStr(args, ["action"]) ? `action: ${firstStr(args, ["action"])}` : undefined, input: argsText, inputLabel: "INPUT" };
  }

  // Delegation
  if (raw === "delegate_task") {
    const goal = args?.tasks?.[0]?.goal;
    return { kind: "delegate", name: "Delegate", meta: typeof goal === "string" ? goal.slice(0, 100) : undefined, input: argsText, inputLabel: "TASK" };
  }

  // Search
  if (raw === "search_files" || raw === "tool_search" || raw === "tool_describe") {
    return { kind: "search", name: raw === "search_files" ? "Search files" : raw === "tool_search" ? "Find tools" : "Tool docs", meta: firstStr(args, ["pattern", "queries", "names"]), input: argsText, inputLabel: "INPUT" };
  }

  // Generic tool (plugin calls, unknown MCP shapes) — name + args
  return { kind: "tool", name: raw || "Tool", meta: firstStr(args, ["path", "query", "name", "command"]), input: argsText, inputLabel: "INPUT" };
}
