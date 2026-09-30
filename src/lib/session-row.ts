// Pure sidebar-row helpers (no React) so they can be pinned by session-row.check.ts.

export interface SessionRow {
  id: string;
  session_id?: string | null;
  title?: string | null;
  preview?: string | null;
  snippet?: string | null;
  role?: string | null;
  source?: string | null;
  model?: string | null;
  message_count?: number | null;
  last_activity_at?: number | null;
  last_active?: number | null;
  started_at?: number | null;
  is_active?: boolean | null;
  pinned?: boolean | null;
  archived?: boolean | null;
}

export function rowKey(s: SessionRow): string {
  return s.session_id || s.id;
}

export function rowTime(s: SessionRow): number | null {
  const t = s.last_activity_at ?? s.last_active ?? s.started_at;
  return typeof t === "number" ? t : null;
}

/** Compact relative time: now / Nm / Nh / Nd, then "Mar 4" (+" ’25" only for past years). */
export function timeAgo(epochSeconds: number | null | undefined, nowMs: number = Date.now()): string {
  if (typeof epochSeconds !== "number" || !isFinite(epochSeconds)) return "";
  const s = Math.max(0, Math.floor((nowMs - epochSeconds * 1000) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  const d = new Date(epochSeconds * 1000);
  const now = new Date(nowMs);
  const sameYear = d.getFullYear() === now.getFullYear();
  const label = d.toLocaleString("default", { month: "short" }) + " " + d.getDate();
  return sameYear ? label : `${label} ’${String(d.getFullYear()).slice(2)}`;
}

/** Sort: pinned first, then by effective activity time desc (nulls last), stable. */
export function sortRows(rows: SessionRow[]): SessionRow[] {
  return [...rows].sort((a, b) => {
    const pa = a.pinned ? 1 : 0;
    const pb = b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const ta = rowTime(a) ?? -Infinity;
    const tb = rowTime(b) ?? -Infinity;
    if (ta !== tb) return tb - ta;
    return 0;
  });
}

/** Merge a fresh page into the accumulated list; fresh rows win, keyed by rowKey. */
export function mergeRows(prev: SessionRow[], next: SessionRow[]): SessionRow[] {
  const byKey = new Map<string, SessionRow>();
  for (const r of prev) byKey.set(rowKey(r), r);
  for (const r of next) byKey.set(rowKey(r), r);
  return sortRows([...byKey.values()]);
}
