import { Plan } from "./plan-block";

const KEY = "astra-plan-draft";
const CAP = 40;

let cache: Map<string, Plan> | null = null;

function load(): Map<string, Plan> {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof (v as any).v === "number") {
        cache.set(k, v as Plan);
      }
    }
  } catch { /* corrupt store → start empty */ }
  return cache;
}

function persist() {
  if (!cache) return;
  let entries = [...cache.entries()];
  if (entries.length > CAP) entries = entries.slice(entries.length - CAP);
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* storage full */ }
}

export function getDraft(sessionId: string, planId: string): Plan | null {
  return load().get(`${sessionId}:${planId}`) || null;
}

export function setDraft(sessionId: string, planId: string, plan: Plan | null): void {
  const key = `${sessionId}:${planId}`;
  const store = load();
  if (plan === null) {
    store.delete(key);
  } else {
    store.set(key, plan);
  }
  persist();
}
