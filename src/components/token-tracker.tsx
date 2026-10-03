import { useEffect, useState } from "react";
import { BarChart3, ShieldCheck, Zap, TrendingUp, Activity, Cpu, ArrowLeft } from "lucide-react";

/* Global Token Tracker — live data from tokenbeacon capture workers (127.0.0.1:8789)
   via the /api/beacon/* auth proxy. Harnesses: claude-code, hermes, opencode (agy has
   no local usage persistence — shown as uncaptured, never estimated).
   NO synthetic fallback data: if the API is unreachable we show the error, not fake rows. */

interface SummaryRow {
  harness: string;
  model: string;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  reasoning: number;
  cost_est: number;
  cost_actual: number;
}

interface RecordRow {
  ts: number;
  harness: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  cost_usd: number | null;
}

interface BeaconStatus {
  capture_last_run: string;
  pricing_last_run: string;
  derive_last_run: string;
}

const HARNESS_META: Record<string, { label: string; provider: string; note: string }> = {
  "claude-code": { label: "Claude Code", provider: "Anthropic", note: "" },
  hermes: { label: "Hermes", provider: "z.ai / OpenRouter / Nous", note: "" },
  opencode: { label: "OpenCode", provider: "z.ai coding plan", note: "" },
  agy: { label: "agy (Antigravity)", provider: "Google Gemini", note: "agy does not persist per-request usage locally. Excluded from totals — never estimated." },
};

const PERIODS = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
] as const;

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function formatUSD(n: number): string {
  return "$" + n.toFixed(2);
}

function timeAgo(raw: string | number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - Number(raw)));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.floor(s / 60)}m ago`;
  if (s < 172800) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface HarnessAgg {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  reasoning: number;
  cost: number;
  models: Map<string, number>;
}

export default function TokenTrackerPage({ onBack }: { onBack?: () => void }) {
  const [summary, setSummary] = useState<SummaryRow[] | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [status, setStatus] = useState<BeaconStatus | null>(null);
  const [days, setDays] = useState<number>(30);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const fetchData = async () => {
      try {
        const [s, r, st] = await Promise.all([
          fetch(`/api/beacon/summary?days=${days}`),
          fetch(`/api/beacon/records`),
          fetch(`/api/beacon/status`),
        ]);
        if (!s.ok) throw new Error(`tracker HTTP ${s.status}`);
        const summaryData = await s.json();
        if (alive) {
          setSummary(summaryData);
          setError(null);
        }
        if (r.ok && alive) setRecords(await r.json());
        if (st.ok && alive) setStatus(await st.json());
      } catch (e: any) {
        if (alive) setError(e?.message || "tracker unreachable");
      }
    };
    fetchData();
    const t = setInterval(fetchData, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [days]);

  // Aggregate per harness — real captured rows only, no synthetic fallback.
  const byHarness = new Map<string, HarnessAgg>();
  if (summary) {
    for (const r of summary) {
      const agg =
        byHarness.get(r.harness) ??
        { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, cost: 0, models: new Map<string, number>() };
      agg.input += r.input;
      agg.output += r.output;
      agg.cache_read += r.cache_read;
      agg.cache_write += r.cache_write;
      agg.reasoning += r.reasoning;
      agg.cost += r.cost_est;
      agg.models.set(r.model, (agg.models.get(r.model) ?? 0) + r.cost_est);
      byHarness.set(r.harness, agg);
    }
  }
  const totalCost = [...byHarness.values()].reduce((a, h) => a + h.cost, 0);
  const maxCost = Math.max(...[...byHarness.values()].map((h) => h.cost), 0.01);

  return (
    <div className="flex-1 overflow-auto bg-void text-brandtext font-sans p-6 lg:p-10">
      {/* Header */}
      <div className="max-w-5xl mx-auto mb-8 flex items-start gap-4">
        {onBack && (
          <button type="button" onClick={onBack} className="p-2 -ml-2 rounded-lg hover:bg-white/5 text-slate-400 transition lg:hidden" aria-label="Back to chat">
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div>
          <h2 className="font-display text-3xl tracking-tight text-brandtext">Global Token Tracker</h2>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent/70 mt-1">Live harness usage / token optimization observability</p>
          <p className="text-xs text-muted mt-2">
            Source: tokenbeacon per-request capture (claude-code, hermes, opencode) + LiteLLM/OpenRouter rate maps. Refresh: every 30s.
            {status && ` Capture ${timeAgo(status.capture_last_run)}.`}
          </p>
        </div>
      </div>

      {error && (
        <div className="max-w-5xl mx-auto mb-6 rounded-xl border border-redx/20 bg-redx/[0.04] p-4 text-xs font-mono text-redx">
          Tracker API error: {error} — showing no data rather than estimates. Check the tokenbeacon stack (127.0.0.1:8789).
        </div>
      )}

      <div className="max-w-5xl mx-auto space-y-6">
        {/* Capture worker health */}
        <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-6 backdrop-blur-md">
          <h3 className="font-display text-xl text-brandtext mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent" strokeWidth={1.5} />
            Capture Workers
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Capture", ts: status?.capture_last_run, icon: <Zap className="h-4 w-4" /> },
              { label: "Pricing", ts: status?.pricing_last_run, icon: <TrendingUp className="h-4 w-4" /> },
              { label: "Costing", ts: status?.derive_last_run, icon: <Activity className="h-4 w-4" /> },
            ].map((w) => (
              <div key={w.label} className="rounded-xl border border-white/[0.06] bg-void/40 p-4">
                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-slate-500">
                  {w.icon}
                  {w.label}
                </div>
                <div className={`mt-1 text-sm font-medium ${w.ts ? "text-accent" : "text-redx"}`}>
                  {w.ts ? timeAgo(w.ts) : "no data"}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-mono uppercase tracking-wider text-slate-500">
            <span>Headroom v0.37.0 (claude-code + hermes paths)</span>
            <span>•</span>
            <span>Pricing: LiteLLM + OpenRouter catalogs</span>
            <span>•</span>
            <span>TokenShift: N/A (enterprise SaaS)</span>
            <span>•</span>
            <span>agy: not locally instrumented — excluded, never estimated</span>
          </div>
        </section>

        {/* Per-harness usage table */}
        <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-6 backdrop-blur-md">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-xl text-brandtext flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-accent" strokeWidth={1.5} />
              Per-Harness Usage
            </h3>
            <div className="flex rounded-lg border border-white/[0.08] overflow-hidden" role="tablist" aria-label="Period">
              {PERIODS.map((p) => (
                <button
                  key={p.days}
                  role="tab"
                  aria-selected={days === p.days}
                  onClick={() => setDays(p.days)}
                  className={`px-3 py-1.5 text-xs font-medium transition ${days === p.days ? "bg-accent/10 text-accent" : "text-slate-500 hover:text-slate-300"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-white/[0.08] text-left text-[10px] font-mono uppercase tracking-wider text-slate-500">
                  <th className="py-2.5 px-3">Harness</th>
                  <th className="py-2.5 px-3 text-right">Input</th>
                  <th className="py-2.5 px-3 text-right">Cache Read</th>
                  <th className="py-2.5 px-3 text-right">Cache Write</th>
                  <th className="py-2.5 px-3 text-right">Output</th>
                  <th className="py-2.5 px-3 text-right">Cost (USD)</th>
                  <th className="py-2.5 px-3">Share</th>
                </tr>
              </thead>
              <tbody className="font-mono text-xs">
                {!summary ? (
                  <tr><td colSpan={7} className="py-6 text-center text-muted">Loading…</td></tr>
                ) : byHarness.size === 0 ? (
                  <tr><td colSpan={7} className="py-6 text-center text-muted">No usage captured for this period.</td></tr>
                ) : (
                  [...byHarness.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([name, h]) => {
                    const meta = HARNESS_META[name] ?? { label: name, provider: "", note: "" };
                    return (
                      <tr key={name} className="border-b border-white/[0.04] hover:bg-white/[0.02]" title={meta.note}>
                        <td className="py-2.5 px-3">
                          <div className="text-brandtext font-medium">{meta.label}</div>
                          <div className="text-[10px] text-slate-500">{meta.provider}</div>
                        </td>
                        <td className="py-2.5 px-3 text-right text-muted">{formatTokens(h.input)}</td>
                        <td className="py-2.5 px-3 text-right text-muted">{formatTokens(h.cache_read)}</td>
                        <td className="py-2.5 px-3 text-right text-muted">{formatTokens(h.cache_write)}</td>
                        <td className="py-2.5 px-3 text-right text-muted">{formatTokens(h.output)}</td>
                        <td className="py-2.5 px-3 text-right text-accent font-bold">{formatUSD(h.cost)}</td>
                        <td className="py-2.5 px-3">
                          <div className="h-1.5 w-24 rounded-[3px] bg-white/5 overflow-hidden">
                            <div className="h-full rounded-[3px] bg-accent/70" style={{ width: `${Math.round((h.cost / maxCost) * 100)}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
                {byHarness.size > 0 && (
                  <tr className="font-bold text-brandtext bg-accent/[0.04]">
                    <td className="py-2.5 px-3">Total</td>
                    <td className="py-2.5 px-3 text-right">—</td>
                    <td className="py-2.5 px-3 text-right">—</td>
                    <td className="py-2.5 px-3 text-right">—</td>
                    <td className="py-2.5 px-3 text-right">—</td>
                    <td className="py-2.5 px-3 text-right text-accent">{formatUSD(totalCost)}</td>
                    <td className="py-2.5 px-3">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Latest captured requests */}
        <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-6 backdrop-blur-md">
          <h3 className="font-display text-xl text-brandtext mb-4 flex items-center gap-2">
            <Cpu className="h-5 w-5 text-accent" strokeWidth={1.5} />
            Latest Captured Requests
          </h3>
          <div className="divide-y divide-white/[0.04]">
            {records.slice(0, 10).map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2 font-mono text-xs">
                <div className="min-w-0">
                  <span className="text-brandtext">{r.model}</span>
                  <span className="ml-2 text-slate-500">{r.harness}</span>
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-muted">
                    {formatTokens(r.input_tokens + r.cache_read_tokens + r.cache_write_tokens)} → {formatTokens(r.output_tokens)}
                  </span>
                  {r.cost_usd != null && <span className="ml-3 text-accent">{formatUSD(r.cost_usd)}</span>}
                </div>
              </div>
            ))}
            {records.length === 0 && <div className="py-4 text-center text-muted text-xs">No records.</div>}
          </div>
        </section>

        <p className="text-[10px] text-slate-600 font-mono max-w-5xl mx-auto">
          Costs are computed per-request from exact captured token counts using LiteLLM/OpenRouter pricing catalogs — cache-aware (cache reads at the discounted rate, cache writes at the write premium). agy (Antigravity) is excluded because the CLI does not persist per-request usage locally; it is never estimated, so totals are accurate for every harness shown.
        </p>
      </div>
    </div>
  );
}
