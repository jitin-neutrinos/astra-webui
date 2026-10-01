import assert from 'node:assert';

// Mock localStorage / document / window / fetch
const mockStore: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => mockStore[k] || null,
  setItem: (k: string, v: string) => { mockStore[k] = v; }
};
let title = "";
let visibility = "hidden";
(global as any).document = {
  get visibilityState() { return visibility; },
  set title(t: string) { title = t; },
  get title() { return title; }
};
(global as any).window = { dispatchEvent: () => {} };
const markedRead: string[] = [];
(global as any).fetch = async (url: any, init?: any) => {
  if (init?.method === "PATCH" && String(url).includes("/api/hx/sessions/")) {
    markedRead.push(String(url));
    return { ok: true };
  }
  return { ok: true };
};

import * as notify from "./notify";

notify._test.reset();
notify.setBaseTitle("My Astra");
assert.equal(title, "My Astra"); // no unread yet

// 1) mapped session: complete bumps the STORED key
notify.mapSession("live1", "k1");
notify.handleComplete("live1", null, { text: "hello" });
assert.equal(notify.getUnreadCount("k1"), 1, "mapped bump");
assert.equal(title, "(1) My Astra", "title counts overlay");

// 2) unmapped session: falls back to live id
notify.handleComplete("live2", null, { text: "hello" });
assert.equal(notify.getUnreadCount("live2"), 1, "unmapped bump");

// 3) response-only: tool calls / thinking / errors / gates never count
notify.handleComplete("live9", null, { status: "error" });
notify.handleComplete("live9", null, { gate: "x" });
notify.handleComplete("live9", null, { approval: "y" });
assert.equal(notify.getUnreadCount("live9"), 0, "non-responses skipped");

// 4) auto-greet never counts
notify.handleComplete("live10", null, { text: "New chat just started. Greet me briefly and naturally, then ask what I'd like to work on." });
assert.equal(notify.getUnreadCount("live10"), 0, "greet skipped");

// 5) watching the CURRENT chat (visible) → no bump, watermark stamped instead
notify.setActiveSession("k1");
visibility = "visible";
notify.handleComplete("live1", "k1", { text: "hi" });
assert.equal(notify.getUnreadCount("k1"), 1, "no bump while watching");
assert.ok(markedRead.some(u => u.endsWith("/k1")), "server watermark stamped");

// 6) another tab's session bumps even if THIS tab has it "current" but hidden
visibility = "hidden";
notify.handleComplete("live1", "k1", { text: "hi again" });
assert.equal(notify.getUnreadCount("k1"), 2, "hidden → bump");

// 7) replay dedupe: same frame id counted once
notify.setActiveSession(null);
notify.handleComplete("live11", null, { text: "a" }, "frame-7");
notify.handleComplete("live11", null, { text: "a" }, "frame-7");
assert.equal(notify.getUnreadCount("live11"), 1, "replay deduped");

// 8) clearChat wipes overlay AND stamps watermark
notify.clearChat("k1");
assert.equal(notify.getUnreadCount("k1"), 0, "cleared");
assert.ok(markedRead.filter(u => u.endsWith("/k1")).length >= 2, "watermark on clear");

// 9) server seed: rows flagged unread get a pill on a device that never saw the event
notify._test.setNow(null);
notify.seedFromServer([{ id: "srv1", unread: true }, { id: "srv2", unread: false }], null);
assert.equal(notify.getUnreadCount("srv1", 1), 1, "server-unread row shows pill");
assert.equal(notify.getUnreadCount("srv2", 0), 0, "read row stays clean");
// local overlay wins when larger
notify.handleComplete("srv2", null, { text: "new" });
assert.equal(notify.getUnreadCount("srv2", 0), 1, "overlay over server");

// 10) countUnreadResponses: only assistant rows with text after the watermark
const rows = [
  { role: "user", timestamp: 100, content: "q" },
  { role: "assistant", timestamp: 101, content: "answer one" },
  { role: "tool", timestamp: 102, content: "tool out" },
  { role: "assistant", timestamp: 103, content: "" },             // empty: skip
  { role: "assistant", timestamp: 104, content: "New chat just started. Greet me briefly and naturally, then ask what I'd like to work on." }, // greet: skip
  { role: "assistant", timestamp: 105, content: "answer two" },
];
assert.equal(notify.countUnreadResponses(rows as any, 100), 2, "two real responses");
assert.equal(notify.countUnreadResponses(rows as any, null), 0, "no watermark = read");

// 11) TAB-TITLE vs PILLS (2026-10-01 live bug): a stale orphan overlay key (live
// session id that never mapped to a stored row) must NOT inflate the total once
// the chat list is known. Fresh orphans survive (mapping may still land); stale
// ones (t older than TTL) are pruned on the next seed/total.
notify._test.reset();
notify.handleComplete("orphan-live", null, { text: "x" });            // orphan bump
notify.handleComplete("real-row", null, { text: "y" });               // legit bump
notify.seedFromServer([{ id: "real-row", unread: true }], null);      // list lands: orphan NOT in it
// age the orphan past TTL
const ov = notify._test.overlayRef() as Record<string, { n: number; t: number }>;
ov["orphan-live"].t = Date.now() - 11 * 60 * 1000;
notify.seedFromServer([{ id: "real-row", unread: true }], null);      // prune triggers
assert.equal(notify.getTotalUnread(), 1, "stale orphan pruned; total == visible pill count");

// 12) legacy store shape {key:number} still restores (fresh module instance —
// restore is one-shot per module, so import with a cache-busting query)
mockStore["astra_unread_overlay_v1"] = JSON.stringify({ legacy: 3 });
const notify2 = await import(/* @vite-ignore */ "./notify?legacy-shape" as string);
assert.equal(notify2.getTotalUnread(), 3, "legacy overlay migrated");

console.log("unread.check.ts passed");
