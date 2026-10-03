import { cn } from "@/lib/utils";

export type OpsStatus = "healthy" | "degraded" | "auth-gated" | "unreachable" | "disabled" | "inactive";

export const STATUS_META: Record<OpsStatus, { label: string; dot: string; text: string; note?: string }> = {
  healthy:     { label: "Healthy",     dot: "bg-violetx",  text: "text-violetx" },
  degraded:    { label: "Degraded",    dot: "bg-fuchsiax", text: "text-fuchsiax" },
  "auth-gated": { label: "Auth-gated", dot: "bg-cyanx",    text: "text-cyanx" },
  unreachable: { label: "Unreachable", dot: "bg-redx",     text: "text-redx" },
  disabled:    { label: "Disabled",    dot: "bg-muted",    text: "text-muted" },
  inactive:    { label: "Inactive",    dot: "bg-muted",    text: "text-muted" },
};

export function StatusDot({ s }: { s: OpsStatus }) {
  return (
    <span aria-hidden="true"
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", STATUS_META[s].dot)}
    />
  );
}

export function StatusRow({ s, label, reason }: { s: OpsStatus; label?: string; reason?: string }) {
  const meta = STATUS_META[s];
  return (
    <div className="flex items-center gap-2 text-sm">
      <StatusDot s={s} />
      <span className={cn("font-medium tabular-nums", meta.text)}>{label || meta.label}</span>
      {reason && <span className="text-muted truncate"> — {reason}</span>}
    </div>
  );
}
