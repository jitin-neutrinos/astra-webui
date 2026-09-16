import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Segment } from "@/lib/chat-segments";
import { turnIsRunning } from "@/lib/chat-segments";

export type { SegKind, Segment, SegOp } from "@/lib/chat-segments";
export { applySegmentOps, finalizeSegments, findNewestCollapsedToolSeg, expandKeyBlocked, turnIsRunning } from "@/lib/chat-segments";

// ---- minimal markdown: bold / inline code / fenced code only ------------
// No library (none installed). Partial trailing `**`/``` never render raw —
// unmatched markers stay literal text, a trailing open fence renders inside
// a stable <pre> so streaming never reflows or breaks layout.

function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] !== undefined) nodes.push(<strong key={`${keyBase}b${i++}`}>{m[1]}</strong>);
    else nodes.push(<code key={`${keyBase}c${i++}`} className="chat-inline-code">{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function MiniMarkdown({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  const fenceRe = /```([\w+-]*)\n([\s\S]*?)```/g;
  let last = 0, m: RegExpExecArray | null, key = 0;
  while ((m = fenceRe.exec(text))) {
    if (m.index > last) nodes.push(...renderInline(text.slice(last, m.index), `s${key}-`));
    nodes.push(<pre key={`f${key++}`} className="chat-code-block"><code>{m[2]}</code></pre>);
    last = m.index + m[0].length;
  }
  const rest = text.slice(last);
  const partial = rest.match(/```([\w+-]*)\n?([\s\S]*)$/);
  if (partial) {
    const before = rest.slice(0, partial.index);
    if (before) nodes.push(...renderInline(before, `p${key}-`));
    nodes.push(<pre key={`fp${key++}`} className="chat-code-block chat-code-pending"><code>{partial[2]}</code></pre>);
  } else if (rest) {
    nodes.push(...renderInline(rest, `r${key}-`));
  }
  return <>{nodes}</>;
}

// ---- segment rows ---------------------------------------------------------

function ThinkingRow({ seg }: { seg: Segment }) {
  const [open, setOpen] = useState(true);
  const wasRunning = useRef(seg.status === "run");
  useEffect(() => {
    if (wasRunning.current && seg.status === "done") setOpen(false);
    wasRunning.current = seg.status === "run";
  }, [seg.status]);
  if (!seg.text) return null;
  return (
    <div className="chat-step-wrap">
      <button type="button" className={cn("chat-step k-think", seg.status === "run" && "run")}
        onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {seg.status === "run" ? <Loader2 className="chat-step-icon spin" /> : <Check className="chat-step-icon" />}
        <span className="chat-step-label">Thinking</span>
        {open ? <ChevronDown className="chat-step-chevron" /> : <ChevronRight className="chat-step-chevron" />}
      </button>
      {open && <div className="chat-step-body chat-think-text">{seg.text}</div>}
    </div>
  );
}

function ToolRow({ seg, onToggle }: { seg: Segment; onToggle: () => void }) {
  const isTerm = /terminal|bash|shell|exec/i.test(seg.label || "") || !!seg.command;
  const preview = (seg.command || seg.argsText || "").replace(/\s+/g, " ").slice(0, 90);
  const long = (seg.resultText?.length || 0) > 3000;
  const showBody = !seg.collapsed || !long;
  return (
    <div className="chat-step-wrap">
      <button type="button" className={cn("chat-step k-tool", seg.status === "run" && "run")} onClick={onToggle} aria-expanded={!seg.collapsed}>
        {seg.status === "run" ? <Loader2 className="chat-step-icon spin" /> : seg.exitCode ? <TriangleAlert className="chat-step-icon err" /> : <Check className="chat-step-icon" />}
        <span className="chat-step-label">{seg.label}</span>
        {!!preview && <span className="chat-step-preview">{preview}</span>}
        {seg.status === "done" && seg.exitCode != null && seg.exitCode !== 0 && <span className="chat-step-exit">exit {seg.exitCode}</span>}
        {(seg.command || seg.argsText || seg.resultText) && (seg.collapsed ? <ChevronRight className="chat-step-chevron" /> : <ChevronDown className="chat-step-chevron" />)}
      </button>
      {!seg.collapsed && (
        <div className="chat-step-body">
          {isTerm ? (
            <>
              {!!seg.command && <pre className="chat-term-cmd">$ {seg.command}</pre>}
              {!seg.command && !!seg.argsText && <pre className="chat-term-args">{seg.argsText}</pre>}
              {!!seg.resultText && (
                <div className="chat-term-block">
                  <pre className="chat-term-out" tabIndex={0}>{showBody ? seg.resultText : seg.resultText.slice(0, 3000) + "\n…"}</pre>
                  {long && !showBody && (
                    <button type="button" className="chat-term-expand" onClick={onToggle} title="Expand full output (Ctrl+O)">
                      Ctrl+O to expand
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {!!seg.argsText && <pre className="chat-term-args">{seg.argsText}</pre>}
              {!!seg.resultText && <pre className="chat-term-args">{prettyPrint(seg.resultText)}</pre>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function prettyPrint(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

function TextRow({ seg }: { seg: Segment }) {
  if (!seg.text) return null;
  return (
    <div className="chat-text-seg whitespace-pre-wrap">
      <MiniMarkdown text={seg.text} />
      {seg.status === "run" && <span className="chat-caret" aria-hidden="true" />}
    </div>
  );
}

const APPROVAL_LABELS: Record<string, string> = { once: "Approve once", session: "Allow this chat", always: "Always allow", deny: "Deny" };

function ApprovalRow({ seg, onRespond }: { seg: Segment; onRespond: (reqId: string, choice: string) => void }) {
  const p = seg.params || {};
  const choices = p.choices?.length ? p.choices : ["once", "deny"];
  return (
    <div id={`chat-approval-${seg.reqId}`} className="chat-approval" role="alertdialog" aria-label="Command approval">
      <div className="chat-approval-head">
        <span className="chat-approval-badge" aria-hidden="true">!</span>
        <span className="chat-approval-title">Approval needed</span>
        <span className="chat-approval-sub">{p.description || "Astra wants to run a command"}</span>
      </div>
      {!!p.command && <pre className="chat-approval-cmd" tabIndex={0}>{p.command}</pre>}
      {seg.resolved ? (
        <div className="chat-approval-resolved">{seg.resolved === "cancelled" ? "Request withdrawn" : `Resolved: ${APPROVAL_LABELS[seg.resolved] || seg.resolved}`}</div>
      ) : (
        <>
          <div className="chat-approval-actions">
            {choices.map((c) => (
              <button key={c} type="button" className={cn("chat-approval-btn", c === "deny" && "deny", c === "once" && "primary")}
                onClick={() => onRespond(seg.reqId!, c)}>
                {APPROVAL_LABELS[c] || c}
              </button>
            ))}
          </div>
          <div className="chat-approval-wait">Waiting for your decision — the turn is paused</div>
        </>
      )}
    </div>
  );
}

// ---- turn container --------------------------------------------------------

export function TurnTimeline({ segments, streaming, onToggleTool, onApprovalRespond }: {
  segments: Segment[];
  streaming: boolean;
  onToggleTool: (segId: string) => void;
  onApprovalRespond: (reqId: string, choice: string) => void;
}) {
  if (!segments.length) return null;
  // A turn with an unresolved approval is paused, not streaming (pure helper —
  // replayed cards must not show an infinite spinner).
  const isRunning = turnIsRunning(segments, streaming);
  return (
    <div className={cn("chat-turn", isRunning && "running")} aria-busy={isRunning}>
      {segments.map((seg) => {
        if (seg.kind === "thinking") return <ThinkingRow key={seg.id} seg={seg} />;
        if (seg.kind === "tool") return <ToolRow key={seg.id} seg={seg} onToggle={() => onToggleTool(seg.id)} />;
        if (seg.kind === "approval") return <ApprovalRow key={seg.id} seg={seg} onRespond={onApprovalRespond} />;
        return <TextRow key={seg.id} seg={seg} />;
      })}
    </div>
  );
}
