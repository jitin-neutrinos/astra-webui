import { useEffect } from "react";
import { ArrowLeft, Gauge, Clock } from "lucide-react";
import { StatusRow } from "./ops/status";
import { cn } from "@/lib/utils";
import { useOpsPoll } from "./ops/use-ops-poll";
import type { OpsStatus } from "./ops/status";

type ContextData = {
  error?: string;
  headroom?: any;
  tracker?: any;
  tbeacon?: any;
  laya?: { status: OpsStatus; reason?: string; statusCode?: number };
  ollama?: any;
  leanctx?: any;
  configLive?: Record<string, unknown>;
  ctxCache?: { count: number; samples: { key: string; value: number | string }[] };
  router?: any;
  toolsets?: any[];
};

export function ContextPage({ onBack }: { onBack: () => void }) {
  const { data } = useOpsPoll<ContextData>("/api/sysinfo/context", 5000);

  useEffect(() => {
    document.title = "Context — Astra";
  }, []);

  const d = data || {};

  return (
    <div className="flex h-full w-full flex-col bg-void text-brandtext overflow-hidden">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] px-4 md:px-6">
        <button onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/5 md:hidden shrink-0" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <Gauge className="h-5 w-5 text-cyanx shrink-0" />
          <h1 className="truncate font-display text-base font-semibold">Context — Tools &amp; Optimization</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24">
        <div className="mx-auto max-w-3xl space-y-6">

          {/* Health summary */}
          <p aria-live="polite" className="text-xs text-muted mb-2">
            {d ? `Live — poll every 5s · health: headroom ${d.headroom ? "ok" : "—"} · laya ${d.laya?.status || "—"}` : "Checking state…"}
          </p>

          {/* Headroom */}
          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="flex items-center gap-2 text-sm font-display font-semibold mb-4"><Gauge className="h-4 w-4 text-cyanx" /> Headroom Proxy</h2>
            {d.headroom ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs md:text-sm">
                {Object.entries({ version: d.headroom.version, ready: String(d.headroom.ready), uptime: `${Math.round((d.headroom.uptime_seconds || 0) / 60)}m` }).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-white/[0.04] px-3 py-2"><span className="text-muted">{k}</span><div className="font-medium tabular-nums text-brandtext truncate">{String(v)}</div></div>
                ))}
              </div>
            ) : <StatusRow s={(d.error ? "unreachable" : "degraded") as OpsStatus} label="Probing…" />}
            {d.headroom?.checks && (
              <div className="mt-3 space-y-1">
                {Object.entries(d.headroom.checks as Record<string, { status?: string }>)
                  .map(([name, c]) => (
                    <StatusRow key={name} s={c?.status === "healthy" ? "healthy" : "degraded"} label={`${name}: ${c?.status || "—"}`} />
                  ))}
              </div>
            )}
          </section>

          {/* Tracker optimization */}
          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="flex items-center gap-2 text-sm font-display font-semibold mb-3"><Clock className="h-4 w-4 text-cyanx" /> Optimization Stats (30d)</h2>
            {d.tracker ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs md:text-sm">
                  {[{ l: "Requests 30d", v: d.tracker.requests_30d }, { l: "Compression %", v: `${(d.tracker.compression_ratio_pct || 0).toFixed(1)}%` }, { l: "Tokens saved", v: d.tracker.tokens_saved_30d ? d.tracker.tokens_saved_30d.toLocaleString() : "—" }, { l: "Cost saved", v: d.tracker.cost_saved_usd ? `$${(d.tracker.cost_saved_usd || 0).toFixed(2)}` : "—" }].map(t => (
                    <div key={t.l} className="rounded-xl bg-white/[0.04] px-3 py-2"><span className="text-muted">{t.l}</span><div className="font-medium tabular-nums text-brandtext truncate">{t.v}</div></div>
                  ))}
                </div>
                <div className="rounded-xl bg-amber-900/10 border border-amber-700/20 px-3 py-3 text-xs text-amber-300 leading-relaxed">
                  <strong>Data truth note:</strong> the tracker’s combined "all" summary row reports $0.00 / zero output tokens (a known defect in the collector). Per-agent rows below are authoritative.
                  The leanctx flag is hardcoded in the collector (not measured) and token-shift is an unavailable enterprise SaaS feature.
                </div>
              </div>
            ) : <StatusRow s={"degraded"} label="Tracker not reached" />}
          </section>

          {/* Config + context lengths + tool router */}
          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="text-sm font-display font-semibold mb-4">Configuration &amp; Routing</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs md:text-sm text-muted">
              {d.configLive ? Object.entries(d.configLive).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-white/[0.04] px-2 py-1.5 truncate"><span className="text-brandtext font-medium">{k}</span>: <span className="tabular-nums">{String(v).slice(0, 40)}</span></div>
              )) : <span>—</span>}
            </div>
            {d.ctxCache && (
              <div className="mt-3 text-xs text-muted">Context cache entries: <span className="text-brandtext font-medium">{d.ctxCache.count}</span> · first 5 shown in details.</div>
            )}
            {d.router && (
              <div className="mt-2 text-xs text-muted">Router rebuilt <span className="text-brandtext">{(d.router.built_at ? d.router.stats?.built_at : "—")}</span> · breaker: {d.router.breaker?.map((b: any) => b.name).join(", ")}</div>
            )}
          </section>

          {/* Toolsets */}
          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="text-sm font-display font-semibold mb-3">Toolsets</h2>
            <div className="flex flex-wrap gap-2">
              {(d.toolsets || []).map((t: any) => (
                <span key={t.name} className={cn("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium border",
                  t.enabled ? (t.configured ? "bg-violetx/10 border-violetx/30 text-violetx" : "bg-fuchsiax/10 border-fuchsiax/30 text-fuchsiax") : "bg-redx/10 border-redx/30 text-redx")}>
                  {t.name} — {t.enabled ? (t.configured ? "configured" : "degraded") : "disabled"}
                </span>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
