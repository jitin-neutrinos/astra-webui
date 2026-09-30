import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { SessionsSkeleton } from "./ui/skeletons";
import {
  ArrowLeft, Search, ChevronLeft, ChevronRight, AlertCircle,
  MoreHorizontal, Pin, PinOff, Pencil, Trash2, Check, X, Loader2,
  Globe, TerminalSquare, MessagesSquare,
} from "lucide-react";
import { sourcesParam, type SourceModal } from "@/lib/source-filter";
import { cleanTitle } from "@/lib/chat-title";
import { getUnreadCount, seedFromServer } from "@/lib/notify";
import { rowKey, rowTime, timeAgo, sortRows, mergeRows, type SessionRow } from "@/lib/session-row";
import { UnreadPill } from "./ui/unread-pill";
import { CheckCheck } from "lucide-react";

// Brand glyphs — single-color currentColor marks, no third-party assets.
function TelegramGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.9 6.9-1.7 8.1c-.13.57-.47.71-.95.44l-2.63-1.94-1.27 1.22c-.14.14-.26.26-.53.26l.19-2.68 4.88-4.41c.21-.19-.05-.29-.33-.1l-6.03 3.8-2.6-.81c-.56-.18-.57-.56.12-.83l10.15-3.92c.47-.17.88.11.73.86Z" />
    </svg>
  );
}

function AndroidGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M6 9a6 6 0 0 1 12 0v5H6V9Zm-1.6 0a1.1 1.1 0 0 1 1.1 1.1v3.8a1.1 1.1 0 0 1-2.2 0v-3.8A1.1 1.1 0 0 1 4.4 9Zm15.2 0a1.1 1.1 0 0 1 1.1 1.1v3.8a1.1 1.1 0 0 1-2.2 0v-3.8a1.1 1.1 0 0 1 1.1-1.1ZM8.6 4.9l-.9-1.6a.35.35 0 0 1 .6-.35l.95 1.66A7.2 7.2 0 0 1 12 4.1c.94 0 1.84.16 2.66.46l.94-1.64a.35.35 0 0 1 .61.35l-.9 1.6A6 6 0 0 1 18 8.95H6a6 6 0 0 1 2.6-4.05Zm1.65 1.55a.55.55 0 1 0 0-1.1.55.55 0 0 0 0 1.1Zm3.5 0a.55.55 0 1 0 0-1.1.55.55 0 0 0 0 1.1Z" />
    </svg>
  );
}

function ZapGlyph({ className }: { className?: string }) {
  // One-shot run: a single fired agent run.
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.8L13 2Z" />
    </svg>
  );
}

type GlyphFC = React.FC<{ className?: string }>;

const FILTERS: { key: SourceModal; label: string; icon: GlyphFC }[] = [
  { key: "all", label: "All", icon: MessagesSquare },
  { key: "web", label: "Web", icon: Globe },
  { key: "android", label: "Android", icon: AndroidGlyph },
  { key: "telegram", label: "Telegram", icon: TelegramGlyph },
  { key: "terminal", label: "Terminal", icon: TerminalSquare },
  { key: "oneshot", label: "One-shots", icon: ZapGlyph },
];

const SOURCE_ICON: Record<string, GlyphFC> = {
  webui: Globe, android: AndroidGlyph, telegram: TelegramGlyph, cli: TerminalSquare, tui: TerminalSquare, oneshot: ZapGlyph,
};

function SourceBadge({ source }: { source: string }) {
  const Icon = SOURCE_ICON[source] || MessagesSquare;
  return (
    <span className="ast-src-badge" title={source}>
      <Icon className="w-2.5 h-2.5" />
    </span>
  );
}


// "tok:5.7M $:12.32" — totals across the whole session, model-chip styling.
function fmtTok(n: number | null | undefined): string {
  if (typeof n !== "number" || !isFinite(n) || n <= 0) return "";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k";
  return String(Math.round(n));
}
function fmtUsd(n: number | null | undefined): string {
  if (typeof n !== "number" || !isFinite(n) || n <= 0) return "";
  return n >= 100 ? n.toFixed(0) : n.toFixed(2);
}
export function TokenCostChip({ row }: { row: any }) {
  const tok = (row?.input_tokens || 0) + (row?.output_tokens || 0) + (row?.cache_read_tokens || 0) + (row?.cache_write_tokens || 0);
  const cost = row?.actual_cost_usd ?? row?.estimated_cost_usd;
  const t = fmtTok(tok);
  const c = fmtUsd(cost);
  if (!t && !c) return null;
  return (
    <span className="ast-tok-chip" title={`tokens ${tok.toLocaleString()}${cost ? ` · $${c}` : ""}`}>
      {t ? `tok:${t}` : ""}{t && c ? " " : ""}{c ? `$:${c}` : ""}
    </span>
  );
}

export function ChatsPanel({ onBack, onSelect, activeSessionId }: { onBack: () => void; onSelect: (id: string) => void; activeSessionId?: string | null }) {
  const [query, setQuery] = useState("");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<SourceModal>("all");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [busySid, setBusySid] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const limit = 15;
  const listRef = useRef<HTMLDivElement | null>(null);

  // --- live refresh ---
  useEffect(() => {
    const onUnread = () => setTick(t => t + 1);
    window.addEventListener("astra:unread-changed", onUnread);
    return () => window.removeEventListener("astra:unread-changed", onUnread);
  }, []);

  useEffect(() => {
    const onWs = (e: Event) => {
      const ev = (e as CustomEvent<{ type?: string }>).detail;
      if (ev && (ev.type === "sessions.changed" || ev.type === "session.started")) {
        setTick(t => t + 1);
      }
    };
    window.addEventListener("astra-ws-event", onWs);
    return () => window.removeEventListener("astra-ws-event", onWs);
  }, []);

  // relative timestamps refresh each minute
  useEffect(() => {
    const t = window.setInterval(() => setTick(x => x + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // click-away closes the row menu / rename editor
  useEffect(() => {
    if (menuFor === null && renaming === null) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".ast-row-menu-wrap")) {
        setMenuFor(null);
        setRenaming(null);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuFor, renaming]);

  // close on Escape
  useEffect(() => {
    if (menuFor === null && renaming === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setMenuFor(null); setRenaming(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuFor, renaming]);

  const fetchSessions = useCallback(async (q: string, off: number) => {
    setLoading(true);
    setError("");
    try {
      const isSearch = q.trim() !== "";
      const url = isSearch
        ? `/api/hx/sessions/search?q=${encodeURIComponent(q)}&limit=50&sources=${encodeURIComponent(sourcesParam(filter))}`
        : `/api/hx/sessions?limit=${limit}&offset=${off}&order=recent&sources=${encodeURIComponent(sourcesParam(filter))}`;
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
        const rows = (data.results || []).filter((r: SessionRow) => {
          const sid = rowKey(r);
          if (!sid || seen.has(sid)) return false;
          seen.add(sid);
          return true;
        });
        setSessions(rows);
        setTotal(rows.length);
      } else {
        const rows: SessionRow[] = data.sessions || [];
        seedFromServer(rows as any, null);
        setSessions((prev) => mergeRows(prev, rows));
        setTotal(data.total || 0);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load.");
      setSessions([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // Filter switch is a context change: the merged accumulation belongs to the OLD
  // filter — clear it so the new fetch starts from a blank (skeleton) list.
  useEffect(() => { setOffset(0); setSessions([]); setTotal(0); setLoading(true); }, [filter]);

  // debounced (re)fetch on query/filter/offset; live ticks refetch silently (keep list)
  useEffect(() => {
    const run = async () => {
      if (query.trim() !== "") await fetchSessions(query, 0);
      else await fetchSessions("", offset);
    };
    const isLiveRefresh = tick > 0 && query.trim() === "" && offset === 0;
    const t = setTimeout(run, isLiveRefresh ? 1000 : 300);
    return () => clearTimeout(t);
  }, [query, offset, filter, fetchSessions, tick]);

  // The open chat was (re)named - live auto-name or rename: patch its row in place.
  useEffect(() => {
    const on = (e: Event) => {
      const { id, title } = (e as CustomEvent<{ id?: string; title?: string }>).detail || {};
      if (id && title) setSessions((rows) => rows.map((r) => (rowKey(r) === id ? { ...r, title } : r)));
    };
    window.addEventListener("astra:chat-title", on);
    return () => window.removeEventListener("astra:chat-title", on);
  }, []);

  const patchFlag = useCallback(async (sid: string, body: Record<string, unknown>) => {
    setBusySid(sid);
    try {
      const res = await fetch(`/api/hx/sessions/${encodeURIComponent(sid)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      setSessions((rows) => rows.map((r) => (rowKey(r) === sid ? { ...r, ...body } as SessionRow : r)));
      return true;
    } catch {
      return false;
    } finally {
      setBusySid(null);
    }
  }, []);

  const doDelete = useCallback(async (sid: string) => {
    setBusySid(sid);
    try {
      const res = await fetch(`/api/hx/sessions/${encodeURIComponent(sid)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setSessions((rows) => rows.filter((r) => rowKey(r) !== sid));
      setTotal((t) => Math.max(0, t - 1));
      return true;
    } catch {
      return false;
    } finally {
      setBusySid(null);
    }
  }, []);

  const startRename = (sid: string, current: string) => {
    setMenuFor(null);
    setRenaming(sid);
    setRenameText(current);
  };

  const commitRename = async () => {
    const sid = renaming;
    if (!sid) return;
    const t = renameText.trim();
    setRenaming(null);
    if (!t) return;
    const row = sessions.find((r) => rowKey(r) === sid);
    if (row && cleanTitle(row.title) === t) return;
    await patchFlag(sid, { title: t });
  };

  const visible = useMemo(
    () => (query.trim() !== "" ? sessions : sortRows(sessions)),
    [sessions, query]
  );

  const maxOffset = Math.max(0, total - (total % limit || limit));

  const renderRow = (s: SessionRow) => {
    const sid = rowKey(s);
    const isActive = !!activeSessionId && sid === activeSessionId;
    const serverUnread = (s as any).unread ? 1 : 0;
    const unread = getUnreadCount(sid, serverUnread);
    const live = !!s.is_active;
    const src = (s as any).source || "";
    const title = cleanTitle(s.title) || "Untitled session";
    const t = rowTime(s);
    const editing = renaming === sid;
    const busy = busySid === sid;

    return (
      <div
        key={sid}
        className={"ast-chat-row group " + (isActive ? "ast-row-active" : unread > 0 ? "ast-unread-row" : "")}
        data-session-id={sid}
      >
        {editing ? (
          <div className="flex items-center gap-1.5 p-2">
            <input
              autoFocus
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenaming(null);
              }}
              className="ast-rename-input"
              aria-label="Rename session"
              maxLength={200}
            />
            <button className="ast-icon-btn" onClick={commitRename} title="Save"><Check className="w-3.5 h-3.5" /></button>
            <button className="ast-icon-btn" onClick={() => setRenaming(null)} title="Cancel"><X className="w-3.5 h-3.5" /></button>
          </div>
        ) : (
          <button
            onClick={() => onSelect(sid)}
            aria-current={isActive ? "true" : undefined}
            className="w-full text-left"
          >
            <div className="flex items-center gap-1.5">
              <SourceBadge source={src} />
              {s.model && <span className="ast-model-tag" title={`model: ${s.model}`}>{s.model}</span>}
              <TokenCostChip row={s as any} />
              <span className="ast-row-time" title={t ? new Date(t * 1000).toLocaleString() : undefined}>
                {timeAgo(t)}
              </span>
              <span className="flex-1" />
              {live && <span className="ast-live-dot" title="Session active now"><Loader2 className="w-2.5 h-2.5 animate-spin" /></span>}
              {s.pinned && <Pin className="w-2.5 h-2.5 text-cyanx/80 shrink-0" aria-label="Pinned" />}
              {unread > 0
                ? <UnreadPill count={unread} />
                : ((s as any).unread === false && (s as any).last_read_at != null && <CheckCheck className="w-2.5 h-2.5 ast-read-tick" aria-label="Read" />)}
            </div>
            <div className={"ast-row-title truncate " + (unread > 0 ? "ast-row-title-unread" : "")}>{title}</div>
            <div className="ast-row-sub truncate">
              {query.trim() !== "" && s.snippet ? s.snippet : (s.preview || "")}
            </div>
          </button>
        )}
        {!editing && (
          <div className="ast-row-menu-wrap">
            <button
              className="ast-row-menu-btn"
              onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === sid ? null : sid); }}
              aria-label="Session actions"
              aria-haspopup="menu"
              aria-expanded={menuFor === sid}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
            {menuFor === sid && (
              <div className="ast-row-menu" role="menu">
                <button className="ast-menu-item" role="menuitem" onClick={() => { setMenuFor(null); startRename(sid, title); }}>
                  <Pencil className="w-3 h-3" /> Rename
                </button>
                <button className="ast-menu-item" role="menuitem" onClick={() => { setMenuFor(null); void patchFlag(sid, { pinned: !s.pinned }); }}>
                  {s.pinned ? <><PinOff className="w-3 h-3" /> Unpin</> : <><Pin className="w-3 h-3" /> Pin</>}
                </button>
                <button className="ast-menu-item ast-menu-danger" role="menuitem" onClick={() => {
                  setMenuFor(null);
                  if (window.confirm(`Delete "${title}"? This cannot be undone.`)) void doDelete(sid);
                }}>
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </div>
            )}
            {busy && <Loader2 className="w-3 h-3 animate-spin text-cyanx absolute right-2 top-2" />}
          </div>
        )}
      </div>
    );
  };

  const searching = query.trim() !== "";

  return (
    <div className="flex h-full flex-col">
      <div className="p-4 flex items-center gap-2 border-b border-white/[0.07] ast-panel-head">
        <button onClick={onBack} className="nav-back-btn p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors" aria-label="Back">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="font-mono text-xs uppercase tracking-widest ast-panel-title">Chats</span>
        <span className="flex-1" />
        {total > 0 && !searching && <span className="font-mono text-[10px] text-slate-500">{total}</span>}
      </div>

      <div className="p-3 border-b border-white/[0.07]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search chats…"
            className="ast-chats-search w-full rounded-lg pl-9 pr-8 py-1.5 text-sm focus:outline-none focus:border-cyanx/50 focus:ring-1 focus:ring-cyanx/50 transition-all"
            aria-label="Search chats"
          />
          {query && (
            <button onClick={() => setQuery("")} className="ast-search-clear absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200" aria-label="Clear search">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="px-2.5 pt-2.5 pb-1.5 flex flex-wrap gap-1" role="tablist" aria-label="Filter by source">
        {FILTERS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={"ast-filter-chip " + (filter === key ? "ast-filter-chip-on" : "")}
          >
            <Icon className="w-3 h-3" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      <div ref={listRef} className="sidebar-scroll flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {loading && sessions.length === 0 ? (
          <SessionsSkeleton />
        ) : error ? (
          <div className="p-4 flex flex-col items-center gap-2 text-center text-redx/80">
            <AlertCircle className="w-5 h-5" />
            <span className="text-sm">{error}</span>
            <button onClick={() => fetchSessions(query, offset)} className="text-xs underline hover:text-red-300">Retry</button>
          </div>
        ) : visible.length === 0 ? (
          <div className="p-4 text-center font-mono text-xs text-slate-500">
            {searching ? "No chats match." : filter === "oneshot" ? "No one-shot runs." : "No sessions yet."}
          </div>
        ) : (
          visible.map(renderRow)
        )}
      </div>

      {!searching && total > limit && (
        <div className="p-3 border-t border-white/[0.07] flex items-center justify-between">
          <button
            disabled={offset === 0}
            onClick={() => { setOffset(Math.max(0, offset - limit)); listRef.current?.scrollTo({ top: 0 }); }}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-mono text-[10px] text-slate-500">
            {offset + 1}–{Math.min(total, offset + limit)} of {total}
          </span>
          <button
            disabled={offset >= maxOffset}
            onClick={() => { setOffset(offset + limit); listRef.current?.scrollTo({ top: 0 }); }}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none"
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
