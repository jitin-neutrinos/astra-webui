// Chat turn renderer — reasoning bundle (elements-/chain-of-thought) + response.
// Per turn: ONE bundled card holds all thinking + tool rows (Radix Collapsible,
// 21st.dev elements- port); the response text follows outside the card.
// Owner mandates honored: everything initializes collapsed; a user-open persists
// via step-prefs; opened-state updates LIVE through controlled `open` state.

import { useEffect, useRef, useState, useMemo, memo } from "react";
import type { ReactNode } from "react";
import { Check, Loader2, ShieldAlert, X, Clock } from "lucide-react";
import { cn } from "../lib/utils";
import { GateCard } from "./gates/gate-card";
import { MediaGrid } from "./media-grid";
import {
  AiToolCall,
  AiToolCallHeader,
  AiToolCallContent,
  AiToolCallInput,
  AiToolCallOutput,
  AiToolCallError,
  AiToolCallFields,
  TerminalWindow,
} from "./ui/ai-tool-call";
import type { ToolCallState } from "./ui/ai-tool-call";

import type { Segment, ClarifyQuestion } from "../lib/chat-segments";
import {
  turnIsRunning,
} from "../lib/chat-segments";
import { MEDIA_RE, mediaPaths, mediaPathsSpaced, stripMediaLines, toItem, pathFromApiUrl, type MediaItem } from "../lib/media-paths";
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

import DOMPurify from "dompurify";
import { renderRichHtml } from "../lib/rich-html";
import { splitCanvasBlocks, splitCanvasBlocksAsync, planTurnCanvases, parseStreamingCanvas, type CanvasSpec, type CanvasBlock, type CanvasPart } from "../lib/canvas-schema";
import { wireCodeCopyButtons } from "../lib/rich-pre";
import { safeTail } from "../lib/safe-tail";
import { copyText } from "../lib/copy-text";
import { lazy, Suspense, useId } from "react";

// Canvas chunk (recharts + block renderers) loads only when a message
// actually carries a valid canvas — the main bundle never pays for it.
//
// A rejected dynamic import does NOT reach an error boundary: the rejection is async, so
// nothing throws during render, Suspense shows its fallback forever, and the card is
// silently blank. That is exactly the "canvas not loading" symptom, and it is what a tab
// loaded BEFORE a deploy sees when it asks for rotated chunk hashes. So the guard lives
// HERE, on the promise, where the failure is observable.
const CanvasView = lazy(() =>
  import("./canvas/canvas-view").catch((err) => {
    if (isStaleChunkError(err)) reloadOnce();
    throw err;
  }),
);
import { CanvasErrorBoundary, isStaleChunkError, reloadOnce } from "./canvas/canvas-error-boundary";
import { sanitizeCanvasSpec } from "../lib/canvas-sanitize";

function CanvasHost({ spec, partial, id }: { spec?: CanvasSpec; partial?: { title?: string; blocks: CanvasBlock[] }; id: string }) {
  // Sanitize spec before rendering: strip invalid blocks, normalize enums, cap lengths.
  const safeSpec = spec ? sanitizeCanvasSpec(spec) : undefined;
    // The boundary (NOT Suspense) is the outer shell: a lazy chunk that fails to resolve or a render that
  // throws lands in the placeholder instead of unmounting the whole page (white-screen-of-death bug).
  return (
    <CanvasErrorBoundary id={id}>
      <Suspense fallback={<div className="ast-canvas ast-canvas-loading" aria-busy="true" />}>
        <CanvasView spec={safeSpec ?? undefined} partial={partial} canvasId={id} />
      </Suspense>
    </CanvasErrorBoundary>
  );
}

let purifyHooked = false;

/** One markdown block, memoized on its own source string (perf audit R5).
 *
 *  THIS is the whole point of the change: during streaming only the LAST block's
 *  source changes, so only that block re-parses. Every completed block is
 *  memoized by value and never touches marked/DOMPurify again — turning the
 *  previous "re-parse the entire reply on every token" (O(n²)) into O(1) work
 *  per delta.
 *
 *  Sanitization is unchanged: renderRichHtml sanitizes every block individually,
 *  which is exactly what the single-blob path did for the same input. Splitting
 *  cannot weaken it because the splitter only cuts at block boundaries — the
 *  concatenation is byte-identical (asserted in rich-blocks.check.ts).
 *
 *  `streaming` is passed false per block on purpose: renderRichHtml's
 *  odd-fence-closing hack targets the single trailing open fence, which is a
 *  whole-document concern. The container-level html below still owns it. */
const RichBlockView = memo(function RichBlockView({ source }: { source: string }) {
  const html = useMemo(() => renderRichHtml(source, false), [source]);
  return <div className="chat-md" dangerouslySetInnerHTML={{ __html: html }} />;
});

import { splitRichBlocks } from "../lib/rich-blocks";
import { withholdOpenCanvasFence } from "../lib/canvas-reveal";

export function RichText({ text, onOpenMedia, streaming }: { text: string; onOpenMedia?: (items: MediaItem[], index: number) => void; streaming?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Stable per-instance id, namespaced into every canvas block's fullscreen key.
  // useId (not an index) because the fullscreen host is a SINGLETON: two cards
  // from different messages must never resolve to the same slot key.
  const uid = useId();
  // Canvas parts split out of the raw text; markdown keeps everything else
  // (invalid/streaming fences stay inside the md flow, fail-soft).
  // Sync split first (tiers 1-2) so a well-formed card paints on the very first
  // frame. Then, once the text settles, retry any fence that failed with the
  // async tier — which is the only path that pulls the repair library in, so a
  // chat with no canvas never loads it.
  const [parts, setParts] = useState<CanvasPart[]>(() => splitCanvasBlocks(text, streaming));
  // Hoisted (L4 needs them): how many astra-canvas fences the text declares, and
  // how many the sync tiers actually rendered. A gap means a fence the parser
  // could not read — the only situation that may pull in the repair library.
  const openers = (text.match(/`{3,}astra-canvas/g) || []).length;
  const rendered = parts.filter((p) => p.kind === "canvas").length;
  useEffect(() => {
    const sync = splitCanvasBlocks(text, streaming);
    setParts(sync);
    let alive = true;
    if (streaming || text.length === 0) return;
    // Only pay for the async retry when a fence exists that the sync tiers
    // failed to render. Counting openers against rendered cards (rather than
    // calling hasCanvas) is what makes this precise: hasCanvas is the lazy
    // chunk's mount gate and is false for exactly the cards we want rescued, but
    // it is also false for prose that merely MENTIONS the fence, which would
    // load the repair library on chats that never needed it.
    if (openers <= rendered) return;
    void splitCanvasBlocksAsync(text, streaming).then((rescued) => {
      if (alive && rescued.filter((p) => p.kind === "canvas").length > rendered) setParts(rescued);
    });
    return () => { alive = false; };
  }, [text, streaming]);

  // L4 (2026-10-05) — give a stream that never reported `done` one debounced
  // second chance.
  //
  // The rescue above is gated on `!streaming` (the line above), which is right:
  // running it per frame would load the repair library on every live reply. But
  // a turn whose `text-final` never arrives used to stay streaming forever, so
  // the rescue never ran and a slightly-malformed canvas fence stayed as raw
  // code until a reload. L3 closes those turns, and this is the belt to that
  // braces: after the text stops changing, retry once even while `streaming` is
  // still true.
  //
  // Debounced, so a burst of deltas costs one retry, not one per frame — the
  // repair library is only pulled in for a message that has a fence the sync
  // tiers could not read AND has stopped moving.
  useEffect(() => {
    if (openers > rendered && text.length > 0) {
      const t = window.setTimeout(() => {
        void splitCanvasBlocksAsync(text, streaming).then((rescued) => {
          setParts((prev) =>
            rescued.filter((p) => p.kind === "canvas").length >
            prev.filter((p) => p.kind === "canvas").length
              ? rescued
              : prev,
          );
        });
      }, 900);
      return () => window.clearTimeout(t);
    }
  }, [text, streaming, openers, rendered]);
  const plainText = useMemo(() => parts.filter((p) => p.kind === "md").map((p) => (p as { text: string }).text).join(""), [parts]);
  // R5: per-block split. Each block memoizes on its own source, so streaming
  // re-parses only the tail instead of the whole reply. Returns null whenever
  // the split can't be proven lossless, and we fall back to the single-blob
  // render below — which is the exact pre-change behavior.
  const blocks = useMemo(() => splitRichBlocks(plainText), [plainText]);
  // R5 CRITICAL: the whole-blob render is only needed when the split FAILED.
  // Computing it unconditionally would re-parse the entire reply on every delta
  // — precisely the O(n²) cost this change exists to remove. So the memo body
  // short-circuits whenever blocks exist.
  const html = useMemo(() => {
    if (blocks) return ""; // block path renders; nothing to pre-parse
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

    return renderRichHtml(plainText, streaming);
  }, [plainText, streaming]);

  // Blocks joined into one string, used ONLY as an effect dependency so the
  // copy-button + image-lightbox wiring re-runs whenever any block changes.
  // Not used for rendering when `blocks` is non-null.
  const blockSig = blocks ? blocks.map((b) => b.source).join("") : html;

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    wireCodeCopyButtons(root, copyText);

    const imgs = root.querySelectorAll("img:not([data-lb])");
    imgs.forEach((el) => {
      const img = el as HTMLImageElement;
      img.setAttribute("data-lb", "1");
      img.classList.add("cursor-zoom-in");
      img.addEventListener("click", (e) => {
        e.preventDefault();
        onOpenMedia?.([{ path: pathFromApiUrl(img.src), url: img.src, name: img.alt || "image" }], 0);
      });
    });
  }, [blockSig, onOpenMedia]);

  const hasCanvas = parts.some((p) => p.kind === "canvas");

  if (!hasCanvas) {
    // Fast path: exactly the pre-canvas render (copy button + one md region).
    // R5: when the split is lossless, render memoized blocks so streaming only
    // re-parses the tail. Otherwise fall back to the single html blob.
    return (
      <div className="relative group" ref={containerRef}>
        <AnimatedCopyButton sm className="!absolute top-2 right-2 z-10 !h-6 !w-6 opacity-0 group-hover:opacity-100 transition-opacity" text={text} />
        {blocks
          ? blocks.map((b, i) => <RichBlockView key={i} source={b.source} />)
          : <div className="chat-md" dangerouslySetInnerHTML={{ __html: html }} />}
      </div>
    );
  }

  // Canvas path: render parts in chronological order; all md parts share the
  // outer ref so copy-buttons/image-lightbox wiring covers every md chunk.
  return (
    <div className="relative group" ref={containerRef}>
      <AnimatedCopyButton sm className="!absolute top-2 right-2 z-10 !h-6 !w-6 opacity-0 group-hover:opacity-100 transition-opacity" text={text} />
      {parts.map((p, i) =>
        p.kind === "canvas"
          ? <CanvasHost key={`cv${i}`} spec={p.spec} id={`${uid}-${i}`} />
          : <div key={`md${i}`} className="chat-md" dangerouslySetInnerHTML={{ __html: renderRichHtml(p.text, streaming) }} />
      )}
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
import { describeInput, describeOutput } from "../lib/tool-io";
import { unwrapToolEnvelope } from "../lib/term-format";
import {
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

  // Capped scroll region: ALWAYS show the newest stream — jump to the bottom on
  // every text tick and when the row opens, and keep following while streaming
  // UNLESS the reader deliberately scrolled up (then leave their position alone).
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onScroll = () => {
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const el = bodyRef.current;
    if (!running || !el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [seg.text, running, open]);

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
          <span className="chat-step-dur shrink-0 font-mono text-[10px] text-[var(--color-brandtext)]">
            {formatDur(seg.durationMs)}
          </span>
        )}
      </AiToolCallHeader>
      <AiToolCallContent>
        <div ref={bodyRef} className="chat-think-text whitespace-pre-wrap">{seg.text}</div>
      </AiToolCallContent>
    </AiToolCall>
  );
}

// ---- standalone tool row: elements-/tool-call card (arrival slot) -----------

function BundleToolRow({ seg, onToggleTool }: { seg: Segment; onToggleTool: (segId: string) => void }) {
  const info = describeTool(seg.label, seg.argsText, seg.command, seg.resultText);
  const prefKey = stepPrefKey(seg);
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

  // Human-readable fields (owner 2026-09-29): labeled rows, not raw JSON.
  //
  // Tool results are PERSISTED as a JSON envelope (`{"output": "...", "exit_code": 0}`), and
  // describing it raw produced an `Output` field whose value was the payload itself — while the
  // TerminalWindow BELOW rendered the very same text again. That is the "output is duplicated
  // 2-3 times" report (owner, 2026-10-03/04), and it is why it varied: how many fields the
  // envelope yielded decided how many times the text appeared. Unwrap FIRST, so the fields and
  // the window describe the same real output exactly once between them.
  const inFields = describeInput(seg.label, seg.argsText, info.kind === "terminal" ? seg.command : undefined);
  const unwrapped = unwrapToolEnvelope(seg.resultText || "");
  const outFields = describeOutput(seg.label, unwrapped.text);

  return (
    <AiToolCall
      name={info.name}
      state={state}
      kind={info.kind}
      title={info.title}
      detail={info.detail}
      open={open}
      onOpenChange={(o) => { if (o !== open) toggle(); }}
      className="bg-transparent border-0"
    >
      <AiToolCallHeader>
        {info.kind === "mcp" && <span className="chat-step-kind">MCP</span>}
        {info.kind === "skill" && <span className="chat-step-kind">SKILL</span>}
        {info.kind === "browser" && <span className="chat-step-kind">WEB</span>}
        {dur && <span className={cn("chat-step-dur shrink-0 font-mono text-[10px]", seg.status === "run" ? "text-accent" : "text-[var(--color-brandtext)]")}>{dur}</span>}
        {seg.status === "done" && seg.exitCode != null && seg.exitCode !== 0 && <span className="chat-step-exit">exit {seg.exitCode}</span>}
      </AiToolCallHeader>
      <AiToolCallContent>
        {info.kind === "terminal" ? (
          <TerminalWindow
            title={info.kind === "terminal" ? "shell" : undefined}
            // Pass the RAW result: formatTerminal sanitizes and humanizes it. No pre-truncation
            // here — the formatter truncates the MIDDLE (head+tail), which reads far better than
            // chopping the tail, and it reports how many lines it dropped.
            text={[seg.command ? `$ ${seg.command}` : "", seg.resultText || ""].filter(Boolean).join("\n\n")}
            maxHeight="420px"
            exitCode={seg.exitCode}
            status={state}
          />
        ) : (
          <>
            <AiToolCallInput input={{ __fields: inFields }} />
            {!!seg.resultText && (
              <AiToolCallOutput>
                <AiToolCallFields label="Output" fields={outFields} />
                {outFields.length === 0 && long && (
                  <TerminalWindow title="output" text={seg.resultText!.slice(0, 3000) + "\n…"} maxHeight="420px" />
                )}
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
      if (nRef.current < text.length) id = window.setTimeout(tick, done ? 48 : 100);
    };
    id = window.setTimeout(tick, done ? 48 : 100);
    return () => window.clearTimeout(id);
  }, [text, done, instant]);
  return instant ? text.length : Math.min(n, text.length);
}

function TextRow({ seg, reveal, onOpenMedia, mdOverride, canvases, liveCanvas, live }: {
  seg: Segment;
  reveal?: boolean;
  onOpenMedia?: (items: MediaItem[], index: number) => void;
  /** Turn-level canvas plan: this segment's markdown with fences already removed. */
  mdOverride?: string;
  /** Canvases anchored to this segment (parsed from the WHOLE turn). */
  canvases?: CanvasSpec[];
  /** Incremental blocks of a canvas still being streamed (painted as they land). */
  liveCanvas?: { title?: string; blocks: CanvasBlock[] } | null;
  /** True when this is the segment currently being streamed into. */
  live?: boolean;
}) {
  const raw = seg.text ?? "";
  // Stable per-row id → namespaced into each canvas block's fullscreen key. The
  // fullscreen host is a singleton, so ids must be unique page-wide, not per row.
  const uid = useId();
  // When the turn planner ran, reveal the STRIPPED markdown (canvas JSON must
  // never be swept in character by character — it renders as a block instead).
  const text = mdOverride !== undefined ? mdOverride : raw;
  const instant = usePrefersReducedMotion();
  // Only the timeline's LAST text segment (the latest response) sweeps on
  // mount; every older row renders whole inside its turn's fade-in. A live
  // turn's own rows mount at ~0 chars and grow, so this only bites
  // history/reload restores — exactly the "latest streams, rest fade" ask.
  const n = useReveal(text, seg.status === "done", instant || reveal === false);
  const shown = useMemo(() => safeTail(text.slice(0, n)), [text, n]);
  // L2: drop a partially-revealed canvas fence so no half-fence is ever handed
  // to the renderer. A DONE segment keeps the full text (the fence is whole).
  const shownSafe = useMemo(() => withholdOpenCanvasFence(text, shown), [text, shown]);
  const paths = useMemo(() => mediaPathsSpaced(text), [text]);
  // A DONE segment always renders its FULL text. The old `n >= text.length` gate
  // meant a sweep that never finished — killed by a backgrounded WebView timer,
  // a Stop, or a dropped socket — left the message permanently TRUNCATED, so
  // trailing markdown (`**bold`, a list) never closed and rendered as literal
  // asterisks. Correct markdown beats a tidy sweep: sweeping is a live-only nicety.
  const isDone = seg.status === "done";
  const fullyRevealed = n >= text.length;
  const displayRaw = isDone ? text : shownSafe;
  const display = useMemo(() => stripMediaLines(displayRaw), [displayRaw]);

  if (!text && !canvases?.length && !liveCanvas) return null;
  return (
    <div className="chat-text-seg">
      {display && <RichText text={display} onOpenMedia={onOpenMedia} streaming={seg.status === "run"} />}
      {/* Canvases anchored here by the turn planner render after this segment's prose. */}
      {canvases?.map((spec, i) => <CanvasHost key={`cv${i}`} spec={spec} id={`${uid}-a${i}`} />)}
      {/* LIVE canvas: blocks paint the moment each one completes mid-stream. */}
      {live && liveCanvas && <CanvasHost partial={liveCanvas} id={`${uid}-live`} />}
      {(fullyRevealed || isDone) && paths.length > 0 && (
        <MediaGrid className="mt-2" items={paths.map((p) => toItem(p))} onOpen={onOpenMedia} />
      )}
    </div>
  );
}

const APPROVAL_LABELS: Record<string, string> = { once: "Allow once", session: "Allow for this chat", deny: "Deny" };

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
  once: { label: "Approval sent", tone: "ok" },
  session: { label: "Approval sent · allowed for this chat", tone: "ok" },
  always: { label: "Always allowed", tone: "ok" },
  deny: { label: "Denied — Astra won't run it", tone: "no" },
  answered: { label: "Answered on another device", tone: "ok" },
  cancelled: { label: "Request withdrawn", tone: "idle" },
};

function ApprovalRow({ seg, onRespond }: { seg: Segment; onRespond: (reqId: string, choice: string) => void }) {
  const p = seg.params || {};
  // Owner order 2026-10-02: no "Always allow" anywhere — the scope ladder tops
  // out at per-chat. Filter at render so a host that still sends "always" never
  // surfaces it; a legacy already-resolved "always" keeps its receipt readable.
  const choices = (p.choices?.length ? p.choices : ["once", "deny"]).filter((c: string) => c !== "always");
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
        {/* owner 2026-10-02: waiting pill removed — the command itself + eyebrow carry state */}
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
export const TurnTimeline = memo(function TurnTimeline({ segments, streaming, sessionId, ts, onToggleTool, onApprovalRespond, onClarifyAnswer, onGateRespond, onOpenMedia, actions }: {
  segments: Segment[];
  streaming: boolean;
  sessionId: string | null;
  ts?: number;
  onToggleTool: (segId: string) => void;
  onApprovalRespond: (reqId: string, choice: string) => void;
  onClarifyAnswer: (reqId: string, result: { answer?: string; answers?: Record<string, string> }) => void;
  onGateRespond: (reqId: string, reply: any) => void;
  onOpenMedia?: (items: MediaItem[], index: number) => void;
  /** Action row docked INSIDE the bubble's bottom-right (owner 10-02). */
  actions?: ReactNode;
}) {
  const isRunning = turnIsRunning(segments, streaming);
    // Reveal policy: only the last segment sweeps (latest response). Everything
    // earlier renders whole; each turn's own 200ms fade supplies the motion.
    const lastIdx = segments.length - 1;

    // Canvas planning is TURN-level, never per-segment: the segment engine splits
    // one assistant message across several text segments (tool calls, message
    // boundaries, non-extending `text-final`), and a fence spanning a boundary
    // cannot parse from either half. Stitch, parse, then hand each canvas back to
    // the segment where it COMPLETES so it still renders in place.
    const canvasPlan = useMemo(() => {
      const textIdx: number[] = [];
      segments.forEach((s, i) => { if (s.kind === "text") textIdx.push(i); });
      const plan = planTurnCanvases(textIdx.map((i) => segments[i].text || ""), streaming && isRunning);
      const bySeg = new Map<number, CanvasSpec[]>();
      for (const c of plan.canvases) {
        // translate "index within text segments" back to the real segment index
        const real = textIdx[c.afterSeg];
        if (real == null) continue;
        if (!bySeg.has(real)) bySeg.set(real, []);
        bySeg.get(real)!.push(c.spec);
      }
      const mdFor = new Map<number, string>();
      textIdx.forEach((real, k) => mdFor.set(real, plan.mdPerSeg[k] ?? ""));

      // LIVE incremental canvas: while the turn is streaming, a fence that is
      // still open at the tail has its COMPLETED blocks painted immediately, so
      // the user watches the card build instead of waiting for the closing fence.
      // The moment the fence closes, the turn planner takes over and the final
      // spec replaces this provisional one (same position, no flash).
      let liveCanvas: { title?: string; blocks: CanvasBlock[] } | null = null;
      if (streaming && isRunning) {
        const tailIdx = textIdx[textIdx.length - 1];
        if (tailIdx != null && !bySeg.has(tailIdx)) {
          const tailText = mdFor.get(tailIdx) ?? "";
          liveCanvas = parseStreamingCanvas(tailText);
          if (liveCanvas) {
            // strip the partial fence from the markdown so raw JSON never shows
            const open = tailText.lastIndexOf("```astra-canvas");
            if (open !== -1) mdFor.set(tailIdx, tailText.slice(0, open));
          }
        }
      }

      return { bySeg, mdFor, liveCanvas, liveSeg: textIdx[textIdx.length - 1] };
      }, [segments, streaming, isRunning]);

    // Guard AFTER the hooks: an early return above them changes the hook count between
    // renders (react-hooks/rules-of-hooks). Behaviour is identical — an empty turn still
    // renders nothing — and the memo above is free on an empty segment list.
    if (!segments.length) return null;

    return (
      <div className={cn("chat-turn", isRunning && "running")} aria-busy={isRunning}>
        <div className="chat-turn-head">
          <img src="/astra-logo.png" alt="" aria-hidden="true" className="chat-turn-logo" />
          {ts != null && (
            <div className="chat-turn-ts">{new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
          )}
        </div>
        {segments.map((seg, i) => {
          // Slow sweep ONLY for the chat being watched live (owner 2026-10-01): a
          // restored/navigated-into chat paints whole; `streaming` here means
          // THIS turn is the live one in the active view.
          const reveal = !!streaming && i === lastIdx;
          if (seg.kind === "thinking") return <ThoughtRow key={seg.id} seg={seg} />;
          if (seg.kind === "tool") return <BundleToolRow key={seg.id} seg={seg} onToggleTool={onToggleTool} />;
          if (seg.kind === "approval") return <ApprovalRow key={seg.id} seg={seg} onRespond={onApprovalRespond} />;
          if (seg.kind === "clarify") return <ClarifyCard key={seg.id} seg={seg} onAnswer={onClarifyAnswer} />;
          if (seg.kind === "gate") return <GateCard key={seg.id} seg={seg} sessionId={sessionId} onRespond={onGateRespond} onOpenMedia={onOpenMedia} />;
          return (
            <TextRow
              key={seg.id}
              seg={seg}
              reveal={reveal}
              onOpenMedia={onOpenMedia}
              mdOverride={canvasPlan.mdFor.get(i)}
              canvases={canvasPlan.bySeg.get(i)}
              liveCanvas={i === canvasPlan.liveSeg ? canvasPlan.liveCanvas : null}
              live={i === canvasPlan.liveSeg}
            />
          );
        })}
        {actions}
      </div>
    );
  })
