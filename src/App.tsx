import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import {
  MessageSquare,
  Plus,
  LogOut,
  ArrowUp,
  Terminal,
} from "lucide-react";
import { BackgroundGradientAnimation } from "@/components/ui/background-gradient-animation";
import { cn } from "@/lib/utils";

type Status = "checking" | "login" | "ready";
type Msg = { role: "user" | "assistant"; content: string };

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
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-cyanx/30 bg-black/60 shadow-[0_0_24px_rgba(34,211,238,0.25)]">
              <Terminal aria-hidden="true" className="h-5 w-5 text-cyanx" strokeWidth={1.5} />
            </div>
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
                  type="password" id="password" name="password"
                  autoComplete="current-password" autoFocus required
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); clearError(); }}
                  placeholder="&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;&#8226;"
                  className="relative z-20 w-full bg-transparent px-3 py-2.5 font-mono text-sm text-brandtext placeholder-slate-700 focus:outline-none"
                />
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
  return (
    <div className="flex h-screen w-full overflow-hidden bg-void font-sans text-brandtext">
      <Sidebar onLogout={onLogout} />
      <ChatLanding />
    </div>
  );
}

function Sidebar({ onLogout }: { onLogout: () => void }) {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-white/[0.07] bg-midnight/60">
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <span className="h-2 w-2 rounded-full bg-cyanx shadow-[0_0_10px_rgba(34,211,238,0.8)]" />
        <span className="font-display text-lg tracking-tight">Astra</span>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        <button type="button"
          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white">
          <Plus className="h-4 w-4 text-muted" strokeWidth={1.5} />
          New chat
        </button>
        <button type="button" aria-current="page"
          className="flex items-center gap-2.5 rounded-lg bg-cyanx/10 px-3 py-2 text-left text-sm text-cyanx transition-colors hover:bg-cyanx/15">
          <MessageSquare className="h-4 w-4" strokeWidth={1.5} />
          Chat
          <span className="ml-auto font-mono text-[9px] uppercase tracking-widest text-cyanx/60">live</span>
        </button>
      </nav>

      <div className="mt-auto p-3">
        <button type="button" onClick={onLogout}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-400">
          <LogOut className="h-4 w-4" strokeWidth={1.5} />
          Logout
        </button>
        <p className="px-3 pb-1 pt-2 font-mono text-[9px] uppercase tracking-[0.25em] text-slate-700">
          astra // uplink stable
        </p>
      </div>
    </aside>
  );
}

function ChatLanding() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // ponytail: echo responder — wire /api/chat to Hermes when the backend lands
  const send = async () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setThinking(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json().catch(() => ({}));
      setMessages((m) => [...m, {
        role: "assistant",
        content: data.reply || `Uplink acknowledged: "${text}". Agent backend not wired yet — this channel is scaffolded for Hermes.`,
      }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Signal lost. Try again." }]);
    } finally {
      setThinking(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, thinking]);

  const empty = messages.length === 0 && !thinking;

  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col">
      <div className="pointer-events-none absolute inset-0 retro-grid opacity-40" aria-hidden="true" />

      <header className="relative z-10 flex items-center justify-between border-b border-white/[0.07] px-6 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
          {empty ? "new session" : `session // ${messages.length} msgs`}
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> online
        </span>
      </header>

      <div ref={listRef} className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <span aria-hidden="true" className="font-mono text-3xl text-cyanx [text-shadow:0_0_24px_rgba(34,211,238,0.6)]">&#10035;</span>
            <h2 className="mt-4 font-display text-3xl tracking-tight text-brandtext">
              Good evening, Jitin
            </h2>
            <p className="mt-3 max-w-md text-sm font-light text-muted">
              Astra is standing by. Ask anything, or start a task — the fleet handles the rest.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
            {messages.map((m, i) => (
              <div key={i} className="flex items-start gap-3">
                {m.role === "assistant" ? (
                  <span aria-hidden="true"
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyanx/40 bg-cyanx/10 font-mono text-xs text-cyanx">A</span>
                ) : (
                  <span aria-hidden="true"
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 font-mono text-xs text-slate-300">J</span>
                )}
                <div className={cn(
                  "min-w-0 whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed",
                  m.role === "user"
                    ? "bg-white/[0.06] text-slate-200"
                    : "border border-cyanx/15 bg-midnight/80 text-slate-200"
                )}>{m.content}</div>
              </div>
            ))}
            {thinking ? (
              <div className="flex items-start gap-3">
                <span aria-hidden="true"
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyanx/40 bg-cyanx/10 font-mono text-xs text-cyanx">A</span>
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
        <div className="mx-auto max-w-3xl">
          <div className="relative rounded-2xl border border-white/10 bg-midnight/90 shadow-[0_0_40px_rgba(34,211,238,0.05)] backdrop-blur transition-colors focus-within:border-cyanx/40">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={empty ? "Message Astra..." : "Reply..."}
              aria-label="Message Astra"
              className="w-full resize-none bg-transparent px-4 py-3.5 pr-12 text-sm text-brandtext placeholder-slate-600 focus:outline-none"
            />
            <button
              type="button" onClick={() => void send()}
              disabled={!input.trim() || thinking}
              aria-label="Send message"
              className="absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-cyanx text-void transition-opacity hover:opacity-90 disabled:opacity-25"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
          <p className="mt-2 text-center font-mono text-[9px] uppercase tracking-[0.25em] text-slate-700">
            enter to send // shift+enter newline
          </p>
        </div>
      </div>
    </main>
  );
}
