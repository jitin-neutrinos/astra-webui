import { useEffect } from "react";
import { ArrowLeft, Brain } from "lucide-react";
import { StatusRow } from "./ops/status";
import { useOpsPoll } from "./ops/use-ops-poll";

type MemoryData = {
  providers?: any;
  stores?: any[];
  openviking?: any;
  ovgate?: any;
  ollama?: any;
  ovCli?: any;
  compSurv?: Record<string, unknown>;
  error?: string;
};

export function MemoryPage({ onBack }: { onBack: () => void }) {
  const { data } = useOpsPoll<MemoryData>("/api/sysinfo/memory", 5000);
  const d = data || {};

  useEffect(() => { document.title = "Memory — Astra"; }, []);

  const budgetRow = (label: string, chars?: number, budget?: number) => {
    const pct = (chars !== undefined && budget) ? (chars / budget) * 100 : null;
    return (
      <div key={label} className="rounded-2xl border border-white/[0.04] bg-midnight/30 p-4">
        <div className="flex items-center justify-between mb-2"><span className="text-sm font-medium text-brandtext">{label}</span></div>
        <div className="text-2xl font-display font-semibold text-brandtext">{chars !== undefined ? chars.toLocaleString() : "—"}</div>
        {budget !== undefined && chars !== undefined && (
          <div className="mt-2 h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-1.5 rounded-full bg-violetx" style={{ width: `${Math.min(100, pct || 0)}%` }} />
          </div>
        )}
        <div className="mt-1 text-xs tabular-nums text-muted">{budget !== undefined && chars !== undefined ? `${pct !== null ? pct.toFixed(1) + "%" : "—"} of ${budget}` : "—"}</div>
        {pct !== null && pct > 100 && <div className="text-xs text-redx font-medium">Over budget</div>}
      </div>
    );
  };

  return (
    <div className="flex h-full w-full flex-col bg-void text-brandtext overflow-hidden">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] px-4 md:px-6">
        <button onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/5 md:hidden shrink-0" aria-label="Back"><ArrowLeft className="h-4 w-4" /></button>
        <div className="flex items-center gap-2 min-w-0"><Brain className="h-5 w-5 text-accent shrink-0" /><h1 className="truncate font-display text-base font-semibold">Memory — Tools &amp; Stores</h1></div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24">
        <div className="mx-auto max-w-3xl space-y-6">
          <p aria-live="polite" className="text-xs text-muted">Poll every 5s. No synthetic data.</p>

          {/* Providers */}
          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="text-sm font-display font-semibold mb-4">Memory Providers</h2>
            {d.providers ? (
              <div className="space-y-2 text-xs md:text-sm">
                <div className="rounded-xl bg-white/[0.06] px-3 py-2 flex items-center gap-2"><span className="font-medium text-brandtext">Active:</span> <span className="text-accent font-medium">{String(d.providers.active || d.providers?.rows?.[0]?.name || "—")}</span></div>
                {(d.providers.rows || []).map((r: any) => (
                  <div key={r.name} className="rounded-xl bg-white/[0.03] px-3 py-2.5 flex items-center justify-between">
                    <div><div className="font-medium text-brandtext">{r.name}</div><div className="text-muted">{r.description}</div></div>
                    <StatusRow s={(r.available && r.configured && r.status === "ready") ? "healthy" : (r.available ? "degraded" : "inactive")} label={r.status || (r.available ? "ready-adjacent" : "disabled")} />
                  </div>
                ))}
              </div>
            ) : <StatusRow s={d.error ? "unreachable" : "degraded"} label="Providers not reached" />}
          </section>

          {/* Stores */}
          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="text-sm font-display font-semibold mb-4">Memory Stores</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(d.stores || []).map((s: any) => budgetRow(s.name, s.chars, s.budget))}
            </div>
          </section>

          {/* OpenViking + ovgate + ollama */}
          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="text-sm font-display font-semibold mb-4">Memory Infrastructure</h2>
            <div className="space-y-2 text-xs md:text-sm">
              {d.openviking && <StatusRow s={d.openviking.healthy ? "healthy" : "degraded"} label={`OpenViking (${d.openviking.version || d.openviking.auth_mode || "—"})`} />}
              {d.ovgate && <StatusRow s={d.ovgate.status === "healthy" ? "healthy" : (d.ovgate.status === "degraded" ? "degraded" : "unreachable")} label="OVGate (write gate 1934→1933)" />}
              {d.ollama && <StatusRow s={"healthy"} label="Ollama embedding backend" />}
              {d.ovCli && <StatusRow s={d.ovCli.status === "healthy" ? "healthy" : "unreachable"} label={`OpenViking CLI (${d.ovCli.version || "—"})`} />}
            </div>
          </section>

          {/* Compaction */}
          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="text-sm font-display font-semibold mb-3">Compaction &amp; Survivability</h2>
            <div className="space-y-1 text-xs md:text-sm text-muted">
              {d.compSurv ? Object.entries(d.compSurv).map(([k, v]) => (
                <div key={k} className="flex justify-between"><span>{k.replace(/\./g, " ")}</span> <span className="tabular-nums">{String(v).slice(0, 40)}</span></div>
              )) : <span>—</span>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
