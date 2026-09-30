// Rich tool identity: every collapsed step header shows WHAT ran — typed name,
// human meta line, and structured INPUT/OUTPUT bodies (owner requirement:
// MCP/plugin/skill/file/terminal calls identified by name with input+output).
// 2026-09-30 owner pass: titles are now PLAIN-ENGLISH verb-first summaries a
// non-coder understands ("Edited auth.ts", "Ran a command", "Searched the web
// for …"), with the technical detail kept as a secondary `detail` line rendered
// in mono under the title. `meta` (server/step hints) still exported for the
// input body. Icons are chosen per kind by the renderer (toolIcon()).
// 2026-09-29 upgrade: the DISPLAY NAME is the concrete thing (skill name, MCP
// tool+server, browser step comment) — never a generic "Tool call"/"MCP".

export interface ToolInfo {
  kind: "mcp" | "skill" | "terminal" | "file" | "web" | "browser" | "memory" | "delegate" | "search" | "tool";
  name: string;        // display name, e.g. "astra-webui" or "get_doc_page"
  meta?: string;       // short human line for the header, e.g. "neutrinos-docs MCP"
  detail?: string;     // secondary mono line under the title (path/command/host)
  title?: string;      // plain-english verb-first title; falls back to name
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
  let v: unknown;
  try {
    v = JSON.parse(argsText);
  } catch { return null; }
  // Some harnesses double-encode: the args arrive as a JSON *string* whose
  // body is itself JSON ("{\"path\": …}"). Parse the inner layer too.
  if (typeof v === "string") {
    try {
      const inner = JSON.parse(v);
      if (inner && typeof inner === "object") return inner as Record<string, any>;
    } catch { /* fall through */ }
  }
  return v && typeof v === "object" ? (v as Record<string, any>) : null;
}

// Regex fallback for file tools whose args failed to parse at all — pulls the
// path straight out of the raw text so the title always names the file.
function pathRegex(argsText: string | undefined): string | undefined {
  if (!argsText) return undefined;
  const m = argsText.match(/"path"\s*:\s*"((?:[^"\\]|\\.)+)"/);
  if (!m) return undefined;
  try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
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

// Bare filename / short tail of a path, for titles: "Edited auth.ts".
function fileTail(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const t = p.split("/").filter(Boolean).pop();
  return t || p;
}

// Trim a host down to the readable part for titles.
function hostOf(u: string | undefined): string | undefined {
  if (!u) return undefined;
  const m = u.match(/^(?:https?:\/\/)?([^/\s]+)/);
  return m ? m[1].replace(/^www\./, "") : undefined;
}

export function describeTool(label: string | undefined, argsText: string | undefined, command?: string, resultText?: string): ToolInfo {
  const raw = (label || "").trim();
  const args = parseArgs(argsText);
  // File tools may lose `path` in args (double-encoded / elided) — the RESULT
  // still names the file ("Edited 2 files · a.ts, y.ts"). Last-chance fallback
  // so a file card NEVER says just "a file".
  const fileFromResult = (() => {
    const m = resultText?.match(/files?[^·\n]{0,20}·\s*([^\n"]+)/);
    if (m) return m[1].split(",")[0].trim();
    const j = resultText?.match(/"files_modified"\s*:\s*\["([^"]+)"/);
    if (j) return j[1].split("/").pop() || j[1];
    // read_file result shape: {"path": "/a/b.ts", ...} (path echoed back)
    const p = resultText && /^[\s{]*"/.test(resultText) ? (() => {
      try {
        const parsed = JSON.parse(resultText!);
        if (parsed && typeof parsed.path === "string") return parsed.path;
      } catch { /* not json */ }
      return undefined;
    })() : undefined;
    return p;
  })();

  // MCP: provider convention mcp__<server>__<tool>
  const mcp = parseMcp(raw);
  if (mcp) {
    // Humanize well-known MCP verbs; keep the real tool name as the detail.
    const t = mcp.tool;
    let title: string;
    if (/^get_|^read_|^fetch_/.test(t)) title = "Looked up information";
    else if (/^search|^find_/.test(t)) title = "Searched a connected service";
    else if (/^list|^browse/.test(t)) title = "Listed items";
    else if (/^create|^add_|^insert/.test(t)) title = "Created an entry";
    else if (/^update|^edit_|^modify|^rename/.test(t)) title = "Updated an entry";
    else if (/^delete|^remove|^trash/.test(t)) title = "Removed an entry";
    else if (/^send|^post|^submit/.test(t)) title = "Sent a request";
    else title = `Used a connected tool`;
    return {
      kind: "mcp", name: mcp.tool, title,
      meta: `${mcp.server} MCP`,
      detail: `${mcp.tool} · ${mcp.server}`,
      input: firstStr(args, ["query", "path", "url", "name", "topic", "command"]) ?? argsText,
      inputLabel: "INPUT",
    };
  }

  // Skill lifecycle — the card's NAME is the skill itself
  if (raw === "skill_view") {
    const s = firstStr(args, ["name"]);
    return {
      kind: "skill", name: s || "Skill", title: s ? `Loaded the ${s} playbook` : "Loaded a playbook",
      meta: "skill read", detail: s, input: argsText, inputLabel: "SKILL",
    };
  }
  if (raw === "skill_manage") {
    const ops = args?.operations;
    const first = Array.isArray(ops) ? ops[0] : undefined;
    const skill = (first && (first.name || (first.content && first.new_text === undefined))) ? first.name : first?.name;
    const n = Array.isArray(ops) ? ops.length : undefined;
    return {
      kind: "skill", name: skill || "Skill update",
      title: skill ? `Updated the ${skill} playbook` : "Updated a playbook",
      meta: n ? `${n} change${n > 1 ? "s" : ""}` : "skill write",
      detail: skill, input: argsText, inputLabel: "CHANGES",
    };
  }
  if (raw === "skills_list") {
    return { kind: "skill", name: "Skills catalog", title: "Checked available playbooks", meta: "all installed skills", input: argsText, inputLabel: "INPUT" };
  }

  // Terminal — the command IS the identity
  if (raw === "terminal" || raw === "bash" || raw === "shell") {
    const cmd = command || firstStr(args, ["command"]) || "";
    const head = cmd.replace(/\s+/g, " ").trim().slice(0, 60);
    // First word usually tells the story: git → checked the project history, etc.
    const verb = head.split(" ")[0];
    const known: Record<string, string> = {
      git: "Worked with the project's history (git)",
      npm: "Ran a project task (npm)",
      npx: "Ran a project task (npx)",
      node: "Ran a script with Node",
      python: "Ran a script with Python",
      python3: "Ran a script with Python",
      pip: "Installed Python packages",
      cargo: "Built with Rust (cargo)",
      go: "Ran a Go task",
      docker: "Ran something in Docker",
      curl: "Contacted a web service (curl)",
      ssh: "Connected to another machine",
      systemctl: "Managed a background service",
      ls: "Listed a folder's contents",
      cat: "Read a file",
      grep: "Searched inside files",
      find: "Searched for files",
    };
    return {
      kind: "terminal", name: "Terminal",
      title: known[verb] || (verb ? `Ran a command (${verb})` : "Ran a command"),
      meta: head || undefined, detail: head || undefined,
      input: argsText, inputLabel: "COMMAND",
    };
  }

  // File tools — plain-verb + filename in the title, path as detail.
  if (raw === "read_file" || raw === "write_file") {
    const p = firstStr(args, ["path"]) || pathRegex(argsText);
    const f = fileTail(p) || fileFromResult;
    return {
      kind: "file", name: raw === "read_file" ? "Read file" : "Write file",
      title: raw === "read_file" ? (f ? `Read ${f}` : "Read a file") : (f ? `Saved ${f}` : "Saved a file"),
      meta: p, detail: p,
      input: argsText, inputLabel: p ? "FILE" : "INPUT",
    };
  }
  if (raw === "patch") {
    const p = firstStr(args, ["path"]) || pathRegex(argsText);
    const f = fileTail(p) || fileFromResult;
    return {
      kind: "file", name: "Edit file",
      title: f ? `Edited ${f}` : "Edited a file",
      meta: p, detail: p, input: argsText, inputLabel: "FILE",
    };
  }

  // Code execution (Hermes execute_code): the first comment line of the script
  // IS the step description, same convention as browser_exec.
  if (raw === "execute_code" || raw === "execute-command") {
    const code = firstStr(args, ["code"]);
    const m = code?.match(/^[^\S\n]*#[^\S\n]*([^#^\n][^\n]*?)\s*$/m);
    const step = m?.[1]?.trim().slice(0, 90);
    return {
      kind: "terminal", name: "Run code",
      title: step || "Ran a block of Python",
      meta: step || "python", detail: step ? "python" : undefined,
      input: argsText, inputLabel: "CODE",
    };
  }

  // Web
  if (raw === "web_search") {
    const q = firstStr(args, ["query"]);
    return {
      kind: "web", name: "Web search",
      title: q ? `Searched the web for “${q}”` : "Searched the web",
      meta: q, input: argsText, inputLabel: "QUERY",
    };
  }
  if (raw === "web_extract") {
    const u = firstStr(args, ["urls", "url"]);
    const host = hostOf(u?.split(/[\s,]+/)[0]);
    return {
      kind: "web", name: "Fetch page",
      title: host ? `Read the page at ${host}` : "Read a web page",
      meta: u, detail: u, input: argsText, inputLabel: "URL",
    };
  }

  // Browser — title = the step comment ("Searching Amazon…"), detail = host.
  if (raw.startsWith("browser")) {
    const step = browserStep(args);
    const url = firstStr(args, ["url"]) || firstStr(args, ["code"])?.match(/https?:\/\/[^\s'"]+/)?.[0];
    const host = hostOf(url);
    return {
      kind: "browser",
      name: step || (raw === "browser_exec" ? "Browser" : raw.replace(/^browser_?/, "Browser · ")),
      title: step || (host ? `Worked in the browser on ${host}` : "Worked in the browser"),
      meta: step ? "browser" : firstStr(args, ["code", "url"])?.replace(/\s+/g, " ").slice(0, 120),
      detail: host,
      input: argsText, inputLabel: "SCRIPT",
    };
  }

  // Memory / knowledge
  if (raw === "memory" || raw === "fact_store") {
    const act = firstStr(args, ["action"]);
    const titles: Record<string, string> = {
      add: "Saved something to memory",
      update: "Updated its memory",
      remove: "Removed a memory",
      delete: "Removed a memory",
      search: "Checked its memory",
      probe: "Recalled everything about a topic",
      reason: "Connected memories to reason",
    };
    return {
      kind: "memory", name: raw === "memory" ? "Memory" : "Fact store",
      title: (act && titles[act]) || "Used its memory",
      meta: act ? `action: ${act}` : undefined,
      input: argsText, inputLabel: "INPUT",
    };
  }

  // Delegation — title = plain verb + goal
  if (raw === "delegate_task") {
    const tasks = Array.isArray(args?.tasks) ? (args!.tasks as any[]) : [];
    const goal = tasks[0]?.goal;
    const short = typeof goal === "string" ? excerptOf(goal, 80) : undefined;
    return {
      kind: "delegate", name: typeof goal === "string" ? short! : "Delegate",
      title: short ? `Asked a helper agent to: ${short}` : "Asked a helper agent to help",
      meta: tasks.length > 1 ? `+${tasks.length - 1} more task${tasks.length > 2 ? "s" : ""}` : "subagent",
      input: argsText, inputLabel: "TASK",
    };
  }

  // Search
  if (raw === "search_files" || raw === "tool_search" || raw === "tool_describe") {
    const q = firstStr(args, ["pattern", "queries", "names"]);
    if (raw === "search_files") {
      return { kind: "search", name: "Search files", title: q ? `Searched the project for “${q}”` : "Searched the project's files", meta: q, detail: q, input: argsText, inputLabel: "INPUT" };
    }
    return { kind: "search", name: raw === "tool_search" ? "Find tools" : "Tool docs", title: raw === "tool_search" ? "Looked for a suitable tool" : "Read a tool's manual", meta: q, input: argsText, inputLabel: "INPUT" };
  }

  // Generic tool (plugin calls, unknown MCP shapes) — pretty name + args
  const known = firstStr(args, ["path", "query", "name", "command"]);
  const p = (raw === "write_file" || raw === "patch" || raw === "read_file") ? (known || pathRegex(argsText)) : known;
  if (p) {
    const f = fileTail(p);
    if (/write|save/i.test(raw)) return { kind: "file", name: prettyName(raw) || "Tool", title: f ? `Saved ${f}` : `Saved a file`, meta: p, detail: p, input: argsText, inputLabel: "FILE" };
    if (/edit|patch/i.test(raw)) return { kind: "file", name: prettyName(raw) || "Tool", title: f ? `Edited ${f}` : `Edited a file`, meta: p, detail: p, input: argsText, inputLabel: "FILE" };
    if (/read/i.test(raw)) return { kind: "file", name: prettyName(raw) || "Tool", title: f ? `Read ${f}` : `Read a file`, meta: p, detail: p, input: argsText, inputLabel: "FILE" };
  }
  return { kind: "tool", name: prettyName(raw) || "Tool", title: `Used ${prettyName(raw) || "a tool"}`, meta: known, input: argsText, inputLabel: "INPUT" };
}

function excerptOf(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

function prettyName(raw: string): string {
  if (!raw) return "";
  return raw.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
