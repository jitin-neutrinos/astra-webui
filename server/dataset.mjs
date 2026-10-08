// dataset.mjs — Training-dataset hygiene for the Astra transcript archive.
//
// The raw archive is agent telemetry, not chat: ~94% of its text is tool
// output (44k rows / 113 MB of JSON envelopes), 28.7k assistant rows carry no
// prose at all (they are pure tool calls), and 208 sessions are automation
// (cron/oneshot/tool), not conversations. Feeding that to a fine-tune teaches
// JSON escaping and noise.
//
// This builder turns the archive into a clean SFT set:
//   • drops automation + internal-pipeline sessions (not real chat)
//   • drops tool-result bodies entirely; keeps a compact HEADING per call
//     ("terminal: grep -rn login", "read_file: src/App.tsx") so the trace of
//     what happened survives without the payload
//   • drops assistant rows that are empty or a raw tool-call envelope
//   • unwraps JSON envelopes on anything that still carries one
//   • trims/truncates oversized turns (no 100k-char monsters)
//   • enforces strict user/assistant alternation, user-first, assistant-last
//   • deduplicates by content hash
//
// Env knobs: DATASET_MAX_USER_CHARS, DATASET_MAX_ASSISTANT_CHARS,
// DATASET_MAX_TOTAL_CHARS, DATASET_MIN_USER_TURNS.
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openTrainingDb } from "./training.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.TRAINING_DATA_DIR || join(__dirname, "..", "data");

const MAX_USER_CHARS = Number(process.env.DATASET_MAX_USER_CHARS || 8000);
const MAX_ASSISTANT_CHARS = Number(process.env.DATASET_MAX_ASSISTANT_CHARS || 6000);
const MAX_TOTAL_CHARS = Number(process.env.DATASET_MAX_TOTAL_CHARS || 24000);
const MIN_USER_TURNS = Math.max(1, Number(process.env.DATASET_MIN_USER_TURNS || 1));

// Sources that are machinery, not conversation.
const AUTOMATION_SOURCES = new Set(["cron", "oneshot", "tool", "unknown"]);
// Internal pipeline sessions (the end-session reviewer's own runs).
const INTERNAL_MARKERS = [
  "PROMPT_TEMPLATE_VERSION:",
  "session reviewer for Astra's end-of-session pipeline",
];

// Harness-injected text that is not the user speaking, and pipeline noise that
// teaches a model to apologise or emit greetings. Both are dropped.
const INJECTED_PREFIXES = [
  /^\s*\[System: The active model[^\]]*\]\s*/,
  /^\s*\[System:[^\]]*\]\s*/,
  /^\s*\[System note:[\s\S]*?\]\s*/,
  /^\s*\[Surface:[\s\S]*?\]\s*/,
  /^\s*\[IMPORTANT: Background process[^\]]*\][\s\S]*?(?=\n\n|$)/,
  /^\s*\[IMPORTANT: \d+ background processes? completed[^\]]*\][\s\S]*?(?=\n\n|$)/,
  /^\s*\[OUT-OF-BAND USER MESSAGE[\s\S]*?\[\/OUT-OF-BAND USER MESSAGE\]\s*/,
];

// Whole messages that are harness notifications, not a human turn. Multi-line
// blocks with no closing bracket, so they must be dropped, not prefix-stripped.
const INJECTED_NOTIFICATIONS = [
  /^\s*\[IMPORTANT:[\s\S]*background process/i,
  /^\s*\[Background process[\s\S]*heartbeat/i,
  /^\s*\[IMPORTANT: The user has invoked the[\s\S]*skill/i,
];
const COMPACTION_MARKERS = [
  /^\s*\[STILL IN PROGRESS/i,
  /^\s*\[CONTEXT COMPACTION/i,
  /REFERENCE ONLY/i,
  /handoff from a previous context/i,
  /restated after the compaction boundary/i,
  /previous turn was interrupted mid-run/i,
  /Treat these results as one batch/i,
];
const BOILERPLATE = [
  /^New chat just started\. Greet me briefly and naturally, then ask what I'd like to work on\.?$/,
  /^Your request was not processed\. Send it again if you still want me to carry it out\.?$/,
  /^.{0,80}(interrupted|stopped|cancelled|aborted).{0,120}$/i,
  /^.{0,80}context (was )?compressed.{0,120}$/i,
  /^.{0,60}conversation was (reset|cleared|compressed).{0,120}$/i,
  /^\[context (was )?compressed\]/i,
];

// Strip injected harness prefixes; return "" when nothing real remains.
export function cleanUserText(text) {
  let t = (text || "").trim();
  for (const re of INJECTED_PREFIXES) t = t.replace(re, "");
  t = t.trim();
  if (!t) return "";
  if (BOILERPLATE.some((re) => re.test(t))) return "";
  if (COMPACTION_MARKERS.some((re) => re.test(t))) return "";
  if (INJECTED_NOTIFICATIONS.some((re) => re.test(t))) return "";
  return t;
}

export function isBoilerplate(text) {
  const t = (text || "").trim();
  return BOILERPLATE.some((re) => re.test(t))
    || COMPACTION_MARKERS.some((re) => re.test(t))
    || INJECTED_NOTIFICATIONS.some((re) => re.test(t));
}

// ---- helpers --------------------------------------------------------------

// One compact heading per tool call: the tool name plus the argument that says
// what it was for. Never the result payload.
export function toolHeading(call) {
  const fn = call?.function || call;
  const name = fn?.name || call?.name || "tool";
  let args = fn?.arguments ?? call?.arguments;
  if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
  if (!args || typeof args !== "object") return name;
  const pick = args.command || args.query || args.file_path || args.path
    || args.name || args.skill || args.pattern || args.url || args.prompt
    || Object.values(args).find((v) => typeof v === "string");
  if (typeof pick !== "string" || !pick.trim()) return name;
  const oneLine = pick.replace(/\s+/g, " ").trim();
  return `${name}: ${oneLine.length > 100 ? oneLine.slice(0, 100) + "…" : oneLine}`;
}

export function headingsFor(toolCallsJson) {
  if (!toolCallsJson) return [];
  let calls;
  try { calls = JSON.parse(toolCallsJson); } catch { return []; }
  if (!Array.isArray(calls)) return [];
  return calls.map(toolHeading).filter(Boolean);
}

// Anything that arrived as a JSON envelope string gets unwrapped to its text.
// {"output":"...","exit_code":0} → the output; {"content":"..."} → the content.
export function unwrap(text) {
  if (typeof text !== "string") return "";
  const t = text.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return t;
  try {
    const obj = JSON.parse(t);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const key of ["content", "output", "text", "result", "message"]) {
        if (typeof obj[key] === "string" && obj[key].trim()) return obj[key].trim();
      }
      return ""; // a JSON object with no readable body (a bare tool-call envelope)
    }
  } catch { /* not JSON — keep as-is */ }
  return t;
}

function truncate(text, cap) {
  if (text.length <= cap) return text;
  return text.slice(0, cap).replace(/\s+\S*$/, "") + "\n\n[…truncated]";
}

// A conversation is usable if it has a user turn and an assistant turn.
function isUsable(conv) {
  const users = conv.filter((m) => m.role === "user").length;
  const assts = conv.filter((m) => m.role === "assistant").length;
  return users >= MIN_USER_TURNS && assts >= 1;
}

function alternate(conv) {
  const out = [];
  for (const m of conv) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content = [last.content, m.content].filter(Boolean).join("\n\n");
      last.headings.push(...(m.headings || []));
    } else {
      out.push({ role: m.role, content: m.content, headings: [...(m.headings || [])] });
    }
  }
  return out;
}

// Render one assistant turn: prose, then ONE compact heading line for every
// tool call it made. Truncation happens here, after merging, so a merged turn
// can never exceed the cap.
function renderAssistant(turn) {
  const parts = [];
  if (turn.content) parts.push(turn.content);
  if (turn.headings.length) parts.push(`[tools: ${turn.headings.join(" · ")}]`);
  return truncate(parts.join("\n\n"), MAX_ASSISTANT_CHARS);
}

// ---- builder --------------------------------------------------------------

export function buildTrainingDataset(opts = {}) {
  const database = openTrainingDb();
  const dir = opts.outDir || join(DATA_DIR, "training-exports");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = join(dir, `dataset-sft-${stamp}.jsonl`);

  const sessions = database.prepare(
    "SELECT sid, source FROM sessions ORDER BY ended_at ASC",
  ).all();

  const perSession = database.prepare(
    "SELECT role, content, tool_calls FROM messages WHERE sid = ? ORDER BY ts ASC, row_id ASC",
  );

  const stats = {
    source_sessions: sessions.length,
    automation_excluded: 0, internal_excluded: 0, unusable_excluded: 0,
    dupes_excluded: 0, raw_messages: 0, kept_messages: 0,
    tool_results_dropped: 0, tool_headings_kept: 0, empty_assistant_dropped: 0,
    boilerplate_dropped: 0,
    raw_chars: 0, kept_chars: 0,
  };
  const lines = [];
  const seen = new Set();

  for (const { sid, source } of sessions) {
    if (AUTOMATION_SOURCES.has(String(source || ""))) { stats.automation_excluded++; continue; }

    const raw = [];
    for (const m of perSession.all(sid)) {
      stats.raw_messages++;
      stats.raw_chars += (m.content || "").length;

      if (m.role === "tool") { stats.tool_results_dropped++; continue; } // payload never enters
      if (m.role !== "user" && m.role !== "assistant") continue;         // system/meta dropped

      if (m.role === "assistant") {
        const headings = headingsFor(m.tool_calls);
        let prose = unwrap(m.content || "");
        // Drop pipeline-noise assistant replies (interrupted/error/apology).
        if (prose && isBoilerplate(prose)) { stats.boilerplate_dropped++; prose = ""; }
        if (!prose && !headings.length) { stats.empty_assistant_dropped++; continue; }
        stats.tool_headings_kept += headings.length;
        raw.push({ role: "assistant", content: prose, headings });
      } else {
        const content = cleanUserText(m.content || "");
        if (!content) { stats.boilerplate_dropped++; continue; }
        raw.push({ role: "user", content, headings: [] });
      }
    }

    const firstUser = raw.findIndex((m) => m.role === "user");
    if (firstUser === -1) { stats.unusable_excluded++; continue; }
    const trimmed = raw.slice(firstUser);
    if (INTERNAL_MARKERS.some((mk) => trimmed.some((m) => m.content.includes(mk)))) {
      stats.internal_excluded++;
      continue;
    }
    // Merge same-role neighbours, then render/truncate once per final turn.
    let clean = alternate(trimmed).map((t) => t.role === "assistant"
      ? { role: "assistant", content: renderAssistant(t) }
      : { role: "user", content: truncate(t.content, MAX_USER_CHARS) });
    if (clean.length < 2 || clean[clean.length - 1].role !== "assistant" || !isUsable(clean)) {
      stats.unusable_excluded++;
      continue;
    }
    // Total-length cap: drop the oldest middle turns rather than the ends.
    let total = clean.reduce((n, m) => n + m.content.length, 0);
    if (total > MAX_TOTAL_CHARS && clean.length > 2) {
      const head = clean.slice(0, 1);
      const tail = clean.slice(-3);
      clean = alternate([...head, ...tail]);
      total = clean.reduce((n, m) => n + m.content.length, 0);
    }
    const hash = createHash("sha256").update(JSON.stringify(clean)).digest("hex");
    if (seen.has(hash)) { stats.dupes_excluded++; continue; }
    seen.add(hash);

    lines.push(JSON.stringify({ messages: clean }));
    stats.kept_messages += clean.length;
    stats.kept_chars += total;
  }

  writeFileSync(outPath, lines.join("\n") + (lines.length ? "\n" : ""));
  const manifest = {
    generated_at: new Date().toISOString(),
    format: "sft",
    file: outPath,
    conversations: lines.length,
    turns: stats.kept_messages,
    avg_turns: lines.length ? +(stats.kept_messages / lines.length).toFixed(1) : 0,
    raw_chars: stats.raw_chars,
    kept_chars: stats.kept_chars,
    reduction: stats.raw_chars ? `${(100 * (1 - stats.kept_chars / stats.raw_chars)).toFixed(1)}%` : "0%",
    excluded: {
      automation: stats.automation_excluded,
      internal: stats.internal_excluded,
      unusable: stats.unusable_excluded,
      duplicates: stats.dupes_excluded,
    },
    hygiene: {
      tool_results_dropped: stats.tool_results_dropped,
      tool_headings_kept: stats.tool_headings_kept,
      empty_assistant_dropped: stats.empty_assistant_dropped,
      boilerplate_dropped: stats.boilerplate_dropped,
      raw_messages: stats.raw_messages,
      kept_messages: stats.kept_messages,
    },
  };
  writeFileSync(join(dir, `dataset-sft-${stamp}.manifest.json`), JSON.stringify(manifest, null, 2));
  return manifest;
}
