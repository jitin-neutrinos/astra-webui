import { useEffect, useRef, useState, useMemo } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, TriangleAlert, Copy } from "lucide-react";
import { cn } from "../lib/utils";
import { getFileKind } from "../lib/session-files";
import { AudioPlayer } from "./audio-player";
import { GateCard } from "./gates/gate-card";

import type { Segment, ClarifyQuestion } from "../lib/chat-segments";
import { turnIsRunning } from "../lib/chat-segments";
import { MEDIA_RE, mediaPaths, stripMediaLines } from "../lib/media-paths";

export type { SegKind, Segment, SegOp } from "../lib/chat-segments";
export { applySegmentOps, finalizeSegments, findNewestCollapsedToolSeg, expandKeyBlocked, turnIsRunning } from "../lib/chat-segments";
export { MEDIA_RE, mediaPaths, stripMediaLines };

import { extractPlans, extractReports, stripAstraFences, hasOpenFence } from "../lib/plan-block";
import { PlanCard, PlanGateContext } from "./plan-card";
import { ReportCard } from "./report-card";

export { extractPlans, extractReports, stripAstraFences, hasOpenFence };
export { PlanCard, PlanGateContext };
export { ReportCard };

import { Marked } from "marked";
import DOMPurify from "dompurify";
import { safeTail } from "../lib/safe-tail";
import { copyText } from "../lib/copy-text";

const md = new Marked({ gfm: true, breaks: true });
let purifyHooked = false;

export function RichText({ text, onOpenImage, streaming }: { text: string; onOpenImage?: (url: string, alt: string) => void; streaming?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => {
    if (!purifyHooked) {
      DOMPurify.addHook("afterSanitizeAttributes", (n) => {
        if (n.tagName === "A") { n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener noreferrer"); }
        if (n.tagName === "IMG") {
          const src = n.getAttribute("src") || "";
          if (src && !src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("/api/hx/")) {
            n.removeAttribute("src"); // Only allow safe paths
          }
          n.setAttribute("loading", "lazy");
        }
      });
      purifyHooked = true;
    }
    
    let processed = text;
    let matches: RegExpMatchArray | null = null;
    if (streaming) {
      // detect odd fence count -> close it
      matches = processed.match(/```/g);
      if (matches && matches.length % 2 !== 0) {
        processed += "\n```";
      }
    }
    
    let sanitized = DOMPurify.sanitize(md.parse(processed, { async: false }) as string, {
      ADD_ATTR: ["target", "loading"], FORBID_TAGS: ["style", "form"], FORBID_ATTR: ["srcset"],
    });

    if (streaming && matches && matches.length % 2 !== 0) {
      // only the trailing unterminated block is actually streaming — a global
      // replace would also tag earlier, already-closed code blocks
      const lastOpen = sanitized.lastIndexOf("<pre><code");
      if (lastOpen !== -1) {
        sanitized = sanitized.slice(0, lastOpen) + '<pre data-streaming="true"><code' + sanitized.slice(lastOpen + "<pre><code".length);
      }
    }
    return sanitized;
  }, [text, streaming]);

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

    const imgs = root.querySelectorAll("img:not([data-lb])");
    imgs.forEach((el) => {
      const img = el as HTMLImageElement;
      img.setAttribute("data-lb", "1");
      img.classList.add("cursor-zoom-in");
      img.addEventListener("click", (e) => {
        e.preventDefault();
        onOpenImage?.(img.src, img.alt);
      });
    });
  }, [html, onOpenImage]);

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

function formatDur(ms?: number) {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

import { stepOpen, setStepOpen, hashKey } from "../lib/step-prefs";
import { describeTool } from "../lib/tool-identity";
import { FileText, Terminal as TerminalIcon, Globe, Database, Users, Search as SearchIcon, Wrench, Blocks } from "lucide-react";

const KIND_ICON: Record<string, typeof Wrench> = {
  mcp: Blocks, skill: Blocks, terminal: TerminalIcon, file: FileText,
  web: Globe, browser: Globe, memory: Database, delegate: Users,
  search: SearchIcon, tool: Wrench,
};

// Stable per-step preference key. Tool steps: the provider tool_call id is
// stable across live and restored paths. Thinking steps: content hash (ids
// differ between live and restored renders for the same reasoning).
function stepPrefKey(seg: Segment): string {
  if (seg.kind === "tool" && seg.id && !seg.id.startsWith("orphan-") && !seg.id.startsWith("s")) return seg.id;
  if (seg.kind === "thinking") return `think:${hashKey((seg.text || "").slice(0, 400))}`;
  return seg.id;
}

function ThinkingRow({ seg }: { seg: Segment }) {
  const prefKey = stepPrefKey(seg);
  // Collapsed by default (owner mandate); ONLY a persisted user-open or a live
  // click opens it. While running it shows open once, then collapses on done —
  // a persisted "closed" from a previous session always wins.
  const [open, setOpen] = useState<boolean>(() => seg.status === "run" ? stepOpen(prefKey) ?? true : stepOpen(prefKey) ?? false);
  const wasRunning = useRef(seg.status === "run");
  const userTouched = useRef(false);
  useEffect(() => {
    if (wasRunning.current) {
      // the run just finished (or flipped states) — re-arm and auto-collapse
      const finished = seg.status === "done";
      wasRunning.current = seg.status === "run";
      if (finished && !userTouched.current) setOpen(false); // auto-collapse after the run
      return;
    }
    wasRunning.current = seg.status === "run";
  }, [seg.status]);
  if (!seg.text) return null;
  const dur = formatDur(seg.durationMs);
  return (
    <div className="chat-step-wrap">
      <button type="button" className={cn("chat-step k-think", seg.status === "run" && "run")}
        onClick={() => { userTouched.current = true; setStepOpen(prefKey, !open); setOpen((o) => !o); }} aria-expanded={open}>
        {seg.status === "run" ? <Loader2 className="chat-step-icon spin" /> : <Check className="chat-step-icon" />}
        <span className="chat-step-label">Thinking</span>
        {dur && <span className={cn("chat-step-dur ml-auto font-mono text-[10px]", seg.status === "run" ? "text-[var(--color-cyanx)]" : "text-[var(--color-brandtext)]")}>{dur}</span>}
        {open ? <ChevronDown className="chat-step-chevron ml-2" /> : <ChevronRight className="chat-step-chevron ml-2" />}
      </button>
      {open && <div className="chat-step-body chat-think-text">{seg.text}</div>}
    </div>
  );
}

function ToolRow({ seg, onToggle }: { seg: Segment; onToggle: () => void }) {
  const info = describeTool(seg.label, seg.argsText, seg.command);
  const Icon = KIND_ICON[info.kind] || Wrench;
  const prefKey = stepPrefKey(seg);
  // Header meta: identity line — command for terminal, path for files,
  // server for MCP, skill name for skills, etc.
  const meta = (info.kind === "terminal" ? (seg.command || info.meta) : info.meta)?.replace(/\s+/g, " ").slice(0, 110);
  const long = (seg.resultText?.length || 0) > 3000;
  const dur = formatDur(seg.durationMs);

  const toggle = () => {
    const next = !seg.collapsed;
    setStepOpen(prefKey, next);
    onToggle();
  };

  return (
    <div className="chat-step-wrap">
      <button type="button" className={cn("chat-step k-tool", seg.status === "run" && "run")} onClick={toggle} aria-expanded={!seg.collapsed}>
        {seg.status === "run" ? <Loader2 className="chat-step-icon spin" /> : seg.exitCode ? <TriangleAlert className="chat-step-icon err" /> : <Icon className="chat-step-icon" />}
        <span className="chat-step-label">{info.name}</span>
        {info.kind === "mcp" && <span className="chat-step-kind">MCP</span>}
        {info.kind === "skill" && <span className="chat-step-kind">SKILL</span>}
        {!!meta && <span className="chat-step-preview truncate mr-2">{meta}</span>}
        {dur && <span className={cn("chat-step-dur ml-auto font-mono text-[10px]", seg.status === "run" ? "text-[var(--color-cyanx)]" : "text-[var(--color-brandtext)]")}>{dur}</span>}
        {seg.status === "done" && seg.exitCode != null && seg.exitCode !== 0 && <span className="chat-step-exit ml-2">exit {seg.exitCode}</span>}
        {(seg.command || seg.argsText || seg.resultText) && (seg.collapsed ? <ChevronRight className="chat-step-chevron ml-2" /> : <ChevronDown className="chat-step-chevron ml-2" />)}
      </button>
      {!seg.collapsed && (
        <div className="chat-step-body">
          {info.kind === "terminal" ? (
            <div className="chat-term-block">
              {!!seg.command && <pre className="chat-term-cmd">$ {seg.command}</pre>}
              {!!seg.resultText && <pre className="chat-term-out" tabIndex={0}>{long ? seg.resultText.slice(0, 3000) + "\n…" : seg.resultText}</pre>}
            </div>
          ) : (
            <>
              {(info.input || seg.argsText) && (
                <div className="chat-io">
                  <p className="chat-io-label">{info.inputLabel || "INPUT"}</p>
                  <pre className="chat-term-args" tabIndex={0}>{info.input || seg.argsText}</pre>
                </div>
              )}
              {!!seg.resultText && (
                <div className="chat-io">
                  <p className="chat-io-label">OUTPUT{seg.exitCode != null && seg.exitCode !== 0 ? ` · exit ${seg.exitCode}` : ""}</p>
                  <div className="chat-term-block">
                    <pre className="chat-term-out" tabIndex={0}>{long ? seg.resultText.slice(0, 3000) + "\n…" : prettyPrint(seg.resultText)}</pre>
                    {long && (
                      <button type="button" className="chat-term-expand" onClick={toggle} title="Expand full output (Ctrl+O)">
                        Ctrl+O to expand
                      </button>
                    )}
                  </div>
                </div>
              )}
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

export function PdfCard({ path, name }: { path: string; name: string }) {
  const [expanded, setExpanded] = useState(false);
  const enc = encodeURIComponent(path);
  return (
    <div className="flex flex-col gap-2 w-full max-w-2xl overflow-hidden rounded-[var(--radius-inner)] border border-white/10 bg-[var(--surface-raised)] text-sm">
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-md bg-white/5 p-2 text-slate-300">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-slate-200">{name}</div>
            <div className="text-xs text-slate-400 font-mono">PDF Document</div>
          </div>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="shrink-0 rounded-[var(--radius-pill)] bg-[var(--surface-step-2)] px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-white/10"
        >
          {expanded ? "Collapse" : "View"}
        </button>
      </div>
      {expanded && (
        <div className="h-[480px] max-h-[70vh] w-full border-t border-white/10 bg-white">
          <iframe src={`/api/hx/files/download?path=${enc}`} className="h-full w-full border-none" title={name} />
        </div>
      )}
    </div>
  );
}

export function MediaCard({ path, name, onOpenImage }: { path: string; name: string; onOpenImage?: (url: string, alt: string) => void }) {
  const kind = getFileKind(name);
  const enc = encodeURIComponent(path);
  const url = `/api/hx/files/download?path=${enc}`;
  
  if (kind === "pdf") {
    return <PdfCard path={path} name={name} />;
  }
  
  if (kind === "audio") {
    return <AudioPlayer src={`/api/hx/files/stream?path=${enc}`} name={name} />;
  }

  return (
    <div data-media-card className="overflow-hidden rounded-[var(--radius-inner)] border border-white/10 bg-[var(--surface-raised)] text-xs text-slate-300">
      {kind === "image" ? (
        <button type="button" onClick={(e) => { e.preventDefault(); onOpenImage?.(url, name); }} title="Open full image" className="block cursor-zoom-in">
          <img src={url} alt={name} loading="lazy" className="max-h-44 max-w-[240px] object-cover" />
        </button>
      ) : kind === "video" ? (
        <div className="relative max-h-44 max-w-[280px] bg-black">
          <video src={`/api/hx/files/stream?path=${enc}`} controls preload="metadata" className="max-h-44 max-w-[280px]" poster="" />
        </div>
      ) : (
        <a href={url} target="_blank" rel="noreferrer"
           className="flex items-center gap-3 p-3 transition hover:bg-[var(--surface-step-2)]" title="Download">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-black/20 text-slate-400">
            <FileText className="h-3 w-3" />
          </div>
          <span className="truncate">{name}</span>
        </a>
      )}
      {(kind === "image" || kind === "video") && (
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <span className="truncate text-[10px] text-slate-500">{name}</span>
          <a href={`/api/hx/files/download?path=${enc}`} target="_blank" rel="noreferrer"
            className="shrink-0 font-mono text-[10px] text-cyanx hover:underline">download</a>
        </div>
      )}
    </div>
  );
}

function TextRow({ seg, onOpenImage }: { seg: Segment; onOpenImage?: (url: string, alt: string) => void }) {
  const text = seg.text ?? "";
  const instant = usePrefersReducedMotion();
  const n = useReveal(text, seg.status === "done", instant);
  const shown = useMemo(() => safeTail(text.slice(0, n)), [text, n]);
  const paths = useMemo(() => mediaPaths(text), [text]);
  const displayRaw = seg.status === "done" && n >= text.length ? text : shown;
  const display = useMemo(() => stripMediaLines(stripAstraFences(displayRaw)), [displayRaw]);
  
  const full = seg.status === "done" || n >= text.length;
  const plans = useMemo(() => full ? extractPlans(text) : [], [full, text]);
  const reports = useMemo(() => full ? extractReports(text) : [], [full, text]);
  const drafting = !full && hasOpenFence(text, "astra-plan");

  if (!text) return null;
  return (
    <div className="chat-text-seg">
      {display && <RichText text={display} onOpenImage={onOpenImage} streaming={seg.status === "run"} />}
      {!instant && (seg.status === "run" || n < text.length) && <span className="chat-caret" aria-hidden="true" />}
      {n >= text.length && paths.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {paths.map(p => <MediaCard key={p} path={p} name={p.split("/").pop() || p} onOpenImage={onOpenImage} />)}
        </div>
      )}
      {drafting && <div className="chat-plan-skeleton" role="status" aria-label="Drafting plan" />}
      {plans.map(p => <PlanCard key={p.id} plan={p} />)}
      {reports.map((r, i) => <ReportCard key={r.planId ?? i} report={r} />)}
    </div>
  );
}

const APPROVAL_LABELS: Record<string, string> = { once: "Approve once", session: "Allow this chat", always: "Always allow", deny: "Deny" };

// Generative-UI clarify card: renders the agent's question(s) as an interactive
// form. Design language: left-aligned document card (not an alert dialog) —
// eyebrow label, vertical choice rows with radio/checkbox affordances, quiet
// free-text line, single left-aligned submit. Single question → one group;
// batch → numbered groups; multi_select → checkbox rows.
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
    const answered = questions.length > 0
      ? questions.map((q, i) => ({ k: questions.length > 1 ? `Q${i + 1}` : "", v: seg.answers?.[q.qid || q.question] || "" }))
      : [];
    return (
      <div className="chat-clarify" role="status" aria-label="Question answered">
        <p className="chat-clarify-eyebrow">Answered</p>
        {answered.length > 0 ? (
          <dl className="chat-clarify-answer-list">
            {answered.map((a, i) => (
              <div key={i} className="chat-clarify-answer-row">
                {a.k && <dt className="chat-clarify-answer-key">{a.k}</dt>}
                <dd className="chat-clarify-answer-val">{a.v || "—"}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="chat-clarify-answer-val">{Object.values(seg.answers || {}).join(", ") || "Done"}</p>
        )}
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
    <div className="chat-clarify" role="form" aria-label="Astra has questions">
      <p className="chat-clarify-eyebrow">{questions.length > 1 ? `${questions.length} quick questions` : "Quick question"}</p>
      {questions.map((q, qi) => {
        const qid = q.qid || q.question;
        const picked = picks[qid] || [];
        const multi = !!q.multi_select;
        return (
          <fieldset key={qid} className="chat-clarify-q" style={{ ["--i" as any]: qi }}>
            <legend className="chat-clarify-question">{questions.length > 1 ? `${qi + 1}.  ` : ""}{q.question}</legend>
            <div className="chat-clarify-choices" role={multi ? "group" : "radiogroup"} aria-label={q.question}>
              {q.choices.map((c) => {
                const on = picked.includes(c);
                return (
                  <button key={c} type="button"
                    role={multi ? "checkbox" : "radio"}
                    aria-checked={on}
                    className={cn("chat-clarify-row", on && "selected")}
                    onClick={() => togglePick(qid, c, multi)}>
                    <span className={cn("chat-clarify-control", multi && "box")} aria-hidden="true">
                      {multi
                        ? (on && <Check className="h-3 w-3" strokeWidth={2.5} />)
                        : <span className="chat-clarify-dot" />}
                    </span>
                    <span className="chat-clarify-label">{c}</span>
                  </button>
                );
              })}
            </div>
            <input type="text" className="chat-clarify-free" placeholder="Or write your own…"
              value={freeText[qid] || ""} aria-label={`Custom answer for: ${q.question}`}
              onChange={(e) => setFreeText((prev) => ({ ...prev, [qid]: e.target.value }))} />
          </fieldset>
        );
      })}
      <div className="chat-clarify-actions">
        <button type="button" className="chat-clarify-submit" disabled={!allAnswered}
          onClick={() => {
            if (questions.length === 1 && !questions[0].qid) {
              onAnswer(seg.reqId!, { answer: answerFor(questions[0]) });
            } else {
              const answers: Record<string, string> = {};
              for (const q of questions) answers[q.qid || q.question] = answerFor(q);
              onAnswer(seg.reqId!, { answers });
            }
          }}>
          Answer
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

export function TurnTimeline({ segments, streaming, sessionId, onToggleTool, onApprovalRespond, onClarifyAnswer, onGateRespond, onOpenImage }: {
  segments: Segment[];
  streaming: boolean;
  sessionId: string | null;
  onToggleTool: (segId: string) => void;
  onApprovalRespond: (reqId: string, choice: string) => void;
  onClarifyAnswer: (reqId: string, result: { answer?: string; answers?: Record<string, string> }) => void;
  onGateRespond: (reqId: string, reply: any) => void;
  onOpenImage?: (url: string, alt: string) => void;
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
        if (seg.kind === "gate") return <GateCard key={seg.id} seg={seg} sessionId={sessionId} onRespond={onGateRespond} onOpenImage={onOpenImage} />;
        return <TextRow key={seg.id} seg={seg} onOpenImage={onOpenImage} />;
      })}
    </div>
  );
}
