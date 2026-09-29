// Runnable check for the human-friendly tool I/O renderers (owner 2026-09-29).
// npx tsx src/lib/tool-io.check.ts
import {
  describeInput,
  describeOutput,
  excerpt,
  type IOField,
} from "./tool-io";
import { describeTool } from "./tool-identity";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) { console.error("FAIL:", msg); process.exit(1); }
}
function field(fields: IOField[], key: string): IOField | undefined {
  return fields.find((f) => f.key === key);
}

// ---- describeInput -----------------------------------------------------------
const in1 = describeInput("skill_view", JSON.stringify({ name: "astra-webui" }));
assert(field(in1, "Name")?.value === "astra-webui", "skill name field");

const in2 = describeInput("terminal", JSON.stringify({ command: "ls -la", timeout_s: 180 }), "ls -la");
assert(field(in2, "Command")?.mono === true, "command is mono");
assert(!field(in2, "Command2"), "no dup command");
assert(field(in2, "Timeout S") !== undefined || field(in2, "Timeout_s") !== undefined, "misc numeric key present");

const in3 = describeInput("patch", JSON.stringify({
  path: "/tmp/x.ts",
  old_string: "a".repeat(400),
  new_string: "b".repeat(400),
}));
assert(field(in3, "Find")?.long === true, "long old_string becomes tall field");
assert(field(in3, "Replace with")?.long === true, "long new_string becomes tall field");
assert((field(in3, "Find")?.value.length || 0) <= 4000, "long value clamped");

const in4 = describeInput(undefined, "not json at all");
assert(in4.length === 1 && in4[0].key === "Input", "raw non-JSON args → single Input field");

const in5 = describeInput("skill_manage", JSON.stringify({
  operations: [{ action: "patch", name: "astra-webui" }],
}));
assert(field(in5, "Changes")?.value.includes("1 op"), "ops summary counts");
assert(!field(in5, "Operations"), "operations not dumped generically");

// arrays joined, capped
const in6 = describeInput("web_extract", JSON.stringify({ urls: ["a.io", "b.io", "c.io", "d.io", "e.io", "f.io", "g.io"] }));
assert(field(in6, "URLs")?.value.includes("+2 more"), "array cap suffix");

// ---- describeOutput ----------------------------------------------------------
const out1 = describeOutput("web_search", JSON.stringify({ data: { web: [1, 2, 3] } }));
assert(out1.length === 1 && (out1[0].value.length || 0) <= 300, "unknown-shape output compacted");

const out2 = describeOutput("terminal", JSON.stringify({ stdout: "hello", exit_code: 0 }));
assert(field(out2, "Output")?.value === "hello", "stdout → Output");
assert(field(out2, "Exit")?.mono === true, "exit mono");

const out3 = describeOutput("x", JSON.stringify({ error: "boom" }));
assert(field(out3, "Error")?.value === "boom", "error surfaced first");

const out4 = describeOutput("x", "plain text result");
assert(field(out4, "Result")?.value === "plain text result", "plain text result");

const out5 = describeOutput("x", JSON.stringify([
  { title: "One" }, { title: "Two" }, { title: "Three" },
]));
assert(field(out5, "Results")?.value.startsWith("3 items"), "array count summary");
assert(field(out5, "Results")?.value.includes("One · Two · Three"), "array titles joined");

const out6 = describeOutput("x", JSON.stringify({ content: "x".repeat(500) }));
assert(field(out6, "Result")?.long === true, "long content tall");

// ---- excerpt -----------------------------------------------------------------
assert(excerpt("  \n\nfirst line here\nsecond") === "first line here", "excerpt first non-empty line");
assert(excerpt("word ".repeat(40)).endsWith("…"), "excerpt ellipsized");

// ---- describeTool naming (owner: name the thing, never generic) --------------
const t1 = describeTool("skill_view", JSON.stringify({ name: "astra-webui" }));
assert(t1.name === "astra-webui", "skill card named after the skill");
assert(t1.kind === "skill", "skill kind");

const t2 = describeTool("mcp__neutrinos_docs__get_doc_page", JSON.stringify({ topic: "x" }));
assert(t2.name === "get_doc_page", "mcp tool name");
assert(t2.meta === "neutrinos-docs MCP", "mcp server meta");

const t3 = describeTool("browser_exec", JSON.stringify({ code: "# Searching Amazon for paper towels\nawait page.goto('https://amazon.com')" }));
assert(t3.name === "Searching Amazon for paper towels", "browser step comment is the name");

const t4 = describeTool("browser_exec", JSON.stringify({ code: "await page.goto('x')" }));
assert(t4.name === "Browser", "browser fallback name");

const t5 = describeTool("delegate_task", JSON.stringify({ tasks: [{ goal: "Fix the login bug" }] }));
assert(t5.name === "Fix the login bug", "delegate named by goal");

const t6 = describeTool("read_file", JSON.stringify({ path: "/a/b.ts" }));
assert(t6.name === "Read file" && t6.meta === "/a/b.ts", "file tool path meta");

const t7 = describeTool("some_unknown_tool", JSON.stringify({ path: "/x" }));
assert(t7.name === "Some Unknown Tool", "generic tool pretty-named");
assert((t7.name as string) !== "tool call" && (t7.name as string) !== "MCP", "never generic label");

console.log("tool-io.check: ALL PASS");

// ---- patch result humanized ---------------------------------------------------
const p1 = describeOutput("patch", JSON.stringify({ success: true, files_modified: ["/a/x.ts", "/a/y.ts"] }));
assert(p1.length === 1 && p1[0].value === "Edited 2 files · x.ts, y.ts", "patch result humanized");

// ---- input ordering ------------------------------------------------------------
const o1 = describeInput("patch", JSON.stringify({ new_string: "b", path: "/p", old_string: "a", replace_all: false }));
const keys = o1.map(f => f.key);
assert(keys.indexOf("Path") < keys.indexOf("Find") && keys.indexOf("Find") < keys.indexOf("Replace with"), "Path→Find→Replace with order");

console.log("tool-io.check: ALL PASS (2)");
