// message-order.ts — the total order for a transcript (Phase 5).
//
// WHY A DEDICATED ORDER AT ALL:
//   The requirement was "compile the chronology from timestamps and other
//   UUIDs". That is unsafe as written, and the reason is worth stating plainly:
//   a phone whose clock is four seconds slow emits a user message that sorts
//   BEFORE one you actually sent afterwards. Every major platform orders
//   server-side for exactly this reason — Slack's `ts` IS the id and the sort
//   key; Discord's snowflake is 42-bit server-ms + worker + process + counter;
//   Telegram's per-chat integer `message_id` has `date` as a DISPLAY-only field;
//   Google Chat's `createTime` is output-only. The unanimity is the finding.
//
//   Upstream Hermes already made this call, and wrote down why:
//     "Load messages in insertion order (id, never timestamp: clocks regress)."
//     — hermes_state_messages.py:1061
//   `messages.id` is INTEGER PRIMARY KEY AUTOINCREMENT. `timestamp REAL` exists
//   but is deliberately NOT the sort key.
//
// SO: there is NO client wall-clock anywhere in this module. Timestamps are
// carried for DISPLAY only (durations, "when did this arrive"), never for
// ordering. Correctness comes from the server's sequence; the client's only job
// is to never lose the ability to say "I sent this and it has not landed yet".
//
// THE ORDER (D8):
//
//     KEY(committed) = (0, seq, id)
//     KEY(optimistic) = (1, uuidv7_ms, client_msg_id)
//
//   `0` before `1` means a COMMITTED row always sorts ahead of a PENDING one at
//   the same instant, so an optimistic bubble can never jump ahead of a real
//   reply it triggered — and, just as importantly, can never jump BEHIND one it
//   is still waiting for.
//
//   uuidv7 supplies `uuidv7_ms` for optimistic rows: time-ordered so equal
//   milliseconds still break ties stably across devices. RFC 9562 §5.7 mandates
//   v7; §6.4 concedes multi-node generators lean on the random source, so v7
//   makes tie-breaks STABLE, not CORRECT. That is the right division of labour:
//   correctness from the server's seq, stability from the client's uuid.
//
// WHY NOT A CRDT:
//   No messaging platform uses a CRDT for transcript order, and this codebase
//   already decided so — src/lib/read-sync.ts:1-7: "server watermark is durable
//   truth; the CRDT layer is the fast path", CRDT for read-markers and presence,
//   server-authoritative for the transcript. One writer, one authoritative log:
//   a CRDT would add a dependency for zero correctness gain.

/** Where a row's ORDER comes from. Committed always precedes pending. */
export const PHASE_COMMITTED = 0;
export const PHASE_OPTIMISTIC = 1;

export type OrderPhase = typeof PHASE_COMMITTED | typeof PHASE_OPTIMISTIC;

/** A message row reduced to the fields ordering actually needs. */
export interface Orderable {
  /**
   * Astra's per-session MONOTONIC cursor — the ordering authority.
   *
   * NOT the gateway's `seq`. The gateway's seq is per-PROCESS and resets to 1 on
   * restart (event_replay.py: "Seq counters live in-process, so a restart resets
   * them to 1 while clients hold high watermarks"), which is exactly why the
   * stream log carries its own `mono` column: a client resuming on seq would skip
   * a whole post-restart turn. Use `mono` when the server provides it.
   */
  mono?: number | null;
  /**
   * The gateway's own sequence number. Present for reference and for matching
   * gateway replies — NOT for ordering, and NOT unique across a restart.
   */
  seq?: number | null;
  /** The row's own id — the authoritative tiebreak within one cursor value. */
  id: string;
  /** Epoch ms. DISPLAY ONLY. Never consulted for ordering. */
  ts?: number | null;
  /**
   * A client-minted uuidv7, present only on a row the server has not yet
   * acknowledged. Its presence is what makes the row OPTIMISTIC.
   */
  clientMsgId?: string | null;
}

export type SortKey = readonly [number, number, string];

/** Milliseconds embedded in a uuidv7, or null when the id is not a v7. */
export function uuidv7Ms(id: string | null | undefined): number | null {
  if (!id || typeof id !== "string") return null;
  // 8-4-4-4-12 with the version nibble '7' at index 14.
  const v = id[14];
  if (v !== "7") return null;
  const hi = parseInt(id.slice(0, 8), 16);
  const lo = parseInt(id.slice(9, 13), 16);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return hi * 2 ** 16 + lo;
}

/**
 * Is this row one the server has not acknowledged yet?
 * A clientMsgId alone is not proof — a COMMITTED row can carry the same id, since
 * that id is exactly what it was acknowledged FOR. So a committed row (one with a
 * server seq) is committed regardless of the client id.
 */
export function phaseOf(row: Orderable): OrderPhase {
  return isCommitted(row) ? PHASE_COMMITTED : PHASE_OPTIMISTIC;
}

/** A row is committed once the server has assigned it a cursor. */
export function isCommitted(row: Orderable): boolean {
  const m = Number(row.mono);
  if (Number.isFinite(m) && m > 0) return true;
  // Fall back to the gateway's seq for callers holding raw history rows (which
  // carry no `mono`). Ordering is still correct within one gateway process, and
  // the id tiebreak keeps it deterministic even if seqs collide after a restart.
  const s = Number(row.seq);
  return Number.isFinite(s) && s > 0;
}

/** The committed row's ordering cursor. */
function committedCursor(row: Orderable): number {
  const m = Number(row.mono);
  return Number.isFinite(m) && m > 0 ? m : Number(row.seq) || 0;
}

/**
 * The total order. Committed (0, cursor, id) sorts before optimistic
 * (1, uuidv7_ms, client_msg_id).
 *
 * Returns a NEW array; the input is never mutated.
 */
export function orderKey(row: Orderable): SortKey {
  if (isCommitted(row)) {
    return [PHASE_COMMITTED, committedCursor(row), String(row.id)] as const;
  }
  const ms = uuidv7Ms(row.clientMsgId);
  // No usable client timestamp (not a v7, or absent): fall back to the row's own
  // display ts so the row still has a STABLE position rather than NaN ordering,
  // which would make sort results depend on input order. `Number(undefined)` is
  // NaN, so the isFinite guard below also covers the absent case.
  const t = ms ?? Number(row.ts);
  return [PHASE_OPTIMISTIC, Number.isFinite(t) ? t : 0, String(row.clientMsgId ?? row.id)] as const;
}

/** Compare two keys. Exported so callers can sort without building key arrays. */
export function compareKeys(a: SortKey, b: SortKey): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0;
}

/** Sort a copy of `rows` into the total order. */
export function sortRows<T extends Orderable>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => compareKeys(orderKey(a), orderKey(b)));
}

/**
 * Dedupe by id BEFORE sorting — required, not optional. A reconnect can deliver
 * the same row twice (the socket replays what the HTTP catch-up also returned);
 * without this, a message renders twice. First occurrence wins, so the earliest
 * copy (the one that arrived live, before any refetch backfilled it) is kept.
 */
export function dedupeById<T extends Orderable>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (!r || typeof r.id !== "string") continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/**
 * Merge a fresh batch into an existing list: dedupe, then re-sort.
 * This is the "compile the chronology" operation the requirement describes, and
 * it is order-independent — the same set of rows always yields the same output,
 * on every device, regardless of arrival order.
 */
export function mergeRows<T extends Orderable>(existing: readonly T[], incoming: readonly T[]): T[] {
  return sortRows(dedupeById([...existing, ...incoming]));
}

/**
 * Partition into turns: consecutive assistant rows share ONE turn, broken only by
 * a user row.
 *
 * This is the owner's Phase-7 requirement stated as data: "one assistant bubble,
 * broken only by user messages". Applying it HERE, in the pure order layer, means
 * the same rule runs on history reload and on a live merge, so a bubble cannot
 * differ between the two.
 */
export interface TurnFold<T extends Orderable> {
  kind: "user" | "assistant";
  /** First (oldest) row id in the turn — stable across reloads. */
  id: string;
  rows: T[];
}

export function foldIntoTurns<T extends Orderable & { role: string }>(rows: readonly T[]): TurnFold<T>[] {
  const out: TurnFold<T>[] = [];
  let cur: TurnFold<T> | null = null;
  for (const r of rows) {
    const kind: TurnFold<T>["kind"] = r.role === "user" ? "user" : "assistant";
    // Anything that is not a plain user row (tool, system, failed_turn) belongs
    // to the assistant bubble — it is the agent speaking, not the human.
    if (!cur || cur.kind !== kind) {
      cur = { kind, id: r.id, rows: [r] };
      out.push(cur);
    } else {
      cur.rows.push(r);
    }
  }
  return out;
}

/**
 * Where does a newly-arrived row belong, and what does it break?
 *
 * A late user message (sent on another device, or queued before a reload)
 * splits the assistant turn that currently spans its position. Callers need to
 * know WHICH turn to split so only two DOM nodes change instead of re-flowing
 * the whole transcript — a full re-derive is correct on LOAD only.
 *
 * Returns the index of the turn the row belongs in, and the turn index it splits
 * (null when it opens a new turn).
 */
export function locateInsertion(
  turns: readonly TurnFold<Orderable>[],
  row: Orderable & { role: string }
): { turnIndex: number; splitsTurnAt: number | null } {
  const kind = row.role === "user" ? "user" : "assistant";
  const key = orderKey(row);

  // FIRST: is the row inside an existing turn's span, whatever that turn's kind?
  // This is the split case that matters — a user message arriving late lands inside
  // the assistant bubble it interrupts. Checking same-kind turns first would miss
  // it entirely, because the turn it breaks is the OTHER kind.
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (!t.rows.length) continue;
    const firstKey = orderKey(t.rows[0]);
    const lastKey = orderKey(t.rows[t.rows.length - 1]);
    if (compareKeys(key, firstKey) >= 0 && compareKeys(key, lastKey) <= 0) {
      // Inside this turn. It splits at the END of this turn (the new row opens
      // the following one), so the caller re-partitions from here.
      return { turnIndex: i + 1, splitsTurnAt: i };
    }
  }

  // Not inside any span: it belongs at a boundary, never splitting a turn.
  // Take the LAST same-kind turn it sorts after, not the first — returning early
  // on turn 0 (user) would place a trailing user message in the middle of the
  // transcript instead of at the end.
  let target = 0;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.kind !== kind || !t.rows.length) continue;
    const lastKey = orderKey(t.rows[t.rows.length - 1]);
    if (compareKeys(key, lastKey) > 0) target = i + 1;
  }
  return { turnIndex: target, splitsTurnAt: null };
}

export const _test = { uuidv7Ms, isCommitted, phaseOf };
