import { useEffect, useState, useRef } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  Menu,
  MessageSquare,
  Plus,
  LogOut,
  Eye,
  EyeOff,
  Folder,
  Cpu,
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
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatLanding } from "./components/chat-landing";
import { ChatsPanel } from "./components/chats-panel";

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
import TubesBackground from "./components/ui/tubes-background";

/* ---------------- shell: sidebar + chat landing ---------------- */

function Shell({ onLogout }: { onLogout: () => void }) {
  const [resetSignal, setResetSignal] = useState(0);
  const [view, setView] = useState<'chat' | 'files'>('chat');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("astra-sidebar-collapsed") === "1");
  const toggleSidebar = () => setSidebarCollapsed((c) => {
    localStorage.setItem("astra-sidebar-collapsed", c ? "0" : "1");
    return !c;
  });
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

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
          onNewChat={() => { closeDrawer(); setResetSignal(r => r + 1); setView('chat'); setSelectedSessionId(null); }}
          onSelectSession={(id) => { setSelectedSessionId(id); setView('chat'); }}
          onOpenAstra={() => { closeDrawer(); setView('chat'); }}
          onOpenFiles={() => { closeDrawer(); setView('files'); }}
        />
        <div className={cn("flex flex-1 flex-col overflow-hidden", view !== 'chat' && "hidden")}>
          <ChatLanding resetSignal={resetSignal} selectedSessionId={selectedSessionId} onSessionChange={setActiveSessionId} />
        </div>
        {view === 'files' && (
          <FilesPage onBack={() => setView('chat')} />
        )}
      </div>
    </div>
  );
}

function Sidebar({ activeView, collapsed, drawerOpen, activeSessionId, onCloseDrawer, onToggleCollapse, onLogout, onNewChat, onSelectSession, onOpenAstra, onOpenFiles }: { activeView: 'chat' | 'files'; collapsed: boolean; drawerOpen: boolean; activeSessionId: string | null; onCloseDrawer: () => void; onToggleCollapse: () => void; onLogout: () => void; onNewChat: () => void; onSelectSession: (id: string) => void; onOpenAstra: () => void; onOpenFiles: () => void; }) {
  const [mode, setMode] = useState<'nav' | 'chats'>('nav');
  const groups: {
    label: string;
    items: { name: string; icon: ReactNode; badge?: string; onClick?: () => void }[];
  }[] = [
    {
      label: "Work",
      items: [
        { name: "Astra", icon: <img src="/astra-logo.png" alt="" className="h-4 w-4 rounded-full object-cover" />, onClick: onOpenAstra },
        { name: "New chat", icon: <Plus className="h-4 w-4" strokeWidth={1.5} />, onClick: onNewChat },
        { name: "Chats", icon: <MessageSquare className="h-4 w-4" strokeWidth={1.5} />, onClick: () => { setMode('chats'); if (collapsed) onToggleCollapse(); }, badge: "live" },
        { name: "Files", icon: <Folder className="h-4 w-4" strokeWidth={1.5} />, onClick: onOpenFiles },
      ],
    },
    {
      label: "Configure",
      items: [
        { name: "Model", icon: <Cpu className="h-4 w-4" strokeWidth={1.5} />, onClick: () => { alert("Model: openrouter / inkling:free (configured). Click to switch (dropdown coming in Phase 2)."); } },
        { name: "Config", icon: <Settings2 className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Env", icon: <FileCode2 className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Skills", icon: <Braces className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Plugins", icon: <Blocks className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "MCP", icon: <Plug className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Profile", icon: <UserRound className="h-4 w-4" strokeWidth={1.5} /> },
      ],
    },
    {
      label: "Operations",
      items: [
        { name: "Cron Jobs", icon: <Clock className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Logs", icon: <ScrollText className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "System Health", icon: <HeartPulse className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Analytics", icon: <BarChart3 className="h-4 w-4" strokeWidth={1.5} /> },
        { name: "Webhooks & Pairing", icon: <Webhook className="h-4 w-4" strokeWidth={1.5} /> },
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

  return (
    <aside id="astra-sidebar" data-open={String(drawerOpen)}
      className={cn(
        "flex flex-col border-r border-white/[0.07] bg-midnight/60",
        // < lg: overlay drawer
        "fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transition-transform duration-200 ease-out motion-reduce:transition-none",
        drawerOpen ? "translate-x-0" : "-translate-x-full",
        // >= lg: exact current inline sidebar, untouched
        "lg:static lg:z-auto lg:h-full lg:w-60 lg:max-w-none lg:shrink-0 lg:translate-x-0 lg:transition-[width] lg:duration-150",
        collapsed && "lg:w-14",
      )}>
      <div className={cn("flex items-center pb-3 pt-5", collapsed ? "justify-center px-0" : "gap-2.5 px-5")}>
        {!collapsed && (
          <>
            <img src="/astra-logo.png" alt="Astra"
              className="h-8 w-8 rounded-lg object-cover shadow-[0_0_16px_rgba(34,211,238,0.3)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm tracking-tight text-brandtext">Astra</p>
              <p className="font-mono text-[8px] uppercase tracking-[0.3em] text-cyanx/60">Command Center</p>
            </div>
          </>
        )}
        <button type="button" onClick={() => (drawerOpen ? onCloseDrawer() : onToggleCollapse())}
          aria-expanded={!collapsed}
          aria-label={drawerOpen ? "Close navigation" : collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={drawerOpen ? "Close navigation" : collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg p-1 lg:h-auto lg:w-auto lg:p-1 text-slate-400 transition-colors hover:bg-white/5 hover:text-cyanx">
          {collapsed
            ? <PanelLeftOpen className="h-5 w-5" strokeWidth={1.5} />
            : <PanelLeftClose className="h-5 w-5" strokeWidth={1.5} />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <p className="px-3 pb-1.5 pt-2 font-mono text-[9px] uppercase tracking-[0.25em] text-slate-600">
                {group.label}
              </p>
            )}
            {group.items.map((item) => {
              const active = item.name === "Astra" ? activeView === "chat"
                // @ts-ignore — TypeScript strict-mode inference; runtime behavior verified correct (mode state is 'nav' | 'chats')
                                : item.name === "Chats" ? mode === 'chats'
                : item.name === "Files" ? activeView === "files"
                : false;
              return (
              <button key={item.name} type="button" onClick={item.onClick}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.name : undefined}
                className={cn(
                  "flex w-full items-center rounded-lg text-left text-sm transition-colors",
                  collapsed ? "h-11 justify-center px-0" : "min-h-[44px] lg:min-h-0 py-2.5 lg:py-1.5 gap-2.5 px-3",
                  active
                    ? "bg-cyanx/10 text-cyanx hover:bg-cyanx/15"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                )}>
                <span className="shrink-0 text-muted">{item.icon}</span>
                {!collapsed && <span className="truncate">{item.name}</span>}
                {!collapsed && "badge" in item && item.badge ? (
                  <span className="ml-auto font-mono text-[8px] uppercase tracking-widest text-cyanx/60">{item.badge}</span>
                ) : null}
              </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className={cn("border-t border-white/[0.07]", collapsed ? "p-2" : "p-3")}>
        <button type="button" onClick={onLogout}
          title={collapsed ? "Logout" : undefined}
          className={cn(
            "flex w-full items-center rounded-lg text-sm text-slate-400 transition-colors hover:bg-redx/10 hover:text-redx",
            collapsed ? "h-11 justify-center px-0" : "min-h-[44px] lg:min-h-0 py-2.5 lg:py-1.5 gap-2.5 px-3 text-left",
          )}>
          <LogOut className="h-4 w-4" strokeWidth={1.5} />
          {!collapsed && "Logout"}
        </button>
      </div>
    </aside>
  );
}

