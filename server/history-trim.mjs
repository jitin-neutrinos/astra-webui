// history-trim.mjs — strip message fields the client never reads (RCA fix 3).
//
// WHY (measured 2026-10-05):
//   Opening a chat fetches 100 history rows = 245-255 KiB. Per-field breakdown of
//   a real 100-row payload:
//     content        96.8 KiB   — needed (the transcript)
//     tool_calls     77.2 KiB   — needed (tool rows render from it)
//     api_content    12.6 KiB   — NEVER read by any client file
//     reasoning       8.5 KiB   — needed
//     reasoning_content 8.5 KiB — a DUPLICATE of reasoning; the client reads
//                                `reasoning` (normalize-messages.ts:9,80,95)
//     session_id      2.3 KiB   — redundant: every row is from one session, and
//                                the client already knows the id it asked for
//     timestamp       1.7 KiB   — needed (think/tool durations)
//     tool_call_id    1.7 KiB   — needed (pairs a result to its call)
//
//   So `api_content` + `reasoning_content` + `session_id` are ~23 KiB per open
//   that the client provably never touches — downloaded, JSON.parsed on the main
//   thread, and discarded.
//
// WHAT IS *NOT* REMOVED, and why:
//   • `reasoning` — used for the "Thought for Nm" durations. Removing it would
//     silently change the UI.
//   • `content` — the transcript itself.
//   • `tool_calls` / `tool_call_id` — the tool rows render from these, and they
//     are the bulk of a real agent transcript.
//   • `display_kind` / `display_metadata` — normalize-messages.ts branches on
//     `display_kind` (failed_turn, hidden) to decide what is shown.
//   • Anything unknown — see below.
//
// WHY AN ALLOW-LIST WOULD BE WRONG HERE:
//   Restricting history to a known field set silently breaks the moment the
//   gateway adds a field the UI already consumes (this happened with
//   `display_kind`: adding it upstream changed what renders, and a strict
//   allow-list would have dropped it). So this REMOVES a small, named set of
//   proven-unused fields and passes everything else through untouched. A new
//   upstream field is therefore safe by default; a new CLIENT read of a removed
//   field is the risk, and each removal below names the evidence for it.

/**
 * Fields removed from every history row. Each entry states the evidence that no
 * client reads it — a removal without evidence is not allowed into this list.
 */
export const DROPPED_FIELDS = {
  // normalize-messages.ts's HistoryRow has no api_content; `grep -rn api_content
  // src/` returns nothing. It is the raw provider payload, superseded by content.
  api_content: "never read by any client file (grep: 0 hits)",

  // normalize-messages.ts reads `reasoning` only (lines 9, 80, 95). Hermes writes
  // the same text to both columns, so reasoning_content is a byte-for-byte
  // duplicate — the same 8.5 KiB twice.
  reasoning_content: "duplicate of `reasoning`, which is the column the client reads",
};

/**
 * FIELDS CONSIDERED AND KEPT, recorded so nobody re-litigates them.
 *
 * `session_id` looked like dead weight (every row belongs to the session the
 * client just asked for, ~2.3 KiB over a 100-row page). history-trim.check.mjs
 * REJECTED that removal by grepping the live client tree: NINE files read it —
 * chat-landing, subagent-panel, chat-segments, command-exec, prune, session-row,
 * tool-io, ws-engine, ws-helpers. It looks redundant per-page but is load-bearing
 * across routes (a deep-linked row, a subagent frame, a tool result arriving for a
 * different session). Kept.
 *
 * This is exactly the trap the check exists to catch: a field that looks unused in
 * the one code path you read is often used in another.
 */
export const KEPT_AFTER_REVIEW = {
  session_id: "read by 9 client files (chat-landing, subagent-panel, chat-segments, command-exec, prune, session-row, tool-io, ws-engine, ws-helpers) — looks redundant per-page, is not",
  reasoning: "drives the 'Thought for Nm' duration; removing it changes the UI",
  display_kind: "normalize-messages.ts branches on it (hidden rows, failed_turn)",
  content: "the transcript",
  tool_calls: "tool rows render from it",
  tool_call_id: "pairs a result to its call",
  timestamp: "think/tool durations",
};

/**
 * Drop the unused fields from one row. Returns a NEW object; the input is not
 * mutated (the caller may hold it elsewhere).
 */
export function trimRow(row) {
  let out = null;
  for (const k of Object.keys(DROPPED_FIELDS)) {
    if (k in row) {
      if (!out) out = { ...row };
      delete out[k];
    }
  }
  return out ?? row;
}

/**
 * Trim a history payload in place on its parsed form.
 * Returns the payload plus a byte count so the caller can report the saving.
 */
export function trimHistoryPayload(data) {
  const rows = Array.isArray(data?.messages) ? data.messages : [];
  const bytesBefore = JSON.stringify(rows).length;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] && typeof rows[i] === "object") rows[i] = trimRow(rows[i]);
  }
  const bytesAfter = JSON.stringify(rows).length;
  return { payload: data, rows: rows.length, bytesBefore, bytesAfter };
}

export const _test = { DROPPED_FIELDS };
