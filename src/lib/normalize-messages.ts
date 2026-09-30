import type { Segment } from "./chat-segments.ts";
import { extractAttachments } from "./media-paths.ts";
import { parseArchivedGate, GATE_RE } from "../components/gates/gate-envelope.ts";

export interface HistoryRow {
  id: string; role: "user"|"assistant"|"tool"|"system";
  content: string|null; tool_call_id?: string|null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[] | null;
  tool_name?: string|null; reasoning?: string|null;
  timestamp?: number;            // epoch float SECONDS (live-probed)
  finish_reason?: string|null; display_kind?: string|null; display_metadata?: any;
  text?: string;
  display_content?: string;
}

export interface Turn {          // structurally assignable to ChatMsg
  id: string; role: "user"|"assistant"; ts?: number;   // ts normalized to ms
  content?: string;              // user only, attachments stripped
  files?: { name: string; path: string }[];             // user attachments
  segments: Segment[];           // assistant only; [] for user
  isStreaming: false;
}

export function rowsToTurns(rows: HistoryRow[]): Turn[] {
  const turns: Turn[] = [];
  let currentTurn: Turn | null = null;

  // The auto-greet kickoff is a UI convention, not a conversation turn: the
  // client hides the instruction at send time, and history restore must hide
  // it too, or every reload of a fresh chat renders the hidden prompt as the
  // first user bubble (owner 2026-09-29: "this should never be displayed").
  const GREET_RE = /^New chat just started\. Greet me briefly and naturally, then ask what I'd like to work on\.\s*$/;
  const rowMainText = (r: HistoryRow): string =>
    (typeof r.text === "string" ? r.text
      : typeof r.content === "string" ? r.content
      : typeof r.display_content === "string" ? r.display_content
      : "") || "";
  const greetRow = rows.find((r) => r.role === "user" && GREET_RE.test(rowMainText(r).trim()));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (greetRow && row.id === greetRow.id) continue;
    // Failed turns still carry the user's question and the failure reason —
    // both belong on screen. Skipping the row entirely left the prompt with NO
    // answer and NO error after a reload, which read as "the chat lost it".
    if (row.display_kind === "failed_turn") {
      // Attach to the in-progress assistant turn, or open one for this failure
      // (the row usually lands right after the user's prompt).
      if (!currentTurn || currentTurn.role !== "assistant") {
        currentTurn = { id: `failed-turn-${row.id}`, role: "assistant", ts: undefined, segments: [], isStreaming: false };
        turns.push(currentTurn);
      }
      currentTurn.segments.push({
        id: `failed-${row.id}`,
        kind: "text",
        status: "done",
        text: (typeof row.content === "string" && row.content.trim()) || "This turn failed before a reply was produced.",
      });
      continue;
    }
    if (row.display_kind != null) continue;
    if (row.role === "system") continue;

    let rowTs = row.timestamp !== undefined ? (row.timestamp < 1e12 ? row.timestamp * 1000 : row.timestamp) : undefined;
    let content = typeof row.text === "string" ? row.text : typeof row.content === "string" ? row.content : typeof row.display_content === "string" ? row.display_content : "";

    if (row.role === "user") {
      const { text, files } = extractAttachments(content || "");
      currentTurn = {
        id: row.id, role: "user", ts: rowTs, content: text, files, segments: [], isStreaming: false
      };
      turns.push(currentTurn);
    } else if (row.role === "assistant") {
      if (!currentTurn || currentTurn.role !== "assistant") {
        currentTurn = { id: row.id, role: "assistant", ts: rowTs, segments: [], isStreaming: false };
        turns.push(currentTurn);
      }
      
      let thinkDurMs: number | undefined = undefined;
      if (row.reasoning) {
        let nextTs: number | undefined = undefined;
        for (let j = i + 1; j < rows.length; j++) {
          const nextRow = rows[j];
          if (nextRow.display_kind != null || nextRow.role === "system") continue;
          if (nextRow.timestamp !== undefined) {
             nextTs = nextRow.timestamp < 1e12 ? nextRow.timestamp * 1000 : nextRow.timestamp;
             break;
          }
        }
        if (nextTs !== undefined && rowTs !== undefined) {
          thinkDurMs = Math.max(0, nextTs - rowTs);
        }
      }

      if (row.reasoning) {
        currentTurn.segments.push({
          id: `think-${row.id}`,
          kind: "thinking",
          status: "done",
          text: row.reasoning,
          durationMs: thinkDurMs
        });
      }

      if (row.tool_calls) {
        for (const call of row.tool_calls) {
          let argsStr = call.function.arguments;
          try {
            argsStr = JSON.stringify(JSON.parse(argsStr), null, 2);
          } catch {
            // raw string
          }
          if (argsStr.length > 6000) argsStr = argsStr.slice(0, 6000) + "...\n(truncated)";

          // Will store assistant rowTs temporarily to compute duration later
          (call as any)._assistantTs = rowTs;

          currentTurn.segments.push({
            id: call.id,
            kind: "tool",
            status: "done", // Will be filled by tool role row
            label: call.function.name,
            argsText: argsStr,
            collapsed: true
          });
        }
      }

      if (content) {
        const archivedGate = parseArchivedGate(content);
        if (archivedGate) {
          currentTurn.segments.push({
            id: `gate-${row.id}`,
            kind: "gate",
            status: "done",
            gate: archivedGate,
            resolved: archivedGate.resolved || "approved", // fallback
          });
          content = content.replace(GATE_RE, "").trim();
        }
        if (content) {
          currentTurn.segments.push({
            id: `text-${row.id}`,
            kind: "text",
            status: "done",
            text: content
          });
        }
      }
    } else if (row.role === "tool") {
      if (!currentTurn || currentTurn.role !== "assistant") {
        currentTurn = { id: row.id, role: "assistant", ts: rowTs, segments: [], isStreaming: false };
        turns.push(currentTurn);
      }

      let toolSeg = null;
      for (const t of turns) {
        if (t.role === "assistant") {
          const s = t.segments.find(s => s.id === row.tool_call_id && s.kind === "tool");
          if (s) { toolSeg = s; break; }
        }
      }

      let exitCode = null;
      if (content) {
        try {
          const parsed = JSON.parse(content);
          if (parsed && typeof parsed.exit_code === "number") exitCode = parsed.exit_code;
        } catch {}
      }

      const resText = content ? content.slice(0, 30000) : "";
      
      if (toolSeg) {
        toolSeg.resultText = resText;
        toolSeg.exitCode = exitCode;
        toolSeg.collapsed = true; // owner mandate: restored steps initialize collapsed
        
        let assistantTs: number | undefined;
        // Search original rows for the tool call
        for (let j = 0; j < i; j++) {
           if (rows[j].tool_calls) {
             const c = rows[j].tool_calls!.find(c => c.id === row.tool_call_id);
             if (c) {
               assistantTs = (c as any)._assistantTs;
               break;
             }
           }
        }
        if (assistantTs !== undefined && rowTs !== undefined) {
           toolSeg.durationMs = Math.max(0, rowTs - assistantTs);
        }
      } else {
        // Orphan result (no matching call id — gateway recycled the id or the
        // call row sits on an unloaded page). Try to adopt the OLDEST pending
        // call with the SAME tool name: that pair is the same logical tool use
        // split by an id mismatch, and adopting gives the card its path back.
        let adopted: (typeof turns)[number]["segments"][number] | null = null;
        for (const t of turns) {
          if (t.role !== "assistant") continue;
          const s = t.segments.find((x) => x.kind === "tool" && x.label === (row.tool_name || "") && !x.resultText && !String(x.id).startsWith("orphan-"));
          if (s) { adopted = s; break; }
        }
        if (adopted) {
          adopted.resultText = resText;
          adopted.exitCode = exitCode;
          adopted.collapsed = true;
        } else {
          currentTurn.segments.push({
            id: `orphan-${row.id}`,
            kind: "tool",
            status: "done",
            label: row.tool_name || "tool",
            resultText: resText,
            exitCode,
            collapsed: true // owner mandate
          });
        }
      }
    }
  }

  // Zombie purge (owner 2026-10-01): drop tool segments whose result row never
  // arrived (interrupted turn, dropped stream) — they would render as empty
  // "Read a file" / spinner cards forever. A segment with args OR a result
  // stays (intent visible); TRULY empty ones (no args, no result) are dropped.
  // Second orphan pass: adoption during the row scan only sees EARLIER turns;
  // an orphan whose same-name call sits in a LATER turn (id mismatch across a
  // page boundary) gets one more chance here.
  for (const t of turns) {
    if (t.role !== "assistant") continue;
    for (const s of t.segments) {
      if (s.kind !== "tool" || !String(s.id).startsWith("orphan-")) continue;
      const host = turns.find((t2) => t2.role === "assistant" && t2.segments.some((x) => x.kind === "tool" && x.label === s.label && !x.resultText && !String(x.id).startsWith("orphan-")));
      const cand = host?.segments.find((x) => x.kind === "tool" && x.label === s.label && !x.resultText && !String(x.id).startsWith("orphan-"));
      if (cand) {
        cand.resultText = s.resultText;
        cand.exitCode = s.exitCode;
        cand.collapsed = true;
        s.resultText = ""; // emptied → filtered below
      }
    }
    t.segments = t.segments.filter((s) => {
      if (s.kind !== "tool") return true;
      const hasArgs = !!(s.argsText && s.argsText.trim() && s.argsText !== "{}");
      const hasResult = !!(s.resultText && s.resultText.trim());
      if (!hasArgs && !hasResult) return false;
      // File tools (owner 2026-10-01): a card that cannot be TITLED with its
      // filename is not shown — "Read a file"/"Edited a file" is banned. Orphan
      // results whose call row is on an unloaded page return whole (id-matched)
      // once pagination brings the call in; interrupted path-less calls never
      // had a result and are zombie work.
      if (s.label === "read_file" || s.label === "write_file" || s.label === "patch") {
        const argsHavePath = hasArgs && /"(path|file_path)"\s*:/.test(s.argsText!);
        const resultNamesFile = hasResult && /(files_modified|"path"\s*:|Edited \d+ file)/.test(s.resultText!);
        return argsHavePath || resultNamesFile;
      }
      return true;
    });
    for (const s of t.segments) if (s.kind === "tool" && s.status === "run") s.status = "done";
  }

  return turns;
}
