import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
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
} from "lucide-react";
import { BackgroundGradientAnimation } from "@/components/ui/background-gradient-animation";
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
      <BackgroundGradientAnimation
        gradientBackgroundStart="#0a0a0f"
        gradientBackgroundEnd="#12121a"
        firstColor="34, 211, 238"      /* cyan  #22d3ee */
        secondColor="139, 92, 246"     /* violet #8b5cf6 */
        thirdColor="217, 70, 239"      /* fuchsia #d946ef */
        fourthColor="26, 26, 46"       /* depth */
        fifthColor="18, 18, 26"        /* midnight */
        pointerColor="34, 211, 238"
        size="70%"
        blendingValue="hard-light"
        containerClassName="absolute inset-0"
      >
        <div className="pointer-events-none absolute inset-0 z-40 retro-scanlines" />
        <div className="pointer-events-none absolute inset-0 z-40 retro-grid opacity-60" />
      </BackgroundGradientAnimation>

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
              <p role="alert" className="font-mono text-xs tracking-wide text-red-400">
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

/* ---------------- shell: sidebar + chat landing ---------------- */

function Shell({ onLogout }: { onLogout: () => void }) {
  const [resetSignal, setResetSignal] = useState(0);
  const [view, setView] = useState<'chat' | 'chats'>('chat');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-void font-sans text-brandtext">
      <Sidebar 
        onLogout={onLogout} 
        onNewChat={() => { setResetSignal(r => r + 1); setView('chat'); setSelectedSessionId(null); }} 
        onOpenChats={() => setView('chats')} 
        onOpenAstra={() => setView('chat')} 
      />
      {view === 'chat' ? (
        <ChatLanding resetSignal={resetSignal} selectedSessionId={selectedSessionId} />
      ) : (
        <ChatsPanel onBack={() => setView('chat')} onSelect={(id) => { setSelectedSessionId(id); setView('chat'); }} />
      )}
    </div>
  );
}

function Sidebar({ onLogout, onNewChat, onOpenChats, onOpenAstra }: { onLogout: () => void; onNewChat: () => void; onOpenChats: () => void; onOpenAstra: () => void; }) {
  const groups: {
    label: string;
    items: { name: string; icon: ReactNode; badge?: string; onClick?: () => void }[];
  }[] = [
    {
      label: "Work",
      items: [
        { name: "Astra", icon: <img src="/astra-logo.png" alt="" className="h-4 w-4 rounded-full object-cover" />, onClick: onOpenAstra },
        { name: "New chat", icon: <Plus className="h-4 w-4" strokeWidth={1.5} />, onClick: onNewChat },
        { name: "Chats", icon: <MessageSquare className="h-4 w-4" strokeWidth={1.5} />, onClick: onOpenChats, badge: "live" },
        { name: "Files", icon: <Folder className="h-4 w-4" strokeWidth={1.5} /> },
      ],
    },
    {
      label: "Configure",
      items: [
        { name: "Model", icon: <Cpu className="h-4 w-4" strokeWidth={1.5} /> },
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

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-white/[0.07] bg-midnight/60">
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-5">
        <img src="/astra-logo.png" alt="Astra"
          className="h-8 w-8 rounded-lg object-cover shadow-[0_0_16px_rgba(34,211,238,0.3)]" />
        <div className="min-w-0">
          <p className="truncate font-display text-sm tracking-tight text-brandtext">Astral Command Center</p>
          <p className="font-mono text-[8px] uppercase tracking-[0.3em] text-cyanx/60">astra webui</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="px-3 pb-1.5 pt-2 font-mono text-[9px] uppercase tracking-[0.25em] text-slate-600">
              {group.label}
            </p>
            {group.items.map((item) => (
              <button key={item.name} type="button" onClick={item.onClick}
                aria-current={"badge" in item && item.badge ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm transition-colors",
                  "badge" in item && item.badge
                    ? "bg-cyanx/10 text-cyanx hover:bg-cyanx/15"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                )}>
                <span className="shrink-0 text-muted">{item.icon}</span>
                <span className="truncate">{item.name}</span>
                {"badge" in item && item.badge ? (
                  <span className="ml-auto font-mono text-[8px] uppercase tracking-widest text-cyanx/60">{item.badge}</span>
                ) : null}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.07] p-3">
        <button type="button" onClick={onLogout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400">
          <LogOut className="h-4 w-4" strokeWidth={1.5} />
          Logout
        </button>
      </div>
    </aside>
  );
}

