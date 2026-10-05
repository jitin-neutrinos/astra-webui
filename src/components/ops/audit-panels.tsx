// Audit-derived panels shared by the Context, Memory and Harness pages.
//
// Every number here comes from a READ-ONLY SQLite probe of the actual store (server/sysinfo.mjs),
// not from config restatement — the 2026-10-04 audit found that most of the interesting failures
// (dead trust scoring, unrecorded retrievals, framing stored as memory) were invisible in every
// status endpoint precisely because nobody read the store.
import { AlertTriangle, CheckCircle2, Database, ShieldCheck, Timer } from "lucide-react";
import { StatusRow, type OpsStatus } from "./status";
import { cn } from "@/lib/utils";

export type FactStore = {
  status?: OpsStatus; reason?: string;
  facts_total?: number;
  trust_values?: number;
  retrieval_count_sum?: number;
  facts_without_provenance?: number;
  entity_linked?: number;
  framing_facts?: number;
  truncated_facts?: number;
  bank_dims?: number[];
  dim_uniform?: boolean;
};

export type StateStore = {
  status?: OpsStatus; reason?: string;
  size_mb?: number; messages?: number; sessions?: number; days?: number;
  per_day?: number; projected_gb_year?: number; tool_row_share_pct?: number;
  retention?: { armed?: boolean; schedule?: string; archived?: number };
};

export type TrackerHealth = { status?: OpsStatus; rows?: number; last_record_age_h?: number | null; note?: string };

export type AuditCheck = { name: string; file: string; note: string; present?: boolean; age_days?: number };

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-xl bg-white/[0.04] px-3 py-2">
      <span className="text-muted">{label}</span>
      <div className={cn("font-medium tabular-nums truncate",
        tone === "good" && "text-violetx", tone === "warn" && "text-amber-300", tone === "bad" && "text-redx")}>
        {value}
      </div>
    </div>
  );
}

function Section({ title, icon, children, note }: { title: string; icon?: React.ReactNode; children: React.ReactNode; note?: string }) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-midnight/50 p-5 backdrop-blur-md">
      <h2 className="flex items-center gap-2 text-sm font-display font-semibold mb-4">{icon}{title}</h2>
      {children}
      {note && <p className="mt-3 text-[11px] leading-relaxed text-muted">{note}</p>}
    </section>
  );
}

/** Fact-store integrity: the four invariants the audit fixed. */
export function FactStorePanel({ fs }: { fs?: FactStore }) {
  if (!fs || fs.status === "unreachable") {
    return <Section title="Fact Store" icon={<Database className="h-4 w-4 text-accent" />}>
      <StatusRow s={(fs?.status as OpsStatus) || "unreachable"} label={fs?.reason || "fact store unreadable"} />
    </Section>;
  }
  const framing = fs.framing_facts ?? 0;
  const noProv = fs.facts_without_provenance ?? 0;
  const uniform = fs.dim_uniform !== false;
  const total = fs.facts_total ?? 0;
  const linkedPct = total ? Math.round(((fs.entity_linked ?? 0) / total) * 100) : 0;
  return (
    <Section
      title="Fact Store — content integrity"
      icon={<Database className="h-4 w-4 text-accent" />}
      note="Read live from memory_store.db (read-only). These four counters were all failing before the 2026-10-04 audit: 56 gateway-envelope rows stored as user facts, zero provenance, mixed vector dims, and a trust column that never moved off its default."
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs md:text-sm">
        <Stat label="Facts" value={total.toLocaleString()} />
        <Stat label="Entity-linked" value={`${linkedPct}%`} tone={linkedPct >= 60 ? "good" : "warn"} />
        <Stat label="Retrievals recorded" value={(fs.retrieval_count_sum ?? 0).toLocaleString()} tone={(fs.retrieval_count_sum ?? 0) > 0 ? "good" : "bad"} />
        <Stat label="Trust values" value={fs.trust_values ?? 0} tone={(fs.trust_values ?? 0) > 1 ? "good" : "warn"} />
      </div>
      <div className="mt-3 space-y-1">
        <StatusRow s={framing === 0 ? "healthy" : "degraded"} label={`Runtime framing stored as memory: ${framing} ${framing === 0 ? "(clean)" : "— these are gateway envelopes, not user facts"}`} />
        <StatusRow s={noProv === 0 ? "healthy" : "degraded"} label={`Facts without provenance: ${noProv}`} />
        <StatusRow s={uniform ? "healthy" : "degraded"} label={`Vector dim uniform: ${uniform ? (fs.bank_dims || []).join(",") || "—" : `MIXED ${(fs.bank_dims || []).join(",")} — stale rows from an unmigrated dim`}`} />
      </div>
    </Section>
  );
}

/** state.db growth + whether anything bounds it. */
export function StateStorePanel({ st }: { st?: StateStore }) {
  if (!st) return null;
  const r = st.retention;
  return (
    <Section
      title="Session Store — growth & retention"
      icon={<Timer className="h-4 w-4 text-accent" />}
      note={`${(st.messages ?? 0).toLocaleString()} messages over ${st.days ?? 0}d. Tool results are ${st.tool_row_share_pct ?? 0}% of stored bytes — that share is why raw size grows faster than session count.`}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs md:text-sm">
        <Stat label="Size" value={`${st.size_mb ?? 0} MB`} tone={(st.size_mb ?? 0) > 2000 ? "warn" : undefined} />
        <Stat label="Per day" value={(st.per_day ?? 0).toLocaleString()} />
        <Stat label="Projected / yr" value={`${st.projected_gb_year ?? 0} GB`} tone={(st.projected_gb_year ?? 0) > 20 ? "warn" : "good"} />
        <Stat label="Archived" value={(r?.archived ?? 0).toLocaleString()} tone={(r?.archived ?? 0) > 0 ? "good" : undefined} />
      </div>
      <div className="mt-3">
        <StatusRow
          s={r?.armed ? "healthy" : "degraded"}
          label={r?.armed
            ? `Retention armed — ${r.schedule}, archive-to-JSONL before delete`
            : "No retention policy — this store grows without bound"}
        />
      </div>
    </Section>
  );
}

/** Proof the tracker is actually collecting (it recorded nothing for 9 days). */
export function TrackerPanel({ tr }: { tr?: TrackerHealth }) {
  if (!tr) return null;
  const rows = tr.rows ?? 0;
  return (
    <Section
      title="Token Tracker — collection proof"
      icon={<ShieldCheck className="h-4 w-4 text-accent" />}
      note="A collector that serves its API but never writes is worse than none: the figures look live. Row count is the only honest evidence."
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs md:text-sm">
        <Stat label="usage_records" value={rows.toLocaleString()} tone={rows > 0 ? "good" : "bad"} />
        <Stat label="Last record" value={tr.last_record_age_h != null ? `${tr.last_record_age_h}h ago` : "—"} tone={(tr.last_record_age_h ?? 99) < 2 ? "good" : "warn"} />
      </div>
      {rows === 0 && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-700/20 bg-amber-900/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {tr.note || "not recording"}
        </p>
      )}
    </Section>
  );
}

/** The runnable regression checks that guard all of this. */
export function AuditChecksPanel({ checks }: { checks?: AuditCheck[] }) {
  if (!checks?.length) return null;
  return (
    <Section
      title="Regression checks"
      icon={<CheckCircle2 className="h-4 w-4 text-accent" />}
      note="Assert-based and exit 1 on failure, so a regression is a non-zero exit rather than a silent drift. Run any of them from the shell."
    >
      <div className="space-y-2">
        {checks.map(c => (
          <div key={c.file} className="rounded-xl bg-white/[0.03] px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-xs font-medium text-brandtext">{c.name}</span>
              <StatusRow s={c.present ? "healthy" : "degraded"} label={c.present ? "present" : "missing"} />
            </div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-muted">{c.file}</div>
            <div className="mt-0.5 text-[11px] leading-relaxed text-muted">{c.note}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}