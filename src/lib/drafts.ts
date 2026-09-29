// Per-session composer drafts (R8f). Storage injected so checks run under node.
export type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const draftKey = (sid: string | null) => `astra:draft:${sid || "new"}`;

export function loadDraft(kv: KV, sid: string | null): string {
  try {
    return kv.getItem(draftKey(sid)) ?? "";
  } catch {
    return "";
  }
}

export function saveDraft(kv: KV, sid: string | null, text: string): void {
  try {
    if (text.trim() === "") kv.removeItem(draftKey(sid));
    else kv.setItem(draftKey(sid), text);
  } catch { /* quota/private mode — drafts are best-effort */ }
}

export function clearDraft(kv: KV, sid: string | null): void {
  try {
    kv.removeItem(draftKey(sid));
  } catch { /* best-effort */ }
}

// A draft started on the "new" pseudo-id moves to the real session id once minted.
export function moveDraft(kv: KV, from: string | null, to: string): void {
  try {
    const text = kv.getItem(draftKey(from));
    if (text != null) {
      saveDraft(kv, to, text);
      if (draftKey(from) !== draftKey(to)) kv.removeItem(draftKey(from));
    }
  } catch { /* best-effort */ }
}
