// Human-friendly input/output fields for tool cards (owner requirement:
// expanding a card must show WHAT went in and WHAT came out as readable
// labeled rows, not raw machine JSON). Pure, no React — checkable via npx tsx.

export interface IOField {
  key: string;    // human label, e.g. "Query", "Command"
  value: string;  // display value (pre-clamped)
  mono?: boolean; // render in mono (commands, code, paths)
  long?: boolean; // tall text: gets its own capped scroll region
  md?: boolean;   // render as rich markdown (lists, tables, links, code)
}

const KEY_LABELS: Record<string, string> = {
  query: "Query", queries: "Queries", urls: "URLs", url: "URL",
  path: "Path", file_path: "File", name: "Name", names: "Names",
  pattern: "Pattern", command: "Command", cmd: "Command", code: "Code",
  content: "Content", text: "Text", topic: "Topic", action: "Action",
  old_string: "Find", new_string: "Replace with",
  offset: "Offset", limit: "Limit", goal: "Goal", context: "Context",
  description: "Description", question: "Question", questions: "Questions",
  operations: "Changes", tasks: "Tasks", handles: "Handles",
  images: "Images", session_id: "Session", file_glob: "Filter",
  target: "Target", schema: "Schema", prompt: "Prompt",
};

// Values that can be huge and read best in a scroll region.
const LONG_KEYS = new Set([
  "code", "content", "old_string", "new_string", "text", "goal",
  "context", "description", "script", "body", "prompt",
]);
// Input keys that are natural-language documents (not code) — render rich so
// the structure the agent wrote (lists, headers) stays readable.
const INPUT_PROSE_KEYS = new Set([
  "content", "text", "goal", "context", "description", "prompt", "body",
]);
// Values that are code-ish / path-ish and read best in mono.
const MONO_KEYS = new Set([
  "command", "cmd", "code", "old_string", "new_string", "script",
  "pattern", "path", "file_path", "url", "urls", "file_glob",
]);
// Handled by dedicated summaries — never dumped generically.
const SKIP_KEYS = new Set(["operations", "tasks"]);

function humanKey(k: string): string {
  return KEY_LABELS[k] || k.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function valToStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    const parts = v.slice(0, 5).map((x) => (typeof x === "string" ? x : valToStr(x)));
    return v.length > 5 ? `${parts.join(", ")} +${v.length - 5} more` : parts.join(", ");
  }
  try { return JSON.stringify(v); } catch { return String(v); }
}

function shortVal(s: string): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > 300 ? flat.slice(0, 300) + "…" : flat;
}

/** One-line excerpt of a thought / long text, for collapsed headers. */
export function excerpt(text: string | undefined, max = 90): string {
  if (!text) return "";
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) || "";
  const flat = line.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

export function describeInput(
  _label: string | undefined,
  argsText: string | undefined,
  command?: string,
): IOField[] {
  const fields: IOField[] = [];
  let args: Record<string, unknown> | null = null;
  try {
    const v = argsText ? JSON.parse(argsText) : null;
    if (v && typeof v === "object" && !Array.isArray(v)) args = v as Record<string, unknown>;
  } catch { /* raw, non-JSON args */ }

  if (command) fields.push({ key: "Command", value: String(command), mono: true });

  if (args) {
    // Dedicated compact summaries for structural params
    const ops = args.operations;
    if (Array.isArray(ops) && ops.length) {
      const acts = ops.map((o: any) => o?.action || o?.name).filter(Boolean).join(", ");
      fields.push({ key: "Changes", value: `${ops.length} op${ops.length > 1 ? "s" : ""}${acts ? " · " + acts : ""}`.slice(0, 300) });
    }
    const tasks = args.tasks;
    if (Array.isArray(tasks) && tasks.length) {
      const goals = tasks.slice(0, 2).map((t: any) => excerpt(typeof t?.goal === "string" ? t.goal : "", 80)).filter(Boolean).join(" · ");
      fields.push({ key: "Tasks", value: `${tasks.length} task${tasks.length > 1 ? "s" : ""}${goals ? " · " + goals : ""}` });
    }

    // Sensible display order: path first, Find before Replace with.
    const order = (k: string) => (k === "path" || k === "file_path" ? 0 : k === "old_string" ? 1 : k === "new_string" ? 2 : 3);
    const keys = Object.keys(args).sort((a, b) => order(a) - order(b));

    for (const k of keys) {
      const v = args[k];
      if (SKIP_KEYS.has(k)) continue;
      if (command && (k === "command" || k === "cmd")) continue; // already shown
      if (v === undefined || v === null || v === "") continue;
      const raw = typeof v === "string" ? v : valToStr(v);
      if (!raw.trim()) continue;
      const isLong = LONG_KEYS.has(k) && raw.length > 160;
      fields.push({
        key: humanKey(k),
        value: isLong ? raw.slice(0, 4000) : shortVal(raw),
        mono: MONO_KEYS.has(k),
        long: isLong,
        md: INPUT_PROSE_KEYS.has(k) && isLong && /[\n#*>|]/.test(raw),
      });
    }
  } else if (argsText && argsText.trim()) {
    fields.push({
      key: "Input",
      value: argsText.length > 160 ? argsText.slice(0, 4000) : shortVal(argsText),
      long: argsText.length > 160,
      mono: true,
    });
  }
  return fields;
}

// Interesting output keys in display-priority order.
const OUT_KEYS: Array<[string, string]> = [
  ["error", "Error"],
  ["exit_code", "Exit"],
  ["stdout", "Output"],
  ["stderr", "Stderr"],
  ["title", "Title"],
  ["url", "URL"],
  ["path", "Path"],
  ["description", "Summary"],
  ["summary", "Summary"],
  ["content", "Result"],
  ["output", "Output"],
  ["result", "Result"],
  ["text", "Text"],
  ["message", "Message"],
];

// Output keys whose values are human prose or structured documents (summaries,
// report bodies, content fields) — these render as rich markdown in the card so
// lists, tables, links and code blocks survive. Machine-ish keys (stdout,
// stderr, exit codes, error text) stay plain/mono.
const PROSE_KEYS = new Set([
  "description", "summary", "content", "result", "text", "message", "title",
]);

function firstStrOf(o: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

export function describeOutput(_label: string | undefined, resultText: string | undefined): IOField[] {
  const text = (resultText || "").trim();
  if (!text) return [];

  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }

  if (parsed !== undefined && parsed !== null && typeof parsed === "object") {
    const fields: IOField[] = [];

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) return [{ key: "Result", value: "Empty" }];
      const titles = parsed
        .slice(0, 4)
        .map((x: any) => firstStrOf(x, ["title", "name", "url", "path", "id"]))
        .filter(Boolean);
      fields.push({
        key: "Results",
        value: `${parsed.length} item${parsed.length > 1 ? "s" : ""}${titles.length ? " · " + titles.join(" · ") : ""}`.slice(0, 300),
      });
      const firstContent = firstStrOf(parsed[0], ["content", "description", "text", "summary"]);
      if (firstContent && firstContent.length > 80) {
        fields.push({ key: "First result", value: firstContent.slice(0, 4000), long: true, md: true });
      }
      return fields;
    }

    const obj = parsed as Record<string, unknown>;

    // Patch tool result: {"success":true,"files_modified":[...]} → human line
    if (typeof obj.success === "boolean" && Array.isArray(obj.files_modified)) {
      const files = obj.files_modified as string[];
      const names = files.map((f) => f.split("/").pop()).filter(Boolean);
      const fields: IOField[] = [
        { key: obj.success ? "Result" : "Error", value: obj.success ? `Edited ${files.length} file${files.length > 1 ? "s" : ""} · ${names.join(", ")}` : `Patch failed` },
      ];
      return fields;
    }

    for (const [k, label] of OUT_KEYS) {
      const v = obj[k];
      if (v === undefined || v === null || v === "") continue;
      const raw = typeof v === "string" ? v : valToStr(v);
      if (!raw.trim()) continue;
      const isLong = raw.length > 160;
      fields.push({
        key: label,
        value: isLong ? raw.slice(0, 4000) : shortVal(raw),
        mono: k === "stdout" || k === "stderr" || k === "exit_code",
        long: isLong,
        md: PROSE_KEYS.has(k) && !/^(stdout|stderr|exit_code)$/.test(k) && (isLong || /[\n#*|\-] /.test(raw)),
      });
    }
    if (fields.length === 0) {
      // No known key — compact whole-object summary instead of a JSON dump.
      const flat = valToStr(parsed).replace(/\s+/g, " ");
      fields.push({ key: "Result", value: flat.length > 300 ? flat.slice(0, 300) + "…" : flat });
    }
    return fields;
  }

  // Plain text result (terminal output etc. is handled by its own renderer).
  if (text.length > 200) {
    return [{ key: "Result", value: text.slice(0, 4000), long: true }];
  }
  return [{ key: "Result", value: shortVal(text) }];
}
