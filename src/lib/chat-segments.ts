// Pure segment-timeline engine — no React/JSX so it can be exercised from a
// plain node script (scripts/verify-chat-timeline.ts) without a build step.
// One ordered list per assistant turn. Frames map to ops (chat-landing.tsx);
// ops apply in arrival order so text/thinking/tool segments interleave
// exactly as the model emitted them — this is the fix for the old "one
// block, then all text below" bug.

export type SegKind = "thinking" | "tool" | "text" | "approval";

export interface Segment {
  id: string;
  kind: SegKind;
  status: "run" | "done";
  // thinking / text
  text?: string;
  // tool
  label?: string;
  argsText?: string;
  command?: string;
  resultText?: string;
  exitCode?: number | null;
  collapsed?: boolean;
  // approval
  reqId?: string;
  params?: { session_id?: string; request_id?: string; command?: string; description?: string; choices?: string[] };
  resolved?: string | null;
}

export type SegOp =
  | { op: "think"; text: string }
  | { op: "tool"; key?: string; label: string; argsText?: string; command?: string }
  | { op: "tool-update"; key?: string; label?: string; argsText?: string; command?: string }
  | { op: "tool-done"; key?: string; label?: string; resultText?: string; exitCode?: number | null }
  | { op: "text"; text: string }
  | { op: "approval"; reqId: string; params: Segment["params"] };

let segSeq = 0;
const nextSegId = () => `seg${++segSeq}-${Date.now()}`;

function closeRunningThink(out: Segment[]) {
  const last = out[out.length - 1];
  if (last && last.kind === "thinking" && last.status === "run") last.status = "done";
}

const TERM_FOLD_CHARS = 3000;

export function applySegmentOps(segments: Segment[], ops: SegOp[]): Segment[] {
  const out = segments.map((s) => ({ ...s }));
  let barrier = false; // a tool/text landed this batch: later thinking opens a NEW segment
  for (const op of ops) {
    if (op.op === "think") {
      if (!op.text) continue;
      const last = out[out.length - 1];
      let t = last && last.kind === "thinking" && last.status === "run" && !barrier ? last : null;
      if (!t) {
        t = { id: nextSegId(), kind: "thinking", status: "run", text: "" };
        out.push(t);
      }
      t.text = (t.text || "") + op.text;
    } else if (op.op === "tool") {
      closeRunningThink(out);
      barrier = true;
      out.push({
        id: op.key || nextSegId(), kind: "tool", status: "run",
        label: op.label, argsText: op.argsText || "", command: op.command || "", collapsed: true,
      });
    } else if (op.op === "tool-update") {
      const t = (op.key && out.find((s) => s.id === op.key && s.kind === "tool" && s.status === "run"))
        || [...out].reverse().find((s) => s.kind === "tool" && s.status === "run");
      if (t) {
        if (op.argsText) t.argsText = op.argsText;
        if (op.command) t.command = op.command;
      } else {
        closeRunningThink(out);
        barrier = true;
        out.push({ id: op.key || nextSegId(), kind: "tool", status: "run", label: op.label || "tool", argsText: op.argsText || "", command: op.command || "", collapsed: true });
      }
    } else if (op.op === "tool-done") {
      const t = (op.key && out.find((s) => s.id === op.key && s.kind === "tool"))
        || [...out].reverse().find((s) => s.kind === "tool" && s.status === "run");
      if (t) {
        t.status = "done";
        if (op.resultText !== undefined) t.resultText = op.resultText;
        if (op.exitCode !== undefined) t.exitCode = op.exitCode;
        t.collapsed = (t.resultText?.length || 0) > TERM_FOLD_CHARS;
      } else {
        out.push({ id: nextSegId(), kind: "tool", status: "done", label: op.label || "tool", resultText: op.resultText || "", exitCode: op.exitCode ?? null, collapsed: (op.resultText?.length || 0) > TERM_FOLD_CHARS });
      }
    } else if (op.op === "text") {
      if (!op.text) continue;
      closeRunningThink(out);
      barrier = true;
      const last = out[out.length - 1];
      let t = last && last.kind === "text" && last.status === "run" ? last : null;
      if (!t) {
        t = { id: nextSegId(), kind: "text", status: "run", text: "" };
        out.push(t);
      }
      t.text = (t.text || "") + op.text;
    } else if (op.op === "approval") {
      closeRunningThink(out);
      barrier = true;
      out.push({ id: nextSegId(), kind: "approval", status: "run", reqId: op.reqId, params: op.params, resolved: null });
    }
  }
  return out;
}

export function finalizeSegments(segments: Segment[]): Segment[] {
  return segments.map((s) => ({ ...s, status: "done" as const }));
}

// Ctrl+O expands the newest collapsed >3k-char tool block across the whole
// transcript (matches the TUI's real Ctrl+O key). Pure so both the keydown
// handler and the verify script share one implementation.
export function findNewestCollapsedToolSeg(
  turns: { id: string; segments: Segment[] }[],
): { msgId: string; segId: string } | null {
  let target: { msgId: string; segId: string } | null = null;
  for (const t of turns) {
    for (const s of t.segments) {
      if (s.kind === "tool" && s.collapsed && (s.resultText?.length || 0) > TERM_FOLD_CHARS) {
        target = { msgId: t.id, segId: s.id };
      }
    }
  }
  return target;
}
