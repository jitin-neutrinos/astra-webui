import { useEffect, useState, useCallback } from "react";
import { ArrowLeft, Search, MessageSquare, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import { sourcesParam, sourceLabel } from "@/lib/source-filter";
import { cleanTitle } from "@/lib/chat-title";

interface SessionMeta {
  id: string;
  title?: string | null;
  preview?: string | null;
  last_activity_at?: number;
}

export function ChatsPanel({ onBack, onSelect, activeSessionId }: { onBack: () => void; onSelect: (id: string) => void; activeSessionId?: string | null }) {
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const limit = 10;

  const [filterModal, setFilterModal] = useState<'all'|'web'|'telegram'|'terminal'>('all');

  const fetchSessions = useCallback(async (q: string, off: number) => {
    setLoading(true);
    setError("");
    try {
      const isSearch = q.trim() !== "";
      let url = "";
      if (isSearch) {
        url = `/api/hx/sessions/search?q=${encodeURIComponent(q)}&limit=${limit}&sources=${encodeURIComponent(sourcesParam(filterModal as any))}`;
      } else {
        url = `/api/hx/sessions?limit=${limit}&offset=${off}&order=recent${filterModal !== "all" ? "&sources=" + encodeURIComponent(sourcesParam(filterModal as any)) : ""}`;
      }
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 503) throw new Error("Agent backend busy (503).");
        if (res.status === 401) throw new Error("Unauthorized (401).");
        throw new Error("Failed to load sessions.");
      }
      const data = await res.json();
      if (isSearch) {
        // search rows are messages-with-session-hints; dedupe by session id
        const seen = new Set<string>();
        const rows = (data.results || []).filter((r: any) => {
          const sid = r.session_id || r.id;
          if (!sid || seen.has(sid)) return false;
          seen.add(sid);
          return true;
        });
        setSessions(rows);
        setTotal(rows.length);
      } else {
        setSessions(data.sessions || []);
        setTotal(data.total || 0);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load.");
      setSessions([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filterModal]);

  useEffect(() => {
    setOffset(0);
  }, [filterModal]);

  // The open chat was (re)named - live auto-name or rename: patch its row in place.
  useEffect(() => {
    const on = (e: Event) => {
      const { id, title } = (e as CustomEvent<{ id?: string; title?: string }>).detail || {};
      if (id && title) setSessions((rows) => rows.map((r) => (r.id === id ? { ...r, title } : r)));
    };
    window.addEventListener("astra:chat-title", on);
    return () => window.removeEventListener("astra:chat-title", on);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query.trim() !== "") {
        setOffset(0);
        fetchSessions(query, 0);
      } else {
        fetchSessions("", offset);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, offset, filterModal, fetchSessions]);

  const maxOffset = Math.max(0, total - (total % limit || limit));

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 flex items-center gap-2 border-b border-white/[0.07]">
        <button onClick={onBack} className="nav-back-btn p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-mono text-xs uppercase tracking-widest text-slate-300">Chats</span>
      </div>

      <div className="p-3 border-b border-white/[0.07]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search sessions..."
            className="w-full bg-black/40 border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyanx/50 focus:ring-1 focus:ring-cyanx/50 transition-all"
          />
        </div>
      </div>
      <div className="p-2 flex gap-1.5">
        {["all","web","telegram","terminal"].map((m) => (
          <button key={m} onClick={() => setFilterModal(m as any)} className={"px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wide border transition-colors " + (filterModal === m ? "bg-cyanx text-black border-cyanx" : "bg-white/5 text-slate-400 border-white/10 hover:text-white")}>{m === "all" ? "All" : m === "web" ? "Web" : m === "telegram" ? "Telegram" : "Terminal"}</button>
        ))}
      </div>

      <div className="sidebar-scroll flex-1 overflow-y-auto p-2 space-y-1">
        {loading && sessions.length === 0 ? (
          <div className="p-4 text-center font-mono text-xs text-slate-500">Loading...</div>
        ) : error ? (
          <div className="p-4 flex flex-col items-center gap-2 text-center text-redx/80">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">{error}</span>
            <button onClick={() => fetchSessions(query, offset)} className="text-xs underline hover:text-red-300">Retry</button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="p-4 text-center font-mono text-xs text-slate-500">No sessions found.</div>
        ) : (
          sessions.map(s => {
            const rowId = (s as any).session_id || s.id;
            const isActive = !!activeSessionId && rowId === activeSessionId;
            return (
            <button
              key={s.id}
              onClick={() => onSelect(rowId)}
              aria-current={isActive ? "true" : undefined}
              className={"w-full flex items-start gap-3 p-2.5 rounded-lg text-left transition-colors group press-feedback " + (isActive ? "bg-cyanx/10 border border-cyanx/30" : "border border-transparent hover:bg-white/5")}
            >
              <MessageSquare className={"w-4 h-4 mt-0.5 shrink-0 " + (isActive ? "text-cyanx" : "text-slate-500 group-hover:text-cyanx/70")} />
              <div className="min-w-0 flex-1">
                <span className="inline-block px-1 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider bg-white/5 text-slate-500 mr-1.5">{sourceLabel((s as any).source || "")}</span>
                <div className="text-sm text-slate-300 truncate">{cleanTitle(s.title) || s.preview || "Untitled session"}</div>
                <div className="text-[10px] text-slate-500 font-mono mt-1">
                  {typeof s.last_activity_at === "number" ? new Date(s.last_activity_at * 1000).toLocaleString() : ""}
                </div>
              </div>
            </button>
            );
          })
        )}
      </div>

      {query.trim() === "" && total > limit && (
        <div className="p-3 border-t border-white/[0.07] flex items-center justify-between">
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-mono text-[10px] text-slate-500">
            {offset + 1}-{Math.min(total, offset + limit)} of {total}
          </span>
          <button
            disabled={offset >= maxOffset}
            onClick={() => setOffset(offset + limit)}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
