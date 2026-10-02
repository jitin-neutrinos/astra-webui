import { useEffect, useRef, useState, useCallback } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { ArrowUp, Square, TriangleAlert, RotateCcw, Pencil, ChevronDown, Plus, WifiOff, Loader2, CheckCircle2, Check, LogOut } from "lucide-react";
import TrainingStatus from "./training-status";
import * as notify from "@/lib/notify";
import { AnimatedCopyButton } from "@/lib/animated-copy";
import { cn } from "@/lib/utils";
import { useHermesWS } from "@/lib/hermes-ws";
import type { EventPayload } from "@/lib/hermes-ws";
import { RESTORED_MS, fmtSeconds, bannerVisible, type ConnState } from "@/lib/connection-state";
import { parseCommand } from "@/lib/slash-commands";
import { rowsToTurns, type Turn } from "@/lib/normalize-messages";
import { extractAttachments, mediaKind } from "@/lib/media-paths";

const MediaViewer = lazy(() => import("./media-viewer"));
import { parseGate, serializeReply, type GateReply } from "./gates/gate-envelope";
import { hasRenderedReq, lastAssistantHasText } from "@/lib/chat-segments";
import { cleanTitle } from "@/lib/chat-title";
import { modelSwitchValue } from "@/lib/model-switch";
import AITextLoading from "@/components/ui/ai-text-loading";
import { ChatFeedSkeleton, NewChatGreetSkeleton } from "@/components/ui/skeletons";
import { getHermesHome, getCatalog } from "@/lib/session-files";
import { histBackoffMs, histFailureTransient, HIST_MAX_ATTEMPTS } from "@/lib/history-retry";
import {
applySegmentOps, finalizeSegments, findNewestCollapsedToolSeg, expandKeyBlocked, TurnTimeline,
usePrefersReducedMotion,
  type Segment, type SegOp,
} from "./chat-timeline";
import { ComposerControls, filesToAttachments, type Attachment } from "./composer-controls";
import { AttachmentTray } from "./attachment-tray";
import { RotatingPlaceholder } from "./composer-anim";
import { ComposerTrace, isLowSpec } from "./composer-trace";
import { newId, uniqueUploadName } from "@/lib/upload-names";
import { loadDraft, saveDraft, clearDraft, moveDraft } from "@/lib/drafts";
import { toast } from "@/lib/toast";
import { SubagentPanel, useSubagents } from "./subagent-panel";
import { harnessRowFromToolStart, harnessRowId, mergeRoster, type HarnessRow } from "@/lib/harness-agents";
import { lazy, Suspense } from "react";
import { MediaGrid } from "./media-grid";
import { ToastHost } from "./toast-host";
import { toItem, type MediaItem } from "@/lib/media-paths";
import { createItem, onTurnComplete, reconcileWithServer, dismissItem } from "@/lib/bg-items";
import { loadItems, saveItems } from "@/lib/bg-items";
import type { BgItem } from "@/lib/bg-items";
import { BgDock, BgNote, SteerNote } from "./bg-dock";
import avatarUrl from "@/assets/avatar-jitin.webp";
import type { CatalogPayload } from "./composer-controls";

// Source: ~/.hermes/plugins/astra-brand/dashboard/dist/astra-core.js CHAT_TUI_COMMANDS
// (the TUI's registered slash commands — submitted as plain prompt text, same as the terminal).
// /bg and /steer are CLIENT-side (parsed in send()): queue-after and live steer.
// Low-spec device probe, once per session: drives the reduced comet band count
// (composer-trace) and the cheap composer autosize below. Both are pure wins on
// a weak phone and invisible on a desktop.
const LOW_SPEC = isLowSpec();

const TUI_COMMANDS = [
  "/bg", "/steer",
  "/model", "/reasoning", "/new", "/sessions", "/compact", "/usage",
  "/skills", "/tools", "/memory", "/approvals", "/help", "/stop", "/status",
];

type ChatMsg = { isSysNote?: boolean; bgId?: number; content?: string; files?: {name: string, path: string}[] } & (
    | { id: string; role: "user"; content: string; ts?: number }
    | { id: string; role: "assistant"; segments: Segment[]; isStreaming: boolean; ts?: number } );

// home dir for upload targets (bootstrap once); in-flight XHRs by attachment id
const hermesHomeRef: { p: Promise<string> | null } = { p: null };
const homeP = () => hermesHomeRef.p ?? (hermesHomeRef.p = getHermesHome().catch((e) => { hermesHomeRef.p = null; throw e; }));

let idSeq = 0;
const nextId = () => `m${++idSeq}-${Date.now()}`;

const BATCH_MS = 40; // ~30-60ms batching window for both text deltas and step ops

// Controlled: ChatLanding owns the name. It is fed by the initial fetch, the gateway's live
// `session.title` event (auto-naming), a refresh after reconnect, and renames made here - and
// ChatLanding mirrors it to the browser tab (document.title) and the sidebar.
function ChatTitle({ storedSessionId, title, onTitleChange }: { storedSessionId: string | null; title: string; onTitleChange: (title: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const save = async () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === title || !storedSessionId) return;
    const prev = title;
    onTitleChange(next);
    try {
      const res = await fetch(`/api/hx/sessions/${encodeURIComponent(storedSessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      // Server truth wins: it may normalise the name, or refuse it (e.g. already in use).
      if (!res.ok) onTitleChange(prev);
      else { const d = await res.json().catch(() => null); if (d?.title) onTitleChange(d.title); }
    } catch { /* keep local title; server may be unreachable */ }
  };

  if (!storedSessionId) return null;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") setEditing(false);
          }}
          autoFocus
          maxLength={80}
          aria-label="Chat name"
          className="w-56 rounded-md border border-cyanx/40 bg-black/50 px-2 py-1 font-mono text-[11px] text-brandtext focus:outline-none"
        />
      ) : (
        <>
          <span className="max-lg:max-w-[calc(50vw-60px)] truncate font-mono text-[11px] uppercase tracking-[0.2em] text-slate-400" title={title}>
            {title || "untitled chat"}
          </span>
          <button
            type="button"
            onClick={() => { setDraft(title); setEditing(true); }}
            aria-label="Rename chat" title="Rename chat"
            className="rounded p-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-cyanx"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        </>
      )}
    </span>
  );
}



function textOf(payload: any): string {
  return payload?.delta?.text ?? payload?.text ?? payload?.rendered ?? "";
}

// Dynamic connection banner: offline → live retry countdown + manual Retry;
// restored → green "Connected" that auto-dismisses (RESTORED_MS) and slides
// away on the next frame drop. Glassmorphic, both themes (see .conn-banner CSS).
function ConnectionBanner({ state, onRetry, nextRetryIn }: { state: ConnState; onRetry: () => void; nextRetryIn: () => number }) {
  const [tick, setTick] = useState(0);
  const [leaving, setLeaving] = useState(false);
  // Banner only after 60s down. Reconnect is unchanged — this only hides chrome.
  const disconnectAtRef = useRef<number | null>(null);
  if (state === "online") disconnectAtRef.current = null;
  else if (disconnectAtRef.current === null) disconnectAtRef.current = Date.now();
  const disconnectedMs = disconnectAtRef.current ? Date.now() - disconnectAtRef.current : 0;
  const bannerReady = bannerVisible(state, disconnectedMs);
  // 1s tick while down: flips the 60s gate and refreshes the countdown.
  // (The old 250ms tick ran the whole outage, including the hidden minute.)
  useEffect(() => {
    if (state === "online") return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [state]);
  // Auto-dismiss the restored confirmation.
  useEffect(() => {
    if (state !== "restored") { setLeaving(false); return; }
    const t = window.setTimeout(() => setLeaving(true), RESTORED_MS);
    return () => window.clearTimeout(t);
  }, [state]);
  if (state === "online") return null;
  if (!bannerReady) return null;

  const offline = state === "offline";
  return (
    <div role="status" aria-live="polite"
      className={cn("conn-banner", leaving && "conn-banner-leave")}
      data-state={state}>
      {offline ? (
        <>
          <WifiOff className="conn-banner-icon" aria-hidden="true" />
          <span className="conn-banner-title">Connection lost</span>
          <span className="conn-banner-sub">
            Auto-retrying in <span className="conn-banner-mono">{fmtSeconds(nextRetryIn())}</span> — your messages queue in the background.
          </span>
          <button type="button" className="conn-banner-retry" onClick={onRetry}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry now
          </button>
        </>
      ) : state === "checking" ? (
        <>
          <Loader2 className="conn-banner-icon spin" aria-hidden="true" />
          <span className="conn-banner-title">Reconnecting…</span>
          <span className="conn-banner-sub">Holding your messages until the line is back.</span>
        </>
      ) : (
        <>
          <CheckCircle2 className="conn-banner-icon ok" aria-hidden="true" />
          <span className="conn-banner-title">Connected</span>
          <span className="conn-banner-sub">Back online — queued messages are on their way.</span>
        </>
      )}
      {tick < 0 && <span hidden>{tick}</span>}
    </div>
  );
}
function thinkingOf(payload: any): string {
  return payload?.delta?.thinking ?? payload?.text ?? payload?.rendered ?? "";
}


// ---- UserBubble (owner 2026-10-01): 5-line clamp with "read more" ----------
// Long user messages collapse to 5 rendered lines (CSS line-clamp — counts
// WRAPPED lines, not just newlines) with an inline toggle. Overflow is measured
// after paint via scrollHeight, so the toggle only appears when the clamp
// actually cut something.
function UserBubble({ msg, avatarUrl, onOpenMedia }: { msg: ChatMsg; avatarUrl: string; onOpenMedia: (items: MediaItem[], index: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const clampRef = useRef<HTMLDivElement | null>(null);
  const body = (msg.content || "").replace(/\n\nAttached file: .*/g, "");
  useEffect(() => {
    const el = clampRef.current;
    if (!el || expanded) { if (expanded) setOverflows(true); return; }
    setOverflows(el.scrollHeight > el.clientHeight + 2);
  }, [body, expanded]);
  return (
    <div className="chat-bubble-user min-w-0 w-full whitespace-pre-wrap [overflow-wrap:anywhere] rounded-2xl px-4 py-3 text-sm leading-relaxed">
      <div className="chat-turn-head chat-turn-head-user">
        <img src={avatarUrl} alt="" aria-hidden="true" className="chat-user-chip" />
        {msg.ts != null && (
          <div className="chat-turn-ts">{new Date(msg.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
        )}
      </div>
      {msg.files && msg.files.length > 0 && (
        <MediaGrid className="mb-2" items={msg.files.map((f) => toItem(f.path, f.name))} onOpen={onOpenMedia} />
      )}
      <div ref={clampRef} className={!expanded ? "user-msg-clamp" : undefined}>{body}</div>
      {overflows && (
        <button type="button" className="user-msg-toggle" aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

export function ChatLanding({ resetSignal, selectedSessionId, onSessionChange, onNewChat, onOpenNav, isActiveView = true }: { resetSignal: number, selectedSessionId: string | null, onSessionChange?: (id: string | null) => void, onNewChat?: () => void, onOpenNav?: () => void, isActiveView?: boolean }) {
  const [messages, setMessagesState] = useState<ChatMsg[]>([]);
  // history is in flight for this chat: show skeleton feed instead of the
  // empty-state welcome (which flashed before history landed).
  // Owner standing rule (2026-10-01): skeleton until EVERYTHING is loaded —
  // start true whenever a chat is (or may be) selected so first paint, reload,
  // and deep links never flash the welcome screen.
  // [histLoading, histReloadTick] — tick re-fires the load-history effect when a
  // failed first load needs a nudge (e.g. connection restored after exhausting
  // retries); the effect itself only keys on storedSessionId for the fetch key.
  const [histLoading, setHistLoading] = useState(true);
  const [histReloadTick, setHistReloadTick] = useState(0);
  // which chat's history the rendered messages belong to — navigating to a
  // DIFFERENT chat clears the screen so its skeleton shows while fetching
  const loadedSidRef = useRef<string | null>(null);
  // Synchronous mirror of the transcript. Handlers that must know what is ALREADY on screen
  // (replayed gate / answer frames) cannot wait for React's next render: the live frame and
  // the resume-reply replay of the same request land back-to-back.
  const messagesRef = useRef<ChatMsg[]>([]);
  const setMessages = useCallback((u: ChatMsg[] | ((m: ChatMsg[]) => ChatMsg[])) => {
    const next = typeof u === "function" ? u(messagesRef.current) : u;
    messagesRef.current = next;
    setMessagesState(next);
  }, []);
  const [bgItems, setBgItems] = useState<BgItem[]>([]);
  const bgItemsRef = useRef(bgItems);
  useEffect(() => { bgItemsRef.current = bgItems; }, [bgItems]);
  const [openBgRef, setOpenBgRef] = useState<string | null>(null); // msg id to scroll to after "open" click
  const [chatTitle, setChatTitle] = useState(""); // the open chat's name: header + browser tab (document.title)
  const chatTitleRef = useRef("");
  useEffect(() => { chatTitleRef.current = chatTitle; }, [chatTitle]);
  const [viewer, setViewer] = useState<{ items: MediaItem[]; index: number } | null>(null);
  const openMedia = useCallback((items: MediaItem[], index: number) => setViewer({ items, index }), []);
  const [input, setInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [errorBanner, setErrorBanner] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  // Mirror of atBottom for observers/listeners that must read the CURRENT value
  // without being re-subscribed on every change.
  const atBottomRef = useRef(true);
  // Last observed scrollTop, used to tell a reader's upward scroll apart from
  // the scroll position shifting because content grew underneath them.
  const lastScrollTopRef = useRef(0);
  useEffect(() => { atBottomRef.current = atBottom; }, [atBottom]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashActive, setSlashActive] = useState(0);
  // Send-button sent-flash (morphs to a check briefly after send).
  const [sentFlash, setSentFlash] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);

  // ---- history pagination (owner 2026-10-01) --------------------------------
  // Gateway semantics (measured 2026-10-01 against /api/hx/sessions/<sid>/
  // messages): rows are ALWAYS returned oldest-first ascending. order=latest
  // selects the window anchored at the END of the session (offset skips back
  // from the newest row); order=oldest anchors at the START. So:
  //   initial load  → order=latest&limit=PAGE   (newest PAGE rows, ascending)
  //   scroll-up     → order=latest&limit=PAGE&offset=<held count>
  // Never .reverse() the result — that rotates the chat (first message sinks
  // to the bottom, newest work renders on top) on every reload.
  const HIST_PAGE = 200;
  const rawRowsRef = useRef<any[]>([]); // RAW rows, oldest-first ascending
  const histDoneRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const [olderLoading, setOlderLoading] = useState(false);

  // Shared row→messages merge (initial page and scroll-up pages both use it).
  const applyHistoryRows = useCallback(async (rawRows: any[], sid: string) => {
    const rows = rowsToTurns(rawRows);
    const sameMsg = (live: ChatMsg, row: Turn) => {
      if (live.isSysNote || live.role !== row.role) return false;
      if (live.role === "user") return (live.content || "").trim() === (row.content || "").trim();
      const t1 = (live.segments || []).filter((s) => s.kind === "text").map((s) => s.text ?? "").join("\n\n").trim();
      const t2 = (row.segments || []).filter((s) => s.kind === "text").map((s) => s.text ?? "").join("\n\n").trim();
      if (t1 === "" && t2 === "") {
        const kinds1 = (live.segments || []).map(s => s.kind).join();
        const kinds2 = (row.segments || []).map(s => s.kind).join();
        const labels1 = (live.segments || []).filter(s => s.kind === "tool").map(s => s.label).join();
        const labels2 = (row.segments || []).filter(s => s.kind === "tool").map(s => s.label).join();
        return kinds1 === kinds2 && labels1 === labels2;
      }
      return t1 === t2;
    };
    const toMsg = (r: Turn): ChatMsg => ({ ...r, id: r.id || nextId() } as ChatMsg);
    setMessages((live) => {
      if (liveSidRef.current !== sid || live.length === 0) return rows.map(toMsg);
      if (activeIdRef.current != null) return live;
      let li = live.length - 1, ri = rows.length - 1;
      while (li >= 0 && ri >= 0 && sameMsg(live[li], rows[ri])) { li--; ri--; }
      return [...rows.slice(0, ri + 1).map(toMsg), ...live.slice(li + 1)];
    });
    setErrorBanner("");
    loadedSidRef.current = sid;
  }, [setMessages]);

  // Scroll-up pagination: fetch the next older page and prepend.
  const loadOlder = useCallback(async () => {
    const sid = storedSidRef.current;
    if (!sid || loadingOlderRef.current || histDoneRef.current) return;
    loadingOlderRef.current = true;
    setOlderLoading(true);
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const offset = rawRowsRef.current.length;
      // order=latest&offset skips BACK from the newest row — the window just
      // above what we already hold. (order=oldest&offset skips from the START
      // and would re-fetch rows we already have, dead-ending pagination.)
      const res = await fetch(`/api/hx/sessions/${encodeURIComponent(sid)}/messages?order=latest&limit=${HIST_PAGE}&offset=${offset}`);
      if (!res.ok) return;
      const data = await res.json();
      const page = (data.messages || []).filter((r: any) => r && r.id != null && !rawRowsRef.current.some((x) => x.id === r.id));
      if (page.length === 0) { histDoneRef.current = true; return; }
      rawRowsRef.current = [...page, ...rawRowsRef.current];
      if (page.length < HIST_PAGE) histDoneRef.current = true;
      await applyHistoryRows(rawRowsRef.current, sid);
      // Keep the reader anchored: restore the scroll offset over the prepended content.
      requestAnimationFrame(() => {
        const el2 = listRef.current;
        if (el2) { el2.scrollTop = el2.scrollHeight - prevHeight + el2.scrollTop; }
      });
    } catch { /* keep what we have */ }
    finally { loadingOlderRef.current = false; setOlderLoading(false); }
  }, [applyHistoryRows]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const uploading = attachments.some((a) => a.status === "uploading");
  const failedUp = attachments.some((a) => a.status === "error");
  const doneCount = attachments.filter((a) => a.status === "done").length;
  const canSend = !uploading && !failedUp && (input.trim().length > 0 || doneCount > 0);
  const sendHint = uploading ? "Waiting for uploads…" : failedUp ? "Retry or remove failed uploads" : "";

  const reducedMotion = usePrefersReducedMotion();

  const liveSidRef = useRef<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const prevStoredSidRef = useRef<string | null>(null);
  // Mirrors the hook's storedSessionId for handlers declared above the hook call
  // (handleEvent runs before useHermesWS returns).
  const storedSidRef = useRef<string | null>(null);
  // Name updates: initial fetch, live `session.title` events, post-reconnect refresh, renames.
  // Ignored unless they belong to the chat open NOW (a late reply for a chat the user already
  // left must not rename this one); applied names fan out to the sidebar list.
  const applyTitle = useCallback((sid: string | null, raw: unknown, allowEmpty = false) => {
    const t = cleanTitle(raw);
    if (!sid || sid !== storedSidRef.current || (!t && !allowEmpty)) return;
    setChatTitle(t);
    if (t) window.dispatchEvent(new CustomEvent("astra:chat-title", { detail: { id: sid, title: t } }));
  }, []);
  const refreshTitle = useCallback((sid: string | null) => {
    if (!sid) return;
    fetch(`/api/hx/sessions/${encodeURIComponent(sid)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => applyTitle(sid, d?.title))
      .catch(() => {});
  }, [applyTitle]);
  const greetPendingRef = useRef(false);
  const pendingOpsRef = useRef<SegOp[]>([]);
  const opsTimerRef = useRef<number | null>(null);
  const lastPromptRef = useRef("");
  const lastScrolledApprovalRef = useRef<string | null>(null);
  const xhrPathRef = useRef<Promise<string> | null>(null);
  const xhrRef = useRef<Map<string, XMLHttpRequest>>(new Map());
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  useEffect(() => {
    xhrPathRef.current = homeP();
    getCatalog().then((c) => setCatalog(c)).catch(() => { /* popup retries on open */ });
  }, []);
  const refreshCatalog = useCallback(() => {
    getCatalog(true).then((c) => setCatalog(c)).catch(() => { /* keep last good catalog */ });
  }, []);

  const flushOps = useCallback(() => {
    opsTimerRef.current = null;
    const ops = pendingOpsRef.current;
    pendingOpsRef.current = [];
    const id = activeIdRef.current;
    if (!ops.length || !id) return;
    setMessages((m) => m.map((msg) =>
      msg.role === "assistant" && msg.id === id
        ? { ...msg, segments: applySegmentOps(msg.segments, ops) }
        : msg));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (opsTimerRef.current) return;
    opsTimerRef.current = window.setTimeout(flushOps, BATCH_MS);
  }, [flushOps]);

  const pushOp = useCallback((op: SegOp, immediate = false) => {
    pendingOpsRef.current.push(op);
    if (immediate) flushOps();
    else scheduleFlush();
  }, [flushOps, scheduleFlush]);

  const ensureActive = useCallback(() => {
    if (activeIdRef.current) return;
    const id = nextId();
    activeIdRef.current = id;
    setMessages((m) => [...m, { id, role: "assistant", segments: [], isStreaming: true, ts: Date.now() }]);
  }, []);

  const finalizeActive = useCallback(() => {
    if (opsTimerRef.current) { window.clearTimeout(opsTimerRef.current); opsTimerRef.current = null; }
    const ops = pendingOpsRef.current;
    pendingOpsRef.current = [];
    const id = activeIdRef.current;
    activeIdRef.current = null;
    if (!id) return;
    setMessages((m) => m
      .map((msg) => msg.role === "assistant" && msg.id === id
        ? { ...msg, segments: finalizeSegments(ops.length ? applySegmentOps(msg.segments, ops) : msg.segments), isStreaming: false }
        : msg)
      // drop a turn that ended with nothing rendered (e.g. Stop before any event arrived)
      .filter((msg) => !(msg.role === "assistant" && msg.id === id && msg.segments.length === 0)));
  }, []);

  const resolveApproval = useCallback((reqId: string, choice: string | null) => {
    setMessages((m) => m.map((msg) => {
      if (msg.role !== "assistant") return msg;
      let changed = false;
      const segments = msg.segments.map((s) => {
        if (s.kind === "approval" && s.reqId === reqId && s.resolved == null) {
          changed = true;
          return { ...s, resolved: choice ?? "cancelled", status: "done" as const };
        }
        return s;
      });
      return changed ? { ...msg, segments } : msg;
    }));
  }, []);

  // Mark a clarify card resolved (with the submitted answers) or cancelled.
  const resolveClarify = useCallback((reqId: string, answers: Record<string, string> | null) => {
    setMessages((m) => m.map((msg) => {
      if (msg.role !== "assistant") return msg;
      let changed = false;
      const segments = msg.segments.map((s) => {
        if (s.kind === "clarify" && s.reqId === reqId && s.resolved == null) {
          changed = true;
          return { ...s, answers: answers ?? s.answers, resolved: answers ? "answered" : "cancelled", status: "done" as const };
        }
        return s;
      });
      return changed ? { ...msg, segments } : msg;
    }));
  }, []);

  // Mark a gate card resolved/cancelled (mirrors resolveClarify).
  const resolveGate = useCallback((reqId: string, reply: GateReply | null) => {
    setMessages((m) => m.map((msg) => {
      if (msg.role !== "assistant") return msg;
      let changed = false;
      const segments = msg.segments.map((sg) => {
        if (sg.kind === "gate" && sg.reqId === reqId && sg.resolved == null) {
          changed = true;
          return { ...sg, resolved: reply ? reply.action : "cancelled", status: "done" as const };
        }
        return sg;
      });
      return changed ? { ...msg, segments } : msg;
    }));
  }, []);

  // Harness-CLI sub-agent rows (claude / opencode / agy …): the gateway's
  // subagent.list only tracks Hermes delegate_task children, so external CLI
  // agents run via the terminal tool were invisible. Detected client-side from
  // tool.start/generating/complete events and merged into the panel roster.
  const harnessRowsRef = useRef<HarnessRow[]>([]);
  const [, forceRoster] = useState(0);
  const noteHarness = useCallback((payload: any, toolId: unknown, done: boolean) => {
    // Completion removes by tool_id — tool.complete payloads don't restate the
    // command, so detection would fail; keying on the id alone is exact.
    if (done) {
      const id = harnessRowId(toolId);
      const prev = harnessRowsRef.current.find((r) => r.subagent_id === id);
      if (!prev) return; // finished before we ever saw it start — nothing to clear
      harnessRowsRef.current = harnessRowsRef.current.filter((r) => r.subagent_id !== id);
      forceRoster((n) => n + 1);
      return;
    }
    const row = harnessRowFromToolStart(payload, toolId, Date.now() / 1000);
    if (!row) return;
    const prev = harnessRowsRef.current.find((r) => r.subagent_id === row.subagent_id);
    if (prev) { prev.last_tool = row.goal; forceRoster((n) => n + 1); return; }
    harnessRowsRef.current = [...harnessRowsRef.current, row];
    forceRoster((n) => n + 1);
  }, []);

  const handleEvent = useCallback((ev: EventPayload) => {
    const { type, payload } = ev;

    if (type === "proxy.status") {
      // Connection state is owned by the dynamic ConnectionBanner (conn state
      // machine in hermes-ws); the errorBanner keeps only non-transport errors.
      // The 25s keepalive "tick" must NOT fall through to the else-branch and
      // silently wipe a live error message the user is still reading.
      return;
    }

    if (type === "message.start") {
      setErrorBanner("");
      if (!activeIdRef.current) ensureActive();
      else setMessages((m) => m.map((msg) => msg.id === activeIdRef.current ? { ...msg, isStreaming: true } : msg));
      return;
    }

    if (type === "message.delta") {
      const text = textOf(payload);
      if (!text) return;
      ensureActive();
      pushOp({ op: "text", text });
      return;
    }

    if (type === "thinking.delta" || type === "reasoning.delta" || type === "reasoning.available") {
      const text = thinkingOf(payload);
      if (!text) return;
      ensureActive();
      pushOp({ op: "think", text });
      return;
    }

    if (type === "tool.start") {
      ensureActive();
      const name = payload?.name || "tool";
      let argsText = "";
      if (payload?.args !== undefined) { try { argsText = JSON.stringify(payload.args, null, 2).slice(0, 6000); } catch { /* noop */ } }
      const command = payload?.args?.command || payload?.args?.cmd || "";
      noteHarness(payload, payload?.tool_id, false);
      pushOp({ op: "tool", key: payload?.tool_id, label: name, argsText, command: String(command) });
      return;
    }

    if (type === "tool.generating") {
      ensureActive();
      const name = payload?.name;
      let argsText = "";
      if (payload?.args !== undefined) { try { argsText = JSON.stringify(payload.args, null, 2).slice(0, 6000); } catch { /* noop */ } }
      const command = payload?.args?.command || payload?.args?.cmd || "";
      noteHarness(payload, payload?.tool_id, false);
      pushOp({ op: "tool-update", key: payload?.tool_id, label: name, argsText, command: String(command || "") });
      return;
    }

    if (type === "tool.complete") {
      ensureActive();
      // harvest agent-created files for the Files page "Generated media" registry
      try {
        const hay = typeof payload?.result === "string" ? payload.result : JSON.stringify(payload?.result || "");
        const found = hay.match(/\/home\/notjitin\/[^"\\\s]+\.(png|jpe?g|gif|webp|mp4|webm|mov|mkv|mp3|wav|ogg|flac|m4a|opus|pdf|docx|xlsx|pptx|txt|md|csv)/gi) || [];
        if (found.length) {
          const reg = new Set(JSON.parse(localStorage.getItem("astra-gen-files") || "[]"));
          for (const p of found) reg.add(p);
          localStorage.setItem("astra-gen-files", JSON.stringify([...reg].slice(-200)));
        }
      } catch { /* registry is best-effort */ }
      let resultText = "";
      let exitCode: number | null = null;
      if (payload) {
        if (payload.result !== undefined && payload.result !== null && payload.result !== "") {
          try { resultText = typeof payload.result === "string" ? payload.result : JSON.stringify(payload.result, null, 2); }
          catch { resultText = String(payload.result); }
          if ((payload.name === "terminal" || !payload.name) && typeof payload.result === "string") {
            try { const rj = JSON.parse(payload.result); if (rj && typeof rj === "object" && rj.exit_code != null) exitCode = rj.exit_code; } catch { /* not JSON */ }
          }
        }
        if (!resultText && payload.summary) resultText = String(payload.summary);
        resultText = resultText.slice(0, 30000);
      }
      noteHarness(payload, payload?.tool_id, true);
      pushOp({ op: "tool-done", key: payload?.tool_id, label: payload?.name, resultText, exitCode });
      return;
    }

    if (type === "message.complete" || type === "message.error") {
      if (type === "message.error") {
        const msg = payload?.error?.message || payload?.error || "The agent turn failed.";
        setErrorBanner(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      if (type === "message.complete") {
        const finalText = textOf(payload);
        // No live bubble and the newest assistant row already shows this answer: the turn was
        // settled + re-pulled from history (or the frame replayed) - never paint it twice.
        if (finalText && !(activeIdRef.current == null && lastAssistantHasText(messagesRef.current, finalText))) {
          ensureActive(); pushOp({ op: "text-final", text: finalText }, true);
        }
        if (!chatTitleRef.current) refreshTitle(storedSidRef.current); // backstop if the title event was missed
      }
      // Link the finishing turn's reply to any bg item that just went done, so the
      // dock row can scroll back to its answer later. The active msg id IS the turn.
      const activeMsgId = activeIdRef.current;
      if (activeMsgId) {
        setBgItems((items) => items.map((it) => (
          it.status === "running" && !it.replyMsgId ? { ...it, replyMsgId: activeMsgId } : it
        )));
      }
      setBgItems(onTurnComplete);
      finalizeActive();
      return;
    }

    // An interim assistant message: the model spoke, then continued the turn
    // (typically before a tool call). Carries the same authoritative `text` as
    // message.complete and must render as its own finished assistant block.
    if (type === "message.interim") {
      const interim = textOf(payload);
      if (!interim) return;
      if (activeIdRef.current == null && lastAssistantHasText(messagesRef.current, interim)) return; // replay
      ensureActive();
      // already_streamed: the gateway delivered these words via message.delta
      // already — seal the streamed segment instead of pushing the text again
      // (re-pushing rendered the interim twice: once streamed, once sealed).
      if (payload?.already_streamed) pushOp({ op: "text-seal", text: interim }, true);
      else pushOp({ op: "text-final", text: interim }, true);
      return;
    }

    if (type === "approval") {
      // Replayed request (resume reply's open_requests): the card is already on screen.
      if (hasRenderedReq(messagesRef.current, payload?.params?.session_id, payload?.id)) return;
      ensureActive();
      pushOp({ op: "approval", reqId: payload?.id, params: payload?.params || {} }, true);
      return;
    }

    // Generative UI: the agent's clarify tool arrives as a server→client request
    // (method "clarify", srq-* id). Rendered as an interactive question card.
    if (type === "clarify") {
      if (hasRenderedReq(messagesRef.current, payload?.params?.session_id, payload?.id)) return; // replay
      ensureActive();
      // A gate may ride the single-question param or hide inside a batch
      // questions[] entry (agents routinely use the batch shape) — check both.
      const gateQs = [
        payload?.params?.question as string | undefined,
        ...((payload?.params?.questions as Array<{ question?: string }> | undefined) || []).map(q => q?.question),
      ].filter((q): q is string => typeof q === "string");
      const gateHit = gateQs.map(q => parseGate(q)).find(Boolean) || null;
      if (gateHit) {
        pushOp({ op: "gate", reqId: payload?.id, params: { ...payload?.params, env: gateHit.env } }, true);
        return;
      }
      pushOp({ op: "clarify", reqId: payload?.id, params: payload?.params || {} }, true);
      return;
    }

    // Auto-naming landed (instant title, then the model's upgrade): header + tab follow live.
    if (type === "session.title") {
      if (payload?.session_id && payload.session_id === storedSidRef.current) applyTitle(payload.session_id, payload.title);
      return;
    }

    if (type === "request.answered") {
      // Answered from another device (phone pop-up / notification action).
      const r = (payload?.result || {}) as { choice?: string; answer?: string; answers?: Record<string, string> };
      if (payload?.id) {
        resolveApproval(payload.id, r.choice ?? "answered");
        resolveClarify(payload.id, r.answers || (r.answer ? { answer: r.answer } : {}));
        resolveGate(payload.id, null);
      }
      return;
    }

    if (type === "request.cancel") {
      if (payload?.id) { resolveApproval(payload.id, null); resolveClarify(payload.id, null); resolveGate(payload.id, null); }
      return;
    }

    if (type === "ws.closed") {
      // A dropped socket does NOT end the turn — generation continues
      // server-side and the client auto-reconnects + resumes (turn truth is the
      // gateway's). Finalizing here froze the live bubble on every transport
      // recycle, so the resumed stream opened a SECOND bubble mid-answer.
      // Gateway truth finalizes instead: message.complete, or turn.settled from
      // the resume/probe path.
      return;
    }

    if (type === "turn.settled") {
      // Turn truth says finished (probe/resume path) — the local active bubble is
      // stale; drop it and re-pull persisted history so the real reply renders.
      // activeIdRef already cleared by resume truth; a re-pull is idempotent.
      activeIdRef.current = null;
      const sid = storedSidRef.current; // hook return not yet declared this early
      if (sid) {
        fetch(`/api/hx/sessions/${encodeURIComponent(sid)}/messages?order=latest&limit=500`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => { if (d) setMessages(rowsToTurns(d.messages || []).map((r) => ({ ...r, id: r.id || nextId() })) as ChatMsg[]); })
          .catch(() => {});
      }
      return;
    }
  }, [ensureActive, pushOp, finalizeActive, resolveApproval, resolveClarify, resolveGate, noteHarness, applyTitle, refreshTitle]);

  const { isStreaming, submitPrompt, submitBg, submitSteer, retryConnection, conn, nextRetryIn, interrupt, storedSessionId, setStoredSessionId, sendApprovalResponse, sendServerResponse, sessionInfo, setSessionInfo, rpc, liveSessionId, resetSession } = useHermesWS(handleEvent);
  // Per-session drafts (R8f): keyed astra:draft:<sid>, debounced 400ms. The old
  // scheme wrote the SENT text at send time — it reappeared on history reload.
  const draftSidRef = useRef<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => saveDraft(localStorage, draftSidRef.current, input), 400);
    return () => clearTimeout(t);
  }, [input]);
  useEffect(() => {
    const prev = draftSidRef.current;
    if (prev === storedSessionId) return;
    // New chat minted mid-turn: carry what's typed to the real session id.
    if (prev === null && storedSessionId && storedSessionId === liveSessionId) {
      moveDraft(localStorage, null, storedSessionId);
      draftSidRef.current = storedSessionId;
      return;
    }
    saveDraft(localStorage, prev, input);
    draftSidRef.current = storedSessionId;
    setInput(loadDraft(localStorage, storedSessionId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedSessionId]);


  // Per-chat persistence. Restore FIRST (mount), then persist every change AFTER restore
  // (bgRestoreGuardRef) — saving on mount would write the empty initial [] over the stored
  // items before they're ever read (the wipe-on-reload bug this replaces).
  const bgRestoredRef = useRef(false);
  useEffect(() => {
    bgRestoredRef.current = false;
    if (!storedSessionId) return;
    const restored = loadItems(storedSessionId);
    if (restored.length > 0) setBgItems((live) => (live.length > 0 ? live : restored));
    bgRestoredRef.current = true;
  }, [storedSessionId]);
  useEffect(() => {
    if (storedSessionId && bgRestoredRef.current) saveItems(storedSessionId, bgItems);
  }, [bgItems, storedSessionId]);

  // Scroll to a bg item's reply once it exists in the DOM (after "jump to response" click).
  useEffect(() => {
    if (!openBgRef) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector(`[data-msg-id="${openBgRef}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      setOpenBgRef(null);
    }, 80);
    return () => window.clearTimeout(t);
  }, [openBgRef, messages.length]);

  useEffect(() => {
    const live = bgItems.some(it => it.status !== "done");
    if (!live || !storedSessionId) return;

    let dead = false;
    const poll = async () => {
      try {
        // Same params as probeTurn — the gateway rejects unknown params (re_attach etc.).
        const res = await rpc("session.resume", { session_id: storedSessionId, omit_messages: true });
        if (dead) return;
        if (res) {
          setBgItems((items) => reconcileWithServer(items, { queued: res.queued || null, running: !!res.running }));
        }
      } catch {
        // ignore
      }
    };
    const t = window.setInterval(poll, 3000);
    return () => { dead = true; window.clearInterval(t); };
  }, [bgItems, storedSessionId, rpc]);

  // Live sub-agent roster for this chat (gateway subagent.list/subagent.tail),
  // merged with harness-CLI rows (claude/opencode/agy …) detected from tool events.
  const suba = useSubagents(rpc, liveSessionId || storedSessionId || null, isStreaming || harnessRowsRef.current.length > 0);
  const roster = mergeRoster(suba.subs, harnessRowsRef.current);

  const respondApproval = useCallback((reqId: string, choice: string) => {
    const sent = sendApprovalResponse(reqId, choice);
    if (!sent) {
      setErrorBanner("Approval response not delivered — connection lost. Try again or reconnect.");
      return;
    }
    resolveApproval(reqId, choice);
  }, [sendApprovalResponse, resolveApproval]);

  // Send the clarify answer to the gateway (JSON-RPC response frame with the
  // request's srq id), then flip the card to its answered state.
  const respondClarify = useCallback((reqId: string, result: { answer?: string; answers?: Record<string, string> }) => {
    const sent = sendServerResponse(reqId, result);
    if (!sent) {
      setErrorBanner("Answer not delivered — connection lost. Try again or reconnect.");
      return;
    }
    resolveClarify(reqId, result.answers || {});
  }, [sendServerResponse, resolveClarify]);

  // Gate reply: serialize the envelope answer over the same srq wire used by clarify,
  // then flip the gate segment to its resolved state.
  const respondGate = useCallback((reqId: string, reply: GateReply) => {
    setMessages((msgs) => {
      let answer = "";
      let batchQids: string[] | undefined;
      let ok = true;
      const next = msgs.map((msg) => {
        if (msg.role !== "assistant") return msg;
        const segments = msg.segments.map((sg) => {
          if (sg.kind === "gate" && sg.reqId === reqId && sg.resolved == null && sg.gate) {
            answer = serializeReply(sg.gate.gate_id, sg.gate.version || 1, reply);
            batchQids = sg.batchQids;
            return { ...sg, resolved: reply.action, status: "done" as const };
          }
          return sg;
        });
        return { ...msg, segments };
      });
      if (!answer) ok = false;
      // Batch clarify frames are answered per-qid ({answers}); single frames take {answer}.
      if (ok && batchQids && batchQids.length) {
        sendServerResponse(reqId, { answers: Object.fromEntries(batchQids.map(qid => [qid, answer])) });
      } else if (ok) {
        sendServerResponse(reqId, { answer });
      }
      else setErrorBanner("Gate response not delivered — gate no longer open.");
      return next;
    });
  }, [sendServerResponse]);

  const toggleToolCollapse = useCallback((segId: string) => {
    setMessages((m) => m.map((msg) => msg.role === "assistant"
      ? { ...msg, segments: msg.segments.map((s) => s.id === segId ? { ...s, collapsed: !s.collapsed } : s) }
      : msg));
  }, []);

  useEffect(() => {
    if (selectedSessionId) setStoredSessionId(selectedSessionId);
  }, [selectedSessionId, setStoredSessionId]);

  useEffect(() => {
    storedSidRef.current = storedSessionId; // keep early-handler mirror in sync
    onSessionChange?.(storedSessionId);
  }, [storedSessionId, onSessionChange]);

  // Open chat changed: drop the previous chat's name at once, then load this one's.
  useEffect(() => {
    setChatTitle("");
    refreshTitle(storedSessionId);
    notify.reportFocus(storedSessionId); // presence: which chat THIS tab is on
  }, [storedSessionId, refreshTitle]);

  // Back online after a drop: an auto-name / rename may have landed while we were away.
  // If history never landed for THIS chat (the retry chain exhausted while the
  // wire was down), a reconnect is the moment to try again — no user action needed.
  useEffect(() => {
    if (conn === "restored") {
      refreshTitle(storedSessionId);
      if (storedSessionId && loadedSidRef.current !== storedSessionId) setHistReloadTick((t) => t + 1);
    }
  }, [conn, storedSessionId, refreshTitle]);

  useEffect(() => {
    // Only the chat view owns the URL/title while it's the visible view — when
    // Config/Tracker/Files are open, App.tsx's own effect owns document.title and
    // the pathname, so this must not fight it (that fight was the root cause of
    // "chat slug doesn't update right when navigating between pages").
    if (!isActiveView) return;
    if (storedSessionId) {
      notify.clearChat(storedSessionId);
      if (location.pathname !== `/c/${storedSessionId}`) {
        history.pushState({}, "", `/c/${storedSessionId}`);
      }
      notify.setBaseTitle(chatTitle ? `${chatTitle} — Astra` : "Chat — Astra");
    } else {
      if (location.pathname.startsWith("/c/")) {
        history.replaceState({}, "", "/");
      }
      notify.setBaseTitle("Astra");
    }
  }, [storedSessionId, isActiveView, chatTitle]);

  useEffect(() => {
    // A real session switch (sidebar chat click, not a same-session re-affirm) means
    // any still-open turn belonged to the PREVIOUS session — stop guarding it here, or
    // the loadHistory effect below mistakes an unrelated stale turn for a live one on
    // the newly selected session and refuses to load its history.
    // BUT: a brand-new chat mints its session MID-TURN (session.create reply lands
    // while the turn is already streaming). That state flip is not a switch — the new
    // sid IS the live turn's session (liveSessionId was set to it moments before).
    // Nulling here orphaned the turn: ops dropped, duplicate bubble, stuck pill
    // (Opus diagnosis H1, 2026-09-26).
    if (prevStoredSidRef.current !== null && prevStoredSidRef.current !== storedSessionId
        && storedSessionId !== liveSessionId) {
      activeIdRef.current = null;
    }
    prevStoredSidRef.current = storedSessionId;
    if (activeIdRef.current != null) liveSidRef.current = storedSessionId;
    // Naming is the gateway's job (instant title -> model upgrade -> live `session.title`).
    // The old client-side PATCH of the first prompt line wrote a user-provenance title that
    // outranks the model's, freezing those chats on their first line for good.
  }, [storedSessionId]);

  useEffect(() => {
    let gen = 0; // invalidate in-flight retry chains when the chat switches
    async function loadHistory() {
      const myGen = ++gen;
      if (!storedSessionId) { setMessages([]); setHistLoading(false); loadedSidRef.current = null; rawRowsRef.current = []; histDoneRef.current = false; return; }
      setHistLoading(true);
      // switching to another chat: drop the previous chat's rows immediately so
      // the skeleton holds the space (owner: chat switch shows loading state).
      // BUT a fresh chat mints its sid MID-TURN (greeting already streaming) —
      // that flip is not a switch. Wiping there deleted the live bubble, and
      // every later delta mapped over a list that no longer contained it:
      // feed froze empty on the welcome screen until reload. A real switch has
      // no live turn (the session-switch effect nulls activeIdRef); a mint does.
      if (loadedSidRef.current !== storedSessionId && activeIdRef.current == null) { setMessages([]); rawRowsRef.current = []; histDoneRef.current = false; }
      // Reload / app resume / post-approval deep link all land here while the
      // tunnel or proxy relogin is still settling — a single transient failure
      // must not stick. Retry transient failures with backoff; only a
      // definitive answer (404/401/5xx-except-transient) or a chat switch ends
      // the chain. This is the root fix for "unable to get chat history until I
      // re-enter the chat": the remount re-fired this effect, so a retry HERE
      // covers every trigger at once.
      for (let attempt = 1; ; attempt++) {
        let status: number | null = null;
        try {
          // Industry-standard first page only (owner 2026-10-01): the rest pages
          // in as the user scrolls up (loadOlder). order=latest + reverse gives
          // the oldest-first tail page.
          const res = await fetch(`/api/hx/sessions/${encodeURIComponent(storedSessionId)}/messages?order=latest&limit=${HIST_PAGE}`);
          if (!res.ok) {
            status = res.status;
            if (status === 401) setErrorBanner("Unauthorized. Please log in.");
            else if (status === 503) setErrorBanner("Agent backend busy (503).");
            else setErrorBanner("Failed to load history.");
            if (liveSidRef.current !== storedSessionId) setMessages([]);
          } else {
            const data = await res.json();
            // rowsToTurns reconstructs thinking/tool segments from the persisted
            // reasoning/tool_calls/tool-result rows — approval/clarify segments
            // are the only kind never persisted, so restored turns never have them.
            // order=latest already returns rows oldest-first ascending — NO reverse
            // (reversing rotates the feed: newest work on top, first message last).
            const rows = data.messages || [];
            rawRowsRef.current = rows;
            histDoneRef.current = rows.length < HIST_PAGE;
            await applyHistoryRows(rows, storedSessionId);
            break;
          }
        } catch {
          status = null; // network-level failure → transient
          setErrorBanner("Failed to load history.");
          if (liveSidRef.current !== storedSessionId) setMessages([]);
        }
        if (!histFailureTransient(status) || attempt >= HIST_MAX_ATTEMPTS || myGen !== gen) break;
        await new Promise((r) => setTimeout(r, histBackoffMs(attempt)));
        if (myGen !== gen) break; // user switched chats during the wait
      }
      if (myGen === gen) setHistLoading(false);
    }
    loadHistory();
    return () => { gen++; };
  }, [storedSessionId, histReloadTick]);

  const send = async (raw?: string, opts?: { silent?: boolean }) => {
    let finalText = (raw ?? input).trim();
    if (!finalText && doneCount === 0) return;
    // Send rule (R8d): disabled with a visible reason, never auto-sent.
    if (uploading || failedUp) { toast(sendHint); return; }
    // Sent-flash: button morphs to a check for 900ms so the user sees the
    // message left the building even before the reply stream opens.
    setSentFlash(true);
    window.setTimeout(() => setSentFlash(false), 900);

    // Slash-command routing (always allowed — even mid-stream):
    //   /bg    → queue as a run-after envelope (never disturbs the live turn)
    //   /steer → live course-correction injected after the current action
    const cmd = parseCommand(finalText);
    if (cmd.kind !== "plain" && attachments.length === 0 && !opts?.silent) {
      setInput("");
      setSlashOpen(false);
      setMessages((m) => [...m, { id: nextId(), role: "user", content: finalText, ts: Date.now() }]);
      const okSent = cmd.kind === "bg" ? await submitBg(cmd.text) : await submitSteer(cmd.text);
      if (okSent) {
        const isLive = activeIdRef.current != null || isStreaming;
        const item = createItem(cmd.kind, cmd.text, isLive);
        setBgItems((items) => [...items, item]);
        setMessages((m) => [...m, {
          id: nextId(), role: "assistant", segments: [], isStreaming: false, isSysNote: true, bgId: item.id
        } as any]);
      } else if (cmd.kind === "steer") {
        setMessages((m) => [...m, {
          id: nextId(), role: "assistant", segments: [], isStreaming: false, isSysNote: true,
          content: "Steer already in flight — one course-correction at a time"
        } as any]);
      }
      taRef.current?.focus();
      return;
    }

    // Normal message handling...

    const files = attachments.filter((a) => a.status === "done").map((a) => ({ name: a.name, path: a.serverPath! }));
    if (files.length > 0) {
      finalText += (finalText ? "\n\n" : "") + files.map(f => `Attached file: ${f.path}`).join("\n");
    }
    // images reach the model as vision input too (best-effort; path-only on failure)
    for (const f of files) {
      if (mediaKind(f.name) === "image") {
        rpc("image.attach", { session_id: liveSessionId || undefined, path: f.path }).catch(() => { /* path in text is the fallback */ });
      }
    }

    // Silent kickoffs (auto-greet) must not become lastPromptRef, or the title-PATCH
    // effect below titles the chat with the hidden instruction instead of the user's
    // actual first message, and Regenerate on the greeting would leak it as a visible bubble.
    if (!opts?.silent) lastPromptRef.current = finalText;
    if (!opts?.silent) {
      clearDraft(localStorage, draftSidRef.current);
      setInput("");
    }
    setSlashOpen(false);
    setAttachments([]);

    // A silent kickoff (the auto-greet on New chat) submits a prompt to Hermes without
    // showing it as a user bubble — the user should only see Hermes speaking first.
    if (!opts?.silent) {
      const extracted = extractAttachments(finalText);
      setMessages((m) => [...m, { id: nextId(), role: "user", content: extracted.text, ts: Date.now(), files: extracted.files }]);
    }

    // Mid-turn plain sends stay visible and queue server-side (queued:true from
    // the hook). A fresh assistant bubble is only opened when no turn is live.
    if (!activeIdRef.current && !isStreaming) {
      const id = nextId();
      activeIdRef.current = id;
      setMessages((m) => [...m, { id, role: "assistant", segments: [], isStreaming: true, ts: Date.now() }]);
    }
    setAtBottom(true);
    setTimeout(() => submitPrompt(finalText), 0);
    taRef.current?.focus();
  };

  const dismissBgItem = useCallback((id: number) => {
    setBgItems((items) => dismissItem(items, id));
  }, []);

  const openBgItem = useCallback((item: BgItem) => {
    if (item.replyMsgId) setOpenBgRef(item.replyMsgId);
  }, []);

  const handleFollowUpBg = useCallback((text: string) => {
    const isLive = activeIdRef.current != null || isStreaming;
    submitBg(text).then((ok) => {
      if (ok) {
        const item = createItem("bg", text, isLive);
        setBgItems((items) => [...items, item]);
        setMessages((m) => [...m, {
          id: nextId(), role: "assistant", segments: [], isStreaming: false, isSysNote: true, bgId: item.id
        } as any]);
      }
    });
  }, [submitBg, isStreaming]);

  const retry = () => { if (!isStreaming && !activeIdRef.current && lastPromptRef.current) void send(lastPromptRef.current); };

  const stop = () => {
    interrupt();
    finalizeActive();
  };

  // New chat via the chat header (owner workflow 2026-10-01, THIS button only):
  // press → 1s loading animation on the button itself → reset to the new-chat
  // screen, which holds skeleton rows until the auto-greet's first streamed
  // content lands. Every other path (sidebar new chat, opening a session)
  // keeps the old instant reset — ncFlow gates all of it.
  const [ncFlow, setNcFlow] = useState<"idle" | "press" | "skeleton">("idle");
  const ncTimerRef = useRef<number | null>(null);
  const NC_HOLD_MS = 1000;
  const onNewChatClick = useCallback(() => {
    if (ncFlow !== "idle") return;
    setNcFlow("press");
    ncTimerRef.current = window.setTimeout(() => {
      ncTimerRef.current = null;
      setNcFlow("skeleton");
      onNewChat?.();
    }, NC_HOLD_MS);
  }, [ncFlow, onNewChat]);
  useEffect(() => () => { if (ncTimerRef.current != null) window.clearTimeout(ncTimerRef.current); }, []);

  // ---- End session (owner 2026-10-01) ---------------------------------------
  // arm → confirm within 4s → POST /api/training/end-session → straight back to
  // the landing welcome (R7). The dump/review/delete continue server-side; the
  // TrainingStatus chip tracks the job live via `training.updated` WS events.
  const [endArm, setEndArm] = useState(false);
  const [endBusy, setEndBusy] = useState(false);
  const [trainingOpen, setTrainingOpen] = useState(false);
  // Set when End session lands the user on the welcome page: the reset effect
  // consumes it to suppress the auto-greeting (end ≠ new chat).
  const endWelcomeRef = useRef(false);
  useEffect(() => {
    if (!endArm) return;
    const t = window.setTimeout(() => setEndArm(false), 4000);
    return () => window.clearTimeout(t);
  }, [endArm]);
  const doEndSession = useCallback(async () => {
    const sid = storedSessionId;
    if (endBusy || !sid) return;
    setEndBusy(true);
    try {
      const res = await fetch("/api/training/end-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid, title: chatTitle || null, source: "webui" }),
      });
      // 409 = already processing — still leave the chat; server owns the job.
      // Land on the welcome page, NOT a new chat: skip the new-chat animation
      // and suppress the auto-greeting (owner 2026-10-01 — end must not mint
      // a fresh session).
      if (res.ok || res.status === 409) {
        setEndArm(false);
        endWelcomeRef.current = true;
        onNewChat?.();
      }
    } catch { /* network error — leave chat open, banner via global handlers */ }
    finally { setEndBusy(false); }
  }, [endBusy, storedSessionId, chatTitle, onNewChat]);

  // Selector handlers. Every pick is optimistic, then the gateway's session.info
  // (authoritative) overwrites it; a rejected call rolls back to the exact prior
  // value. All three are session-scoped on the gateway (scope:"session" / --session)
  // so they persist for this chat across reloads and never rewrite config.yaml.
  const note = (content: string) => setMessages((m) => [...m, {
    id: nextId(), role: "assistant", segments: [], isStreaming: false, isSysNote: true, content,
  } as any]);
  const errText = (e: any) => String(e?.message || e?.data?.message || e || "request failed");

  const onToggleYolo = async () => {
    const prev = !!sessionInfo?.yolo;
    const next = !prev;
    setSessionInfo((p: any) => ({ ...(p || {}), yolo: next }));
    try {
      await rpc("config.set", { key: "yolo", value: next ? "1" : "0", scope: "session" });
      note(next ? "Yolo mode active — tool calls in this chat run without approval" : "Yolo mode off — tool calls ask for approval first");
    } catch (e) {
      setSessionInfo((p: any) => ({ ...(p || {}), yolo: prev }));
      setErrorBanner(`Yolo change failed: ${errText(e)}`);
    }
  };

  const onPickModel = async (params: { provider: string; model: string }) => {
    const { provider, model } = params;
    const prevModel = sessionInfo?.model;
    const prevProv = sessionInfo?.provider;
    const effort = sessionInfo?.reasoning_effort || "";
    const rollback = () => setSessionInfo((p: any) => ({ ...(p || {}), model: prevModel, provider: prevProv }));
    setSessionInfo((p: any) => ({ ...(p || {}), model, provider }));
    try {
      // A model switch re-resolves reasoning from config.yaml on the gateway and would
      // silently drop this chat's effort pick — re-assert it in the same call.
      const value = modelSwitchValue({ provider, model, effort });
      let res = await rpc("config.set", { key: "model", value });
      if (res?.confirm_required) {
        // Expensive / unusual model: the gateway did NOT switch. Ask, then confirm.
        if (!window.confirm(res.confirm_message || res.warning || `Switch to ${model}?`)) { rollback(); return; }
        res = await rpc("config.set", { key: "model", value, confirm_expensive_model: true });
      }
      if (res?.deferred) note(`Model switch to ${model} queued — applies when the current reply finishes`);
      else if (res?.warning) note(String(res.warning));
    } catch (e) {
      rollback();
      setErrorBanner(`Model switch failed: ${errText(e)}`);
    }
  };

  const onPickEffort = async (effort: string) => {
    const prev = sessionInfo?.reasoning_effort;
    setSessionInfo((p: any) => ({ ...(p || {}), reasoning_effort: effort }));
    try {
      // Key is "reasoning" (_CONFIG_SETTERS), not "reasoning_effort";
      // scope "session" keeps a menu pick from rewriting the global config.
      await rpc("config.set", { key: "reasoning", value: effort, scope: "session" });
    } catch (e) {
      setSessionInfo((p: any) => ({ ...(p || {}), reasoning_effort: prev }));
      setErrorBanner(`Reasoning change failed: ${errText(e)}`);
    }
  };

  // Upload one file via XHR (progress events); path targets <home>/uploads so
  // the agent sees host paths. 503 {error:"reauth"} → one silent retry.
  const startUpload = useCallback((a: Attachment) => {
    if (!a.file) return; // edit-restored items are already done
    const fd = new FormData();
    fd.append("file", a.file);
    xhrPathRef.current?.then((home) => {
      const serverName = uniqueUploadName(a.name);
      fd.append("path", `${home}/uploads/${serverName}`);
      fd.append("overwrite", "false"); // a collision errors (Retry mints a new name) instead of clobbering history
      const xhr = new XMLHttpRequest();
      xhrRef.current.set(a.id, xhr);
      xhr.open("POST", "/api/hx/files/upload-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setAttachments((atts) => atts.map((x) => x.id === a.id ? { ...x, progress: Math.round((e.loaded * 100) / e.total) } : x));
        }
      };
      const fail = () => setAttachments((atts) => atts.map((x) => x.id === a.id ? { ...x, status: "error" } : x));
      const finish = () => {
        xhrRef.current.delete(a.id);
        if (xhr.status === 200) {
          try {
            const data = JSON.parse(xhr.responseText);
            setAttachments((atts) => atts.map((x) => x.id === a.id ? { ...x, status: "done", serverPath: data.path, progress: 100 } : x));
          } catch { fail(); }
        } else if (xhr.status === 503 && !a.retried) {
          // cookie re-auth: remove and requeue once (a fresh request mints a new cookie)
          setAttachments((atts) => atts.map((x) => x.id === a.id ? { ...x, status: "uploading", progress: 0, retried: true } : x));
        } else {
          fail();
        }
      };
      xhr.onload = finish;
      xhr.onerror = fail;
      xhr.send(fd);
    }).catch(() => setAttachments((atts) => atts.map((x) => x.id === a.id ? { ...x, status: "error" } : x)));
  }, [setAttachments]);

  // React to requeued retries without a self-refiring effect: startedRef
  // prevents double-starting the same id.
  const startedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const a of attachments) {
      if (a.status === "uploading" && !startedRef.current.has(a.id)) {
        startedRef.current.add(a.id);
        startUpload(a);
      }
      if (a.status === "error") startedRef.current.delete(a.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments]);

  const removeAttachment = useCallback((id: string) => {
    const x = xhrRef.current.get(id);
    if (x) { x.abort(); xhrRef.current.delete(id); }
    startedRef.current.delete(id);
    setAttachments((list) => list.filter((a) => a.id !== id));
  }, [setAttachments]);

  // Retry a failed upload: restart it (startedRef cleared on error → effect re-fires).
  const retryAttachment = useCallback((id: string) => {
    setAttachments((l) => l.map((x) => x.id === id
      ? { ...x, status: "uploading" as const, progress: 0, retried: false, name: x.file ? x.name : x.name }
      : x));
  }, [setAttachments]);

  // Industry-standard autosize: height is a pure function of `input`, recomputed
  // on EVERY value change — user typing, send-clear, slash-pick, draft restore —
  // so it grows AND shrinks (the old code only fit inside onInputChange, so a
  // programmatic setInput("") left the box tall).
  //
  // LOW-SPEC: this is a forced synchronous layout (write height:auto, read
  // scrollHeight, write height) on every keystroke, and it was measured as the
  // typing lag on android. Skip it while the box is ALREADY tall enough for the
  // text — the common case while typing inside a grown box — and only run the
  // full measure when the content might have outgrown (or shrunk within) it.
  const fitComposer = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    if (LOW_SPEC && ta.clientHeight >= ta.scrollHeight - 1) return;  // fits already
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);
  useEffect(() => { fitComposer(); }, [input, fitComposer]);

  // Stray drops anywhere else must never navigate the page away (R8b).
  useEffect(() => {
    const guard = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => { window.removeEventListener("dragover", guard); window.removeEventListener("drop", guard); };
  }, []);

  const onInputChange = (v: string) => {
    setInput(v);
    if (v.startsWith("/") && !v.includes(" ")) { setSlashOpen(true); setSlashActive(0); }
    else setSlashOpen(false);
  };

  const slashMatches = TUI_COMMANDS.filter((c) => c.startsWith(input));

  // Recognized command: exact match, or command + args ("/model x"). Purely
  // visual — the mirror hides the raw "/" and recolors the text; send() still
  // uses the raw input.
  const recognizedCmd = TUI_COMMANDS.find((c) => input === c || input.startsWith(c + " ")) || null;

  const pickSlash = (cmd: string) => {
    setInput(cmd + " ");
    setSlashOpen(false);
    taRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composing: Enter commits the composition — never send (R8).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    const mod = e.ctrlKey || e.metaKey;
    if (slashOpen && slashMatches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashActive((i) => (i + 1) % slashMatches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashActive((i) => (i - 1 + slashMatches.length) % slashMatches.length); return; }
      if (e.key === "Escape") { setSlashOpen(false); return; }
      if (e.key === "Enter" && !e.shiftKey && !coarse) { e.preventDefault(); pickSlash(slashMatches[slashActive] || slashMatches[0]); return; }
      return;
    }
    if (mod && e.key === "Enter") { e.preventDefault(); void send(); return; }
    // Touch keyboards: Enter = newline; sending is the button's job.
    if (e.key === "Enter" && !e.shiftKey && !coarse) { e.preventDefault(); void send(); }
  };

  // Paste (R8b): screenshots/file-only clipboards attach; text+files keeps both.
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (!files.length) return;
    if (e.clipboardData.getData("text/plain")) {
      setAttachments((a) => [...a, ...filesToAttachments(files)]);
      return;
    }
    e.preventDefault();
    setAttachments((a) => [...a, ...filesToAttachments(files)]);
  };

  // Ctrl+O expands the newest collapsed tool block (real key, matches the TUI).
  // Fired only for a bare Ctrl/Cmd+O outside the composer — typing Ctrl+O while
  // focused in the textarea must stay a no-op (reference ChatPageV2 gate).
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;

      let lastApproval: { reqId: string; choices: string[] } | null = null;
      const m = messagesRef.current;
      for (let i = m.length - 1; i >= 0; i--) {
        const msg = m[i];
        if (msg.role === "assistant") {
          for (let j = msg.segments.length - 1; j >= 0; j--) {
            const s = msg.segments[j];
            if (s.kind === "approval" && s.resolved == null) {
              lastApproval = { reqId: s.reqId!, choices: s.params?.choices?.length ? s.params.choices : ["once", "deny"] };
              break;
            }
          }
          if (lastApproval) break;
        }
      }

      if (lastApproval && /^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx >= 0 && idx < lastApproval.choices.length) {
          e.preventDefault();
          respondApproval(lastApproval.reqId, lastApproval.choices[idx]);
          return;
        }
      }

      if (expandKeyBlocked(e.ctrlKey, e.metaKey, e.key, e.target instanceof HTMLElement ? e.target.tagName : undefined)) return;
      e.preventDefault();
      setMessages((m) => {
        const target = findNewestCollapsedToolSeg(
          m.filter((msg): msg is Extract<ChatMsg, { role: "assistant" }> => msg.role === "assistant")
            .map((msg) => ({ id: msg.id, segments: msg.segments })),
        );
        if (!target) return m;
        return m.map((msg) => msg.role === "assistant" && msg.id === target!.msgId
          ? { ...msg, segments: msg.segments.map((s) => s.id === target!.segId ? { ...s, collapsed: false } : s) }
          : msg);
      });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [respondApproval]);

  // Stick-to-bottom: only auto-scroll on new content if already at bottom.
  // Instant ("auto") on purpose: deltas land every ~40ms and a smooth scroll
  // is cancelled+restarted by each batch, so the view lags behind the bottom
  // during fast streaming (reference ChatPageV2 pins with scrollTop directly).
  useEffect(() => {
    const el = listRef.current;
    if (el && atBottom) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [messages, atBottom, reducedMotion]);

  // The effect above fires on React state changes, but the transcript also
  // grows WITHOUT one: the character-reveal animation mutates text nodes
  // directly, markdown reflows, code blocks wrap, images and audio players
  // settle to their real height after decode. Each of those silently pushed
  // the live edge below the fold. A ResizeObserver re-pins on any height
  // change, whatever caused it.
  //
  // It is attached by CALLBACK REF, not by querying firstElementChild on
  // mount: the scroll container's first child starts as the welcome screen and
  // React swaps it for the transcript on the first message, which left an
  // observer watching a detached node — it never fired again and the pin was
  // silently dead for the whole session.
  const contentRO = useRef<ResizeObserver | null>(null);
  const contentRef = useCallback((node: HTMLDivElement | null) => {
    contentRO.current?.disconnect();
    contentRO.current = null;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const el = listRef.current;
      // Read through the ref so this observer is never re-subscribed per tick.
      if (el && atBottomRef.current) {
        el.scrollTop = el.scrollHeight;
        lastScrollTopRef.current = el.scrollTop;
      }
    });
    ro.observe(node);
    contentRO.current = ro;
  }, []);
  useEffect(() => () => contentRO.current?.disconnect(), []);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    // Scroll-up pagination (owner 2026-10-01): near the top, pull older rows.
    if (el.scrollTop < 240) void loadOlder();
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    const prevTop = lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    // Near the live edge is always "stuck", whatever caused the scroll.
    if (gap < 80) { if (!atBottomRef.current) setAtBottom(true); return; }
    // Away from the edge: only UNSTICK on evidence the reader moved up
    // themselves. Content growth can momentarily report a large gap before the
    // pin lands (markdown reflow, an image decoding, a code block wrapping);
    // treating that as intent latched atBottom=false mid-answer and the view
    // froze while text kept arriving below the fold. Growth only ever raises
    // scrollHeight — it never lowers scrollTop — so a decrease is the reader.
    if (el.scrollTop < prevTop - 1) setAtBottom(false);
  };

  // Pin a freshly-arrived approval card into view even if the user scrolled up.
  useEffect(() => {
    let latest: string | null = null;
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      for (const s of msg.segments) if (s.kind === "approval" && s.resolved == null) latest = s.reqId || latest;
    }
    if (latest && latest !== lastScrolledApprovalRef.current) {
      lastScrolledApprovalRef.current = latest;
      document.getElementById(`chat-approval-${latest}`)?.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
    }
  }, [messages, reducedMotion]);

  useEffect(() => {
    if (resetSignal > 0) {
      resetSession();
      setMessages([]);
      setInput("");
      draftSidRef.current = null;
      setAttachments([]);
      setErrorBanner("");
      activeIdRef.current = null;
      pendingOpsRef.current = [];
      // End session path: land on the welcome page with NO auto-greeting and
      // no new-chat mint. Clear the flag so a later New chat still greets.
      if (endWelcomeRef.current) {
        endWelcomeRef.current = false;
        greetPendingRef.current = false;
      } else {
        greetPendingRef.current = true;
      }
    }
  }, [resetSignal, resetSession]);

  // Exit the new-chat skeleton only after the reset has actually applied AND
  // real content arrives: the greeting turn's first segment, or a user bubble.
  // The gate matters because ncFlow flips to "skeleton" one render BEFORE the
  // resetSignal effect clears messages — unprompted, that first render still
  // holds the old chat's rows and the exit effect would kill the skeleton in
  // the same frame (seen live: skeleton never painted).
  const ncResetAppliedRef = useRef(false);
  useEffect(() => {
    if (ncFlow !== "skeleton") return;
    if (messages.length === 0) { ncResetAppliedRef.current = true; return; }
    const hasUser = messages.some((m) => m.role === "user");
    const last = messages[messages.length - 1];
    const hasContent = hasUser || (!!last && last.role === "assistant" && (last.segments?.length ?? 0) > 0);
    if (ncResetAppliedRef.current && hasContent) setNcFlow("idle");
  }, [messages, ncFlow]);

  // Failsafe: a turn that dies before any segment (gateway down, turn-error)
  // must not wedge the skeleton — fall back to the welcome screen after 15s.
  // Selecting a DIFFERENT session mid-hold cancels the pending reset instead
  // of yanking the user off to a fresh chat. Compare against the sid observed
  // when the flow started — a merely-truthy storedSessionId is the NORMAL
  // new-chat-from-existing-chat path and must not cancel anything.
  const ncPrevSidRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (ncFlow === "skeleton") {
      ncPrevSidRef.current = storedSessionId;
      const t = window.setTimeout(() => setNcFlow("idle"), 15000);
      return () => window.clearTimeout(t);
    }
    if (ncFlow === "press") {
      if (ncPrevSidRef.current !== undefined && storedSessionId !== ncPrevSidRef.current && ncTimerRef.current != null) {
        window.clearTimeout(ncTimerRef.current);
        ncTimerRef.current = null;
        setNcFlow("idle");
      }
      ncPrevSidRef.current = storedSessionId;
    }
  }, [ncFlow, storedSessionId]);

  // Only trigger the greeting when the session was actively RESUMED (resetSignal),
  // not just on reload — to avoid the duplicate greeting turn after every reload
  // or navigation back to the new-chat screen. The real "user started a new chat"
  // is captured by resetSignal > 0; reload leaves resetSignal unchanged.
  useEffect(() => {
    if (greetPendingRef.current && !storedSessionId && !isStreaming && resetSignal > 0) {
      greetPendingRef.current = false;
      void send("New chat just started. Greet me briefly and naturally, then ask what I'd like to work on.", { silent: true });
    }
  }, [storedSessionId, isStreaming, resetSignal]);






  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const suggestions = [
    { label: "System status", prompt: "/status" },
    { label: "Token usage", prompt: "/usage" },
    { label: "My skills", prompt: "/skills" },
    { label: "What can you do?", prompt: "What can you do? Give me a short overview." },
  ];

  const empty = messages.length === 0 && !isStreaming;

  // A11y: role=log + aria-live on the scroll container re-announced the ENTIRE
  // conversation on every token (the reveal animation mutates text ~60x/sec).
  // WAI-ARIA practice is one small polite region carrying only settled state,
  // so a screen reader says "Astra is replying" once, then reads the finished
  // answer once. Tokens themselves are never announced.
  const liveAnnouncement = (() => {
    if (failedUp) return `Upload failed: ${attachments.find((a) => a.status === "error")?.name ?? "file"}`;
    if (uploading) {
      const n = attachments.filter((a) => a.status === "uploading").length;
      return `Uploading ${n} file${n === 1 ? "" : "s"}`;
    }
    if (attachments.length > 0 && doneCount === attachments.length) return "Files ready";
    if (isStreaming) return "Astra is replying";
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || last.isStreaming) return "";
    const text = last.segments.filter((s) => s.kind === "text").map((s) => s.text ?? "").join(" ").trim();
    return text ? `Astra replied: ${text.slice(0, 600)}` : "";
  })();

  return (
    <main
      onDragOver={(e) => { if (e.dataTransfer?.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={(e) => {
        if (!e.dataTransfer?.types.includes("Files")) return;
        e.preventDefault();
        setDragOver(false);
        // Attachments queue for the NEXT turn — allowed mid-stream too.
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length) setAttachments((a) => [...a, ...filesToAttachments(files)]);
      }}className="relative flex h-full min-w-0 flex-1 flex-col">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveAnnouncement}</p>
      {errorBanner && (() => {
        // Transport states are the ConnectionBanner's job; the red banner keeps
        // only actionable non-transport errors (auth, model backend, failures).
        let cat = "Action";
        let title = errorBanner;
        if (errorBanner.includes("Unauthorized") || errorBanner.includes("log in")) cat = "Auth";
        else if (errorBanner.includes("503") || errorBanner.includes("Agent backend")) cat = "Model";
        else if (errorBanner.includes("Connection") || errorBanner.includes("reconnect") || errorBanner.includes("contact")) cat = "Connection";

        return (
          <div role="alert" className="absolute top-0 left-0 right-0 z-20 flex items-center justify-center gap-2 bg-[var(--surface-overlay)] py-1.5 px-4 text-xs font-mono border-b border-red-500/20">
            <TriangleAlert className="w-3.5 h-3.5 text-red-400" />
            <span className="font-semibold text-red-400">[{cat}]</span>
            <span className="text-slate-300">{title}</span>
            {!isStreaming && lastPromptRef.current && (
              <button type="button" onClick={retry} className="ml-1 underline decoration-dotted underline-offset-2 hover:text-slate-200 text-slate-400">retry</button>
            )}
          </div>
        );
      })()}
      <ConnectionBanner state={conn} onRetry={retryConnection} nextRetryIn={nextRetryIn} />

      <header className={cn("relative z-10 flex items-center justify-between border-b border-white/[0.07] px-3 py-3 lg:px-6 lg:min-h-[77px] lg:py-0", errorBanner && "mt-7")}>
        <span className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => onOpenNav?.()}
            aria-label="Open navigation" aria-expanded={false} aria-controls="astra-sidebar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-white/5 lg:hidden">
            <img src="/astra-logo.png" alt="" aria-hidden="true" className="h-7 w-7 object-contain" />
          </button>
          {empty ? (
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">new session</span>
          ) : (
            <ChatTitle storedSessionId={storedSessionId} title={chatTitle} onTitleChange={(t) => applyTitle(storedSessionId, t, true)} />
          )}
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
          {storedSessionId && !empty && (
            <button type="button" onClick={() => (endArm ? void doEndSession() : setEndArm(true))}
              aria-label="End session" title={endArm ? "Click again to end this session" : "End session — saves the transcript for training, then closes the chat"}
              disabled={isStreaming || endBusy}
              className={`flex h-10 items-center gap-2 rounded-lg px-3 text-sm transition-[background-color,box-shadow,opacity] duration-150 active:scale-[0.97] motion-reduce:transition-none max-lg:h-10 max-lg:w-10 max-lg:justify-center max-lg:p-0 disabled:opacity-40 ${endArm ? "bg-redx/20 text-red-300 shadow-[0_0_16px_rgba(248,113,113,0.2)] hover:bg-redx/30" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}>
              {endBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4 max-lg:h-5 max-lg:w-5" strokeWidth={2} />}
              <span className="max-lg:hidden">{endArm ? "End it?" : endBusy ? "Ending…" : "End session"}</span>
            </button>
          )}
          <TrainingStatus open={trainingOpen} onToggle={() => setTrainingOpen((v) => !v)} />
          <button type="button" onClick={onNewChatClick}
            aria-label="New chat" title="New chat" data-ncflow={ncFlow} disabled={ncFlow !== "idle"}
            className="nc-btn flex h-10 items-center gap-2 rounded-lg px-4 text-sm shadow-[0_0_16px_rgba(34,211,238,0.12)] transition-[border-color,background-color,box-shadow,opacity] duration-150 hover:shadow-[0_0_22px_rgba(34,211,238,0.25)] active:scale-[0.97] motion-reduce:transition-none max-lg:h-10 max-lg:w-10 max-lg:justify-center max-lg:p-0">
            {ncFlow === "idle" && <Plus className="h-4 w-4 max-lg:h-5 max-lg:w-5" strokeWidth={2} />}
            {ncFlow === "press" && (
              <span aria-hidden="true" className="nc-btn-spin-wrap max-lg:absolute max-lg:inset-0 max-lg:flex max-lg:items-center max-lg:justify-center">
                <Loader2 className="nc-btn-spin h-4 w-4 max-lg:h-5 max-lg:w-5" strokeWidth={2} />
              </span>
            )}
            {ncFlow === "press" && <span className="nc-btn-progress" aria-hidden="true" />}
            <span className="max-lg:hidden">{ncFlow === "press" ? "Starting…" : "New chat"}</span>
          </button>
        </span>
      </header>

      <div ref={listRef} onScroll={onScroll} className="chat-scroll relative z-10 min-h-0 flex-1" role="log" aria-label="Conversation">
        {histLoading && messages.length === 0 ? (
          <ChatFeedSkeleton />
        ) : ncFlow === "skeleton" ? (
          <NewChatGreetSkeleton />
        ) : empty ? (
          <div className="chat-welcome">
            <img src="/astra-logo.png" alt="" aria-hidden="true" className="chat-welcome-glyph" />
            <h2 className="chat-welcome-title">{greeting}, Jitin</h2>
            <p className="chat-welcome-sub">What are we working on?</p>
            <div className="chat-welcome-grid">
              {suggestions.map((s, i) => (
                <button key={s.label} type="button" className="chat-suggest" style={{ "--i": i } as CSSProperties}
                  onClick={() => void send(s.prompt)}>
                  <span className="chat-suggest-label">{s.label}</span>
                  <span className="chat-suggest-hint">{s.prompt}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
            <div ref={contentRef} className="chat-feed mx-auto flex w-full max-w-[52rem] flex-col gap-6 px-4 py-8">
              {olderLoading && (
                <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted" aria-live="polite">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading earlier messages…
                </div>
              )}
              {messages.map((m, idx) => {
                if (m.isSysNote && m.bgId) {
                  const it = bgItems.find((x) => x.id === m.bgId);
                  if (it && !it.dismissed) {
                    return it.kind === "steer"
                      ? <SteerNote key={m.id} item={it} onDismiss={dismissBgItem} />
                      : <BgNote key={m.id} item={it} onDismiss={dismissBgItem} />;
                  }
                  if (it?.dismissed) return null;
                  return null;
                }
                return (
                <div key={m.id} data-msg-id={m.id} className={m.isSysNote ? "chat-sys-note" : "flex w-full items-start"}>
                {m.isSysNote ? (
                  <>◈ {m.content}</>
                ) : null}
                {!m.isSysNote && (
                <div className="min-w-0 w-full">
                  {m.role === "user" ? (
                    <div>
                      <UserBubble msg={m} avatarUrl={avatarUrl} onOpenMedia={openMedia} />
                    </div>
                  ) : m.segments.length ? (
                    <TurnTimeline segments={m.segments} streaming={m.isStreaming} sessionId={storedSessionId || ""} ts={m.ts} onToggleTool={toggleToolCollapse} onApprovalRespond={respondApproval} onGateRespond={respondGate} onClarifyAnswer={respondClarify} onOpenMedia={openMedia} />
                  ) : m.isStreaming ? (
                    <span className="chat-bubble-ai flex w-full items-center rounded-2xl px-3 py-2.5">
                      <AITextLoading texts={["Thinking...", "Working on it...", "Almost there..."]} />
                    </span>
                  ) : null}
                  {!m.isSysNote && (m.role === "user" || !m.isStreaming) && (
                    <div className="chat-actions">
                      {m.role === "user" ? (
                        <>
                          <AnimatedCopyButton text={m.content} />
                          {!isStreaming && (
                            <button type="button" aria-label="Edit message" title="Edit"
                              onClick={() => {
                                setInput(m.content.replace(/\n\nAttached file: .*/g, ""));
                                setAttachments((m.files ?? []).map((f) => ({ id: newId(), name: f.name, size: 0, status: "done" as const, progress: 100, serverPath: f.path })));
                                setMessages(p => p.slice(0, idx));
                                setTimeout(() => taRef.current?.focus(), 0);
                              }}>
                              <Pencil />
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <AnimatedCopyButton
                            text={m.segments.filter((s) => s.kind === "text").map((s) => s.text ?? "").join("\n\n")} />
                          {!isStreaming && idx === messages.length - 1 && m.segments.length > 0 && !m.segments.some((s) => s.kind === "approval" && s.resolved == null) && (
                            <button type="button" aria-label="Regenerate message" title="Regenerate"
                              onClick={() => retry()}>
                              <RotateCcw />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="relative z-10 px-3 pb-3 lg:px-6 lg:pb-6">
        <SubagentPanel subs={roster} open={suba.open} setOpen={suba.setOpen} now={suba.now} rpc={rpc} sessionId={liveSessionId || storedSessionId || null} />
        <BgDock items={bgItems} onSubmitFollowUp={handleFollowUpBg} onDismiss={dismissBgItem} onOpenItem={openBgItem} />
        <div className={cn("chat-composer mx-auto w-full max-w-[52rem]", dragOver && "drag-over")}>
          {/* Fewer comet bands on low-memory/low-core devices (see composer-trace). */}
          <ComposerTrace bands={LOW_SPEC ? 10 : 28} />
          {dragOver && (
            <div className="chat-drop-overlay" aria-hidden="true">Drop to attach</div>
          )}
          {!atBottom && (
            <button
              type="button"
              className="chat-jump"
              // Available whenever the user is away from the live edge, not just
              // mid-stream: the transcript is scrollable long after a turn ends
              // (2.6k px of content in a 444px viewport), and gating this on
              // isStreaming left the only way back to be a manual drag.
              aria-label={isStreaming ? "Jump to latest — Astra is still replying" : "Jump to latest message"}
              onClick={() => {
                const el = listRef.current;
                if (el) {
                  el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
                  // Seed the intent tracker at the destination: a smooth scroll
                  // fires many events on the way down, and a stale low value
                  // would read as the reader scrolling up and unstick instantly.
                  lastScrollTopRef.current = el.scrollHeight;
                }
                setAtBottom(true);
              }}
            >
              <ChevronDown className="h-4 w-4" strokeWidth={1.5} /> Jump to latest
              {isStreaming && <span className="chat-jump-live" aria-hidden="true" />}
            </button>
          )}
          {slashOpen && slashMatches.length > 0 && (
            <div className="chat-menu chat-slash-menu" role="listbox" aria-label="Slash commands">
              <p className="chat-menu-label">TUI commands — work here too</p>
              {slashMatches.map((c, i) => (
                <button key={c} type="button" className={cn("chat-menu-item", i === slashActive && "chat-menu-item-active")}
                  aria-selected={i === slashActive} onMouseDown={(e) => { e.preventDefault(); pickSlash(c); }}>
                  {c}
                </button>
              ))}
            </div>
          )}
          <AttachmentTray items={attachments} onRemove={removeAttachment} onRetry={retryAttachment} countLabel={sendHint || (attachments.length > 0 ? `${attachments.length} file${attachments.length === 1 ? "" : "s"}` : undefined)} />
          <div className="composer-field">
            <textarea
              ref={taRef}
              rows={1}
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={onKey}
              onPaste={onPaste}
              placeholder=""
              aria-label="Message Astra"
              className={"chat-composer-input" + (recognizedCmd ? " cmd-active" : "")}
            />
            {recognizedCmd && (
              <div className="cmd-mirror" aria-hidden="true">
                <span className="cmd-slash">/</span><span>{recognizedCmd.slice(1)}{input.slice(recognizedCmd.length)}</span>
              </div>
            )}
            <RotatingPlaceholder
              phrases={
                isStreaming
                  ? ["Reply, /bg to queue, /steer to correct…", "/steer redirects the running task…"]
                  : empty
                    ? ["Message Astra…", "/ for commands", "Ask anything — Astra can browse, build, and deploy…"]
                    : ["Reply…", "Continue the conversation…"]
              }
              active={input.length === 0}
            />
          </div>
          <div className="chat-composer-bar">
            <ComposerControls
              setAttachments={setAttachments}
              sessionInfo={sessionInfo}
              catalog={catalog}
              onOpen={refreshCatalog}
              sessionPending={!!storedSessionId && !sessionInfo}
              onToggleYolo={onToggleYolo}
              onPickModel={onPickModel}
              onPickEffort={onPickEffort}
            />
            <span className="chat-composer-hint">{isStreaming ? "Sends queue after the reply · Shift+Enter newline" : "Enter to send · Shift+Enter for newline"}</span>
            {isStreaming && (
              <button
                type="button" onClick={stop}
                aria-label="Stop generation"
                title="Stop generation"
                className="chat-send chat-send-stop"
              >
                <Square className="h-3.5 w-3.5" fill="currentColor" />
              </button>
            )}
            <button
              type="button" onClick={() => void send()}
              disabled={!canSend}
              aria-label={sendHint || (isStreaming ? "Queue message" : "Send message")}
              title={sendHint || undefined}
              className="chat-send"
              data-sent={sentFlash || undefined}
            >
              {sentFlash ? <Check className="h-4 w-4" strokeWidth={2} /> : <ArrowUp className="h-4 w-4" strokeWidth={1.8} />}
            </button>
          </div>
        </div>
      </div>
      {viewer && (
        <Suspense fallback={null}>
          <MediaViewer items={viewer.items} index={viewer.index} onClose={() => setViewer(null)} />
        </Suspense>
      )}
      <ToastHost muted={!!viewer} />
    </main>
  );
}
