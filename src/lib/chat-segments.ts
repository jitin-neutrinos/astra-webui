// Pure segment-timeline engine — no React/JSX so it can be exercised from a
// plain node script (scripts/verify-chat-timeline.ts) without a build step.
// One ordered list per assistant turn. Frames map to ops (chat-landing.tsx);
// ops apply in arrival order so text/thinking/tool segments interleave
// exactly as the model emitted them — this is the fix for the old "one
// block, then all text below" bug.

export type SegKind = "thinking" | "tool" | "text" | "approval" | "clarify";

export interface Segment {
  id: string;
  kind: SegKind;
  status: "run" | "done";
  durationMs?: number;
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
  // clarify (generative UI question card)
  questions?: ClarifyQuestion[];
  answers?: Record<string, string>; // qid -> chosen answer (locked/submitted)
}

export interface ClarifyQuestion {
  qid?: string;
  question: string;
  choices: string[];
  multi_select?: boolean;
}

export type SegOp =
  | { op: "think"; text: string }
  | { op: "tool"; key?: string; label: string; argsText?: string; command?: string }
  | { op: "tool-update"; key?: string; label?: string; argsText?: string; command?: string }
  | { op: "tool-done"; key?: string; label?: string; resultText?: string; exitCode?: number | null }
  | { op: "text"; text: string }
  | { op: "approval"; reqId: string; params: Segment["params"] }
  | { op: "clarify"; reqId: string; params: { questions?: ClarifyQuestion[]; question?: string; choices?: string[]; multi_select?: boolean; answers?: Record<string, string> } };

let segSeq = 0;
const nextSegId = () => `seg${++segSeq}-${Date.now()}`;

const segTiming = new Map<string, number>();

function closeRunningThink(out: Segment[]) {
  const last = out[out.length - 1];
  if (last && last.kind === "thinking" && last.status === "run") {
    last.status = "done";
    const t0 = segTiming.get(last.id);
    if (t0) last.durationMs = Math.max(0, Date.now() - t0);
    segTiming.delete(last.id);
  }
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
        segTiming.set(t.id, Date.now());
      }
      t.text = (t.text || "") + op.text;
    } else if (op.op === "tool") {
      closeRunningThink(out);
      barrier = true;
      const id = op.key || nextSegId();
      out.push({
        id, kind: "tool", status: "run",
        label: op.label, argsText: op.argsText || "", command: op.command || "", collapsed: true,
      });
      segTiming.set(id, Date.now());
    } else if (op.op === "tool-update") {
      const t = (op.key && out.find((s) => s.id === op.key && s.kind === "tool" && s.status === "run"))
        || [...out].reverse().find((s) => s.kind === "tool" && s.status === "run");
      if (t) {
        if (op.argsText) t.argsText = op.argsText;
        if (op.command) t.command = op.command;
      } else {
        closeRunningThink(out);
        barrier = true;
        const id = op.key || nextSegId();
        out.push({ id, kind: "tool", status: "run", label: op.label || "tool", argsText: op.argsText || "", command: op.command || "", collapsed: true });
        segTiming.set(id, Date.now());
      }
    } else if (op.op === "tool-done") {
      // Addressed by tool_id when we have one; a key with no match must NOT
      // close some other still-running tool (results would land on the wrong
      // block). Keyless frames fall back to the newest running tool.
      const t = op.key
        ? out.find((s) => s.id === op.key && s.kind === "tool")
        : [...out].reverse().find((s) => s.kind === "tool" && s.status === "run");
      if (t) {
        t.status = "done";
        if (op.resultText !== undefined) t.resultText = op.resultText;
        if (op.exitCode !== undefined) t.exitCode = op.exitCode;
        // Owner mandate: tool blocks NEVER auto-expand — collapsed by default
        // regardless of output size. Only a user click (persisted in
        // step-prefs) or explicit Ctrl+O opens them.
        t.collapsed = true;
        const t0 = segTiming.get(t.id);
        if (t0) t.durationMs = Math.max(0, Date.now() - t0);
        segTiming.delete(t.id);
      } else {
        out.push({ id: nextSegId(), kind: "tool", status: "done", label: op.label || "tool", resultText: op.resultText || "", exitCode: op.exitCode ?? null, collapsed: true });
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
    } else if (op.op === "clarify") {
      closeRunningThink(out);
      barrier = true;
      const p = op.params;
      const questions: ClarifyQuestion[] = p.questions?.length
        ? p.questions
        : [{ question: p.question || "A question for you", choices: p.choices || [], multi_select: p.multi_select }];
      out.push({
        id: nextSegId(), kind: "clarify", status: "run", reqId: op.reqId,
        questions, answers: { ...(p.answers || {}) }, resolved: null,
      });
    }
  }
  return out;
}

export function finalizeSegments(segments: Segment[]): Segment[] {
  return segments.map((s) => {
    if (s.status === "run") {
      const t0 = segTiming.get(s.id);
      segTiming.delete(s.id);
      return { ...s, status: "done" as const, durationMs: t0 ? Math.max(0, Date.now() - t0) : s.durationMs };
    }
    return { ...s, status: "done" as const };
  });
}

// A turn with an UNRESOLVED approval is paused, not streaming: the model is
// blocked on the user, no caret/spinner should spin forever. Restored/replayed
// approval cards (session resume mid-turn) land here too — interrupted turns
// never emit message.complete, so running-state must not hang off streaming
// alone. Pure so the verify script shares it.
export function turnIsRunning(segments: Segment[], streaming: boolean): boolean {
  const blocked = (s: Segment) =>
    (s.kind === "approval" || s.kind === "clarify") && s.resolved == null;
  return streaming && !segments.some(blocked);
}

// Ctrl+O expands the newest collapsed >3k-char tool block across the whole
// transcript (matches the TUI's real Ctrl+O key). Pure so both the keydown
// handler and the verify script share one implementation.
// Ctrl+O gate, pure so the verify script shares it: only a bare Ctrl/Cmd+O
// outside a text field may expand (INPUT/TEXTAREA targets ignored, metaKey
// accepted for macOS — same rule as the reference ChatPageV2).
export function expandKeyBlocked(ctrlKey: boolean, metaKey: boolean, key: string, targetTag?: string): boolean {
  if (!ctrlKey && !metaKey) return true;
  if (key !== "o" && key !== "O") return true;
  const tag = targetTag?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA";
}

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
