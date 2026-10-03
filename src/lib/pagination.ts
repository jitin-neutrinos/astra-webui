// pagination.ts — the pure contract behind chat-history pagination.
//
// Extracted 2026-10-03 from inline logic in chat-landing.tsx so the invariants
// are directly checkable (see pagination.check.ts). The gateway endpoint is
// GET /api/sessions/<sid>/messages?order=&limit=&offset= — it always pages;
// `order=latest` anchors on the NEWEST rows and walks backwards with offset,
// while `order=oldest` walks forward from the start. Mixing the two re-fetches
// rows already held, which is why `order` is fixed here rather than passed in.

/** Rows per page. 200 keeps a page well under a frame's worth of segment work. */
export const PAGE_SIZE = 200;

/**
 * Scroll-up distance that triggers loading the previous page.
 * Matches the 240px threshold used by the scroll handler.
 */
export const LOAD_OLDER_THRESHOLD_PX = 240;

/** Query for one page of history. Always `latest` — see the module note. */
export function pageRequest(args: { offset: number }): {
  order: "latest";
  limit: number;
  offset: number;
} {
  return { order: "latest", limit: PAGE_SIZE, offset: Math.max(0, args.offset) };
}

/**
 * Offset for the next older page = however many rows we already hold.
 * Guards against a negative or NaN count reaching the query string.
 */
export function pageOffset(args: { held: number | null }): number {
  const n = args.held;
  if (n == null || !Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/** A full page means there may be more above; anything less is the end. */
export function hasMore(args: { returned: number }): boolean {
  const n = args.returned;
  if (!Number.isFinite(n) || n <= 0) return false;
  return n >= PAGE_SIZE;
}

type Row = { id?: number | null; [k: string]: unknown };

/**
 * Prepend a newly fetched older page, dropping any row whose id we already
 * hold. The boundary row is commonly re-sent by the server; without this the
 * feed duplicates one turn per page.
 *
 * Rows with no id are never deduped against each other — they carry no
 * durable address, so collapsing them would drop real content.
 */
export function prependOlder<T extends Row>(args: { held: T[]; older: T[] }): T[] {
  const { held, older } = args;
  const seen = new Set<unknown>();
  for (const r of held) {
    if (r && r.id != null) seen.add(r.id);
  }
  const fresh = older.filter((r) => {
    if (!r || r.id == null) return true; // un-stamped: keep, cannot dedupe
    return !seen.has(r.id);
  });
  return [...fresh, ...held];
}
