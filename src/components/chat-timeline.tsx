// Chat turn renderer — reasoning bundle (elements-/chain-of-thought) + response.
// Per turn: ONE bundled card holds all thinking + tool rows (Radix Collapsible,
// 21st.dev elements- port); the response text follows outside the card.
// Owner mandates honored: everything initializes collapsed; a user-open persists
// via step-prefs; opened-state updates LIVE through controlled `open` state.

import { useEffect, useRef, useState, useMemo } from "react";
import { Check, Loader2, ShieldAlert, X, Clock } from "lucide-react";
import { cn } from "../lib/utils";
import { getFileKind } from "../lib/session-files";
import { AudioPlayer } from "./audio-player";
import { GateCard } from "./gates/gate-card";
import {
  AiToolCall,
  AiToolCallHeader,
  AiToolCallContent,
  AiToolCallInput,
  AiToolCallOutput,
  AiToolCallError,
} from "./ui/ai-tool-call";
import type { ToolCallState } from "./ui/ai-tool-call";

import type { Segment, ClarifyQuestion } from "../lib/chat-segments";
import {
  turnIsRunning,
} from "../lib/chat-segments";
import { MEDIA_RE, mediaPaths, stripMediaLines } from "../lib/media-paths";
import { AnimatedCopyButton } from "../lib/animated-copy";
import { revealCps } from "../lib/reveal-pace";

export type { SegKind, Segment, SegOp } from "../lib/chat-segments";
export {
  applySegmentOps,
  finalizeSegments,
  findNewestCollapsedToolSeg,
  expandKeyBlocked,
  turnIsRunning,
} from "../lib/chat-segments";
export { MEDIA_RE, mediaPaths, stripMediaLines };

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
    // One-time style injection for the DOM-built code copy buttons (they are
    // created imperatively below, outside React — same swap animation as the
    // React-side .chat-copy-swap buttons).
    if (!document.getElementById("chat-code-copy-style")) {
      const st = document.createElement("style");
      st.id = "chat-code-copy-style";
      st.textContent = `
.chat-code-copy { position:relative; overflow:hidden; }
.chat-code-copy .cc-swap { position:absolute; inset:0; }
.chat-code-copy .cc-swap svg { position:absolute; inset:0; width:100%; height:100%; transition:opacity 160ms ease, transform 160ms ease; }
.chat-code-copy .cc-swap svg.cc-check { opacity:0; transform:scale(.5) rotate(-45deg); }
.chat-code-copy.is-check .cc-swap svg.cc-copy { opacity:0; transform:scale(.5) rotate(45deg); }
.chat-code-copy.is-check .cc-swap svg.cc-check { opacity:1; transform:scale(1) rotate(0deg); color:#34d399; }
[data-theme="light"] .chat-code-copy.is-check .cc-swap svg.cc-check { color:#047857; }`;
      document.head.appendChild(st);
    }
    const pres = root.querySelectorAll("pre:not([data-cb])");
    pres.forEach((pre) => {
      pre.setAttribute("data-cb", "1");
      const btn = document.createElement("button");
      btn.className = "chat-code-copy";
      btn.innerHTML = `<span class="cc-swap" aria-hidden="true"><svg class="cc-copy" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><svg class="cc-check" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>`;
      btn.setAttribute("aria-label", "Copy code");
      btn.title = "Copy";
      btn.onclick = () => {
        void copyText(pre.textContent || "").then((ok) => {
          if (!ok) return;
          btn.classList.add("is-check");
          btn.title = "Copied";
          setTimeout(() => { btn.classList.remove("is-check"); btn.title = "Copy"; }, 2000);
        });
      };
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
      <AnimatedCopyButton sm className="!absolute top-2 right-2 z-10 !h-6 !w-6 opacity-0 group-hover:opacity-100 transition-opacity" text={text} />
      <div ref={containerRef} className="chat-md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

// ---- shared bits -----------------------------------------------------------

function formatDur(ms?: number) {
  if (ms == null) return null;
  // Max 2 decimals, locked (owner): raw Date.now() deltas carry float noise like
  // 177.98398282848ms — toFixed(2) then parseFloat drops trailing zeros (177 -> 177).
  if (ms < 1000) return `${parseFloat(ms.toFixed(2))}ms`;
  return `${parseFloat((ms / 1000).toFixed(2))}s`;
}

import { stepOpen, setStepOpen, hashKey } from "../lib/step-prefs";
import { describeTool } from "../lib/tool-identity";
import {
  FileText,
  Lightbulb,
} from "lucide-react";

// Stable per-step preference key. Tool steps: the provider tool_call id is
// stable across live and restored paths. Thinking steps: content hash (ids
// differ between live and restored renders for the same reasoning).
function stepPrefKey(seg: Segment): string {
  if (seg.kind === "tool" && seg.id && !seg.id.startsWith("orphan-") && !seg.id.startsWith("s")) return seg.id;
  if (seg.kind === "thinking") return `think:${hashKey((seg.text || "").slice(0, 400))}`;
  return seg.id;
}

// ---- ThoughtRow: ONE collapsible per thinking segment -----------------------
// Chronological rendering (owner mandate 2026-09-29): every segment renders in
// its arrival slot — no bundling, no regrouping. A thought streams OPEN, then
// auto-collapses the moment it finishes ("as soon as the thought is done, it
// collapses before the next activity"). User-open state persists via
// step-prefs (`think:<content-hash>` key, stable live/restored); an auto-
// collapse does NOT write the pref, so a user-opened thought stays open.
function ThoughtRow({ seg }: { seg: Segment }) {
  const prefKey = `think:${hashKey((seg.text || "").slice(0, 400))}`;
  const running = seg.status === "run";
  // Live-running thought streams OPEN; restored/done thought honors a persisted
  // user-open, else collapsed (owner: never re-open on reload).
  const [open, setOpen] = useState<boolean>(() =>
    running ? true : (stepOpen(prefKey) ?? false),
  );
  const keyRef = useRef(prefKey);
  useEffect(() => {
    keyRef.current = prefKey;
  }, [prefKey]);
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current && !running) {
      // Thought just finished → auto-collapse BEFORE the next activity lands
      // (owner mandate). Clear any pref written while it streamed so a reload
      // stays collapsed; a user click AFTER completion re-persists normally.
      setOpen(false);
      setStepOpen(keyRef.current, false);
    }
    wasRunning.current = running;
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    const next = !open;
    setOpen(next);
    setStepOpen(keyRef.current, next);
  };

  return (
    <AiToolCall
      name="Thinking"
      state={running ? "running" : "completed"}
      icon={<Lightbulb className="size-3.5" />}
      open={open}
      onOpenChange={(o) => { if (o !== open) toggle(); }}
      className="bg-transparent border-0 ai-thought"
    >
      <AiToolCallHeader>
        {seg.durationMs != null && (
          <span className="chat-step-dur ml-1 shrink-0 font-mono text-[10px] text-[var(--color-brandtext)]">
            {formatDur(seg.durationMs)}
          </span>
        )}
      </AiToolCallHeader>
      <AiToolCallContent>
        <div className="chat-think-text whitespace-pre-wrap">{seg.text}</div>
      </AiToolCallContent>
    </AiToolCall>
  );
}

// ---- standalone tool row: elements-/tool-call card (arrival slot) -----------

function BundleToolRow({ seg, onToggleTool }: { seg: Segment; onToggleTool: (segId: string) => void }) {
  const info = describeTool(seg.label, seg.argsText, seg.command);
  const prefKey = stepPrefKey(seg);
  const meta = (info.kind === "terminal" ? (seg.command || info.meta) : info.meta)?.replace(/\s+/g, " ").slice(0, 110);
  const long = (seg.resultText?.length || 0) > 3000;

  // Controlled open, initialized from the persisted per-tool pref (collapsed
  // default). LIVE updates + persist on toggle, same contract as the bundle.
  const [open, setOpen] = useState<boolean>(() => stepOpen(prefKey) ?? false);
  const keyRef = useRef(prefKey);
  useEffect(() => {
    keyRef.current = prefKey;
  }, [prefKey]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    setStepOpen(keyRef.current, next);
    onToggleTool(seg.id); // keep chat-landing's message-state toggle in sync
  };

  const dur = formatDur(seg.durationMs);
  let state: ToolCallState;
  if (seg.status === "run") state = "running";
  else if (seg.exitCode != null && seg.exitCode !== 0) state = "error";
  else state = "completed";

  let parsedInput: Record<string, unknown> | undefined;
  try {
    const v = JSON.parse(seg.argsText || "");
    if (v && typeof v === "object" && !Array.isArray(v)) parsedInput = v;
  } catch { /* non-JSON args → render raw */ }

  return (
    <AiToolCall
      name={info.name}
      state={state}
      open={open}
      onOpenChange={(o) => { if (o !== open) toggle(); }}
      className="bg-transparent border-0"
    >
      <AiToolCallHeader>
        {info.kind === "mcp" && <span className="chat-step-kind">MCP</span>}
        {info.kind === "skill" && <span className="chat-step-kind">SKILL</span>}
        {!!meta && <span className="chat-step-preview truncate">{meta}</span>}
        {dur && <span className={cn("chat-step-dur ml-1 shrink-0 font-mono text-[10px]", seg.status === "run" ? "text-cyanx" : "text-[var(--color-brandtext)]")}>{dur}</span>}
        {seg.status === "done" && seg.exitCode != null && seg.exitCode !== 0 && <span className="chat-step-exit">exit {seg.exitCode}</span>}
      </AiToolCallHeader>
      <AiToolCallContent>
        {info.kind === "terminal" ? (
          <div className="chat-term-block">
            {!!seg.command && <pre className="chat-term-cmd">$ {seg.command}</pre>}
            {!!seg.resultText && <pre className="chat-term-out" tabIndex={0}>{long ? seg.resultText.slice(0, 3000) + "\n…" : seg.resultText}</pre>}
          </div>
        ) : (
          <>
            {(info.input || seg.argsText) && (
              <AiToolCallInput input={parsedInput ?? { raw: info.input || seg.argsText }} />
            )}
            {!!seg.resultText && (
              <AiToolCallOutput>
                <pre className="chat-term-out" tabIndex={0}>{long ? seg.resultText.slice(0, 3000) + "\n…" : prettyPrint(seg.resultText)}</pre>
                {long && (
                  <button type="button" className="chat-term-expand" onClick={() => { if (!open) toggle(); }} title="Expand full output (Ctrl+O)">
                    Ctrl+O to expand
                  </button>
                )}
              </AiToolCallOutput>
            )}
          </>
        )}
      </AiToolCallContent>
      {seg.exitCode != null && seg.exitCode !== 0 && seg.status !== "run" && (
        <AiToolCallError error={`exit ${seg.exitCode}`} />
      )}
    </AiToolCall>
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

// SLOW REVEAL (2026-09-26): calm reading pace. Base 40-52 cps (2.5x slower than
// the original 120-160) with smooth ±20% human wobble. A burst that parks a
// big backlog catches up at backlog/0.6s capped at 240 cps so catch-up stays
// visibly animated. OWNER DIRECTIVE (2026-09-29, supersedes the old
// "never animate settled text" rule): text ALWAYS flows, never lands as a
// single block — when a turn completes with buffer remaining, the reveal
// continues at the drain pace (revealCps done branch, <2s) instead of
// snapping, and a segment that mounts already finished (history restore,
// reload) sweeps in the same fast way. Reduced-motion users still get
// instant text (accessibility, not a snap path).
function useReveal(text: string, done: boolean, instant: boolean) {
  const [n, setN] = useState(0);
  const nRef = useRef(n), tRef = useRef(0);
  useEffect(() => {
    if (instant) { nRef.current = text.length; setN(text.length); return; }
    if (nRef.current >= text.length) return;
    let id = 0;
    const tick = () => {
      const now = performance.now();
      if (!tRef.current) tRef.current = now - 16;
      const dt = Math.min(now - tRef.current, 250) / 1000; // cap tab-sleep jumps
      tRef.current = now;
      const back = text.length - nRef.current;
      const cps = revealCps(back, done, now);
      nRef.current = Math.min(text.length, nRef.current + cps * dt);
      setN(Math.floor(nRef.current));
      if (nRef.current < text.length) id = window.setTimeout(tick, done ? 48 : 16);
    };
    id = window.setTimeout(tick, done ? 48 : 16);
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

function TextRow({ seg, reveal, onOpenImage }: { seg: Segment; reveal?: boolean; onOpenImage?: (url: string, alt: string) => void }) {
  const text = seg.text ?? "";
  const instant = usePrefersReducedMotion();
  // Only the timeline's LAST text segment (the latest response) sweeps on
  // mount; every older row renders whole inside its turn's fade-in. A live
  // turn's own rows mount at ~0 chars and grow, so this only bites
  // history/reload restores — exactly the "latest streams, rest fade" ask.
  const n = useReveal(text, seg.status === "done", instant || reveal === false);
  const shown = useMemo(() => safeTail(text.slice(0, n)), [text, n]);
  const paths = useMemo(() => mediaPaths(text), [text]);
  const displayRaw = seg.status === "done" && n >= text.length ? text : shown;
  const display = useMemo(() => stripMediaLines(displayRaw), [displayRaw]);

  if (!text) return null;
  return (
    <div className="chat-text-seg">
      {display && <RichText text={display} onOpenImage={onOpenImage} streaming={seg.status === "run"} />}
      {n >= text.length && paths.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {paths.map(p => <MediaCard key={p} path={p} name={p.split("/").pop() || p} onOpenImage={onOpenImage} />)}
        </div>
      )}
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

const APPROVAL_RECEIPT: Record<string, { label: string; tone: "ok" | "no" | "idle" }> = {
  once: { label: "Approved once", tone: "ok" },
  session: { label: "Allowed for this chat", tone: "ok" },
  always: { label: "Always allowed", tone: "ok" },
  deny: { label: "Denied", tone: "no" },
  answered: { label: "Answered on another device", tone: "ok" },
  cancelled: { label: "Request withdrawn", tone: "idle" },
};

function ApprovalRow({ seg, onRespond }: { seg: Segment; onRespond: (reqId: string, choice: string) => void }) {
  const p = seg.params || {};
  const choices = p.choices?.length ? p.choices : ["once", "deny"];
  const isCommandApproval = !!p.command;
  const eyebrow = isCommandApproval ? "Approval needed" : (p.description ? "Choice required" : "Clarify");
  const title = p.description || (isCommandApproval ? "Astra wants to run a command" : "Select an option to continue.");
  const [picked, setPicked] = useState<string | null>(null);
  const resolved = seg.resolved ?? null;
  const receipt = resolved ? (APPROVAL_RECEIPT[resolved] || { label: `Resolved: ${APPROVAL_LABELS[resolved] || resolved}`, tone: "ok" as const }) : null;
  const state = resolved ? (receipt!.tone === "no" ? "denied" : receipt!.tone === "idle" ? "withdrawn" : "approved") : picked ? "sending" : "pending";
  // 1..9 picks a choice — only while this is the single pending approval and the
  // user is not typing somewhere (composer, inputs), so it never hijacks text entry.
  useEffect(() => {
    if (resolved || picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const idx = Number(e.key) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= choices.length) return;
      if (document.querySelectorAll('.gate-approval[data-state="pending"]').length !== 1) return;
      e.preventDefault();
      setPicked(choices[idx]);
      onRespond(seg.reqId!, choices[idx]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resolved, picked, choices, onRespond, seg.reqId]);

  const Icon = state === "approved" ? Check : state === "denied" ? X : state === "withdrawn" ? Clock : ShieldAlert;

  return (
    <div id={`chat-approval-${seg.reqId}`} className="gate-approval" data-state={state}
      role={resolved ? "status" : "alertdialog"} aria-live={resolved ? "polite" : undefined}
      aria-label={isCommandApproval ? "Command approval" : "Choice / Clarify"}>
      <span className="ga-rail" aria-hidden="true" />
      <div className="ga-head">
        <span className="ga-icon" aria-hidden="true"><Icon size={15} strokeWidth={2.4} /></span>
        <div className="ga-headtext">
          <p className="ga-eyebrow">{resolved ? "Approval" : eyebrow}</p>
          <p className="ga-title">{resolved ? receipt!.label : title}</p>
        </div>
        {!resolved && <span className="ga-live" aria-hidden="true"><i />Waiting</span>}
      </div>

      {!!p.command && (
        <pre className="ga-cmd" tabIndex={0}><span className="ga-prompt" aria-hidden="true">$</span>{p.command}</pre>
      )}
      {resolved && p.description && <p className="ga-sub">{p.description}</p>}

      {/* actions collapse smoothly into the receipt once resolved */}
      <div className="ga-collapse" data-open={String(!resolved)}>
        <div className="ga-collapse-inner">
          <div className="ga-actions">
            {choices.map((c: string, i: number) => (
              <button key={c} type="button" disabled={!!picked}
                className={cn("ga-btn", c === "deny" && "deny", c === "once" && "primary", picked === c && "is-sending")}
                onClick={() => { setPicked(c); onRespond(seg.reqId!, c); }}>
                <kbd className="ga-key" aria-hidden="true">{i + 1}</kbd>
                <span>{APPROVAL_LABELS[c] || c}</span>
                {picked === c && <Loader2 size={13} className="ga-spin" aria-hidden="true" />}
              </button>
            ))}
          </div>
          <p className="ga-foot">Turn paused until you decide · press a number key</p>
        </div>
      </div>
    </div>
  );
}

// ---- turn container --------------------------------------------------------
// Chronological (owner mandate 2026-09-29): every segment renders in its own
// arrival slot — Thought - Tool Call - Response interleave exactly as the model
// emitted them. Interactions (approval / clarify / gate) land in their slot too,
// never displaced. Each thought is its own collapsible (streams open, collapses
// when done); tool rows keep the persisted per-tool collapse.
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

  const isRunning = turnIsRunning(segments, streaming);
  // Reveal policy: only the last segment sweeps (latest response). Everything
  // earlier renders whole; each turn's own 200ms fade supplies the motion.
  const lastIdx = segments.length - 1;

  return (
    <div className={cn("chat-turn", isRunning && "running")} aria-busy={isRunning}>
      {segments.map((seg, i) => {
        const reveal = i === lastIdx;
        if (seg.kind === "thinking") return <ThoughtRow key={seg.id} seg={seg} />;
        if (seg.kind === "tool") return <BundleToolRow key={seg.id} seg={seg} onToggleTool={onToggleTool} />;
        if (seg.kind === "approval") return <ApprovalRow key={seg.id} seg={seg} onRespond={onApprovalRespond} />;
        if (seg.kind === "clarify") return <ClarifyCard key={seg.id} seg={seg} onAnswer={onClarifyAnswer} />;
        if (seg.kind === "gate") return <GateCard key={seg.id} seg={seg} sessionId={sessionId} onRespond={onGateRespond} onOpenImage={onOpenImage} />;
        return <TextRow key={seg.id} seg={seg} reveal={reveal} onOpenImage={onOpenImage} />;
      })}
    </div>
  );
}
