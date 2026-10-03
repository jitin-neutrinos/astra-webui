// term-format.ts — turn raw tool/terminal output into something a HUMAN can read.
//
// Pure, no React, no DOM: every function is a string transform, so it is checkable with a
// plain assert suite (term-format.check.ts) and reusable on the server side.
//
// WHY THIS EXISTS (owner 2026-10-03: "sanitize them and make them human reader friendly"):
// the terminal/tool cards were rendering the RAW result string. That meant ANSI colour escapes
// (which no code stripped), machine ISO timestamps, single-line JSON blobs hundreds of
// characters wide, and no visual separation between the command and its output. Readable to a
// machine, hostile to a person.

/** Strip ANSI/VT escape sequences: SGR colour, cursor moves, OSC titles, and the
 *  \u001b[?25l style private modes. Without this the codes render as glyph soup. */
export function stripAnsi(s: string): string {
  if (!s) return "";
  return s
    // OSC ... BEL/ST (window titles, hyperlinks)
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    // CSI sequences: params + intermediate + final byte
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    // single-char escapes (ESC c, ESC 7, ...)
    .replace(/\u001b[@-Z\\-_]/g, "")
    // leftover bare CR from progress bars: keep the LAST write on the line
    .split("\n").map((line) => {
      const i = line.lastIndexOf("\r");
      return i >= 0 ? line.slice(i + 1) : line;
    }).join("\n")
    // other C0 control chars except tab/newline
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/** Collapse 3+ blank lines to one, trim trailing whitespace per line. */
export function tidyWhitespace(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Is this string one single JSON document? (object or array) */
function tryJson(s: string): unknown | null {
  const t = s.trim();
  if (!t) return null;
  const c = t[0];
  if (c !== "{" && c !== "[") return null;
  // only attempt when the whole thing parses — a log line containing {..} must not match
  try { return JSON.parse(t); } catch { return null; }
}

/** One-line human summary of a JSON value: counts, not braces. */
export function jsonSummary(v: unknown): string {
  if (Array.isArray(v)) {
    const n = v.length;
    if (n === 0) return "empty list";
    const keys = v[0] && typeof v[0] === "object" && !Array.isArray(v[0])
      ? Object.keys(v[0] as object).length : 0;
    return keys ? `${n} ${n === 1 ? "item" : "items"} · ${keys} fields each` : `${n} ${n === 1 ? "value" : "values"}`;
  }
  if (v && typeof v === "object") {
    const n = Object.keys(v as object).length;
    return `${n} ${n === 1 ? "field" : "fields"}`;
  }
  return typeof v;
}

/** Pretty-print a JSON document at a width that fits a card, else return null. */
export function prettyJson(s: string): string | null {
  const v = tryJson(s);
  if (v === null) return null;
  try { return JSON.stringify(v, null, 2); } catch { return null; }
}

/**
 * A tool result stored as a JSON ENVELOPE (`{"output": "...", "exit_code": 0}`) is
 * the shape the gateway persists for `terminal` and every code-execute card. Handed
 * to the terminal window verbatim it renders the ENVELOPE, not the output: the reader
 * sees a `"output":` key line, the escaped payload on a second line, and an
 * `exit_code` line that is not output at all — the "output is duplicated 2-3 times"
 * report (owner, 2026-10-03).
 *
 * Unwrap it to the real output text and hand the exit code back separately. Only a
 * WHOLE JSON object counts; prose or a log line that merely contains braces is
 * returned untouched, so this can never eat a log that looks like JSON.
 */
export function unwrapToolEnvelope(raw: string): { text: string; exitCode: number | null } {
  const t = (raw || "").trim();
  if (!t || t[0] !== "{") return { text: raw || "", exitCode: null };
  let exitCode: number | null = null;
  let value: unknown;
  try {
    value = JSON.parse(t);
  } catch {
    return { text: raw, exitCode: null };   // starts with '{' but isn't JSON
  }

  // Walk the envelope down to the text it carries. The walk is bounded (DEPTH) because a
  // self-referential or pathological shape must not spin the renderer, and it stops at the
  // first STRING leaf — that string is the output, and every wrapper above it was framing.
  //
  // Probed shapes that the flat single-level lookup missed (all four rendered the raw JSON
  // envelope into the card, which is the duplicated-"output" report):
  //   {"result":{"output":"x"}}        nested one level
  //   {"output":["l1","l2"]}           output as an ARRAY of lines
  //   {"output":[{"text":"a"}]}        output as an array of blocks (MCP-style)
  //   {"output":"","error":"boom"}      empty payload with the error beside it
  for (let depth = 0; depth < 4; depth++) {
    if (typeof value === "string") {
      return { text: value, exitCode };
    }
    if (value === null || typeof value !== "object") break;

    const obj = value as Record<string, unknown>;
    if (typeof obj.exit_code === "number" && exitCode === null) exitCode = obj.exit_code;

    // A content/block array is a list of {type:"text", text:"..."} parts: concatenate the
    // text parts and ignore non-text blocks (images, resources) rather than dumping JSON.
    if (Array.isArray(obj.content)) {
      const parts = obj.content
        .map((c) => (c && typeof c === "object" ? (c as Record<string, unknown>).text : c))
        .filter((x): x is string => typeof x === "string" && x.length > 0);
      if (parts.length) return { text: parts.join("\n"), exitCode };
      break;
    }

    let next: unknown = null;
    let found = false;
    for (const k of ["output", "stdout", "text", "result", "content", "data"]) {
      if (k in obj && obj[k] != null && !(typeof obj[k] === "string" && !obj[k])) {
        next = obj[k];
        found = true;
        break;
      }
    }
    if (!found) {
      // No payload key carried text. If the envelope DOES carry a message, show THAT rather
      // than the raw JSON: `{"output":"", "error":"boom"}` is a failed call, and printing the
      // envelope is the same duplicated-"output" defect one level down. A shape with no
      // message at all falls through to the raw text below.
      for (const k of ["error", "message", "detail", "reason"]) {
        const m = obj[k];
        if (typeof m === "string" && m) return { text: m, exitCode };
      }
      break;
    }

    if (Array.isArray(next)) {
      // An array of strings is the lines of one output; an array of blocks is joined below.
      if (next.every((x) => typeof x === "string")) {
        return { text: (next as string[]).join("\n"), exitCode };
      }
      value = { content: next };
      continue;
    }
    value = next;
  }
  return { text: raw, exitCode };
}

const ISO = /\b(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})\b/g;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** 2026-10-02T11:24:07.881Z -> "2 Oct, 11:24". Local-time aware; falls back to the raw text. */
export function humanizeTimestamps(s: string): string {
  // groups: 1=y 2=mo 3=d 4=h 5=mi 6=sec(optional) 7=tz
  return s.replace(ISO, (m, _y, mo, d, _h, _mi, _sec, _tz) => {
    const mon = MONTHS[Number(mo) - 1];
    if (!mon) return m;
    const date = new Date(m);
    if (Number.isNaN(date.getTime())) return m;
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${Number(d)} ${mon}, ${hh}:${mm}`;
  });
}

/** Compress long absolute paths to …/parent/leaf so a row stays readable. */
export function shortenPaths(s: string, keep = 2): string {
  return s.replace(/(?:\/[\w.@+-]+){3,}/g, (p) => {
    const parts = p.split("/").filter(Boolean);
    if (parts.length <= keep + 1) return p;
    return "…/" + parts.slice(-keep).join("/");
  });
}

/** Classify a line so the UI can tint it. */
export type LineTone = "ok" | "warn" | "err" | "dim" | "cmd" | "plain";
export function lineTone(line: string): LineTone {
  const t = line.trim();
  if (!t) return "dim";
  if (/^\$\s/.test(t)) return "cmd";
  // word-boundary matches so "errorless" does not read as an error
  if (/(^|\W)(error|failed|failure|exception|traceback|fatal|panic|denied|refused)(\W|$)/i.test(t)) return "err";
  if (/(^|\W)(warn|warning|deprecated|caution|note:)(\W|$)/i.test(t)) return "warn";
  // Success words: require them NOT to be a quoted JSON key, and prefer line-leading status.
  // `"ok": true` is data, not a success report — matching it tinted every JSON dump green.
  const isJsonish = /^[\s]*["{\[\]},"]/.test(t) && /[:,\[\]{}]/.test(t);
  if (!isJsonish && /(^|\W)(ok|done|success|passed|complete[d]?|✓|✔)(\W|$)/i.test(t)) return "ok";
  return "plain";
}

export interface TermLine { text: string; tone: LineTone; n: number }

/** The full pipeline: sanitize, tidy, humanize, then split into tone-tagged lines.
 *  `maxLines` truncates the MIDDLE (head + tail), which is what a reader wants from a log. */
export function formatTerminal(raw: string, opts: { maxLines?: number; shorten?: boolean } = {}): { lines: TermLine[]; omitted: number; summary: string | null } {
  let s = tidyWhitespace(humanizeTimestamps(stripAnsi(raw || "")));
  if (opts.shorten !== false) s = shortenPaths(s);
  // A whole-document JSON blob becomes pretty-printed; its summary rides alongside.
  let pretty = prettyJson(s);
  let summary: string | null = null;
  if (pretty) {
    const v = tryJson(s);
    summary = jsonSummary(v);
    s = pretty;
  } else {
    // A LINE with a long embedded JSON object (very common: "→ {...200 chars...}") still runs
    // hundreds of chars wide and is the single worst readability offender. Split prefix from
    // payload and pretty-print the payload underneath, indented, so the eye can follow it.
    s = s.split("\n").map((line) => {
      if (line.length < 160) return line;
      const m = line.match(/^(.*?)(\s*)([{\[].*[}\]])\s*$/);
      if (!m) return line;
      const [, prefix, , payload] = m;
      if (payload.length < 120) return line;
      const inner = prettyJson(payload);
      if (!inner) return line;
      const v = tryJson(payload);
      const sum = v === null ? "" : `  (${jsonSummary(v)})`;
      return prefix.trimEnd() + sum + "\n" + inner.split("\n").map((l) => "  " + l).join("\n");
    }).join("\n");
  }
  // "".split("\n") is [""] — one blank line for empty input. Emit nothing instead.
  const all = s ? s.split("\n") : [];
  const max = opts.maxLines ?? 0;
  let lines = all, omitted = 0;
  if (max > 0 && all.length > max) {
    const head = Math.ceil(max * 0.6), tail = max - head;
    lines = [...all.slice(0, head), `… ${all.length - max} more lines …`, ...all.slice(all.length - tail)];
    omitted = all.length - max;
  }
  return { lines: lines.map((text, i) => ({ text, tone: lineTone(text), n: i + 1 })), omitted, summary };
}
