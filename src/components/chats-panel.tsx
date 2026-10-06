import { useEffect, useState, useCallback, useMemo, useRef, memo } from "react";
import { SessionsSkeleton } from "./ui/skeletons";
import {
  ArrowLeft, Search, ChevronLeft, ChevronRight, AlertCircle,
  MoreHorizontal, Pin, PinOff, Pencil, Trash2, Check, X, Loader2,
  Globe, TerminalSquare, MessagesSquare, LogOut } from "lucide-react";
import { Zap } from "lucide-react";
import { sourcesParam, type SourceModal } from "@/lib/source-filter";
import { cleanTitle } from "@/lib/chat-title";
import { getUnreadCount, seedFromServer, storedKeyFor } from "@/lib/notify";
import { rowKey, rowTime, timeAgo, sortRows, mergeRows, type SessionRow } from "@/lib/session-row";
import { inlineMarkdownHtml, isCanvasPreview, isGreetPreview } from "@/lib/row-inline";
import { cn } from "@/lib/utils";
import { UnreadPill } from "./ui/unread-pill";
import { CheckCheck } from "lucide-react";

// Brand glyphs — single-color currentColor marks, no third-party assets.
function TelegramGlyph({ className }: { className?: string }) {
  // Outline ring + paper plane (stroke-native, matches lucide outline set).
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9.2" />
      <path d="M16 8.5l-7.2 2.9 2.3.8.8 2.3 1.2-1.4 2.1 1.5.8-6.1z" />
    </svg>
  );
}

function AndroidGlyph({ className }: { className?: string }) {
  // Full Android robot — head dome + antennae + eyes + body + arms + legs, stroke outline.
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5.9 10.6a6.1 6.1 0 0 1 12.2 0z" />
      <path d="M7.2 4.9 6.2 3.2M16.8 4.9l1-1.7" />
      <path d="M9.3 7.6h.01M14.7 7.6h.01" strokeWidth={2.2} />
      <path d="M5.9 13.4h12.2v2.4a2.2 2.2 0 0 1-2.2 2.2H8.1a2.2 2.2 0 0 1-2.2-2.2z" />
      <path d="M3.6 13.6v3M20.4 13.6v3" />
      <path d="M9.2 18v2.6M14.8 18v2.6" />
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
  { key: "oneshot", label: "One-shots", icon: Zap },
];

const SOURCE_ICON: Record<string, GlyphFC> = {
  webui: Globe, android: AndroidGlyph, telegram: TelegramGlyph, cli: TerminalSquare, tui: TerminalSquare, oneshot: Zap,
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

/** Sidebar row sub-line (owner 10-06). Priority order:
 *   1. turn running on ANY device → animated "Thinking…"/"Working…" (chat.turn events)
 *   2. latest response was a canvas card → "Open to read canvas card"
 *   3. the latest response text, INLINE-formatted (bold/italic/code only — the
 *      one-line row cannot carry block constructs), never raw markdown paint
 *   4. search snippets pass through as-is (they quote the matched message)
 *   5. greets/fallbacks blank — a convention text never poses as a reply */
/** Live turn state for one sidebar row. `at` is when the state was last set —
 *  an interrupted turn emits no completion frame, so a stale entry must expire
 *  at render rather than stick as a permanent "Thinking…". */
type TurnState = { running: boolean; thinking: boolean; at: number };
const TURN_TTL_MS = 15 * 60 * 1000;

const RowSub = memo(function RowSub({ s, inSearch, running, thinking }: {
  s: { last_reply?: string | null; preview?: string | null; snippet?: string | null };
  inSearch: boolean; running: boolean; thinking: boolean;
}) {
  const live = running || thinking;
  // Greet texts can ride BOTH fields: the server's last_reply was already
  // filtered, but `preview` (the gateway's first-user-message) IS the greet
  // kickoff prompt on every new chat — fall back to it only when it is real.
  const greet = isGreetPreview(s.last_reply) || isGreetPreview(s.preview);
  const body = inSearch && s.snippet ? s.snippet
    : greet ? ""
    : isCanvasPreview(s.last_reply) ? "Open to read canvas card →"
    : s.last_reply || s.preview || "";
  const isCanvas = isCanvasPreview(s.last_reply) && !greet;
  return (
    <div className={"ast-row-sub truncate" + (isCanvas ? " ast-row-canvas" : "")}>
      {live ? (
        // Same box, same ink, one line: the shimmer runs on the EXACT sub-line
        // geometry (10.5px, no padding, left-aligned) — the old AITextLoading
        // wrapper (px-4 py-2 text-sm centered) inflated the row (owner 10-06).
        <span className={cn("ast-row-live-shimmer", thinking ? "ast-row-live-think" : "ast-row-live-work")}>
          {thinking ? "Thinking…" : "Working…"}
        </span>
      ) : isCanvas ? "Open to read canvas card →" : (
        <span dangerouslySetInnerHTML={{ __html: inlineMarkdownHtml(body) }} />
      )}
    </div>
  );
});

export function ChatsPanel({ onBack, onSelect, activeSessionId, onEndSession }: { onBack: () => void; onSelect: (id: string) => void; activeSessionId?: string | null; onEndSession?: (id: string) => Promise<void> }) {
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
  // Live turn status per row (owner 10-06): any chat whose turn is running,
  // on any device, shows "Thinking… / Working…" instead of its last reply.
  // Fed by chat.turn events (ws-engine emits them for OTHER sessions; the open
  // session's state would only matter if this panel is mounted during a turn,
  // which is impossible — the chat surface hides the sidebar panel... except
  // on wide screens where the list is visible alongside, so include it).
  const [turnSids, setTurnSids] = useState<Map<string, TurnState>>(new Map());
  // Seed live turn state from the SERVER on every list fetch (owner 10-06: "I
  // don't see the thinking/working text on the phone"). The turn frames below
  // are TRANSIENT — a drawer opened mid-turn has already missed message.start,
  // so a phone (whose drawer is closed most of the time) saw nothing until the
  // turn ended. The proxy tracks running turns and stamps `turn_running` on
  // each row, so a freshly mounted list shows the truth immediately; the frames
  // then keep it current.
  //
  // Server seeding only ADDS. Clearing is the frame handler's job (a completion
  // frame is authoritative), so a list response that raced a just-started turn
  // can never blank a row the wire already lit. Staleness is handled by
  // TURN_TTL_MS at render instead — an interrupted turn emits no completion, and
  // a permanent "Thinking…" on an idle row is worse than a missing one.
  const seedTurns = (rows: SessionRow[]) => {
    const now = Date.now();
    setTurnSids((m) => {
      const next = new Map(m);
      let changed = false;
      for (const r of rows) {
        if (!(r as any).turn_running) continue;
        const keys = [rowKey(r), r.session_id].filter(Boolean) as string[];
        for (const k of keys) {
          if (!next.has(k)) { next.set(k, { running: true, thinking: true, at: now }); changed = true; }
        }
      }
      return changed ? next : m;
    });
  };
  // End session moved HERE from the chat header (owner 10-02). It is a real
  // action, not a read-only command, so it keeps the header's two-step shape:
  // first click arms (menu item becomes "Confirm end"), second click fires.
  // Arming expires after 4s so a stray first click can't sit armed forever.
  const [endArm, setEndArm] = useState<string | null>(null);
  const [ending, setEnding] = useState<string | null>(null);
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
      // Live turn status for the row sub-lines (owner 10-06).
      if (ev && ev.type === "chat.turn") {
        const p = (ev as any).payload || {};
        // Rows key on the STORED id; events arrive keyed on the LIVE id
        // (rotates on compression). Register under both so the row matches
        // regardless of which id it holds.
        const keys = [p.sid, p.stored].filter(Boolean);
        if (keys.length) {
          const now = Date.now();
          setTurnSids((m) => {
            const next = new Map(m);
            if (p.running) for (const k of keys) next.set(k, { running: true, thinking: !!p.thinking, at: now });
            else for (const k of keys) next.delete(k);
            return next;
          });
        }
      }
      // Own session's turns: the chat surface already knows, but the wide-screen
      // panel ALSO shows the open chat's row — mirror its turn state here.
      // Same sid-mapping rule as chat.turn above: events carry the LIVE id.
      if (ev && (ev.type === "message.start" || ev.type === "message.complete" || ev.type === "message.error")) {
        const sid = (ev as any).session_id;
        const stored = (ev as any).payload?.stored_session_id ||
          ((sid && storedKeyFor(sid)) || "");
        const keys = [sid, stored].filter(Boolean);
        const running = ev.type === "message.start";
        if (keys.length) {
          const now = Date.now();
          setTurnSids((m) => {
            const next = new Map(m);
            if (running) for (const k of keys) next.set(k, { running: true, thinking: true, at: now });
            else for (const k of keys) next.delete(k);
            return next;
          });
        }
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
      // Minute cache-buster on the WIRE url (see src/lib/sessions-cache.ts for
      // the full story): the CF edge filters override cache-control:no-store and
      // edge-cached every /api/hx GET per URL — the panel's stable URL rendered
      // a 90-minute-old list, so new chats and unread state never appeared here.
      const res = await fetch(url + (url.includes("?") ? "&" : "?") + "_r=" + Math.floor(Date.now() / 60_000));
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
        seedTurns(rows);
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

  // Live last-reply for the row previews (owner 10-06 steer): the enriched
  // `last_reply` from the list fetch is a snapshot — a message completing in
  // ANOTHER chat (or this tab while the panel shows a different chat) must
  // patch its row in place instead of waiting for the next poll. Foreign
  // sessions arrive as chat.turn{text}; the open session as astra:chat-preview.
  // The panel's own notification feed (notify) handles unread pills; this only
  // refreshes the SUB text.
  useEffect(() => {
    const applyText = (sid: string, text: string) => {
      if (!sid || !text) return;
      // The kickoff turn DOES complete with the greet text on the wire — never
      // let the live patch re-introduce it into a row the server already
      // filtered (owner 10-06 "some chats show empty": the greet landed back
      // on top of a good last_reply through this very path).
      if (/^New chat just started\./.test(text.trim())) return;
      setSessions((rows) => rows.map((r) => (rowKey(r) === sid ? { ...r, last_reply: text.length > 220 ? text.slice(0, 219) + "…" : text } : r)));
    };
    const onPreview = (e: Event) => {
      const { id, text } = (e as CustomEvent<{ id?: string; text?: string }>).detail || {};
      applyText(String(id || ""), String(text || ""));
    };
    const onTurn = (e: Event) => {
      const p = (e as CustomEvent<{ sid?: string; running?: boolean; text?: string; thinking?: boolean }>).detail || {};
      if (!p.running && p.text) applyText(String(p.sid || ""), String(p.text));
    };
    window.addEventListener("astra:chat-preview", onPreview);
    window.addEventListener("astra-ws-event", onTurn);
    return () => {
      window.removeEventListener("astra:chat-preview", onPreview);
      window.removeEventListener("astra-ws-event", onTurn);
    };
  }, []);

  /**
   * End session (owner 10-02: moved from the chat header to this row menu).
   *
   * Two-step, matching the header button it replaces: the first click arms, the
   * second fires. 409 means the job is already running — the server owns it, so
   * that is a success from the UI's point of view (same rule as the header).
   */
  const doEndSession = useCallback(async (sid: string) => {
    if (!onEndSession) return;
    setEnding(sid);
    try {
      await onEndSession(sid);
      setEndArm(null);
      setMenuFor(null);
      setTick((t) => t + 1);
    } finally {
      setEnding(null);
    }
  }, [onEndSession]);

  const onEndClick = useCallback((sid: string) => {
    if (ending === sid) return;
    if (endArm !== sid) { setEndArm(sid); return; }   // first click arms
    void doEndSession(sid);                          // second click fires
  }, [endArm, ending, doEndSession]);

  // An armed row disarms itself after 4s, so a stray first click can't leave the
  // menu sitting in a confirm state indefinitely.
  useEffect(() => {
    if (!endArm) return;
    const t = window.setTimeout(() => setEndArm(null), 4000);
    return () => window.clearTimeout(t);
  }, [endArm]);

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
    const turn = turnSids.get(sid || "");
    // Expire a stale entry at render: an interrupted turn emits no completion
    // frame, so without this the row would read "Thinking…" forever.
    const turnFresh = !!turn && Date.now() - turn.at < TURN_TTL_MS;
    const rowRunning = !!turnFresh && !!turn!.running;
    const rowThinking = !!turnFresh && !!turn!.thinking;

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
              {s.pinned && <Pin className="w-2.5 h-2.5 text-accent/80 shrink-0" aria-label="Pinned" />}
              {unread > 0
                ? <UnreadPill count={unread} />
                : ((s as any).unread === false && (s as any).last_read_at != null && <CheckCheck className="w-2.5 h-2.5 ast-read-tick" aria-label="Read" />)}
            </div>
            <div className={"ast-row-title truncate " + (unread > 0 ? "ast-row-title-unread" : "")}>{title}</div>
            <RowSub s={s as any} inSearch={query.trim() !== ""} running={rowRunning} thinking={rowThinking} />
            {/* Sub-line is a React subtree (RowSub) so the inline markdown, the
                canvas-card label and the live "thinking/working" state all live
                in one place — see src/lib/row-inline.ts + chat.turn events. */}

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
                {onEndSession && (
                  <button className="ast-menu-item" role="menuitem"
                    onClick={() => onEndClick(sid)}
                    disabled={ending === sid}
                    aria-label={endArm === sid ? "Confirm end session" : "End session"}>
                    {ending === sid ? <Loader2 className="w-3 h-3 animate-spin" />
                      : endArm === sid ? <AlertCircle className="w-3 h-3" />
                      : <LogOut className="w-3 h-3" />}
                    {ending === sid ? "Ending…" : endArm === sid ? "Confirm end" : "End session"}
                  </button>
                )}
                <button className="ast-menu-item ast-menu-danger" role="menuitem" onClick={() => {
                  setMenuFor(null);
                  if (window.confirm(`Delete "${title}"? This cannot be undone.`)) void doDelete(sid);
                }}>
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </div>
            )}
            {busy && <Loader2 className="w-3 h-3 animate-spin text-accent absolute right-2 top-2" />}
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
            className="ast-chats-search w-full rounded-lg pl-9 pr-8 py-1.5 text-sm focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/50 transition-all"
            aria-label="Search chats"
          />
          {query && (
            <button onClick={() => setQuery("")} className="ast-search-clear absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200" aria-label="Clear search">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div
        className="ast-filter-scroller flex gap-1 pl-2.5 pr-2.5 pt-2.5 pb-1.5"
        role="tablist"
        aria-label="Filter by source"
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.currentTarget.scrollLeft += e.deltaY;
          }
        }}
      >
        {FILTERS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={"ast-filter-chip shrink-0 " + (filter === key ? "ast-filter-chip-on" : "")}
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
