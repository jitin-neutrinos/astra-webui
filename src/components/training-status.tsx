import { useEffect, useState, useCallback, useRef } from "react";
import { GraduationCap, ChevronDown, Loader2, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

// TrainingStatus — live status chip + jobs panel for the end-session training
// pipeline. Fed by `training.updated` WS events (relayed to window events by
// chat-landing's ws bridge) + initial fetch. States:
//   dumping | reviewing  → cyan spinner
//   awaiting_retry       → amber clock + countdown
//   failed               → red triangle
//   done                 → green check (brief, then treated as idle)
type JobState = "dumping" | "reviewing" | "awaiting_retry" | "failed" | "done";

const STATE_META: Record<JobState, { label: string; cls: string; spin: boolean }> = {
  dumping: { label: "Saving chat", cls: "text-accent", spin: true },
  reviewing: { label: "Reviewing", cls: "text-accent", spin: true },
  awaiting_retry: { label: "Queued for retry", cls: "text-amber-400", spin: false },
  failed: { label: "Review failed", cls: "text-red-400", spin: false },
  done: { label: "Saved & closed", cls: "text-emerald-400", spin: false },
};

function fmtCountdown(nextAttemptAt: number | null | undefined) {
  if (!nextAttemptAt) return "";
  const ms = Math.max(0, nextAttemptAt - Date.now());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function TrainingStatus({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const [jobs, setJobs] = useState<Array<{ sid: string; status: JobState; attempts?: number; next_attempt_at?: number | null; last_error?: string | null; [k: string]: any }>>([]);
  const [, forceTick] = useState(0);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/training/jobs?limit=20");
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.jobs || []);
    } catch { /* offline — next event/panel-open retries */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // WS events arrive as window CustomEvent("astra-ws-event"); detail is
  // EventPayload {type, payload} (same bridge chats-panel uses for
  // sessions.changed). training.updated's payload = the review_jobs row.
  useEffect(() => {
    const onEvt = (e: Event) => {
      const ev = (e as CustomEvent<{ type?: string; payload?: any }>).detail;
      if (ev?.type !== "training.updated") return;
      const job = ev.payload;
      if (!job?.sid) return;
      setJobs((prev) => {
        const i = prev.findIndex((x) => x.sid === job.sid);
        if (i === -1) return [job, ...prev].slice(0, 20);
        const next = [...prev];
        next[i] = { ...next[i], ...job };
        return next;
      });
    };
    window.addEventListener("astra-ws-event", onEvt);
    return () => window.removeEventListener("astra-ws-event", onEvt);
  }, []);

  // Countdown ticker only while the panel is open AND a retry is pending.
  useEffect(() => {
    if (!open) return;
    const hasPending = jobs.some((j) => j.status === "awaiting_retry");
    if (!hasPending) return;
    const t = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [open, jobs]);

  // Poll while open as a WS-loss backstop.
  useEffect(() => {
    if (!open) { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; } return; }
    pollRef.current = window.setInterval(refresh, 15000);
    return () => { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; } };
  }, [open, refresh]);

  const active = jobs.filter((j) => ["dumping", "reviewing", "awaiting_retry"].includes(j.status));
  const chipJob = active[0] || jobs.find((j) => j.status === "failed");
  if (!chipJob) return null;
  const meta = STATE_META[chipJob.status] || STATE_META.reviewing;

  return (
    <span className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        title="Session training pipeline"
        className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm text-slate-300 transition-colors duration-150 hover:bg-white/5 hover:text-white max-lg:h-10 max-lg:w-10 max-lg:justify-center max-lg:p-0"
      >
        {meta.spin
          ? <Loader2 className="h-4 w-4 animate-spin text-accent" />
          : chipJob.status === "failed"
            ? <AlertTriangle className="h-4 w-4 text-red-400" />
            : chipJob.status === "awaiting_retry"
              ? <Clock className="h-4 w-4 text-amber-400" />
              : <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
        <span className={`max-lg:hidden font-mono text-[10px] uppercase tracking-[0.2em] ${meta.cls}`}>
          {meta.label}{chipJob.status === "awaiting_retry" ? ` ${fmtCountdown(chipJob.next_attempt_at)}` : ""}
        </span>
        <ChevronDown className="h-3.5 w-3.5 opacity-60 max-lg:hidden" />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-80 rounded-xl border border-white/10 bg-[var(--surface-overlay)] p-3 shadow-2xl backdrop-blur-xl">
          <div className="mb-2 flex items-center gap-2 px-1 font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
            <GraduationCap className="h-3.5 w-3.5" /> Session training
          </div>
          {jobs.length === 0 && (
            <div className="px-1 py-3 text-xs text-slate-500">No ended sessions yet.</div>
          )}
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {jobs.map((j) => {
              const m = STATE_META[j.status] || STATE_META.reviewing;
              return (
                <div key={j.sid} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-300" title={j.last_error || j.sid}>
                      {j.sid.slice(-9)}
                    </span>
                    <span className={`flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${m.cls}`}>
                      {m.spin && <Loader2 className="h-3 w-3 animate-spin" />}
                      {m.label}
                      {j.status === "awaiting_retry" ? ` ${fmtCountdown(j.next_attempt_at)}` : ""}
                    </span>
                  </div>
                  {j.status === "awaiting_retry" && (
                    <div className="mt-1 text-[10px] text-slate-500">
                      retry in {fmtCountdown(j.next_attempt_at)} · attempt {j.attempts}/6{j.last_error ? ` · ${String(j.last_error).slice(0, 60)}` : ""}
                    </div>
                  )}
                  {j.status === "failed" && j.last_error && (
                    <div className="mt-1 truncate text-[10px] text-red-400/80" title={j.last_error}>{String(j.last_error).slice(0, 90)}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}
