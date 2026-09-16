import { useEffect, useRef, useState, useCallback } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { ArrowUp, Square, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHermesWS } from "@/lib/hermes-ws";
import type { EventPayload } from "@/lib/hermes-ws";
import { normalizeMessages } from "@/lib/normalize-messages";
import type { Msg } from "@/lib/normalize-messages";
import { ComposerControls, type Attachment } from "./composer-controls";

export function ChatLanding({ resetSignal, selectedSessionId }: { resetSignal: number, selectedSessionId: string | null }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinkingContent, setThinkingContent] = useState("");
  const [isThinking, setIsThinking] = useState(false); // different from streaming, thinking is for thinking.delta
  const [errorBanner, setErrorBanner] = useState("");
  
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const handleEvent = useCallback((ev: EventPayload) => {
    const { type, payload } = ev;
    if (type === "proxy.status") {
      if (payload.state === "reconnecting") {
        setErrorBanner("Connection lost. Reconnecting...");
      } else {
        setErrorBanner("");
      }
      return;
    }
    
    if (type === "message.start") {
      setMessages(m => [...m, { role: "assistant", content: "" }]);
      setThinkingContent("");
      setIsThinking(false);
    } else if (type === "message.delta" && payload?.delta?.text) {
      setMessages(m => {
        const last = m[m.length - 1];
        if (!last || last.role !== "assistant") return m;
        return [...m.slice(0, -1), { ...last, content: last.content + payload.delta.text }];
      });
    } else if (type === "thinking.delta" && payload?.delta?.thinking) {
      setIsThinking(true);
      setThinkingContent(prev => prev + payload.delta.thinking);
    } else if (type === "message.error") {
      setErrorBanner("An error occurred during generation.");
    }
  }, []);

  const { isStreaming, submitPrompt, interrupt, storedSessionId, setStoredSessionId} = useHermesWS(handleEvent);

  useEffect(() => {
    if (selectedSessionId) {
      setStoredSessionId(selectedSessionId);
    }
  }, [selectedSessionId, setStoredSessionId]);

  useEffect(() => {
    async function loadHistory() {
      if (!storedSessionId) {
        setMessages([]);
        return;
      }
      try {
        const res = await fetch(`/api/hx/sessions/${encodeURIComponent(storedSessionId)}/messages?order=oldest&limit=500`);
        if (!res.ok) {
          if (res.status === 401) setErrorBanner("Unauthorized. Please log in.");
          else if (res.status === 503) setErrorBanner("Agent backend busy (503).");
          else setErrorBanner("Failed to load history.");
          setMessages([]);
          return;
        }
        const data = await res.json();
        setMessages(normalizeMessages(data.messages || []));
        setErrorBanner("");
      } catch {
        setErrorBanner("Failed to load history.");
        setMessages([]);
      }
    }
    loadHistory();
  }, [storedSessionId]);

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || isStreaming) return;
    setInput("");
    setMessages(m => [...m, { role: "user", content: text }]);
    // wait for DOM to update then submit
    setTimeout(() => submitPrompt(text), 0);
    taRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, isThinking, thinkingContent]);

  useEffect(() => {
    if (resetSignal > 0) {
      setStoredSessionId(null);
      setMessages([]);
      setInput("");
      setAttachments([]);
      setThinkingContent("");
      setIsThinking(false);
      setErrorBanner("");
    }
  }, [resetSignal, setStoredSessionId]);

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

      <header className={cn("relative z-10 flex items-center justify-between border-b border-white/[0.07] px-6 py-3", errorBanner && "mt-7")}>
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
          {empty ? "new session" : `session // ${messages.length} msgs`}
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> online
        </span>
      </header>

      <div ref={listRef} className="chat-scroll relative z-10 min-h-0 flex-1" role="log" aria-live="polite" aria-label="Conversation">
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
            {messages.map((m, i) => (
              <div key={i} className="flex items-start gap-3">
                {m.role === "assistant" ? (
                  <img src="/astra-logo.png" alt="" aria-hidden="true"
                    className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover shadow-[0_0_12px_rgba(34,211,238,0.3)]" />
                ) : (
                  <span aria-hidden="true"
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 font-mono text-xs text-slate-300">J</span>
                )}
                <div className={cn(
                  "min-w-0 whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed",
                  m.role === "user"
                    ? "bg-white/[0.06] text-slate-200"
                    : "border border-cyanx/15 bg-midnight/80 text-slate-200"
                )}>
                  {m.content}
                  {m.role === "assistant" && i === messages.length - 1 && isThinking && (
                    <div className="mt-2 pl-2 border-l-2 border-cyanx/30 text-xs text-slate-400 font-mono opacity-70">
                      {thinkingContent || "Thinking..."}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isStreaming && messages[messages.length - 1]?.role !== "assistant" ? (
              <div className="flex items-start gap-3">
                <img src="/astra-logo.png" alt="" aria-hidden="true"
                  className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover shadow-[0_0_12px_rgba(34,211,238,0.3)]" />
                <span className="flex items-center gap-1.5 rounded-2xl border border-cyanx/15 bg-midnight/80 px-4 py-3.5">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyanx/70"
                      style={{ animationDelay: `${d * 150}ms` }} />
                  ))}
                </span>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="relative z-10 px-6 pb-6">
        <div className="chat-composer mx-auto max-w-3xl">
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            placeholder={isStreaming ? "Astra is replying\u2026" : empty ? "Message Astra\u2026" : "Reply\u2026"}
            aria-label="Message Astra"
            className="chat-composer-input"
          />
          <div className="chat-composer-bar">
            <ComposerControls
              attachments={attachments}
              setAttachments={setAttachments}
              disabled={isStreaming}
            />
            <span className="chat-composer-hint">Enter to send · Shift+Enter for newline</span>
            {isStreaming ? (
              <button
                type="button" onClick={interrupt}
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
