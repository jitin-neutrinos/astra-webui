import { useEffect, useRef, useState, useMemo } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, TriangleAlert, PlayCircle, FileText, Copy } from "lucide-react";
import { cn } from "../lib/utils";
import { getFileKind } from "../lib/session-files";

import type { Segment, ClarifyQuestion } from "../lib/chat-segments";
import { turnIsRunning } from "../lib/chat-segments";

export type { SegKind, Segment, SegOp } from "../lib/chat-segments";
export { applySegmentOps, finalizeSegments, findNewestCollapsedToolSeg, expandKeyBlocked, turnIsRunning } from "../lib/chat-segments";

import { Marked } from "marked";
import DOMPurify from "dompurify";
import { safeTail } from "../lib/safe-tail";
import { copyText } from "../lib/copy-text";

const md = new Marked({ gfm: true, breaks: true });
let purifyHooked = false;

function RichText({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => {
    if (!purifyHooked) {
      DOMPurify.addHook("afterSanitizeAttributes", (n) => {
        if (n.tagName === "A") { n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener noreferrer"); }
      });
      purifyHooked = true;
    }
    return DOMPurify.sanitize(md.parse(text, { async: false }) as string, {
      ADD_ATTR: ["target"], FORBID_TAGS: ["style", "form"], FORBID_ATTR: ["srcset"],
    });
  }, [text]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const pres = root.querySelectorAll("pre:not([data-cb])");
    pres.forEach((pre) => {
      pre.setAttribute("data-cb", "1");
      const btn = document.createElement("button");
      btn.className = "chat-code-copy";
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
      btn.setAttribute("aria-label", "Copy code");
      btn.title = "Copy";
      btn.onclick = () => void copyText(pre.textContent || "");
      pre.appendChild(btn);
    });
  }, [html]);

  return (
    <div className="relative group">
      <button
        type="button"
        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-midnight/80 text-cyanx border border-white/10 rounded-md px-2 py-0.5 text-[10px] font-mono hover:bg-cyanx/20 focus:outline-none focus:ring-1 focus:ring-cyanx/40"
        onClick={() => void copyText(text)}
        aria-label="Copy message content"
        title="Copy"
      >
        <Copy className="h-3 w-3" strokeWidth={1.5} />
      </button>
      <div ref={containerRef} className="chat-md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
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

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

const CPS_MIN = 120, CPS_MAX = 160; // 30-40 tokens/s (~4 chars avg): human variance band
function useReveal(text: string, done: boolean, instant: boolean) {
  const [n, setN] = useState(0);
  const nRef = useRef(0), tRef = useRef(0);
  useEffect(() => {
    if (instant) { nRef.current = text.length; setN(text.length); return; }
    if (nRef.current > text.length) nRef.current = 0;      // turn reset / retry
    if (nRef.current >= text.length) return;
    let id = 0;
    const tick = () => {
      const now = performance.now();
      if (!tRef.current) tRef.current = now - 16;
      const dt = Math.min(now - tRef.current, 250) / 1000; // cap tab-sleep jumps
      tRef.current = now;
      const back = text.length - nRef.current;
      const cps = done
        ? Math.max(CPS_MIN * 3, back / 0.4)                // finished turn drains <1s
        : CPS_MIN + (Math.sin(now / 900) + 1) * (CPS_MAX - CPS_MIN) / 2; // smooth ±20% human wobble
      nRef.current = Math.min(text.length, nRef.current + cps * dt);
      setN(Math.floor(nRef.current));
      if (nRef.current < text.length) id = window.setTimeout(tick, 16);
    };
    id = window.setTimeout(tick, 16);
    return () => window.clearTimeout(id);
  }, [text, done, instant]);
  return instant ? text.length : Math.min(n, text.length);
}

export const MEDIA_RE = /(?<![\w:])(?<!\/)(?:~|\/)[\w./-]*\.(?:png|jpe?g|gif|webp|mp4|webm|mov|mkv|avi|mp3|wav|ogg|flac|m4a|opus)\b/gi;
export function mediaPaths(text: string) {
  // MEDIA:<path> markers carry a colon before the path — the URL guard would reject them, so strip the marker first
  return [...new Set(text.replace(/\bMEDIA:\s*(?=[~/])/g, "").match(MEDIA_RE) ?? [])];
}

export function MediaCard({ path, name }: { path: string; name: string }) {
  const kind = getFileKind(name);
  const enc = encodeURIComponent(path);
  return (
    <div data-media-card className="overflow-hidden rounded-lg border border-white/10 bg-white/5 text-xs text-slate-300">
      {kind === "image" ? (
        <a href={`/api/hx/files/download?path=${enc}`} target="_blank" rel="noreferrer" title="Open full image" className="block">
          <img src={`/api/hx/files/download?path=${enc}`} alt={name} loading="lazy" className="max-h-44 max-w-[240px] object-cover" />
        </a>
      ) : kind === "video" ? (
        <video src={`/api/hx/files/stream?path=${enc}`} controls preload="metadata" className="max-h-44 max-w-[280px]" />
      ) : kind === "audio" ? (
        <div className="flex w-56 items-center gap-2 p-2">
          <PlayCircle className="h-4 w-4 shrink-0 text-cyanx" />
          <audio src={`/api/hx/files/stream?path=${enc}`} controls preload="metadata" className="h-8 w-full" />
        </div>
      ) : (
        <a href={`/api/hx/files/download?path=${enc}`} target="_blank" rel="noreferrer"
          className="flex max-w-[220px] items-center gap-2 p-2 pr-3 hover:bg-white/5" title="Download">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-black/20 text-slate-400">
            <FileText className="h-3 w-3" />
          </div>
          <span className="truncate">{name}</span>
        </a>
      )}
      {(kind === "image" || kind === "video" || kind === "audio") && (
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <span className="truncate text-[10px] text-slate-500">{name}</span>
          <a href={`/api/hx/files/download?path=${enc}`} target="_blank" rel="noreferrer"
            className="shrink-0 font-mono text-[10px] text-cyanx hover:underline">download</a>
        </div>
      )}
    </div>
  );
}

export function stripMediaLines(t: string) {
  return t.replace(/^\s*MEDIA:\s*\S+\s*$/gm, "").trim();
}

function TextRow({ seg }: { seg: Segment }) {
  const text = seg.text ?? "";
  const instant = usePrefersReducedMotion();
  const n = useReveal(text, seg.status === "done", instant);
  const shown = useMemo(() => safeTail(text.slice(0, n)), [text, n]);
  const paths = useMemo(() => mediaPaths(text), [text]);
  const display = useMemo(() => stripMediaLines(seg.status === "done" && n >= text.length ? text : shown), [seg.status, text, n, shown]);
  if (!text) return null;
  return (
    <div className="chat-text-seg">
      {display && <RichText text={display} />}
      {!instant && (seg.status === "run" || n < text.length) && <span className="chat-caret" aria-hidden="true" />}
      {n >= text.length && paths.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {paths.map(p => <MediaCard key={p} path={p} name={p.split("/").pop() || p} />)}
        </div>
      )}
    </div>
  );
}

const APPROVAL_LABELS: Record<string, string> = { once: "Approve once", session: "Allow this chat", always: "Always allow", deny: "Deny" };

// Generative-UI clarify card: renders the agent's question(s) as an interactive
// form. Single question → choice buttons + free text; batch → per-question
// groups with radio/checkbox inputs, lockable one at a time (clarify.lock).
function ClarifyCard({ seg, onAnswer }: {
  seg: Segment;
  onAnswer: (reqId: string, result: { answer?: string; answers?: Record<string, string> }) => void;
}) {
  const questions = seg.questions || [];
  const [picks, setPicks] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const q of questions) {
      const qid = q.qid || q.question;
      const locked = seg.answers?.[qid];
      init[qid] = locked ? [locked] : [];
    }
    return init;
  });
  const [freeText, setFreeText] = useState<Record<string, string>>({});

  if (seg.resolved) {
    const summary = Object.entries(seg.answers || {}).map(([, v]) => v).join(", ") || seg.resolved;
    return (
      <div className="chat-approval" role="status" aria-label="Question answered">
        <div className="chat-approval-head">
          <span className="chat-approval-badge done" aria-hidden="true">?</span>
          <span className="chat-approval-title">Question answered</span>
        </div>
        <div className="chat-approval-resolved">Answered: {summary}</div>
      </div>
    );
  }

  const togglePick = (qid: string, choice: string, multi: boolean) => {
    setPicks((prev) => {
      const cur = prev[qid] || [];
      if (!multi) return { ...prev, [qid]: [choice] };
      return { ...prev, [qid]: cur.includes(choice) ? cur.filter((c) => c !== choice) : [...cur, choice] };
    });
  };

  const answerFor = (q: ClarifyQuestion): string => {
    const qid = q.qid || q.question;
    const picked = (picks[qid] || []).join(", ");
    const extra = (freeText[qid] || "").trim();
    if (picked && extra) return `${picked} — ${extra}`;
    return picked || extra;
  };

  const allAnswered = questions.every((q) => answerFor(q).length > 0);

  return (
    <div className="chat-approval chat-clarify" role="form" aria-label="Astra has questions">
      <div className="chat-approval-head">
        <span className="chat-approval-badge" aria-hidden="true">?</span>
        <span className="chat-approval-title">{questions.length > 1 ? `${questions.length} questions` : "Quick question"}</span>
      </div>
      {seg.resolved === null && <div className="chat-approval-wait">The turn is paused until you answer</div>}
      {questions.map((q, qi) => {
        const qid = q.qid || q.question;
        const picked = picks[qid] || [];
        return (
          <fieldset key={qid} className="chat-clarify-q">
            <legend className="chat-clarify-question">{questions.length > 1 ? `${qi + 1}. ` : ""}{q.question}</legend>
            <div className="chat-clarify-choices" role={q.multi_select ? "group" : "radiogroup"} aria-label={q.question}>
              {q.choices.map((c) => (
                <button key={c} type="button"
                  role={q.multi_select ? "checkbox" : "radio"}
                  aria-checked={picked.includes(c)}
                  className={cn("chat-approval-btn chat-clarify-choice", picked.includes(c) && "primary")}
                  onClick={() => togglePick(qid, c, !!q.multi_select)}>
                  {picked.includes(c) && <Check className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
                  {c}
                </button>
              ))}
            </div>
            <input type="text" className="chat-clarify-free" placeholder="Or type your own answer…"
              value={freeText[qid] || ""} aria-label={`Custom answer for: ${q.question}`}
              onChange={(e) => setFreeText((prev) => ({ ...prev, [qid]: e.target.value }))} />
          </fieldset>
        );
      })}
      <div className="chat-approval-actions">
        <button type="button" className="chat-approval-btn primary" disabled={!allAnswered}
          onClick={() => {
            if (questions.length === 1 && !questions[0].qid) {
              onAnswer(seg.reqId!, { answer: answerFor(questions[0]) });
            } else {
              const answers: Record<string, string> = {};
              for (const q of questions) answers[q.qid || q.question] = answerFor(q);
              onAnswer(seg.reqId!, { answers });
            }
          }}>
          Send answer
        </button>
      </div>
    </div>
  );
}

function ApprovalRow({ seg, onRespond }: { seg: Segment; onRespond: (reqId: string, choice: string) => void }) {
  const p = seg.params || {};
  const choices = p.choices?.length ? p.choices : ["once", "deny"];
  const isCommandApproval = !!p.command;
  const titleText = isCommandApproval ? "Approval needed" : (p.description ? "Choice required" : "Clarify");
  const subText = p.description || (isCommandApproval ? "Astra wants to run a command" : "Select an option to continue.");
  return (
    <div id={`chat-approval-${seg.reqId}`} className="chat-approval" role="alertdialog" aria-label={isCommandApproval ? "Command approval" : "Choice / Clarify"}>
      <div className="chat-approval-head">
        <span className="chat-approval-badge" aria-hidden="true">!</span>
        <span className="chat-approval-title">{titleText}</span>
      </div>
      <p className="chat-approval-sub">{subText}</p>
      {!!p.command && <pre className="chat-approval-cmd" tabIndex={0}>{p.command}</pre>}
      {seg.resolved ? (
        <div className="chat-approval-resolved">{seg.resolved === "cancelled" ? "Request withdrawn" : `Resolved: ${APPROVAL_LABELS[seg.resolved] || seg.resolved}`}</div>
      ) : (
        <>
          <div className="chat-approval-actions">
            {choices.map((c: string, i: number) => (
              <button key={c} type="button" className={cn("chat-approval-btn", c === "deny" && "deny", c === "once" && "primary")}
                onClick={() => onRespond(seg.reqId!, c)}>
                <span className="chat-approval-key">{i + 1}</span>
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

export function TurnTimeline({ segments, streaming, onToggleTool, onApprovalRespond, onClarifyAnswer }: {
  segments: Segment[];
  streaming: boolean;
  onToggleTool: (segId: string) => void;
  onApprovalRespond: (reqId: string, choice: string) => void;
  onClarifyAnswer: (reqId: string, result: { answer?: string; answers?: Record<string, string> }) => void;
}) {
  if (!segments.length) return null;
  // Action-based chronological: preserve arrival order, but ensure any
  // thinking that follows the first text is shown before that text
  // (so reasoning never trails behind the final response).
  const firstTextIdx = segments.findIndex(s => s.kind === "text");
  let orderedSegments = segments;
  if (firstTextIdx > 0) {
    const beforeText = segments.slice(0, firstTextIdx);
    const afterText = segments.slice(firstTextIdx);
    const trailingThink = afterText.filter(s => s.kind === "thinking");
    const afterTextNoThink = afterText.filter(s => s.kind !== "thinking");
    if (trailingThink.length > 0) {
      orderedSegments = [
        ...beforeText.filter(s => s.kind === "thinking"),
        ...beforeText.filter(s => s.kind !== "thinking"),
        ...trailingThink,
        ...afterTextNoThink,
      ];
    }
  }
  const isRunning = turnIsRunning(segments, streaming);
  return (
    <div className={cn("chat-turn", isRunning && "running")} aria-busy={isRunning}>
      {orderedSegments.map((seg) => {
        if (seg.kind === "thinking") return <ThinkingRow key={seg.id} seg={seg} />;
        if (seg.kind === "tool") return <ToolRow key={seg.id} seg={seg} onToggle={() => onToggleTool(seg.id)} />;
        if (seg.kind === "approval") return <ApprovalRow key={seg.id} seg={seg} onRespond={onApprovalRespond} />;
        if (seg.kind === "clarify") return <ClarifyCard key={seg.id} seg={seg} onAnswer={onClarifyAnswer} />;
        return <TextRow key={seg.id} seg={seg} />;
      })}
    </div>
  );
}
