// Unread tracking, WhatsApp model:
// - SERVER watermark (`last_read_at` via PATCH /api/hx/sessions/<id> {unread:false}) is the
//   cross-device source of truth; a chat is read when its OWNER views it on ANY device.
// - LIVE events (message.complete over the WS) bump a local in-memory overlay so the pill
//   appears instantly; the overlay is reconciled away the next time the row is opened.
// - Only assistant RESPONSES count (message.complete), never tool calls / thinking /
//   errors / gate or approval requests.
// - The auto-greet kickoff ("New chat just started…") is a UI convention, not a message:
//   never counted anywhere.
// Overlay entries carry a `t` (bumped-at, ms). The overlay is a CACHE — orphan entries
// (live session ids that never mapped to a stored row, chats that were deleted) must
// never outlive the chat list, or the tab-title count drifts above the visible pills.
let overlay: Record<string, { n: number; t: number }> = {};
let seenCompletes: Record<string, true> = {};
let currentStoredSid: string | null = null;
let baseTitle = "Astra";

/** Known stored-row keys from the last full sessions fetch — the pruning set. */
let knownRowKeys: Set<string> | null = null;
const ORPHAN_TTL_MS = 10 * 60 * 1000; // keep young orphans (list may be mid-load / mapped later)

/** live session id -> stored row key (sessions rotate ids on compression; rows list tips). */
let sidmap: Record<string, string> = {};

export function mapSession(liveSid: string, storedKey: string) {
  if (sidmap[liveSid] !== storedKey) {
    sidmap[liveSid] = storedKey;
  }
}

export function storedKeyFor(liveSid: string): string | null {
  return sidmap[liveSid] || null;
}

// ── Remote focus (cross-device read) ────────────────────────────────────────
// Owner mandate: a chat open and focused on ANY device is READ everywhere. The
// proxy already broadcasts who is focused where (presence.snapshot /
// presence.update); without consuming it here a message completing in a chat
// focused on the phone still bumped a pill here, because the only read test was
// "focused on THIS device".
let remoteFocus = new Set<string>();

/** Replace the remote-focus set from a presence payload (snapshot or update).
 *  Returns the chat keys that are newly focused elsewhere, so the caller can
 *  clear any local pill they were still showing. */
export function applyPresence(payload: any): string[] {
  ensure();
  const before = new Set(remoteFocus);
  const next = new Set<string>();
  if (Array.isArray(payload?.devices)) {
    for (const d of payload.devices) if (d?.focus) next.add(String(d.focus));
  } else if (payload?.focus) {
    // single-device update; merge into what we know rather than replace it
    for (const k of before) if (k !== String(payload.focus)) next.add(k);
    next.add(String(payload.focus));
  }
  remoteFocus = next;
  const gained: string[] = [];
  for (const k of remoteFocus) if (!before.has(k)) gained.push(k);
  return gained;
}

/** True when this chat is focused on some OTHER surface (phone, another tab). */
export function isRemotelyFocused(key: string): boolean {
  return remoteFocus.has(String(key || ""));
}

let audioCtx: AudioContext | null = null;
let chimeMuted = false;
export function setChimeMuted(m: boolean) { chimeMuted = m; }
export function isChimeMuted() { return chimeMuted; }

function save() {
  try { localStorage.setItem("astra_unread_overlay_v1", JSON.stringify(overlay)); } catch { /* ignore */ }
}
function restore() {
  try {
    const o = localStorage.getItem("astra_unread_overlay_v1");
    if (o) {
      const parsed: unknown = JSON.parse(o);
      // legacy shape {key: number} → migrate; current shape {key: {n,t}}
      overlay = {};
      for (const [k, v] of Object.entries((parsed as Record<string, unknown>) || {})) {
        if (typeof v === "number") overlay[k] = { n: v, t: 0 }; // unknown age: pruned at first list load, server re-seeds if real
        else if (v && typeof v === "object" && typeof (v as { n?: unknown }).n === "number") {
          const rec = v as { n: number; t?: number };
          overlay[k] = { n: rec.n, t: rec.t || 0 };
        }
      }
    }
  } catch { /* ignore */ }
}
let restored = false;
function ensure() { if (!restored) { restored = true; restore(); } }

const GREET_RE = /^New chat just started\. Greet me briefly and naturally, then ask what I'd like to work on\.\s*$/;

function computeTotal(): number {
  ensure();
  pruneOrphans();
  return Object.values(overlay).reduce((a, e) => a + e.n, 0);
}

/** Drop overlay entries whose key is not a known chat row AND is older than the
 *  orphan TTL. Called from computeTotal (title) and seedFromServer.
 *  Returns true when anything was removed. */
function pruneOrphans(nowMs = Date.now()): boolean {
  if (!knownRowKeys) return false; // no full list yet — nothing to prune against
  let changed = false;
  for (const k of Object.keys(overlay)) {
    if (knownRowKeys.has(k)) continue;
    if (nowMs - (overlay[k]?.t || 0) > ORPHAN_TTL_MS) {
      delete overlay[k];
      changed = true;
    }
  }
  if (changed) save();
  return changed;
}

function updateTitle() {
  const total = computeTotal();
  if (typeof document !== "undefined") {
    document.title = total > 0 ? `(${total}) ${baseTitle}` : baseTitle;
  }
}

function playChime() {
  if (chimeMuted) return;
  if (typeof window === "undefined" || !window.AudioContext) return;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});

    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(660, t + 0.09);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
    gain.gain.setValueAtTime(0.15, t + 0.18);
    gain.gain.linearRampToValueAtTime(0, t + 0.22);

    osc.start(t);
    osc.stop(t + 0.22);
  } catch {
    // best effort
  }
}

function bump(key: string) {
  ensure();
  const cur = overlay[key];
  overlay[key] = { n: (cur?.n || 0) + 1, t: Date.now() };
  save();
  updateTitle();
  playChime();
  notifyChanged();
}

export function setBaseTitle(t: string) {
  baseTitle = t;
  updateTitle();
}

/** The chat the user is CURRENTLY looking at (stored id, not live id). */
export function setActiveSession(storedSid: string | null) {
  currentStoredSid = storedSid;
}

/** Server-authoritative unread count for a row + live overlay on top. */
export function getUnreadCount(storedKey: string, serverUnread = 0): number {
  ensure();
  return Math.max(serverUnread, overlay[storedKey]?.n || 0);
}

/** Count unread RESPONSES from history rows since a watermark (epoch seconds).
 * Only assistant rows with real text count; tool/thinking/error rows never do. */
export function countUnreadResponses(rows: { role: string; timestamp?: number; content?: string | null; text?: string | null; display_content?: string | null }[], since: number | null | undefined): number {
  if (!since) return 0;
  const main = (r: any) =>
    (typeof r.text === "string" ? r.text
      : typeof r.content === "string" ? r.content
      : typeof r.display_content === "string" ? r.display_content
      : "") || "";
  let n = 0;
  for (const r of rows) {
    if (r.role !== "assistant") continue;
    const ts = typeof r.timestamp === "number" ? r.timestamp : 0;
    if (ts <= since) continue;
    const t = main(r).trim();
    if (!t || GREET_RE.test(t)) continue;
    n++;
  }
  return n;
}

/** A response turn completed on the wire. Keyed by the STORED session id when known. */
export function handleComplete(sessionId: string, storedKey: string | null, payload: any, frameId?: string | number | string[]) {
  ensure();
  if (payload?.status === "error" || payload?.gate || payload?.approval) return;
  const main = typeof payload?.text === "string" ? payload.text : "";
  if (GREET_RE.test((main || "").trim())) return;
  // replay dedupe: the gateway replays message.complete after reconnects
  const fid = frameId != null ? String(Array.isArray(frameId) ? frameId.join(",") : frameId) : null;
  if (fid) {
    if (seenCompletes[fid]) return;
    seenCompletes[fid] = true;
    // bounded: keep the last 200 seen frames
    const keys = Object.keys(seenCompletes);
    if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete seenCompletes[k];
  }
  const key = storedKey || sidmap[sessionId] || sessionId;
  // Read if focused HERE and visible, OR focused on ANY other surface (the
  // phone, another tab) — owner mandate: focused anywhere ⇒ read everywhere.
  const focusedHere = key === currentStoredSid && typeof document !== "undefined" && document.visibilityState === "visible";
  if (focusedHere || remoteFocus.has(key)) {
    // watching THIS chat: mark it read server-side right away (watermark stays
    // honest). Deliberately does NOT touch the overlay here — clearing a stale
    // pill is clearChat's/clearLocalPill's job, and doing it here broke the
    // "no INCREMENT while watching" contract the unread suite pins.
    void markRead(key);
    return;
  }
  bump(key);
}

/** Viewing a chat clears its overlay AND stamps the server watermark. */
export async function clearChat(storedKey: string) {
  ensure();
  let changed = false;
  if (overlay[storedKey]) {
    delete overlay[storedKey];
    save();
    updateTitle();
    changed = true;
  }
  if (typeof window !== "undefined" && changed) {
    window.dispatchEvent(new CustomEvent("astra:unread-changed"));
  }
  await markRead(storedKey);
}

/** Another device read this chat (session.read frame) — clear the pill HERE too. */
export function handleRemoteRead(storedKey: string) {
  clearLocalPill(storedKey);
}

/** Drop the local overlay pill for a chat without touching the server watermark
 *  (used when a remote surface takes focus — that surface owns the stamp). */
export function clearLocalPill(storedKey: string) {
  ensure();
  if (!overlay[storedKey]) return;
  delete overlay[storedKey];
  save();
  updateTitle();
  notifyChanged();
}

/** Focused chat changed: tell the proxy (presence) so other devices know.
 *  Also updates currentStoredSid so handleComplete knows this chat is being
 *  watched and marks it read instead of bumping the unread pill.
 *  Clears any existing overlay pill and stamps the server watermark so the
 *  focused chat never shows unread treatment. */
export function reportFocus(storedKey: string | null) {
  currentStoredSid = storedKey;
  if (storedKey) {
    if (overlay[storedKey]) {
      delete overlay[storedKey];
      save();
      updateTitle();
      notifyChanged();
    }
    void markRead(storedKey);
  }
  const send = () => {
    try {
      const eng = (globalThis as any).__astraWsSend;
      if (typeof eng === "function") eng(JSON.stringify({ method: "client.info", params: { device: "webui", focus: storedKey } }));
    } catch { /* socket may be down; presence self-heals on next focus change */ }
  };
  if (typeof document !== "undefined" && document.visibilityState === "visible") send();
  else if (typeof document !== "undefined") {
    const once = () => { document.removeEventListener("visibilitychange", once); send(); };
    document.addEventListener("visibilitychange", once);
  }
}

export const _focusSender = () => (globalThis as any).__astraWsSend;

async function markRead(storedKey: string) {
  try {
    await fetch(`/api/hx/sessions/${encodeURIComponent(storedKey)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unread: false }),
    });
  } catch { /* offline: watermark retries on next view */ }
}

export function getTotalUnread(): number {
  return computeTotal();
}

/** Server rows carry `unread` (bool) + `last_read_at`; seed the overlay for rows we
 *  have no local count for so devices that never saw the live event still show a pill.
 *  Read rows RECONCILE the overlay away — a read on another device clears ours.
 *  The row list is also the pruning set: overlay entries not in it (and not fresh)
 *  are orphans and get dropped, keeping the tab-title total equal to the pills. */
export function seedFromServer(rows: { id: string; unread?: boolean; last_read_at?: number | null }[], since: number | null | undefined): void {
  ensure();
  let changed = false;
  knownRowKeys = new Set(rows.map((r) => r.id));
  changed = pruneOrphans() || changed;
  for (const r of rows) {
    if (r.unread && overlay[r.id] == null && r.id !== currentStoredSid && !remoteFocus.has(r.id)) {
      // 1 stands for "has unread responses" — countUnreadResponses refines when history loads
      overlay[r.id] = { n: 1, t: Date.now() };
      changed = true;
    } else if (!r.unread && overlay[r.id] != null) {
      // server says read (another device stamped the watermark) — drop our overlay
      delete overlay[r.id];
      changed = true;
    }
  }
  void since;
  if (changed) {
    save();
    updateTitle();
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("astra:unread-changed"));
  }
}

// test hooks
export const _test = { reset: () => { overlay = {}; seenCompletes = {}; save(); }, overlayRef: () => overlay, setNow: (sid: string | null) => { currentStoredSid = sid; }, markReadRef: () => markRead };

/** Notify listeners that the funnels re-read state (overlay changes, watermark, etc). */
export function notifyChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("astra:unread-changed"));
  }
}
