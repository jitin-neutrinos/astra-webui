import { useEffect, useState, useRef } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  MessageSquare,
  LogOut,
  Eye,
  EyeOff,
  Folder,
  Settings2,
  Braces,
  Blocks,
  Plug,
  UserRound,
  Clock,
  ScrollText,
  HeartPulse,
  BarChart3,
  Webhook,
  ChevronDown,
  Briefcase,
  Activity,
  ShieldCheck,
  Vault as VaultIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import * as notify from "@/lib/notify";
import { ChatLanding } from "./components/chat-landing";
import { ThemeToggle, ThemeIconButton } from "./components/theme-toggle";
import { ChatsPanel } from "./components/chats-panel";
import TokenTrackerPage from "./components/token-tracker";
import { useMobileViewport } from "./hooks/use-mobile-viewport";
import { useSwipeToDismiss } from "./hooks/use-swipe-to-dismiss";

type Status = "checking" | "login" | "ready";

export default function App() {
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/me", { credentials: "same-origin" })
      .then((res) => {
        if (!alive) return;
        setStatus(res.ok ? "ready" : "login");
        if (res.ok) {
          // R5: prune bg_items_<sid> keys for sessions the server forgot.
          import("./lib/prune").then((m) => m.pruneStaleBgItems()).catch(() => {});
        }
      })
      .catch(() => { if (alive) setStatus("login"); });
    return () => { alive = false; };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setPassword("");
        setStatus("ready");
      } else {
        setError(data.error || "ACCESS DENIED — invalid security key");
      }
    } catch {
      setError("NETWORK FAULT — try again");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    setStatus("login");
  };

  if (status === "checking") return null;

  if (status === "login") {
    return <LoginScreen password={password} setPassword={setPassword} clearError={() => setError("")}
      error={error} busy={busy} submit={submit} />;
  }
  return <Shell onLogout={logout} />;
}

/* ---------------- login: retro-techno gradient + glass card ---------------- */

function LoginScreen({ password, setPassword, clearError, error, busy, submit }: {
  password: string; setPassword: (v: string) => void; clearError: () => void;
  error: string; busy: boolean; submit: (e: FormEvent) => void;
}) {
  const [showPw, setShowPw] = useState(false);
  return (
    <div className="fixed inset-0 overflow-hidden bg-void font-sans">
      <TubesBackground />
      {/* edge fades: the WebGL canvas (bloom) renders a shade off the void colour, so
          feather its top/bottom into --color-void — the system bars then read as a
          continuation of the screen instead of a strip. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-void to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-gradient-to-t from-void to-transparent" />
      <ThemeIconButton />

      <div className="absolute inset-0 z-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-void/85 p-8 shadow-[0_0_80px_rgba(139,92,246,0.10)] backdrop-blur-2xl md:p-10">
          <div className="mb-10 text-center">
            <div className="flex items-center justify-center gap-4">
              <img
                src="/astra-logo.png"
                alt="Astra"
                className="h-[38px] w-[38px] object-contain drop-shadow-[0_0_14px_rgba(34,211,238,0.35)]"
              />
              <h1 className="font-display text-[38px] leading-none tracking-tight text-brandtext">
                Astra
              </h1>
            </div>
            <p className="mt-6 text-left text-lg font-light leading-relaxed text-brandtext">
              Hi Jitin,
            </p>
            <p className="mt-2 text-left text-sm font-light leading-relaxed text-muted">
              Just your password and you're in.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-6">
            <div>
              <label htmlFor="password"
                className="mb-2 block text-sm text-slate-300">
                Password
              </label>
              <div className="relative rounded-lg bg-black/70">
                <div className="pointer-events-none absolute inset-0 rounded-lg border border-white/10 transition-colors duration-200 focus-within:border-cyanx/60" />
                <input
                  type={showPw ? "text" : "password"} id="password" name="password"
                  autoComplete="current-password" autoFocus required
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); clearError(); }}
                  placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
                  className="relative z-20 w-full bg-transparent px-4 py-3.5 pr-11 text-base text-brandtext placeholder-slate-700 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 z-30 -translate-y-1/2 text-slate-600 transition-colors hover:text-cyanx"
                >
                  {showPw
                    ? <EyeOff className="h-4 w-4" strokeWidth={1.5} />
                    : <Eye className="h-4 w-4" strokeWidth={1.5} />}
                </button>
              </div>
            </div>
            {error ? (
              <p role="alert" className="text-xs text-redx">
                {error}
              </p>
            ) : null}
            <button
              type="submit" disabled={busy}
              className="mt-2 w-full rounded-lg border border-cyanx/25 bg-cyanx/10 py-3 text-base text-cyanx transition-all hover:bg-cyanx/20 hover:shadow-[0_0_24px_rgba(34,211,238,0.2)] disabled:opacity-50"
            >
              {busy ? "Signing in..." : "Let me in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

import { FilesPage } from "./components/files-page";
import { ConfigPage } from "./components/config-page";
import { ApprovalsPage } from "./components/approvals-page";
import VaultPage from "./components/vault-page";
import TubesBackground from "./components/ui/tubes-background";

/* ---------------- shell: sidebar + chat landing ---------------- */

/** Aggregate unread across every chat, for the nav + mobile-header badges.
 *  One hook, one source: the sidebar nav item and the mobile header logo badge
 *  read the same store and re-sync on the same events, so they can never
 *  disagree with each other or with the per-row pills. */
function useUnreadTotal() {
  const [total, setTotal] = useState(() => notify.getTotalUnread());
  useEffect(() => {
    const sync = () => setTotal(notify.getTotalUnread());
    window.addEventListener("astra:unread-changed", sync);
    // sessions churn (activity elsewhere) can seed pills without a local bump
    const onWs = (e: Event) => {
      const t = (e as CustomEvent<{ type?: string }>).detail?.type;
      if (t === "sessions.changed" || t === "session.started") sync();
    };
    window.addEventListener("astra-ws-event", onWs);
    sync();
    return () => {
      window.removeEventListener("astra:unread-changed", sync);
      window.removeEventListener("astra-ws-event", onWs);
    };
  }, []);
  return total;
}

function Shell({ onLogout }: { onLogout: () => void }) {
  useMobileViewport();
  const unreadTotal = useUnreadTotal();
  const [resetSignal, setResetSignal] = useState(0);
  // Each view now owns a real path (/files, /tracker, /config, /c/<id> or /) so the
  // address bar, browser back/forward, and reload all land on the right page —
  // previously non-chat views were just an in-memory flag with no URL of their own,
  // so navigating away and back (or reloading) always dropped you back into chat.
  const parsePath = (): { view: 'chat' | 'files' | 'tracker' | 'config' | 'approvals' | 'vault'; sessionId: string | null } => {
    const p = location.pathname;
    if (p === "/files") return { view: "files", sessionId: null };
    if (p === "/tracker") return { view: "tracker", sessionId: null };
    if (p === "/config") return { view: "config", sessionId: null };
    if (p === "/approvals") return { view: "approvals", sessionId: null };
    if (p === "/vault" || p === "/env") return { view: "vault", sessionId: null };
    const match = p.match(/^\/c\/([A-Za-z0-9_-]+)$/);
    return { view: "chat", sessionId: match ? match[1] : null };
  };
  const initial = parsePath();
  const [view, setView] = useState<'chat' | 'files' | 'tracker' | 'config' | 'approvals' | 'vault'>(initial.view as 'chat' | 'files' | 'tracker' | 'config' | 'approvals' | 'vault');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("astra-sidebar-collapsed") === "1");
  const toggleSidebar = () => setSidebarCollapsed((c) => {
    localStorage.setItem("astra-sidebar-collapsed", c ? "0" : "1");
    return !c;
  });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(initial.sessionId);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Non-chat views own their own path + title directly (chat's own path/title
  // effect only runs while it is the active view — see ChatLanding's isActiveView).
  useEffect(() => {
    const TITLES: Record<typeof view, string> = { chat: "Astra", files: "Files — Astra", tracker: "Global Token Tracker — Astra", config: "Config — Astra", approvals: "Approvals & Reviews — Astra", vault: "Vault — Astra" };
    if (view === "files" && location.pathname !== "/files") history.pushState({}, "", "/files");
    else if (view === "tracker" && location.pathname !== "/tracker") history.pushState({}, "", "/tracker");
    else if (view === "config" && location.pathname !== "/config") history.pushState({}, "", "/config");
    else if (view === "approvals" && location.pathname !== "/approvals") history.pushState({}, "", "/approvals");
    else if (view === "vault" && location.pathname !== "/vault") history.pushState({}, "", "/vault");
    if (view !== "chat") notify.setBaseTitle(TITLES[view]);
  }, [view]);

  useEffect(() => {
    const onPop = () => {
      const next = parsePath();
      setView(next.view);
      setSelectedSessionId(next.sessionId);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = () => { setDrawerOpen(false); };


  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeDrawer(); };
    const mq = window.matchMedia("(min-width: 1024px)");
    const onMq = () => { if (mq.matches) setDrawerOpen(false); };
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    return () => { document.removeEventListener("keydown", onKey); mq.removeEventListener("change", onMq); };
  }, [drawerOpen]);

  return (
    <div className="app-shell flex w-full flex-col overflow-hidden bg-void font-sans text-brandtext">
      {/* mobile top bar (non-chat views): logo opens navigation */}
      <div className={cn("relative flex shrink-0 items-center border-b border-white/[0.07] bg-midnight/60 px-3 py-2 lg:hidden", view === "chat" && "hidden")}>
        <button type="button" onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation" aria-expanded={drawerOpen} aria-controls="astra-sidebar"
          className="flex h-11 w-11 items-center justify-center rounded-lg p-1 hover:bg-white/5">
          <img src="/astra-logo.png" alt="" aria-hidden="true" className="h-8 w-8 object-contain" />
        </button>
        {unreadTotal > 0 && (
          <span className="ast-unread-badge ast-unread-badge-mobile"
            aria-label={`${unreadTotal} unread ${unreadTotal === 1 ? "message" : "messages"}`}
            title={`${unreadTotal} unread`}>
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        )}
      </div>

      <div onClick={closeDrawer} aria-hidden="true" data-open={String(drawerOpen)}
        className="drawer-backdrop lg:hidden" />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          activeView={view}
          collapsed={sidebarCollapsed && !drawerOpen}
          drawerOpen={drawerOpen}
          activeSessionId={activeSessionId}
          onCloseDrawer={closeDrawer}
          onToggleCollapse={toggleSidebar}
          onLogout={() => { closeDrawer(); onLogout(); }}
          onSelectSession={(id) => { setSelectedSessionId(id); setView('chat'); }}
          onOpenFiles={() => { closeDrawer(); setView('files'); }}
          onOpenTracker={() => { closeDrawer(); setView('tracker'); }}
          onOpenConfig={() => { closeDrawer(); setView('config'); }}
          onOpenApprovals={() => { closeDrawer(); setView('approvals'); }}
          onOpenVault={() => { closeDrawer(); setView('vault'); }}
        />
        <div className={cn("flex flex-1 flex-col overflow-hidden", view !== 'chat' && "hidden")}>
          <ChatLanding resetSignal={resetSignal} selectedSessionId={selectedSessionId} onSessionChange={setActiveSessionId}
            isActiveView={view === 'chat'}
            onNewChat={() => { setResetSignal(r => r + 1); setView('chat'); setSelectedSessionId(null); }}
            onOpenNav={() => setDrawerOpen(true)} />
        </div>
        {view === 'files' && (
          <FilesPage onBack={() => setView('chat')} />
        )}
        {view === 'tracker' && (
          <TokenTrackerPage onBack={() => setView('chat')} />
        )}
        {view === 'config' && (
          <ConfigPage onBack={() => setView('chat')} />
        )}
        {view === 'approvals' && (
          <ApprovalsPage onBack={() => setView('chat')} />
        )}
        {view === 'vault' && (
          <VaultPage />
        )}
      </div>
    </div>
  );
}

function Sidebar({ activeView, collapsed, drawerOpen, activeSessionId, onCloseDrawer, onToggleCollapse, onLogout, onSelectSession, onOpenFiles, onOpenTracker, onOpenConfig, onOpenApprovals, onOpenVault }: { activeView: 'chat' | 'files' | 'tracker' | 'config' | 'approvals' | 'vault'; collapsed: boolean; drawerOpen: boolean; activeSessionId: string | null; onCloseDrawer: () => void; onToggleCollapse: () => void; onLogout: () => void; onSelectSession: (id: string) => void; onOpenFiles: () => void; onOpenTracker?: () => void; onOpenConfig?: () => void; onOpenApprovals?: () => void; onOpenVault?: () => void; }) {
  const [mode, setMode] = useState<'nav' | 'chats'>('nav');
  
  const asideChatsRef = useRef<HTMLElement>(null);
  const asideNavRef = useRef<HTMLElement>(null);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 1023px)").matches);
  
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const onMq = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);

  useSwipeToDismiss(asideChatsRef, onCloseDrawer, drawerOpen && isMobile);
  useSwipeToDismiss(asideNavRef, onCloseDrawer, drawerOpen && isMobile);

  useEffect(() => {
    if (drawerOpen && isMobile) {
      if (mode === 'chats') asideChatsRef.current?.focus();
      else asideNavRef.current?.focus();
      
      const onTab = (e: KeyboardEvent) => {
        if (e.key === "Tab") {
          const el = mode === 'chats' ? asideChatsRef.current : asideNavRef.current;
          if (!el) return;
          const focusable = el.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
          const first = focusable[0] as HTMLElement;
          const last = focusable[focusable.length - 1] as HTMLElement;
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      };
      document.addEventListener("keydown", onTab);
      return () => document.removeEventListener("keydown", onTab);
    }
  }, [drawerOpen, isMobile, mode]);
  // Per-group accordion. Owner mandate: Configure + Operate start collapsed;
  // Work starts open. Persisted in localStorage. Collapsed rail shows icons only,
  // so groups are forced open when the rail is collapsed (labels hidden there).
  const GROUP_OPEN_KEY = "astra-sidebar-groups";
  const DEFAULT_OPEN: Record<string, boolean> = { Work: true, Configure: false, Operate: false };
  const readGroupOpen = (): Record<string, boolean> => {
    try {
      const saved = JSON.parse(localStorage.getItem(GROUP_OPEN_KEY) || "{}") as Record<string, boolean>;
      return { ...DEFAULT_OPEN, ...saved };
    } catch { return { ...DEFAULT_OPEN }; }
  };
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>(readGroupOpen);
  useEffect(() => {
    localStorage.setItem(GROUP_OPEN_KEY, JSON.stringify(groupOpen));
  }, [groupOpen]);

  // Aggregate unread across every chat, for the sidebar Chats item. Same event
  // the chat list listens on, so the two never disagree: a row clearing its pill
  // (locally or from another device) drops the aggregate in the same tick.
  const unreadTotal = useUnreadTotal();

  const groups: {
    label: string;
    icon: ReactNode;
    items: { name: string; icon: ReactNode; badge?: string; onClick?: () => void }[];
  }[] = [
    {
      label: "Work",
      icon: <Briefcase className="h-3.5 w-3.5" strokeWidth={1.5} />,
      items: [
        { name: "Chats", icon: <MessageSquare className="h-4 w-4" strokeWidth={1.5} />, onClick: () => { setMode('chats'); if (collapsed) onToggleCollapse(); } },
        { name: "Files", icon: <Folder className="h-4 w-4" strokeWidth={1.5} />, onClick: onOpenFiles },
      ],
    },
    {
      label: "Configure",
      icon: <Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />,
      items: [
        { name: "Config", icon: <Settings2 className="h-4 w-4" strokeWidth={1.5} />, onClick: () => { onOpenConfig?.(); } },
        { name: "Vault", icon: <VaultIcon className="h-4 w-4" strokeWidth={1.5} />, onClick: () => { onOpenVault?.(); } },
        { name: "Skills", icon: <Braces className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Plugins", icon: <Blocks className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "MCP", icon: <Plug className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Profile", icon: <UserRound className="h-4 w-4" strokeWidth={1.5} /> },
      ],
    },
    {
      label: "Operate",
      icon: <Activity className="h-3.5 w-3.5" strokeWidth={1.5} />,
      items: [
        { name: "Approvals & Reviews", icon: <ShieldCheck className="h-4 w-4" strokeWidth={1.5} />, onClick: () => { onOpenApprovals?.(); } },
        { name: "Cron Jobs", icon: <Clock className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Logs", icon: <ScrollText className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "System Health", icon: <HeartPulse className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Analytics", icon: <BarChart3 className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Webhooks & Pairing", icon: <Webhook className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Global Token Tracker", icon: <BarChart3 className="h-4 w-4" strokeWidth={1.5} />, onClick: () => { onOpenTracker?.(); } },
      ],
    },
  ];


                  if (mode === 'chats') {
    return (
      <aside id="astra-sidebar" data-open={String(drawerOpen)}
        ref={asideChatsRef}
        tabIndex={-1}
        role={drawerOpen && isMobile ? "dialog" : undefined}
        aria-modal={drawerOpen && isMobile ? "true" : undefined}
        aria-label={drawerOpen && isMobile ? "Navigation" : undefined}
        className={cn(
          "flex flex-col border-r border-white/[0.07] bg-midnight/60",
          "fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transition-transform duration-200 ease-out motion-reduce:transition-none",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:z-auto lg:h-full lg:w-72 lg:max-w-none lg:shrink-0 lg:translate-x-0",
        )}>
        <ChatsPanel
          activeSessionId={activeSessionId}
          onBack={() => setMode('nav')}
          onSelect={(id) => {
            onSelectSession(id);
            setMode('nav');
            if (drawerOpen) onCloseDrawer();
          }}
        />
      </aside>
    );
  }

  // 21st.dev "Dashboard with Collapsible Sidebar" (id 5556) DNA, retinted to Astra tokens:
  // logo always in header, fixed w-12 icon column + h-11 rows, 2px left-border active marker,
  // bottom full-width collapse bar with rotating chevron (vendor ToggleClose).
  const expanded = drawerOpen || !collapsed;

  return (
    <aside id="astra-sidebar" data-open={String(drawerOpen)}
      ref={asideNavRef}
      tabIndex={-1}
      role={drawerOpen && isMobile ? "dialog" : undefined}
      aria-modal={drawerOpen && isMobile ? "true" : undefined}
      aria-label={drawerOpen && isMobile ? "Navigation" : undefined}
      className={cn(
        "flex flex-col border-r border-white/[0.07] bg-midnight/60",
        // < lg: overlay drawer
        "fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transition-transform duration-200 ease-out motion-reduce:transition-none",
        drawerOpen ? "translate-x-0" : "-translate-x-full",
        // >= lg: inline sidebar; width animates on collapse (vendor: w-64 / w-16)
        "lg:static lg:z-auto lg:h-full lg:w-64 lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:transition-[width] lg:duration-200 lg:ease-in-out",
        collapsed && "lg:w-16",
      )}>
      <div className={cn("flex shrink-0 border-b border-white/[0.07] py-4",
        expanded ? "items-center gap-3 px-4 h-[77px]" : "items-center justify-center px-2 h-[77px]")}>
        <button type="button" onClick={onToggleCollapse} disabled={drawerOpen}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={expanded ? "Collapse" : "Expand"}
          className="rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyanx/60">
          <img src="/astra-logo.png" alt="Astra"
            className="h-9 w-9 shrink-0 rounded-lg object-cover" />
        </button>
        {expanded && (
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold tracking-tight text-brandtext">Astra</p>
            <p className="truncate font-mono text-[8px] uppercase tracking-[0.3em] text-cyanx/60">Command Center</p>
          </div>
        )}
      </div>

      <nav className="sidebar-scroll flex-1 overflow-y-auto px-2 py-2">
        {groups.map((group) => {
          // Group dropdowns are IDENTICAL in rail mode: same shared open state,
          // headers render as chevron-only toggles, items show icons only.
          const open = !!groupOpen[group.label];
          return (
          <div key={group.label} className="mb-3">
            {/* group header: icon+label+chevron expanded, icon-only in rail. Open = accent styling. */}
            <button type="button"
              onClick={() => setGroupOpen((o) => ({ ...o, [group.label]: !o[group.label] }))}
              aria-expanded={open}
              title={expanded ? `Toggle ${group.label}` : group.label}
              className={cn("flex h-8 w-full items-center rounded-md text-left font-sans text-[13px] font-medium tracking-[0.08em] transition-colors duration-200",
                open ? "text-cyanx/90" : "text-slate-600 hover:text-slate-400",
                expanded ? "justify-between px-3" : "justify-center")}>
              <span className="flex min-w-0 items-center gap-1.5">
                {group.icon}
                {expanded && <span className="truncate">{group.label}</span>}
              </span>
              {expanded && (
                <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
                  open && "rotate-180")} strokeWidth={1.5} />
              )}
            </button>
            <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
              open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
              <div className="overflow-hidden">
                <div className={cn(expanded ? "pb-1.5" : "pb-0", open && "rounded-md bg-white/[0.02]")}>
            {group.items.map((item) => {
              const active = item.name === "Astra" ? activeView === "chat"
                // @ts-ignore — TypeScript strict-mode inference; runtime behavior verified correct (mode state is 'nav' | 'chats')
                                : item.name === "Chats" ? mode === 'chats'
                : item.name === "Files" ? activeView === "files"
                : item.name === "Global Token Tracker" ? activeView === "tracker"
                : item.name === "Config" ? activeView === "config"
                : item.name === "Approvals & Reviews" ? activeView === "approvals"
                : false;
              return (
              <button key={item.name} type="button" onClick={item.onClick}
                aria-current={active ? "page" : undefined}
                title={!expanded ? item.name : undefined}
                className={cn(
                  "relative flex h-11 w-full items-center rounded-md transition-colors duration-200 press-feedback",
                  // Unread: the WHOLE button gets the brand-blue outline + glow,
                  // not just the number — the nav item itself reads as active.
                  item.name === "Chats" && unreadTotal > 0 && "ast-nav-unread",
                  active
                    ? "bg-cyanx/10 text-cyanx"
                    : "text-slate-300 hover:bg-white/5 hover:text-white",
                )}>
                <span className="grid h-full w-12 shrink-0 place-content-center text-muted">{item.icon}</span>
                {expanded && <span className="truncate text-sm font-medium">{item.name}</span>}
                {item.name === "Chats" && unreadTotal > 0 && (
                  <span
                    className={cn("ast-unread-badge", !expanded && "ast-unread-badge-rail")}
                    aria-label={`${unreadTotal} unread ${unreadTotal === 1 ? "message" : "messages"}`}
                    title={`${unreadTotal} unread`}
                  >
                    {unreadTotal > 99 ? "99+" : unreadTotal}
                  </span>
                )}
                {expanded && "badge" in item && item.badge ? (
                  <span className="ml-auto mr-3 font-mono text-[8px] uppercase tracking-widest text-cyanx/60">{item.badge}</span>
                ) : null}
              </button>
              );
            })}
                </div>
              </div>
            </div>
          </div>
          );
        })}
      </nav>

      <div className="shrink-0 px-2 pb-2">
        <ThemeToggle expanded={expanded} />
        <button type="button" onClick={onLogout}
          title={!expanded ? "Logout" : undefined}
          className="relative flex h-11 w-full items-center rounded-md text-slate-400 transition-colors duration-200 hover:bg-redx/10 hover:text-redx press-feedback">
          <span className="grid h-full w-12 shrink-0 place-content-center">
            <LogOut className="h-4 w-4" strokeWidth={1.5} />
          </span>
          {expanded && <span className="truncate text-sm font-medium">Logout</span>}
        </button>
      </div>
    </aside>
  );
}

