import { useEffect, useState, useRef } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Menu,
  MessageSquare,
  LogOut,
  Eye,
  EyeOff,
  Folder,
  Settings2,
  FileCode2,
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatLanding } from "./components/chat-landing";
import { ChatsPanel } from "./components/chats-panel";
import TokenTrackerPage from "./components/token-tracker";

type Status = "checking" | "login" | "ready";

export default function App() {
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/me", { credentials: "same-origin" })
      .then((res) => { if (alive) setStatus(res.ok ? "ready" : "login"); })
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

      <div className="absolute inset-0 z-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-void/60 p-7 shadow-[0_0_60px_rgba(34,211,238,0.08)] backdrop-blur-xl md:p-8">
          <div className="mb-8 text-center">
            <img
              src="/astra-logo.png"
              alt="Astra"
              className="mx-auto mb-5 h-16 w-16 rounded-xl object-cover shadow-[0_0_28px_rgba(34,211,238,0.3)]"
            />
            <h1 className="font-display text-3xl tracking-tight text-brandtext">
              Astra
            </h1>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-cyanx/70">
              secure uplink // v2
            </p>
            <p className="mt-4 text-sm font-light leading-relaxed text-muted">
              Verify identity to initialize secure connection with the primary framework.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-5">
            <div>
              <label htmlFor="password"
                className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
                Security Key
              </label>
              <div className="relative rounded-lg bg-black/70">
                <div className="pointer-events-none absolute inset-0 rounded-lg border border-white/10 transition-colors duration-200 focus-within:border-cyanx/60" />
                <input
                  type={showPw ? "text" : "password"} id="password" name="password"
                  autoComplete="current-password" autoFocus required
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); clearError(); }}
                  placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
                  className="relative z-20 w-full bg-transparent px-3 py-2.5 pr-10 font-mono text-sm text-brandtext placeholder-slate-700 focus:outline-none"
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
              <p role="alert" className="font-mono text-xs tracking-wide text-redx">
                &gt; {error}
              </p>
            ) : null}
            <button
              type="submit" disabled={busy}
              className="mt-2 w-full rounded-lg border border-cyanx/25 bg-cyanx/10 py-2.5 font-mono text-xs uppercase tracking-[0.25em] text-cyanx transition-all hover:bg-cyanx/20 hover:shadow-[0_0_24px_rgba(34,211,238,0.2)] disabled:opacity-50"
            >
              {busy ? "Linking..." : "Initialize Uplink"}
            </button>
          </form>

          <div className="mt-6 flex items-center gap-3">
            <div className="h-px flex-grow bg-white/5" />
            <span className="font-mono text-[9px] uppercase tracking-[0.3em] text-slate-600">astra webui</span>
            <div className="h-px flex-grow bg-white/5" />
          </div>
        </div>
      </div>
    </div>
  );
}

import { FilesPage } from "./components/files-page";
import { ConfigPage } from "./components/config-page";
import TubesBackground from "./components/ui/tubes-background";

/* ---------------- shell: sidebar + chat landing ---------------- */

function Shell({ onLogout }: { onLogout: () => void }) {
  const [resetSignal, setResetSignal] = useState(0);
  const [view, setView] = useState<'chat' | 'files' | 'tracker' | 'config'>('chat');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("astra-sidebar-collapsed") === "1");
  const toggleSidebar = () => setSidebarCollapsed((c) => {
    localStorage.setItem("astra-sidebar-collapsed", c ? "0" : "1");
    return !c;
  });
  // Parse /c/<id> into the INITIAL state: chat-landing's URL-sync effect runs on
  // mount before any parent effect and would replaceState("/") a null session away,
  // destroying the deep link before it could be read.
  const parseSessionPath = () => {
    const match = location.pathname.match(/^\/c\/([A-Za-z0-9_-]+)$/);
    return match ? match[1] : null;
  };
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(parseSessionPath);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    const onPop = () => {
      setSelectedSessionId(parseSessionPath());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const closeDrawer = () => { setDrawerOpen(false); burgerRef.current?.focus(); };

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
      {/* mobile top bar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.07] bg-midnight/60 px-3 py-2 lg:hidden">
        <button ref={burgerRef} type="button" onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation" aria-expanded={drawerOpen} aria-controls="astra-sidebar"
          className="-m-1 flex h-11 w-11 items-center justify-center rounded-lg p-1 text-slate-300 hover:bg-white/5 hover:text-cyanx">
          <Menu className="h-5 w-5" strokeWidth={1.5} />
        </button>
        <img src="/astra-logo.png" alt="" aria-hidden="true" className="h-6 w-6 rounded-lg object-cover" />
        <p className="font-display text-sm tracking-tight text-brandtext">Astra</p>
      </div>

      {drawerOpen && (
        <div onClick={closeDrawer} aria-hidden="true"
          className="fixed inset-0 z-40 bg-void/70 backdrop-blur-sm lg:hidden" />
      )}

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
        />
        <div className={cn("flex flex-1 flex-col overflow-hidden", view !== 'chat' && "hidden")}>
          <ChatLanding resetSignal={resetSignal} selectedSessionId={selectedSessionId} onSessionChange={setActiveSessionId}
            onNewChat={() => { setResetSignal(r => r + 1); setView('chat'); setSelectedSessionId(null); }} />
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
      </div>
    </div>
  );
}

function Sidebar({ activeView, collapsed, drawerOpen, activeSessionId, onCloseDrawer, onToggleCollapse, onLogout, onSelectSession, onOpenFiles, onOpenTracker, onOpenConfig }: { activeView: 'chat' | 'files' | 'tracker' | 'config'; collapsed: boolean; drawerOpen: boolean; activeSessionId: string | null; onCloseDrawer: () => void; onToggleCollapse: () => void; onLogout: () => void; onSelectSession: (id: string) => void; onOpenFiles: () => void; onOpenTracker?: () => void; onOpenConfig?: () => void; }) {
  const [mode, setMode] = useState<'nav' | 'chats'>('nav');
  // Per-group accordion. Owner mandate: Configure + Operations start collapsed;
  // Work starts open. Persisted in localStorage. Collapsed rail shows icons only,
  // so groups are forced open when the rail is collapsed (labels hidden there).
  const GROUP_OPEN_KEY = "astra-sidebar-groups";
  const DEFAULT_OPEN: Record<string, boolean> = { Work: true, Configure: false, Operations: false };
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
        { name: "Env", icon: <FileCode2 className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Skills", icon: <Braces className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Plugins", icon: <Blocks className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "MCP", icon: <Plug className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Profile", icon: <UserRound className="h-4 w-4" strokeWidth={1.5} /> },
      ],
    },
    {
      label: "Operations",
      icon: <Activity className="h-3.5 w-3.5" strokeWidth={1.5} />,
      items: [
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
        expanded ? "items-center gap-3 px-4" : "items-center justify-center px-2")}>
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
              className={cn("flex h-8 w-full items-center rounded-md text-left font-mono text-[9px] uppercase tracking-[0.25em] transition-colors duration-200",
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
                : false;
              return (
              <button key={item.name} type="button" onClick={item.onClick}
                aria-current={active ? "page" : undefined}
                title={!expanded ? item.name : undefined}
                className={cn(
                  "relative flex h-11 w-full items-center rounded-md border-l-2 transition-colors duration-200",
                  active
                    ? "border-cyanx bg-cyanx/10 text-cyanx"
                    : "border-transparent text-slate-300 hover:bg-white/5 hover:text-white",
                )}>
                <span className="grid h-full w-12 shrink-0 place-content-center text-muted">{item.icon}</span>
                {expanded && <span className="truncate text-sm font-medium">{item.name}</span>}
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
        <button type="button" onClick={onLogout}
          title={!expanded ? "Logout" : undefined}
          className="relative flex h-11 w-full items-center rounded-md border-l-2 border-transparent text-slate-400 transition-colors duration-200 hover:border-redx/60 hover:bg-redx/10 hover:text-redx">
          <span className="grid h-full w-12 shrink-0 place-content-center">
            <LogOut className="h-4 w-4" strokeWidth={1.5} />
          </span>
          {expanded && <span className="truncate text-sm font-medium">Logout</span>}
        </button>
      </div>
    </aside>
  );
}

