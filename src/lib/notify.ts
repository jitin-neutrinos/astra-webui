let unread: Record<string, number> = {};
let sidmap: Record<string, string> = {};
let restored = false;
let currentLiveSid: string | null = null;
let baseTitle = "Astra";

let audioCtx: AudioContext | null = null;

function restore() {
  if (restored) return;
  restored = true;
  try {
    const u = localStorage.getItem("astra_unread_v1");
    if (u) unread = JSON.parse(u);
    const s = localStorage.getItem("astra_sidmap_v1");
    if (s) sidmap = JSON.parse(s);
  } catch {
    // ignore
  }
}

function save() {
  if (!restored) return; // safety
  try {
    localStorage.setItem("astra_unread_v1", JSON.stringify(unread));
    localStorage.setItem("astra_sidmap_v1", JSON.stringify(sidmap));
  } catch {
    // ignore
  }
}

function computeTotal(): number {
  restore();
  return Object.values(unread).reduce((a, b) => a + b, 0);
}

function updateTitle() {
  const total = computeTotal();
  if (typeof document !== "undefined") {
    document.title = total > 0 ? `(${total}) ${baseTitle}` : baseTitle;
  }
}

function playChime() {
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
    // note 1: 880Hz for 90ms
    osc.frequency.setValueAtTime(880, t);
    // note 2: 660Hz after 90ms
    osc.frequency.setValueAtTime(660, t + 0.09);
    
    // gain envelope
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

export function setBaseTitle(t: string) {
  baseTitle = t;
  updateTitle();
}

export function setActiveSession(sid: string | null) {
  currentLiveSid = sid;
}

export function mapSession(liveSid: string, storedKey: string) {
  restore();
  if (sidmap[liveSid] !== storedKey) {
    sidmap[liveSid] = storedKey;
    save();
  }
}

export function clearChat(storedKey: string) {
  restore();
  if (unread[storedKey]) {
    delete unread[storedKey];
    save();
    updateTitle();
    // Dispatch event for UI to update immediately
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("astra:unread-changed"));
    }
  }
}

export function handleComplete(sessionId: string, payload: any) {
  restore();
  if (payload?.status === "error" || payload?.gate || payload?.approval) return;
  
  if (sessionId === currentLiveSid && typeof document !== "undefined" && document.visibilityState === "visible") {
    return;
  }
  
  const storedKey = sidmap[sessionId] || sessionId;
  unread[storedKey] = (unread[storedKey] || 0) + 1;
  save();
  updateTitle();
  playChime();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("astra:unread-changed"));
  }
}

export function getUnreadCount(storedKey: string): number {
  restore();
  return unread[storedKey] || 0;
}

export function getTotalUnread(): number {
  restore();
  return computeTotal();
}
