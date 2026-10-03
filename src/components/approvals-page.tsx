import { useState, useEffect } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function ApprovalsPage({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<"approval" | "clarify">("approval");
  const [gates, setGates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGates = async () => {
    try {
      const res = await fetch(`/api/gates?kind=${tab}`);
      if (res.ok) {
        const data = await res.json();
        setGates(data.gates || []);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchGates();
    const interval = setInterval(fetchGates, 5000);
    
    const handleWs = (e: any) => {
        if (e.detail?.type === "request.answered") {
            fetchGates();
        }
    };
    window.addEventListener("astra-ws-event", handleWs);
    return () => {
      clearInterval(interval);
      window.removeEventListener("astra-ws-event", handleWs);
    };
  }, [tab]);

  return (
    <div className="flex h-full w-full flex-col bg-void text-brandtext overflow-hidden">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] px-4 md:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/5 md:hidden shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="h-5 w-5 text-accent" />
            <h1 className="truncate font-display text-base font-semibold">Approvals & Reviews</h1>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 justify-center border-b border-white/[0.07] p-4 bg-midnight/30 md:sticky md:top-0 z-10">
        <div className="flex rounded-[10px] bg-white/[0.04] p-1 w-full max-w-sm">
          <button onClick={() => { setTab("approval"); setLoading(true); }} className={cn("flex-1 rounded-[8px] px-4 py-1.5 text-sm font-medium transition-colors", tab === "approval" ? "bg-accent text-void" : "text-slate-400 hover:text-slate-200")}>Approvals</button>
          <button onClick={() => { setTab("clarify"); setLoading(true); }} className={cn("flex-1 rounded-[8px] px-4 py-1.5 text-sm font-medium transition-colors", tab === "clarify" ? "bg-accent text-void" : "text-slate-400 hover:text-slate-200")}>Reviews</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24">
        <div className="mx-auto max-w-2xl space-y-4">
          {loading ? (
             Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="ast-sk h-32 w-full rounded-xl" />
             ))
          ) : gates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <ShieldCheck className="h-12 w-12 text-white/10 mb-4" />
              <p className="text-sm text-slate-400">No {tab === "approval" ? "approvals" : "reviews"} yet — gates that need your sign-off appear here.</p>
            </div>
          ) : (
            gates.map(g => <GateCard key={g.id} gate={g} onAnswered={fetchGates} />)
          )}
        </div>
      </div>
    </div>
  );
}

function formatRelative(ms: number) {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function GateCard({ gate, onAnswered }: { gate: any, onAnswered: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPending = !gate.answered;
  const GATE_TTL_MS = 30 * 60 * 1000;
  const isExpired = isPending && (Date.now() - gate.at) > GATE_TTL_MS;

  const handleAnswer = async (choice: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/gates/${gate.id}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice })
      });
      if (res.ok) {
        onAnswered();
      } else if (res.status === 404) {
        setError("This request expired or was answered elsewhere.");
        onAnswered();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Couldn't deliver (${res.status}). Try again.`);
      }
    } catch {
      setError("No connection. Try again.");
    }
    setBusy(false);
  };

  const statusColor = isExpired ? "bg-slate-500" : isPending ? "bg-amber-500 animate-pulse" : (gate.result?.choice === "deny" ? "bg-redx" : "bg-green-500");
  const d = new Date(gate.at);
  const isoTime = `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}, ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;

  const severityClasses: Record<string, string> = {
    low: "bg-slate-500/20 text-slate-300 border-slate-500/30",
    moderate: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    high: "bg-orange-500/20 text-orange-300 border-orange-500/30",
    critical: "bg-redx/20 text-redx border-redx/30"
  };

  return (
    <div className={cn("flex flex-col rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-sm transition-colors",
      isPending && "border-amber-500/30 bg-amber-500/[0.02]")}>
      <div className="flex items-center gap-2 mb-3">
        <div className={`h-2 w-2 rounded-full ${statusColor}`} />
        <span className="font-medium text-slate-300 capitalize">{isExpired ? "expired" : gate.kind === "clarify" ? "review" : gate.kind}</span>
        {gate.sid && <span className="ast-appr-sid rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{gate.sid.substring(0, 8)}</span>}
        <span className="ml-auto text-xs text-muted flex gap-2"><span>{isoTime}</span> <span>{formatRelative(gate.at)}</span></span>
      </div>

      <div className="mb-3 flex flex-col gap-1">
        <p className="font-medium text-brandtext truncate">{gate.whatItDoes}</p>
        <div className="flex items-center gap-2">
           <span className={cn("ast-appr-sev uppercase font-mono text-[10px] px-1.5 py-0.5 rounded border", severityClasses[gate.severity] || severityClasses.moderate)}>
              {gate.severity || "moderate"}
           </span>
           <span className="text-[13px] text-muted truncate">{gate.risk}</span>
        </div>
      </div>

      {gate.command && (
        <div className="mb-4">
          <div 
            onClick={() => setExpanded(!expanded)}
            className={cn("ast-appr-cmd cursor-pointer rounded-lg border border-white/[0.05] bg-black/40 p-3 font-mono text-[12px] text-slate-300 transition-colors hover:border-white/10",
               expanded ? "break-all" : "line-clamp-2"
            )}
          >
            $ {gate.command}
          </div>
          <button onClick={() => setExpanded(!expanded)} className="mt-1.5 text-[11px] text-slate-400 hover:text-accent flex items-center gap-1">
             {expanded ? "Hide full command" : "Show full command"}
          </button>
        </div>
      )}

      {isPending && !isExpired && gate.kind === "approval" && (
        <>
        {error && <p className="mb-2 text-[12px] text-redx">{error}</p>}
        <div className="flex items-center gap-3 mt-2">
          <button 
             disabled={busy}
             onClick={() => handleAnswer("deny")}
             className="flex-1 rounded-lg border border-redx/30 bg-redx/10 py-2 font-medium text-redx transition-colors hover:bg-redx/20 disabled:opacity-50">
             Deny
          </button>
          <button 
             disabled={busy}
             onClick={() => handleAnswer("once")}
             className="flex-1 rounded-lg bg-accent py-2 font-medium text-void transition-opacity hover:opacity-90 disabled:opacity-50">
             Approve
          </button>
        </div>
        </>
      )}
    </div>
  );
}
