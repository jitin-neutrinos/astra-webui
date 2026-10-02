/**
 * Should this transcript row paint in the chat feed?
 *
 * Owner mandate: a `/bg` turn's REPLY belongs to the background dock, not the
 * chat. Two exceptions keep the existing behaviour intact:
 *   - the small system-note receipt (isSysNote) always shows in the feed — it
 *     is the visible marker that the task exists and what state it is in;
 *   - the row the dock's "jump to response" is currently targeting must paint,
 *     or the scroll-to would land on nothing.
 */
export function showsInFeed(msg: { bgId?: number; isSysNote?: boolean; id: string }, openBgRef: string | null): boolean {
  if (msg.isSysNote) return true;          // receipts always visible
  if (msg.bgId == null) return true;        // ordinary chat turn
  return msg.id === openBgRef;              // bg reply: only when jumped to
}
