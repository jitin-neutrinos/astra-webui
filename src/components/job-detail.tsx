import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileEdit, FilePlus, FileX, Bot, MessageSquare, Clock, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

// JobDetail — drill-down for ONE completed review job. Answers "what exactly did
// this chat change?": the measured doc-estate diff (which skills / agent docs /
// project docs were created, edited or deleted), the reviewer's own FILE:
// claims, and how the two compare. Evidence, not vibes.
type Change = { path: string; kind: string; skill?: string | null; name?: string };
type Diff = { created: Change[]; edited: Change[]; deleted: Change[]; total: number } | null;
type Analysis = {
  at?: number;
  error?: string;
  diff?: Diff;
  claims?: string[];
  verdict?: { claimed: number; matched: number; unverified: string[]; undeclared: string[] } | null;
};
type Detail = {
  session?: { sid?: string; title?: string | null; source?: string | null; message_rows?: number; created_at?: number; ended_at?: number; review_status?: string; analysis_status?: string; analysis?: string };
  messages?: unknown[];
  job?: { status?: string; attempts?: number; worker_log?: string; last_error?: string; updated_at?: number; created_at?: number };
};

const KIND_META: Record<string, { label: string; cls: string }> = {
  skill: { label: "Skill", cls: "text-accent" },
  "agent-doc": { label: "Agent doc", cls: "text-purple-300" },
  "project-doc": { label: "Project doc", cls: "text-sky-300" },
  other: { label: "File", cls: "text-slate-300" },
};

function dur(a?: number | null, b?: number | null) {
  if (!a || !b) return "—";
  const s = Math.max(0, Math.round((b - a) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function ChangeList({ title, items, icon, tone }: { title: string; items: Change[]; icon: React.ReactNode; tone: string }) {
  if (!items.length) return null;
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className={`mb-2 flex items-center gap-2 text-xs font-medium ${tone}`}>
        {icon} {title} <span className="tabular-nums text-muted">{items.length}</span>
      </div>
      <ul className="space-y-1">
        {items.map((c) => {
          const k = KIND_META[c.kind] || KIND_META.other;
          return (
            <li key={c.path} className="flex items-start gap-2 text-[11px]">
              <span className={`shrink-0 font-mono text-[9px] uppercase tracking-wider ${k.cls}`}>{k.label}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-slate-300" title={c.path}>
                {c.skill || c.name || c.path}
              </span>
              <span className="min-w-0 max-w-[45%] truncate text-[10px] text-slate-600" title={c.path}>{c.path}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function JobDetail({ sid, onBack }: { sid: string; onBack: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => { document.title = `Job ${sid.slice(-9)} — Astra`; }, [sid]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/training/sessions/${encodeURIComponent(sid)}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDetail(await res.json());
      setError(null);
    } catch (e) {
      setError(`Could not load job: ${(e as Error)?.message || "request failed"}`);
    }
    setLoading(false);
  }, [sid]);

  useEffect(() => { void load(); }, [load]);

  let analysis: Analysis | null = null;
  try { analysis = detail?.session?.analysis ? JSON.parse(String((detail.session as any).analysis)) : null; } catch { analysis = null; }
  const diff = analysis?.diff || null;
  const verdict = analysis?.verdict || null;
  const log = detail?.job?.worker_log || "";
  const jobStatus = detail?.job?.status;

  return (
    <div className="flex h-full w-full flex-col bg-void text-brandtext overflow-hidden">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.07] px-4 md:px-6">
        <button onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/5 shrink-0" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-base font-semibold">
            {detail?.session?.title || `Job ${sid.slice(-9)}`}
          </h1>
          <div className="truncate font-mono text-[10px] text-slate-500">{sid}</div>
        </div>
        {jobStatus && (
          <span className={`flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${jobStatus === "done" ? "text-emerald-400" : jobStatus === "failed" ? "text-red-400" : "text-accent"}`}>
            {jobStatus === "done" ? <CheckCircle2 className="h-3 w-3" /> : jobStatus === "failed" ? <AlertTriangle className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
            {jobStatus}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24">
        <div className="mx-auto max-w-4xl space-y-5">
          {loading && <div className="text-xs text-muted">Loading job detail.</div>}
          {error && <div className="rounded-xl border border-redx/30 bg-redx/5 p-3 text-xs text-redx">{error}</div>}

          {detail && (
            <>
              {/* Facts */}
              <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-4">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted"><MessageSquare className="h-3 w-3" /> Transcript</div>
                  <div className="mt-1 text-xl font-display font-semibold tabular-nums">{detail.messages?.length ?? detail.session?.message_rows ?? "—"}</div>
                  <div className="text-[10px] text-slate-600">rows archived</div>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-4">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted"><Clock className="h-3 w-3" /> Review time</div>
                  <div className="mt-1 text-xl font-display font-semibold tabular-nums">{dur(detail.session?.ended_at, detail.job?.updated_at)}</div>
                  <div className="text-[10px] text-slate-600">attempt {detail.job?.attempts ?? 0}/6</div>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-4">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted"><FileEdit className="h-3 w-3" /> Files changed</div>
                  <div className="mt-1 text-xl font-display font-semibold tabular-nums">{diff ? diff.total : "—"}</div>
                  <div className="text-[10px] text-slate-600">measured by diff</div>
                </div>
                <div className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-4">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted"><Bot className="h-3 w-3" /> Declared</div>
                  <div className="mt-1 text-xl font-display font-semibold tabular-nums">{analysis?.claims?.length ?? 0}</div>
                  <div className="text-[10px] text-slate-600">FILE: lines</div>
                </div>
              </section>

              {/* What changed */}
              <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
                <h2 className="mb-3 text-sm font-display font-semibold">What this chat changed</h2>
                {!analysis ? (
                  <div className="text-xs text-muted">
                    No analysis recorded for this session yet.
                    {detail.session?.analysis_status === "failed" && " (the last analysis run failed)"}
                  </div>
                ) : analysis.error && !diff ? (
                  <div className="text-xs text-amber-400/90">Analysis error: {analysis.error}</div>
                ) : !diff ? (
                  <div className="text-xs text-muted">No doc-estate diff was captured for this run.</div>
                ) : diff.total === 0 ? (
                  <div className="text-xs text-muted">No documentation changes — this chat had no durable lessons.</div>
                ) : (
                  <div className="space-y-3">
                    <ChangeList title="Skills & docs edited" items={diff.edited} icon={<FileEdit className="h-3.5 w-3.5" />} tone="text-amber-300" />
                    <ChangeList title="Created" items={diff.created} icon={<FilePlus className="h-3.5 w-3.5" />} tone="text-emerald-300" />
                    <ChangeList title="Deleted" items={diff.deleted} icon={<FileX className="h-3.5 w-3.5" />} tone="text-red-300" />
                  </div>
                )}
              </section>

              {/* Claims vs measured */}
              {analysis?.claims?.length ? (
                <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
                  <h2 className="mb-3 text-sm font-display font-semibold">Reviewer's claims <span className="text-[10px] font-normal text-muted">(from its FILE: lines)</span></h2>
                  <ul className="space-y-1">
                    {analysis.claims.map((c) => {
                      const verified = diff && [...diff.created, ...diff.edited].some((d) => d.path === c);
                      return (
                        <li key={c} className="flex items-center gap-2 text-[11px]">
                          {verified ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" /> : <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />}
                          <span className="min-w-0 flex-1 truncate font-mono text-slate-300" title={c}>{c}</span>
                          <span className="shrink-0 text-[9px] uppercase tracking-wider text-slate-600">{verified ? "verified" : "unverified"}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {verdict && (verdict.undeclared.length > 0) && (
                    <div className="mt-3 border-t border-white/[0.06] pt-3">
                      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-amber-400/80">Changed but not declared ({verdict.undeclared.length})</div>
                      <ul className="space-y-1">
                        {verdict.undeclared.map((c) => (
                          <li key={c} className="truncate font-mono text-[10px] text-slate-400" title={c}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              ) : null}

              {/* Raw reviewer output */}
              {log && (
                <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
                  <button onClick={() => setShowLog((v) => !v)} className="flex w-full items-center justify-between text-sm font-display font-semibold">
                    <span>Reviewer output</span>
                    <span className="text-[10px] font-normal text-muted">{showLog ? "hide" : "show"}</span>
                  </button>
                  {showLog && (
                    <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-slate-400">{log}</pre>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default JobDetail;
