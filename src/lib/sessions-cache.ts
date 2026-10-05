// sessions-cache.ts — ONE shared session-list fetch, shared by every caller.
//
// WHY (measured RCA, 2026-10-05):
//   Opening Astra downloaded the SAME chat list THREE times, from three unrelated
//   call sites:
//     • src/components/chats-panel.tsx:165  ?limit=15&sources=<filtered>
//     • src/App.tsx:242                     ?limit=100&order=recent
//     • src/lib/prune.ts:20                 ?limit=500&order=recent
//   Each identical request cost ~31 ms locally but ~307 ms through the Cloudflare
//   tunnel, so the triplication was ~900 ms of pure waiting before anything could
//   render. Measured in a live browser: the list request fired 4x in one open.
//
// THE FIX — two independent mechanisms, because either alone leaves a hole:
//
//   1. COALESCING (in-flight de-duplication): concurrent identical requests share
//      ONE network round trip. This is what kills the triplication: three callers
//      firing in the same tick now cost one fetch. Correct even when the callers
//      differ in `limit` — see normalise() below.
//
//   2. A SHORT TTL CACHE: a later request for the same key within `ttlMs` is
//      served from memory. This covers the sequential case (App's seed runs after
//      the panel's fetch resolves) that coalescing alone would miss.
//
// WHAT IS *NOT* SHARED, DELIBERATELY:
//   • `sources` — a filtered list is a DIFFERENT answer. Two callers wanting
//     different filters must each fetch; coalescing them would show the wrong
//     chats. The filtered and unfiltered keys therefore never collide.
//   • search (`/sessions/search`) — a different endpoint and a different shape.
//   • `offset > 0` — a pagination window is a different slice, not a prefix of
//     the first page's answer. Caching it would pin the second page forever.
//
// WHY NOT A FULL REVALIDATION CACHE:
//   A stale-while-revalidate cache hides new chats, and the read-marker/presence
//   machinery in this app already owns "what changed" (sessions.changed events,
//   the seedFromServer broadcast). Adding a second source of truth for freshness
//   would duplicate that ownership — the bug class src/lib/read-sync.ts warns
//   about ("server watermark is durable truth; the CRDT layer is the fast path").
//   So this cache is deliberately SHORT-LIVED and coalescing-only: it removes
//   duplicate work within one open, and never becomes the record of truth.
//
// INVALIDATION: `invalidateSessions()` is called by the existing change signals, so
// the cache cannot outlive the moment it would go stale.

export type SessionsPayload = {
  sessions?: any[];
  total?: number;
  results?: any[];
  [k: string]: unknown;
};

const DEFAULT_TTL_MS = 1500;

/** key -> { at, promise, value } */
type Entry = {
  at: number;
  value?: SessionsPayload;
  promise?: Promise<SessionsPayload>;
};
const cache = new Map<string, Entry>();

/**
 * Reduce a URL to the part that determines the ANSWER.
 * Two URLs that normalise to the same key may share a result; two that differ
 * may not. This is the single place that decision is made.
 */
export function normalise(url: string): string | null {
  if (typeof url !== "string" || !url.startsWith("/api/hx/sessions")) return null;
  const [path, query = ""] = url.split("?");
  // A search returns message-hits, not a session list — never shared.
  if (path.includes("/search")) return null;
  // A paginated window is a different slice of the list.
  const params = new URLSearchParams(query);
  const offset = Number(params.get("offset") || 0);
  if (offset > 0) return null;

  // Keep only the parameters that change the answer. Everything else (cache
  // busters, credentials hints, trace ids) is noise and must not split the key.
  const limit = params.get("limit") || "";
  const order = params.get("order") || "recent";
  const sources = params.get("sources") || "";
  // No `sources` means ALL sources, which is a genuinely different answer from
  // an explicit source list — keep them distinct.
  return `${path}?limit=${limit}&order=${order}&sources=${sources}`;
}

/**
 * Fetch a session list, coalesced and briefly cached.
 * Resolves to the parsed JSON; rejects exactly as a bare fetch would (with
 * `.status` attached, so callers keep their specific 401/503 messaging).
 */
export async function fetchSessionsOnce(
  url: string,
  opts?: { ttlMs?: number; init?: RequestInit }
): Promise<SessionsPayload> {
  const { ttlMs = DEFAULT_TTL_MS, init } = opts || {};
  const key = normalise(url);
  // Not shareable (search / paged / foreign URL): go straight to the network.
  if (!key) return doFetch(url, init);

  const now = Date.now();
  const hit = cache.get(key);

  // 1. Coalesce an in-flight request.
  if (hit?.promise) return hit.promise;

  // 2. Serve a fresh-enough value.
  if (hit && hit.value !== undefined && now - hit.at < ttlMs) {
    // Refresh the timestamp so a burst of callers keeps hitting the cache
    // instead of each one starting a new TTL window.
    hit.at = now;
    return hit.value;
  }

  // 3. Otherwise fetch once, and let everyone arriving during it share it.
  const promise = doFetch(url, init).then((value) => {
    const e = cache.get(key);
    // Only write if this is still the newest request for the key (a later
    // invalidation must not be clobbered by an older in-flight response).
    if (e && e.promise === promise) {
      e.value = value;
      e.promise = undefined;
      e.at = Date.now();
    }
    return value;
  }).catch((err) => {
    const e = cache.get(key);
    if (e && e.promise === promise) { e.promise = undefined; e.value = undefined; }
    throw err;
  });

  cache.set(key, { at: now, promise });
  return promise;
}

async function doFetch(url: string, init?: RequestInit): Promise<SessionsPayload> {
  const res = await fetch(url, { credentials: "same-origin", ...(init || {}) });
  if (!res.ok) {
    // Surface the status so callers can keep their specific 401/503 messaging.
    const err = new Error(`sessions fetch failed: ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as SessionsPayload;
}

/**
 * Drop cached session lists. Call this when the server says the list changed
 * (`sessions.changed`), so the next open fetches for real.
 */
export function invalidateSessions(): void {
  cache.clear();
}

/** Diagnostics: how many keys are held and how fresh each is. */
export function sessionsCacheStats(now = Date.now()) {
  const entries = [...cache.entries()].map(([key, e]) => ({
    key: key.slice(0, 70),
    ageMs: now - e.at,
    inFlight: !!e.promise,
    cached: e.value !== undefined,
  }));
  return { keys: cache.size, entries };
}

export const _test = { DEFAULT_TTL_MS, normalise, cache };
