import { useEffect } from "react";
import { ArrowLeft, Terminal, Plug, Braces } from "lucide-react";
import { useOpsPoll } from "./ops/use-ops-poll";
import { StateStorePanel, TrackerPanel, AuditChecksPanel } from "./ops/audit-panels";

type HarnessData = {
  skills?: any[];
  mcpData?: any[];
  pluginsAPI?: any[];
  pluginsDisk?: string[];
  hooks?: any[];
  runtimes?: any[];
  userServices?: any[];
  toolsetsData?: any[];
  error?: string;
  retention?: any;
  trackerDb?: any;
  auditChecks?: any;
  stateStore?: any;
};

export function HarnessPage({ onBack }: { onBack: () => void }) {
  const { data } = useOpsPoll<HarnessData>("/api/sysinfo/harness", 30000);
  const d = data || {};

  useEffect(() => { document.title = "Harness — Astra"; }, []);

  const skillsTop = (d.skills || []).slice(0, 10);
  const skillsFull = (d.skills || []).slice(10);

  return (
    <div className="flex h-full w-full flex-col bg-void text-brandtext overflow-hidden">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] px-4 md:px-6">
        <button onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/5 md:hidden shrink-0" aria-label="Back"><ArrowLeft className="h-4 w-4" /></button>
        <div className="flex items-center gap-2 min-w-0"><Terminal className="h-5 w-5 text-accent shrink-0" /><h1 className="truncate font-display text-base font-semibold">Harness — Tools &amp; Agents</h1></div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24">
        <div className="mx-auto max-w-4xl space-y-6">
          <p aria-live="polite" className="text-xs text-muted">Poll every 30s · read-only · no fake rows.</p>

          {/* Skills */}
          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="flex items-center gap-2 text-sm font-display font-semibold mb-3"><Braces className="h-4 w-4 text-accent" /> Skills</h2>
            {d.error ? (
              <div className="text-xs text-redx">{d.error}</div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted mb-3">
                  <span>Total: <b className="text-brandtext">{(d.skills || []).length}</b></span>
                  <span>Enabled: <b className="text-violetx">{(d.skills || []).filter((s: any) => s.enabled).length}</b></span>
                  <span>Disabled: <b className="text-fuchsiax">{(d.skills || []).filter((s: any) => s.enabled === false).length}</b></span>
                  <span>Unused (usage 0): <b className="text-muted">{(d.skills || []).filter((s: any) => !s.usage).length}</b></span>
                </div>
                <div className="space-y-1 text-xs md:text-sm">
                  {skillsTop.map((s: any) => (
                    <div key={s.name} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2">
                      <span className="font-medium text-brandtext truncate">{s.name}</span>
                      <div className="flex items-center gap-2 text-muted tabular-nums">
                        <span className={s.enabled === false ? "text-fuchsiax" : (s.usage === 0 ? "text-muted" : "text-accent")}>{s.status || "—"}</span>
                        <span className="text-brandtext font-medium">{s.usage || 0}</span>
                        <span className="text-xs">calls</span>
                      </div>
                    </div>
                  ))}
                  {skillsFull.length > 0 && (
                    <div className="text-xs text-muted">+ {skillsFull.length} more skills not shown (capped list).</div>
                  )}
                </div>
              </>
            )}
          </section>

          {/* MCP */}
          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="flex items-center gap-2 text-sm font-display font-semibold mb-3"><Plug className="h-4 w-4 text-accent" /> MCP Servers</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs md:text-sm">
                <thead><tr className="text-muted text-left"><th>Name</th><th>Transport</th><th>Enabled</th><th>Source</th><th>Tools</th></tr></thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {(d.mcpData || []).map((m: any) => (
                    <tr key={m.name} className="hover:bg-white/[0.03]">
                      <td className="py-1.5 font-medium text-brandtext truncate max-w-[10rem]">{m.name}</td>
                      <td className="py-1.5 tabular-nums text-muted">{m.transport || "—"}</td>
                      <td className="py-1.5"><span className={m.enabled ? "text-violetx" : "text-fuchsiax"}>{m.enabled ? "Yes" : "No"}</span></td>
                      <td className="py-1.5 text-muted">{m.source || "—"}</td>
                      <td className="py-1.5 tabular-nums text-muted">{m.tools === null ? "not probed" : (Array.isArray(m.tools) ? m.tools.length : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Plugins */}
          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="flex items-center gap-2 text-sm font-display font-semibold mb-3">Plugins ({(d.pluginsAPI || []).length})</h2>
            <div className="flex flex-wrap gap-2">
              {(d.pluginsAPI || []).map((p: any) => (
                <span key={p.name} className="inline-flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-brandtext">
                  {p.name} <span className="text-muted tabular-nums">v{p.version || "—"}</span>
                </span>
              ))}
            </div>
            {d.pluginsDisk && d.pluginsDisk.length > 0 && (
              <div className="mt-2 text-xs text-muted">On disk but not registered: {d.pluginsDisk.join(", ")}</div>
            )}
          </section>

          {/* Hooks */}
          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="text-sm font-display font-semibold mb-3">Hooks</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs md:text-sm">
                <thead><tr className="text-muted text-left"><th>Path</th><th>Modified</th><th>Purpose</th></tr></thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {(d.hooks || []).map((h: any) => (
                    <tr key={h.name} className="hover:bg-white/[0.03]"><td className="py-1.5 truncate max-w-[14rem] font-medium text-brandtext">{h.name}</td><td className="py-1.5 tabular-nums text-muted">{h.mtime ? new Date(h.mtime).toISOString().slice(0,10) : "—"}</td><td className="py-1.5 text-muted truncate">{h.purpose}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Toolsets */}
          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="text-sm font-display font-semibold mb-3">Toolsets</h2>
            <div className="flex flex-wrap gap-2">
              {(d.toolsetsData || []).map((t: any) => (
                <span key={t.name} className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-brandtext">
                  {t.name}
                </span>
              ))}
            </div>
          </section>

          {/* Runtimes + services */}
          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="text-sm font-display font-semibold mb-3">Agent Runtimes</h2>
            <div className="space-y-1 text-xs md:text-sm">
              {(d.runtimes || []).map((r: any) => (
                <div key={r.name} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2">
                  <span className="font-medium text-brandtext">{r.name}</span>
                  <span className={r.status === "healthy" ? "text-violetx font-medium" : (r.status === "degraded" ? "text-fuchsiax font-medium" : "text-redx font-medium")}>{r.status} <span className="text-muted font-normal ml-1">{r.version || r.reason || ""}</span></span>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-white/[0.06]">
              <h3 className="text-xs font-display font-semibold mb-2">System Services</h3>
              <div className="flex flex-wrap gap-2 text-xs text-muted">
                {(d.userServices || []).map((s: any) => (
                  <span key={s.name} className="inline-flex rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-0.5">{s.name}</span>
                ))}
              </div>
            </div>
          </section>
          <StateStorePanel st={d.stateStore} />
          <TrackerPanel tr={d.trackerDb} />
          <AuditChecksPanel checks={d.auditChecks} />
        </div>
      </div>
    </div>
  );
}
