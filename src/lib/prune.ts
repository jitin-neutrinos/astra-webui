// prune.ts — R5 storage hygiene. Once per 24h: fetch the server's live session
// list and delete bg_items_<sid> localStorage keys whose sid no longer exists
// (chats the server pruned would otherwise leak their dock state forever).
// Fire-and-forget by design: a failed fetch just means "try again tomorrow".
const PRUNE_AT_KEY = "astra-prune-at";
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BG_PREFIX = "bg_items_";

// Pure core (checked by bg-prune.check.ts): which keys to drop given the set
// of sids the server still knows about.
export function bgItemKeysToPrune(storageKeys: string[], liveSids: Set<string>): string[] {
  return storageKeys.filter((k) => k.startsWith(BG_PREFIX) && !liveSids.has(k.slice(BG_PREFIX.length)));
}

export async function pruneStaleBgItems(now = Date.now()): Promise<number> {
  try {
    const last = Number(localStorage.getItem(PRUNE_AT_KEY) || 0);
    if (now - last < PRUNE_INTERVAL_MS) return 0;
    localStorage.setItem(PRUNE_AT_KEY, String(now));
    const res = await fetch("/api/hx/sessions?limit=500&order=recent", { credentials: "same-origin" });
    if (!res.ok) return 0;
    const data = await res.json();
    const live = new Set<string>(
      (data.sessions || []).map((s: any) => s.session_id || s.id).filter(Boolean)
    );
    let removed = 0;
    for (const key of bgItemKeysToPrune(Object.keys(localStorage), live)) {
      localStorage.removeItem(key);
      removed++;
    }
    return removed;
  } catch {
    return 0;
  }
}
