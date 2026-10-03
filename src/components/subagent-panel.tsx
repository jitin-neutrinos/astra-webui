import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Live sub-agent roster for the current chat session, polled from the gateway's
// existing subagent.list / subagent.tail RPCs over the shared WebSocket. Live
// children only (the roster is removed when a child finishes — the chat timeline
// carries the result), so this panel renders while work is in flight and hides
// itself when the roster empties.

export interface SubagentRow {
  subagent_id: string;
  parent_id?: string | null;
  depth?: number | null;
  goal?: string | null;
  delegation_id?: string | null;
  model?: string | null;
  started_at?: number | null;
  status?: string | null;
  tool_count?: number | null;
  last_tool?: string | null;
  accepting_steer?: boolean | null;
}

const POLL_MS = 3000;
const TAIL_POLL_MS = 2500;
const TAIL_LINES = 14;

function fmtElapsed(startedAt?: number | null, now?: number): string {
  if (!startedAt) return "";
  const s = Math.max(0, Math.floor((now ?? Date.now() / 1000) - startedAt));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

// Transcript tail is JSONL — prefer decoded text content, fall back to raw lines.
function tailLines(text: string): string[] {
  const lines = text.split("\n").filter((l) => l.trim());
  const out: string[] = [];
  for (const line of lines.slice(-TAIL_LINES * 3)) {
    try {
      const j = JSON.parse(line);
      const content = j?.payload?.text ?? j?.payload?.content ?? j?.text ?? j?.content;
      if (typeof content === "string" && content.trim()) out.push(content.trim().replace(/\s+/g, " "));
    } catch {
      if (line.length < 200) out.push(line.trim());
    }
    if (out.length >= TAIL_LINES) break;
  }
  return out.slice(-TAIL_LINES);
}

export function useSubagents(rpc: (m: string, p: any) => Promise<any>, sessionId: string | null, isStreaming: boolean) {
  const [subs, setSubs] = useState<SubagentRow[]>([]);
  const [open, setOpen] = useState(false);
  const hadSubsRef = useRef(false);
  const nowRef = useRef(Date.now() / 1000);

  // 1s ticker only while the panel has rows — drives elapsed timers without re-poling.
  useEffect(() => {
    if (!subs.length) return;
    const t = window.setInterval(() => { nowRef.current = Date.now() / 1000; setSubs((s) => [...s]); }, 1000);
    return () => window.clearInterval(t);
  }, [subs.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sessionId) { setSubs([]); return; }
    let dead = false;
    const poll = async () => {
      try {
        const res = await rpc("subagent.list", { session_id: sessionId });
        if (dead) return;
        const rows: SubagentRow[] = res?.subagents ?? [];
        setSubs(rows);
        if (rows.length > 0 && !hadSubsRef.current) setOpen(true); // auto-open on first spawn
        hadSubsRef.current = rows.length > 0;
      } catch { /* socket down / session not ours — next tick retries */ }
    };
    // Poll while a turn streams OR while children are still alive in the background.
    const active = () => isStreaming || subs.length > 0 || hadSubsRef.current;
    if (!active()) return;
    void poll();
    const t = window.setInterval(poll, POLL_MS);
    return () => { dead = true; window.clearInterval(t); };
  }, [sessionId, isStreaming, subs.length > 0, rpc]); // eslint-disable-line react-hooks/exhaustive-deps

  return { subs, open, setOpen, now: nowRef.current };
}

export function SubagentPanel({ subs, open, setOpen, now, rpc, sessionId }: {
  subs: SubagentRow[];
  open: boolean;
  setOpen: (v: boolean) => void;
  now: number;
  rpc: (m: string, p: any) => Promise<any>;
  sessionId: string | null;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tails, setTails] = useState<Record<string, string[]>>({});
  const tailRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { if (!open) setExpandedId(null); }, [open]);

  useEffect(() => {
    if (!expandedId || !sessionId) return;
    let dead = false;
    const poll = async () => {
      try {
        const res = await rpc("subagent.tail", { session_id: sessionId, subagent_id: expandedId });
        if (!dead && res?.available) setTails((t) => ({ ...t, [expandedId]: tailLines(res.text ?? "") }));
      } catch { /* next tick */ }
    };
    void poll();
    const t = window.setInterval(poll, TAIL_POLL_MS);
    return () => { dead = true; window.clearInterval(t); };
  }, [expandedId, sessionId, rpc]);

  useEffect(() => {
    if (tailRef.current) tailRef.current.scrollTop = tailRef.current.scrollHeight;
  }, [tails]);

  const toggleExpand = useCallback((id: string) => setExpandedId((e) => (e === id ? null : id)), []);

  if (!subs.length) return null;
  const failed = subs.some((s) => s.status && s.status !== "running");

  return (
    <div className="suba-wrap mx-auto w-full max-w-[52rem]" role="region" aria-label="Sub-agent activity">
      <button type="button" className="suba-bar" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={cn("suba-pulse", failed && "suba-pulse-err")} aria-hidden="true" />
        <Bot className="suba-bar-icon" aria-hidden="true" />
        <span className="suba-bar-label">
          {subs.length} sub-agent{subs.length > 1 ? "s" : ""} working
        </span>
        <span className="suba-bar-hint">{open ? "hide" : "overview"}</span>
        <ChevronDown className={cn("suba-bar-chevron", open && "rotate-180")} aria-hidden="true" />
      </button>

      {open && (
        <div className="suba-card">
          {subs.map((s) => {
            const err = s.status && s.status !== "running";
            const lines = tails[s.subagent_id];
            return (
              <div key={s.subagent_id} className="suba-row">
                <button type="button" className="suba-head" aria-expanded={expandedId === s.subagent_id}
                  onClick={() => toggleExpand(s.subagent_id)}>
                  <span className={cn("suba-dot", err ? "suba-dot-err" : "suba-dot-run")} aria-hidden="true" />
                  <span className="suba-goal" title={s.goal || s.subagent_id}>
                    {s.goal?.trim() || s.subagent_id}
                  </span>
                  <span className="suba-meta">
                    {s.model && <span className="suba-model">{s.model.split("/").pop()}</span>}
                    {typeof s.tool_count === "number" && s.tool_count > 0 && (
                      <span className="suba-tools">{s.tool_count} tools</span>
                    )}
                    <span className="suba-elapsed">{fmtElapsed(s.started_at, now)}</span>
                  </span>
                </button>
                {s.last_tool && (
                  <div className="suba-last-tool" title={s.last_tool}>
                    <span className="suba-last-tool-k">now</span> {s.last_tool}
                  </div>
                )}
                {expandedId === s.subagent_id && (
                  <div className="suba-tail" ref={tailRef} aria-label="Live transcript">
                    {lines?.length
                      ? lines.map((l, i) => <div key={i} className="suba-tail-line">{l}</div>)
                      : <div className="suba-tail-line suba-tail-empty">connecting to live transcript…</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
