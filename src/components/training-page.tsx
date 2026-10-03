import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, GraduationCap, Loader2, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { jobCounts, countdownUntil } from "@/lib/training-view";

// TrainingPage — permanent home of the end-session training pipeline status
// that used to live in the chat header popup. Fed by /api/training/jobs plus
// training.updated WS events relayed to window events by chat-landing's bridge,
// with a 15s poll as the WS-loss backstop. States: dumping | reviewing |
// awaiting_retry | failed | done.
type Job = {
  sid: string;
  status: string;
  attempts?: number;
  next_attempt_at?: number | null;
  last_error?: string | null;
  updated_at?: number;
  [k: string]: any;
};

// Rows come straight from SQLite via listTrainingSessions(); every field is
// treated as optional because the schema can gain columns without this page.
type SessionRow = {
  sid?: string;
  title?: string | null;
  source?: string | null;
  created_at?: number | null;
  ended_at?: number | null;
  message_rows?: number | null;
  token_stats?: string | null;
  review_status?: string | null;
  job_status?: string | null;
  attempts?: number | null;
  next_attempt_at?: number | null;
  last_error?: string | null;
  [k: string]: any;
};

const STATE_META: Record<string, { label: string; cls: string; spin: boolean }> = {
  dumping: { label: "Saving chat", cls: "text-cyanx", spin: true },
  reviewing: { label: "Reviewing", cls: "text-cyanx", spin: true },
  awaiting_retry: { label: "Queued for retry", cls: "text-amber-400", spin: false },
  failed: { label: "Review failed", cls: "text-red-400", spin: false },
  done: { label: "Saved & closed", cls: "text-emerald-400", spin: false },
};

function metaFor(status?: string | null) {
  return STATE_META[String(status)] || { label: String(status ?? "unknown"), cls: "text-muted", spin: false };
}

function stamp(ms?: number | null) {
  if (!ms) return "—";
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 16).replace("T", " ");
}

// token_stats is a JSON blob (user_msgs, assistant_msgs, tool_calls,
// total_chars); a row can also carry it unparsed or not at all.
function parseStats(raw: unknown): Record<string, number> | null {
  if (raw && typeof raw === "object") return raw as Record<string, number>;
  if (typeof raw !== "string" || !raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, number>) : null;
  } catch { return null; }
}

export function TrainingPage({ onBack }: { onBack: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openSid, setOpenSid] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => { document.title = "Training & Reviews — Astra"; }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/training/jobs?limit=100", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setJobs(Array.isArray(data?.jobs) ? data.jobs : []);
      setJobsError(null);
    } catch (e) {
      // Keep whatever is already on screen: a failed poll must not blank the page.
      setJobsError(`Could not load review jobs: ${(e as Error)?.message || "request failed"}`);
    }
    try {
      const res = await fetch("/api/training/sessions", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
      setSessionsError(null);
    } catch (e) {
      setSessionsError(`Could not load ended sessions: ${(e as Error)?.message || "request failed"}`);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const t = window.setInterval(() => { void refresh(); }, 15000);
    return () => window.clearInterval(t);
  }, [refresh]);

  // Countdown ticker, only while a retry is actually pending.
  useEffect(() => {
    if (!jobs.some((j) => j.status === "awaiting_retry")) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [jobs]);

  useEffect(() => {
    const onEvt = (e: Event) => {
      const ev = (e as CustomEvent<{ type?: string; payload?: any }>).detail;
      if (ev?.type !== "training.updated") return;
      const job = ev.payload;
      if (!job?.sid) return;
      setJobs((prev) => {
        const i = prev.findIndex((x) => x.sid === job.sid);
        if (i === -1) return [job, ...prev];
        const next = [...prev];
        next[i] = { ...next[i], ...job };
        return next;
      });
    };
    window.addEventListener("astra-ws-event", onEvt);
    return () => window.removeEventListener("astra-ws-event", onEvt);
  }, []);

  const toggleDetail = useCallback(async (sid: string) => {
    if (openSid === sid) { setOpenSid(null); setDetail(null); setDetailError(null); return; }
    setOpenSid(sid);
    setDetail(null);
    setDetailError(null);
    try {
      const res = await fetch(`/api/training/sessions/${encodeURIComponent(sid)}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDetail(await res.json());
    } catch (e) {
      setDetailError(`Could not load session detail: ${(e as Error)?.message || "request failed"}`);
    }
  }, [openSid]);

  // Newest first: the server orders by updated_at/ended_at DESC, but a WS merge
  // can prepend a fresh job, so re-sort on the keys we can actually read.
  const ordered = [...jobs].sort((a, b) => (Number(b?.updated_at ?? 0) || 0) - (Number(a?.updated_at ?? 0) || 0));

  const { active, failed, done } = jobCounts(ordered);

  const tile = (label: string, value: number, cls: string) => (
    <div className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-display font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );

  return (
    <div className="flex h-full w-full flex-col bg-void text-brandtext overflow-hidden">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] px-4 md:px-6">
        <button onClick={onBack} className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/5 md:hidden shrink-0" aria-label="Back"><ArrowLeft className="h-4 w-4" /></button>
        <div className="flex items-center gap-2 min-w-0"><GraduationCap className="h-5 w-5 text-cyanx shrink-0" /><h1 className="truncate font-display text-base font-semibold">Training &amp; Reviews — Session training</h1></div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24">
        <div className="mx-auto max-w-4xl space-y-6">
          <p aria-live="polite" className="text-xs text-muted">
            Poll every 15s · live WS updates · read-only.
            {(jobsError || sessionsError) && <span className="ml-2 text-redx">{jobsError || sessionsError}</span>}
          </p>

          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="flex items-center gap-2 text-sm font-display font-semibold mb-3"><GraduationCap className="h-4 w-4 text-cyanx" /> Session training</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {tile("In flight", active, "text-cyanx")}
              {tile("Failed", failed, "text-redx")}
              {tile("Saved & closed", done, "text-emerald-400")}
              {tile("Total jobs", ordered.length, "text-brandtext")}
            </div>
          </section>

          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="flex items-center gap-2 text-sm font-display font-semibold mb-3"><Loader2 className="h-4 w-4 text-cyanx" /> Review jobs</h2>
            {jobsError && <div className="mb-2 text-xs text-redx">{jobsError}</div>}
            {ordered.length === 0 ? (
              <div className="py-3 text-xs text-muted">{loading ? "Loading review jobs." : "No review jobs yet."}</div>
            ) : (
              <ul className="space-y-1.5" role="list">
                {ordered.map((j, idx) => {
                  const m = metaFor(j?.status);
                  return (
                    <li key={j?.sid || `job${idx}`} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-slate-300" title={String(j?.last_error || j?.sid || "")}>
                          {String(j?.sid ?? "—").slice(-9)}
                        </span>
                        <span className={`flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${m.cls}`} aria-live="polite">
                          {m.spin && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                          {j?.status === "failed" ? <AlertTriangle className="h-3 w-3" aria-hidden /> : j?.status === "awaiting_retry" ? <Clock className="h-3 w-3" aria-hidden /> : j?.status === "done" ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : null}
                          {m.label}
                          {j?.status === "awaiting_retry" ? ` ${countdownUntil(j?.next_attempt_at)}` : ""}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-500">
                        {j?.attempts !== undefined && j?.attempts !== null && <span className="tabular-nums">attempt {j.attempts}/6</span>}
                        {j?.updated_at ? <span className="tabular-nums">updated {stamp(j.updated_at)}</span> : null}
                      </div>
                      {j?.status === "awaiting_retry" && (
                        <div className="mt-1 text-[10px] text-slate-500">
                          retry in {countdownUntil(j?.next_attempt_at)} · attempt {j?.attempts}/6{j?.last_error ? ` · ${String(j.last_error).slice(0, 60)}` : ""}
                        </div>
                      )}
                      {j?.status === "failed" && j?.last_error && (
                        <div className="mt-1 truncate text-[10px] text-red-400/80" title={String(j.last_error)}>{String(j.last_error).slice(0, 90)}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
            <h2 className="flex items-center gap-2 text-sm font-display font-semibold mb-3"><CheckCircle2 className="h-4 w-4 text-cyanx" /> Ended sessions</h2>
            {sessionsError && <div className="mb-2 text-xs text-redx">{sessionsError}</div>}
            {sessions.length === 0 ? (
              <div className="py-3 text-xs text-muted">{loading ? "Loading ended sessions." : "No ended sessions yet."}</div>
            ) : (
              <ul className="space-y-1.5" role="list">
                {sessions.map((s, idx) => {
                  const sid = String(s?.sid ?? "");
                  const stats = parseStats(s?.token_stats);
                  const open = openSid === sid;
                  const jobMeta = metaFor(s?.job_status);
                  return (
                    <li key={sid || `s${idx}`} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                      <button
                        type="button"
                        onClick={() => sid && void toggleDetail(sid)}
                        aria-expanded={open}
                        aria-label={`Show training detail for ${sid || "session"}`}
                        className="flex w-full items-center justify-between gap-2 text-left"
                      >
                        <span className="min-w-0 truncate text-xs text-slate-300" title={sid}>
                          {s?.title || (sid ? sid.slice(-9) : "—")}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          {s?.job_status && <span className={`font-mono text-[10px] uppercase tracking-wider ${jobMeta.cls}`}>{jobMeta.label}</span>}
                          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 text-muted" aria-hidden />}
                        </span>
                      </button>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                        <span className="tabular-nums" title={sid}>sid {sid ? sid.slice(-9) : "—"}</span>
                        <span>ended {stamp(s?.ended_at)}</span>
                        <span>rows {s?.message_rows ?? "—"}</span>
                        {stats && <span>chars {stats.total_chars ?? "—"}</span>}
                        {stats && <span>tools {stats.tool_calls ?? "—"}</span>}
                        <span>source {s?.source || "—"}</span>
                      </div>
                      {open && (
                        <div className="mt-2 border-t border-white/[0.06] pt-2">
                          {detailError ? (
                            <div className="text-[10px] text-redx">{detailError}</div>
                          ) : !detail ? (
                            <div className="text-[10px] text-slate-500">Loading session detail.</div>
                          ) : (
                            <div className="space-y-1 text-[10px] text-slate-400">
                              <div className="tabular-nums">
                                created {stamp(detail?.session?.created_at)} · ended {stamp(detail?.session?.ended_at)} · review {detail?.session?.review_status || "—"}
                              </div>
                              <div className="tabular-nums">transcript rows: {Array.isArray(detail?.messages) ? detail.messages.length : "—"}</div>
                              {detail?.job && (
                                <div className={metaFor(detail?.job?.status).cls}>
                                  job {metaFor(detail?.job?.status).label} · attempt {detail?.job?.attempts ?? "—"}/6
                                </div>
                              )}
                              {detail?.job?.last_error && <div className="text-red-400/80">{String(detail.job.last_error).slice(0, 160)}</div>}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

export default TrainingPage;
