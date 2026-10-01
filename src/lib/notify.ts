// Unread tracking, WhatsApp model:
// - SERVER watermark (`last_read_at` via PATCH /api/hx/sessions/<id> {unread:false}) is the
//   cross-device source of truth; a chat is read when its OWNER views it on ANY device.
// - LIVE events (message.complete over the WS) bump a local in-memory overlay so the pill
//   appears instantly; the overlay is reconciled away the next time the row is opened.
// - Only assistant RESPONSES count (message.complete), never tool calls / thinking /
//   errors / gate or approval requests.
// - The auto-greet kickoff ("New chat just started…") is a UI convention, not a message:
//   never counted anywhere.
let overlay: Record<string, number> = {};
let seenCompletes: Record<string, true> = {};
let currentStoredSid: string | null = null;
let baseTitle = "Astra";

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
    if (o) overlay = JSON.parse(o);
  } catch { /* ignore */ }
}
let restored = false;
function ensure() { if (!restored) { restored = true; restore(); } }

const GREET_RE = /^New chat just started\. Greet me briefly and naturally, then ask what I'd like to work on\.\s*$/;

function computeTotal(): number {
  ensure();
  return Object.values(overlay).reduce((a, b) => a + b, 0);
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
  overlay[key] = (overlay[key] || 0) + 1;
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
  return Math.max(serverUnread, overlay[storedKey] || 0);
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
  if (key === currentStoredSid && typeof document !== "undefined" && document.visibilityState === "visible") {
    // watching THIS chat: mark it read server-side right away (watermark stays honest)
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
  ensure();
  let changed = false;
  if (overlay[storedKey]) {
    delete overlay[storedKey];
    save();
    updateTitle();
    changed = true;
  }
  if (changed) notifyChanged();
}

/** Focused chat changed: tell the proxy (presence) so other devices know. */
export function reportFocus(storedKey: string | null) {
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
 *  Read rows RECONCILE the overlay away — a read on another device clears ours. */
export function seedFromServer(rows: { id: string; unread?: boolean; last_read_at?: number | null }[], since: number | null | undefined): void {
  ensure();
  let changed = false;
  for (const r of rows) {
    if (r.unread && overlay[r.id] == null && r.id !== currentStoredSid) {
      // 1 stands for "has unread responses" — countUnreadResponses refines when history loads
      overlay[r.id] = 1;
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
