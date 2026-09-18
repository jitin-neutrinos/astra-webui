import { useEffect, useRef, useState, useCallback } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { ArrowUp, Square, AlertTriangle, RotateCcw, Maximize2, X, Copy, Pencil, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHermesWS } from "@/lib/hermes-ws";
import type { EventPayload } from "@/lib/hermes-ws";
import { normalizeMessages } from "@/lib/normalize-messages";
import { copyText } from "@/lib/copy-text";
import AITextLoading from "@/components/ui/ai-text-loading";
import { getFileKind, } from "@/lib/session-files";
import {
  applySegmentOps, finalizeSegments, findNewestCollapsedToolSeg, expandKeyBlocked, TurnTimeline,
  usePrefersReducedMotion, MediaCard,
  type Segment, type SegOp,
} from "./chat-timeline";
import { ComposerControls, type Attachment } from "./composer-controls";
import { getHermesHome, getCatalog } from "@/lib/session-files";
import type { CatalogPayload } from "./composer-controls";

// Source: ~/.hermes/plugins/astra-brand/dashboard/dist/astra-core.js CHAT_TUI_COMMANDS
// (the TUI's registered slash commands — submitted as plain prompt text, same as the terminal).
const TUI_COMMANDS = [
  "/model", "/reasoning", "/new", "/sessions", "/compact", "/usage",
  "/skills", "/tools", "/memory", "/approvals", "/help", "/stop", "/status",
];

type ChatMsg = { isSysNote?: boolean; content?: string; files?: {name: string, path: string}[] } & (
    | { id: string; role: "user"; content: string; ts?: number }
    | { id: string; role: "assistant"; segments: Segment[]; isStreaming: boolean; ts?: number } );

// home dir for upload targets (bootstrap once); in-flight XHRs by attachment id
const hermesHomeRef: { p: Promise<string> | null } = { p: null };
const homeP = () => hermesHomeRef.p ?? (hermesHomeRef.p = getHermesHome().catch((e) => { hermesHomeRef.p = null; throw e; }));

let idSeq = 0;
const nextId = () => `m${++idSeq}-${Date.now()}`;

const BATCH_MS = 40; // ~30-60ms batching window for both text deltas and step ops



function textOf(payload: any): string {
  return payload?.delta?.text ?? payload?.text ?? payload?.rendered ?? "";
}
function thinkingOf(payload: any): string {
  return payload?.delta?.thinking ?? payload?.text ?? payload?.rendered ?? "";
}

export function ChatLanding({ resetSignal, selectedSessionId }: { resetSignal: number, selectedSessionId: string | null }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [popout, setPopout] = useState(false);
  const popTaRef = useRef<HTMLTextAreaElement>(null);
  const [errorBanner, setErrorBanner] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashActive, setSlashActive] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const reducedMotion = usePrefersReducedMotion();

  const liveSidRef = useRef<string | null>(null);
  const titledRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  const pendingOpsRef = useRef<SegOp[]>([]);
  const opsTimerRef = useRef<number | null>(null);
  const lastPromptRef = useRef("");
  const lastScrolledApprovalRef = useRef<string | null>(null);
  const xhrPathRef = useRef<Promise<string> | null>(null);
  const xhrRef = useRef<Map<string, XMLHttpRequest>>(new Map());
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  useEffect(() => {
    xhrPathRef.current = homeP();
    getCatalog().then((c) => setCatalog(c)).catch(() => { /* popover shows fallback rows */ });
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

  const handleEvent = useCallback((ev: EventPayload) => {
    const { type, payload } = ev;

    if (type === "proxy.status") {
      setErrorBanner(payload.state === "reconnecting" ? "Connection lost. Reconnecting..." : "");
      return;
    }

    if (type === "message.start") {
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
      pushOp({ op: "tool", key: payload?.tool_id, label: name, argsText, command: String(command) });
      return;
    }

    if (type === "tool.generating") {
      ensureActive();
      const name = payload?.name;
      let argsText = "";
      if (payload?.args !== undefined) { try { argsText = JSON.stringify(payload.args, null, 2).slice(0, 6000); } catch { /* noop */ } }
      const command = payload?.args?.command || payload?.args?.cmd || "";
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
      pushOp({ op: "tool-done", key: payload?.tool_id, label: payload?.name, resultText, exitCode });
      return;
    }

    if (type === "message.complete" || type === "message.error") {
      finalizeActive();
      return;
    }

    if (type === "approval") {
      ensureActive();
      pushOp({ op: "approval", reqId: payload?.id, params: payload?.params || {} }, true);
      return;
    }

    if (type === "request.cancel") {
      if (payload?.id) resolveApproval(payload.id, null);
      return;
    }

    if (type === "ws.closed") {
      // Interrupted/dropped turns never emit message.complete — finalize here too.
      finalizeActive();
      return;
    }
  }, [ensureActive, pushOp, finalizeActive, resolveApproval]);

  const { isStreaming, submitPrompt, interrupt, storedSessionId, setStoredSessionId, sendApprovalResponse, sessionInfo, setSessionInfo, rpc, liveSessionId, resetSession } = useHermesWS(handleEvent);

  const respondApproval = useCallback((reqId: string, choice: string) => {
    sendApprovalResponse(reqId, choice);
    resolveApproval(reqId, choice);
  }, [sendApprovalResponse, resolveApproval]);

  const toggleToolCollapse = useCallback((segId: string) => {
    setMessages((m) => m.map((msg) => msg.role === "assistant"
      ? { ...msg, segments: msg.segments.map((s) => s.id === segId ? { ...s, collapsed: !s.collapsed } : s) }
      : msg));
  }, []);

  useEffect(() => {
    if (selectedSessionId) setStoredSessionId(selectedSessionId);
  }, [selectedSessionId, setStoredSessionId]);

  useEffect(() => {
    if (activeIdRef.current != null) liveSidRef.current = storedSessionId;
    if (storedSessionId && lastPromptRef.current && !titledRef.current) {
      fetch(`/api/hx/sessions/${encodeURIComponent(storedSessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: lastPromptRef.current.split("\n")[0].slice(0, 48) }),
      }).catch(() => {});
      titledRef.current = true;
    }
  }, [storedSessionId]);

  useEffect(() => {
    async function loadHistory() {
      if (!storedSessionId) { setMessages([]); return; }
      try {
        const res = await fetch(`/api/hx/sessions/${encodeURIComponent(storedSessionId)}/messages?order=oldest&limit=500`);
        if (!res.ok) {
          if (res.status === 401) setErrorBanner("Unauthorized. Please log in.");
          else if (res.status === 503) setErrorBanner("Agent backend busy (503).");
          else setErrorBanner("Failed to load history.");
          if (liveSidRef.current !== storedSessionId) setMessages([]);
          return;
        }
        const data = await res.json();
        // The history REST endpoint returns plain {role, content} rows only — no
        // persisted step data — so historical turns render as a single plain text
        // segment rather than fabricating tool/thinking blocks that never happened.
        const rows = normalizeMessages(data.messages || []);
        // Restore any saved input draft for this session
        try { const d = sessionStorage.getItem("draft_input_" + (storedSessionId || "global")); if (d) { setInput(d); sessionStorage.removeItem("draft_input_" + (storedSessionId || "global")); } } catch { }
        
        const norm = (s: string) => s.replace(/\n\nAttached file: .*/g, "").replace(/\s+$/g, "");
        const sameMsg = (live: ChatMsg, row: { role: string; content: string }) => {
          if (live.isSysNote || live.role !== row.role) return false;
          if (live.role === "user") return norm(live.content) === norm(row.content);
          const t = live.segments.filter((s) => s.kind === "text").map((s) => s.text ?? "").join("\n\n");
          return norm(t) === norm(row.content) && t !== "";
        };
        const toMsg = (r: any): ChatMsg => r.role === "user"
          ? { id: nextId(), role: "user", content: r.content }
          : { id: nextId(), role: "assistant", isStreaming: false, segments: [{ id: nextId(), kind: "text", status: "done", text: r.content }] };

        const sid = storedSessionId;
        setMessages((live) => {
          if (liveSidRef.current !== sid || live.length === 0) return rows.map(toMsg);
          if (activeIdRef.current != null) return live;
          let li = live.length - 1, ri = rows.length - 1;
          while (li >= 0 && ri >= 0 && sameMsg(live[li], rows[ri])) { li--; ri--; }
          return [...rows.slice(0, ri + 1).map(toMsg), ...live.slice(li + 1)];
        });
        setErrorBanner("");
      } catch {
        setErrorBanner("Failed to load history.");
        if (liveSidRef.current !== storedSessionId) setMessages([]);
      }
    }
    loadHistory();
  }, [storedSessionId]);

  const send = async (raw?: string) => {
    let finalText = (raw ?? input).trim();
    if (!finalText && attachments.length === 0) return;
    if (isStreaming || attachments.some((a) => a.status === "uploading")) return;
    
    const files = attachments.map(a => ({ name: a.file.name, path: a.serverPath! }));
    if (files.length > 0) {
      finalText += (finalText ? "\n\n" : "") + files.map(f => `Attached file: ${f.path}`).join("\n");
    }
    // images reach the model as vision input too (best-effort; path-only on failure)
    for (const f of files) {
      if (getFileKind(f.name) === "image") {
        rpc("image.attach", { session_id: liveSessionId || undefined, path: f.path }).catch(() => { /* path in text is the fallback */ });
      }
    }

    lastPromptRef.current = finalText;
    try { sessionStorage.setItem("draft_input_" + (liveSessionId || "global"), input); } catch { }
    setInput("");
    setSlashOpen(false);
    setAttachments([]);
    
    setMessages((m) => [...m, { id: nextId(), role: "user", content: (raw ?? input).trim(), ts: Date.now(), files }]);
    
    const id = nextId();
    activeIdRef.current = id;
    setMessages((m) => [...m, { id, role: "assistant", segments: [], isStreaming: true, ts: Date.now() }]);
    setAtBottom(true);
    setTimeout(() => submitPrompt(finalText), 0);
    taRef.current?.focus();
  };

  const retry = () => { if (!isStreaming && lastPromptRef.current) void send(lastPromptRef.current); };

  const stop = () => {
    interrupt();
    finalizeActive();
  };

  const onToggleYolo = async () => {
    const next = !sessionInfo?.yolo;
    // Optimistic (create a stub when no session yet — session.info reconciles later)
    setSessionInfo((prev: any) => ({ ...(prev || {}), yolo: next }));
    try {
      const res = await rpc("config.set", { key: "yolo", value: next ? "1" : "0" });
      if (res && res.key === "yolo") {
        setMessages((m) => [...m, {
          id: nextId(), role: "assistant", segments: [], isStreaming: false, isSysNote: true,
          content: next ? "Yolo mode active — tool calls in this chat run without approval" : "Yolo mode off — tool calls ask for approval first"
        } as any]);
      }
    } catch {
      // Revert
      setSessionInfo((prev: any) => ({ ...(prev || {}), yolo: !next }));
    }
  };

  const onPickModel = async (model: string, provider: string) => {
    const prevModel = sessionInfo?.model;
    const prevProv = sessionInfo?.provider;
    setSessionInfo((prev: any) => ({ ...(prev || {}), model, provider }));
    try {
      // Verified grammar: methods_config_set.py _set_model → parse_model_switch_args
      await rpc("config.set", { key: "model", value: `${model} --provider ${provider} --session` });
    } catch {
      setSessionInfo((prev: any) => ({ ...(prev || {}), model: prevModel, provider: prevProv }));
    }
  };

  const onPickEffort = async (effort: string) => {
    const prev = sessionInfo?.reasoning_effort;
    setSessionInfo((prevS: any) => ({ ...(prevS || {}), reasoning_effort: effort }));
    try {
      // Key is "reasoning" (_CONFIG_SETTERS), not "reasoning_effort"
      await rpc("config.set", { key: "reasoning", value: effort });
    } catch {
      setSessionInfo((prevS: any) => ({ ...(prevS || {}), reasoning_effort: prev }));
    }
  };

  // Upload one file via XHR (progress events); path targets <home>/uploads so
  // the agent sees host paths. 503 {error:"reauth"} → one silent retry.
  const startUpload = useCallback((a: Attachment) => {
    const fd = new FormData();
    fd.append("file", a.file);
    xhrPathRef.current?.then((home) => {
      fd.append("path", `${home}/uploads/${a.file.name}`);
      fd.append("overwrite", "true");
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

  const onInputChange = (v: string) => {
    setInput(v);
    if (v.startsWith("/") && !v.includes(" ")) { setSlashOpen(true); setSlashActive(0); }
    else setSlashOpen(false);
    // auto-grow: height follows content up to max-height (CSS caps at 200px)
    const ta = taRef.current;
    if (ta) { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; }
  };

  const slashMatches = TUI_COMMANDS.filter((c) => c.startsWith(input));

  const pickSlash = (cmd: string) => {
    setInput(cmd + " ");
    setSlashOpen(false);
    taRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen && slashMatches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashActive((i) => (i + 1) % slashMatches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashActive((i) => (i - 1 + slashMatches.length) % slashMatches.length); return; }
      if (e.key === "Escape") { setSlashOpen(false); return; }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); pickSlash(slashMatches[slashActive] || slashMatches[0]); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  // Ctrl+O expands the newest collapsed tool block (real key, matches the TUI).
  // Fired only for a bare Ctrl/Cmd+O outside the composer — typing Ctrl+O while
  // focused in the textarea must stay a no-op (reference ChatPageV2 gate).
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
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
  }, []);

  // Stick-to-bottom: only auto-scroll on new content if already at bottom.
  // Instant ("auto") on purpose: deltas land every ~40ms and a smooth scroll
  // is cancelled+restarted by each batch, so the view lags behind the bottom
  // during fast streaming (reference ChatPageV2 pins with scrollTop directly).
  useEffect(() => {
    const el = listRef.current;
    if (el && atBottom) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [messages, atBottom, reducedMotion]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
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
      setAttachments([]);
      setErrorBanner("");
      activeIdRef.current = null;
      pendingOpsRef.current = [];
      titledRef.current = false;
    }
  }, [resetSignal, resetSession]);

  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const suggestions = [
    { label: "System status", prompt: "/status" },
    { label: "Token usage", prompt: "/usage" },
    { label: "My skills", prompt: "/skills" },
    { label: "What can you do?", prompt: "What can you do? Give me a short overview." },
  ];

  const empty = messages.length === 0 && !isStreaming;

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col">
      <div className="pointer-events-none absolute inset-0 retro-grid opacity-40" aria-hidden="true" />

      {errorBanner && (
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-center gap-2 bg-red-500/10 py-1.5 px-4 text-xs font-mono text-red-400 border-b border-red-500/20 backdrop-blur-sm">
          <AlertTriangle className="w-3.5 h-3.5" />
          {errorBanner}
        </div>
      )}

      <header className={cn("relative z-10 flex items-center justify-between border-b border-white/[0.07] px-3 py-3 lg:px-6", errorBanner && "mt-7")}>
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
          {empty ? "new session" : `session // ${messages.length} msgs`}
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> online
        </span>
      </header>

      <div ref={listRef} onScroll={onScroll} className="chat-scroll relative z-10 min-h-0 flex-1" role="log" aria-live="polite" aria-label="Conversation">
        {empty ? (
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
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
            {messages.map((m, idx) => (
              <div key={m.id} className={m.isSysNote ? "chat-sys-note" : "flex items-start gap-3"}>
                {m.isSysNote ? (
                  <>◈ {m.content}</>
                ) : m.role === "assistant" ? (
                  <img src="/astra-logo.png" alt="" aria-hidden="true"
                    className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover shadow-[0_0_12px_rgba(34,211,238,0.3)]" />
                ) : (
                  <span aria-hidden="true"
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 font-mono text-xs text-slate-300">J</span>
                )}
                {!m.isSysNote && (
                <div className="min-w-0 flex-1">
                  {m.ts != null && (
                    <div className="chat-turn-ts">{new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  )}
                  {m.role === "user" ? (
                    <div>
                      {m.files && m.files.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-2">
                          {m.files.map(f => <MediaCard key={f.path} path={f.path} name={f.name} />)}
                        </div>
                      )}
                      <div className="min-w-0 whitespace-pre-wrap rounded-2xl bg-white/[0.06] px-4 py-3 text-sm leading-relaxed text-slate-200">
                        {m.content.replace(/\n\nAttached file: .*/g, "")}
                      </div>
                    </div>
                  ) : m.segments.length ? (
                    <TurnTimeline segments={m.segments} streaming={m.isStreaming} onToggleTool={toggleToolCollapse} onApprovalRespond={respondApproval} />
                  ) : m.isStreaming ? (
                    <span className="flex w-fit items-center rounded-2xl border border-cyanx/15 bg-midnight/80 px-3 py-1.5">
                      <AITextLoading texts={["Thinking...", "Working on it...", "Almost there..."]} />
                    </span>
                  ) : null}
                  {!m.isSysNote && (m.role === "user" || !m.isStreaming) && (
                    <div className="chat-actions">
                      {m.role === "user" ? (
                        <>
                          <button type="button" aria-label="Copy message" title="Copy" disabled={!m.content}
                            onClick={() => void copyText(m.content)}>
                            <Copy />
                          </button>
                          {!isStreaming && (
                            <button type="button" aria-label="Edit message" title="Edit"
                              onClick={() => {
                                setInput(m.content.replace(/\n\nAttached file: .*/g, ""));
                                setMessages(p => p.slice(0, idx));
                                setTimeout(() => taRef.current?.focus(), 0);
                              }}>
                              <Pencil />
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <button type="button" aria-label="Copy message" title="Copy"
                            disabled={!m.segments.some((s) => s.kind === "text" && !!s.text)}
                            onClick={() => void copyText(m.segments.filter((s) => s.kind === "text").map((s) => s.text ?? "").join("\n\n"))}>
                            <Copy />
                          </button>
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
            ))}
          </div>
        )}
      </div>

      <div className="relative z-10 px-3 pb-3 lg:px-6 lg:pb-6">
        <div className="chat-composer mx-auto max-w-3xl">
          {isStreaming && !atBottom && (
            <button type="button" className="chat-jump" onClick={() => {
              listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
              setAtBottom(true);
            }}>
              <ChevronDown className="h-4 w-4" strokeWidth={1.5} /> Jump to latest
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
          {popout && (
    <div className="chat-popout" role="dialog" aria-label="Popped out composer">
      <div className="chat-popout-head">
        <span className="chat-menu-label">Composer — expanded</span>
        <button type="button" className="chat-popout-close" aria-label="Close expanded composer" title="Close"
          onClick={() => { setPopout(false); setTimeout(() => taRef.current?.focus(), 60); }}>
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
      <textarea
        ref={popTaRef}
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!isStreaming && input.trim()) { void send(); setPopout(false); } }
          if (e.key === "Escape") { setPopout(false); setTimeout(() => taRef.current?.focus(), 60); }
        }}
        placeholder={isStreaming ? "Astra is replying…" : "Message Astra…"}
        aria-label="Message Astra (expanded)"
        className="chat-popout-input"
      />
    </div>
  )}
  <textarea
            ref={taRef}
            rows={1}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKey}
            placeholder={isStreaming ? "Astra is replying…" : empty ? "Message Astra… (/ for commands)" : "Reply…"}
            aria-label="Message Astra"
            className="chat-composer-input"
          />
          <div className="chat-composer-bar">
            <button type="button" className={cn("chat-chip", "chat-popout-chip", popout && "chat-chip-active")} disabled={isStreaming}
              aria-pressed={popout} aria-label="Pop out composer" title="Pop out composer"
              onClick={() => { setPopout(!popout); setTimeout(() => popTaRef.current?.focus(), 60); }}>
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
            <ComposerControls
              disabled={isStreaming}
              attachments={attachments}
              setAttachments={setAttachments}
              sessionInfo={sessionInfo}
              catalog={catalog}
              onToggleYolo={onToggleYolo}
              onPickModel={onPickModel}
              onPickEffort={onPickEffort}
              onRemoveAttachment={removeAttachment}
            />
            <span className="chat-composer-hint">Enter to send · Shift+Enter for newline</span>
            {isStreaming ? (
              <button
                type="button" onClick={stop}
                aria-label="Stop generation"
                className="chat-send bg-red-500/20 text-red-400 hover:bg-red-500/30"
              >
                <Square className="h-3.5 w-3.5" fill="currentColor" />
              </button>
            ) : (
              <button
                type="button" onClick={() => void send()}
                disabled={!input.trim()}
                aria-label="Send message"
                className="chat-send"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={1.8} />
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
