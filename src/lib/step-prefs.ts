// Per-step open/closed preference (owner mandate: everything collapsed by
// default; user-opened steps stay open across reloads/revisits, everything
// else stays closed). localStorage-backed, per-chat scoped, size-capped.
// Tool steps key on their stable provider tool_call id; thinking steps on a
// content hash (ids are not stable across live/restored paths, content is).

const KEY = "astra-step-open";
const CAP = 400;

let cache: Map<string, boolean> | null = null;

function load(): Map<string, boolean> {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    for (const [k, v] of Object.entries(raw)) if (typeof v === "boolean") cache.set(k, v as boolean);
  } catch { /* corrupt store → start empty */ }
  return cache;
}

function persist() {
  if (!cache) return;
  // Cap: keep the most recent CAP entries (Map preserves insertion order).
  let entries = [...cache.entries()];
  if (entries.length > CAP) entries = entries.slice(entries.length - CAP);
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* storage full → prefs are best-effort */ }
}

export function stepOpen(key: string): boolean | undefined {
  return load().get(key);
}

export function setStepOpen(key: string, open: boolean) {
  load().set(key, open);
  persist();
}

export function newestClosedStepKey(keys: string[]): string | null {
  const store = load();
  for (let i = keys.length - 1; i >= 0; i--) if (!store.get(keys[i])) return keys[i];
  return null;
}

export function hashKey(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
