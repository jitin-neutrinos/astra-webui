import type { Segment } from "./chat-segments.ts";
import { extractAttachments } from "./media-paths.ts";

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

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.display_kind != null) continue;
    if (row.role === "system") continue;

    let rowTs = row.timestamp !== undefined ? (row.timestamp < 1e12 ? row.timestamp * 1000 : row.timestamp) : undefined;
    const content = typeof row.text === "string" ? row.text : typeof row.content === "string" ? row.content : typeof row.display_content === "string" ? row.display_content : "";

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
        currentTurn.segments.push({
          id: `text-${row.id}`,
          kind: "text",
          status: "done",
          text: content
        });
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
        toolSeg.collapsed = resText.length > 3000;
        
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
        currentTurn.segments.push({
          id: `orphan-${row.id}`,
          kind: "tool",
          status: "done",
          label: row.tool_name || "tool",
          resultText: resText,
          exitCode,
          collapsed: resText.length > 3000
        });
      }
    }
  }

  return turns;
}
