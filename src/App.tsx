import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import GatewayFlow from "./components/gateway-flow";

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
        setError(data.error || "Access denied. Invalid security key.");
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (status === "checking") return null;

  if (status === "ready") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-slate-300">
        <div className="text-center">
          <h1 className="text-4xl font-extralight tracking-tight text-white">Astra</h1>
          <p className="mt-3 text-sm font-light text-slate-500">Uplink established. Build out starts here.</p>
        </div>
      </main>
    );
  }

  return (
    <div className="fixed inset-0 bg-black">
      <GatewayFlow className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-7 shadow-2xl backdrop-blur-xl md:p-8">
          <div className="mb-8 text-center">
            <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-slate-700/50 bg-black/50 shadow-inner">
              <span aria-hidden="true" className="text-xl text-slate-200">A</span>
            </div>
            <h1 className="mb-2 text-3xl font-extralight uppercase tracking-tight text-white">Astra</h1>
            <p className="text-sm font-light leading-relaxed text-slate-500">
              Verify identity to initialize secure connection with the primary framework.
            </p>
          </div>
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label htmlFor="password" className="mb-1.5 block text-xs font-light uppercase tracking-widest text-slate-400">
                Security Key
              </label>
              <div className="relative rounded-lg bg-black/80">
                <div className="pointer-events-none absolute inset-0 rounded-lg border border-slate-800/80 transition-colors duration-300 focus-within:border-slate-500/60"></div>
                <input
                  type="password"
                  id="password"
                  name="password"
                  autoComplete="current-password"
                  autoFocus
                  required
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(""); }}
                  placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
                  className="relative z-20 w-full bg-transparent px-3 py-2 text-sm font-light text-slate-200 placeholder-slate-700 focus:outline-none"
                />
              </div>
            </div>
            {error ? <p role="alert" className="text-xs font-light tracking-wide text-red-400">{error}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="mt-2 w-full rounded-lg border border-white/10 bg-[#0a0a0a] py-2.5 text-sm font-light uppercase tracking-widest text-white transition-all hover:bg-[#111] hover:shadow-[0_0_25px_rgba(255,255,255,0.06)] disabled:opacity-50"
            >
              {busy ? "Initializing..." : "Initialize Uplink"}
            </button>
          </form>
          <div className="mt-6 flex items-center gap-3">
            <div className="h-px flex-grow bg-slate-800/60"></div>
            <span className="text-xs font-extralight uppercase tracking-widest text-slate-600">Astra WebUI</span>
            <div className="h-px flex-grow bg-slate-800/60"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
