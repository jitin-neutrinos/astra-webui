import assert from 'node:assert';
import { readFileSync } from 'node:fs';

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

import * as notify from "./notify.ts";

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

// 13) REMOTE FOCUS (2026-10-02 owner bug): a message completing in a chat that
// is focused on ANOTHER surface (the phone, another tab) must NOT bump a pill
// here — "focused anywhere ⇒ read everywhere". Previously the only read test
// was "focused on THIS device", so a chat open on the phone still showed unread.
notify._test.reset();
notify.applyPresence({ devices: [{ device: "android", focus: "phone-chat" }] });
assert.equal(notify.isRemotelyFocused("phone-chat"), true, "remote focus registered");
notify.handleComplete("live-1", "phone-chat", { text: "answer on the phone" });
// local pill must not exist (serverUnread is a separate input — assert the
// LOCAL overlay, which is what remote focus is responsible for suppressing)
assert.equal(notify.getUnreadCount("phone-chat"), 0, "remotely-focused chat gets no local pill");
assert.equal(notify.getTotalUnread(), 0, "no pill, no tab-title bump");

// a chat focused NOWHERE still counts normally
notify.handleComplete("live-2", "some-other-chat", { text: "unseen answer" });
assert.equal(notify.getTotalUnread(), 1, "unfocused chat still goes unread");

// taking focus elsewhere clears a pill we were already showing
notify._test.reset();
notify.handleComplete("live-3", "later-focus", { text: "answer" });
assert.equal(notify.getTotalUnread(), 1, "pill before remote focus arrives");
const gained = notify.applyPresence({ devices: [{ device: "ios", focus: "later-focus" }] });
notify.clearLocalPill(gained[0]);
assert.equal(notify.getTotalUnread(), 0, "pill cleared when another surface takes focus");

// seedFromServer must not re-pill a remotely-focused chat either
notify._test.reset();
notify.applyPresence({ devices: [{ device: "android", focus: "seeded" }] });
notify.seedFromServer([{ id: "seeded", unread: true }], null);
assert.equal(notify.getTotalUnread(), 0, "list refresh does not re-pill a remotely-focused chat");

// 14) MULTI-TAB / MULTI-DEVICE focus (owner bug: a chat open on the phone went
// unread on the web). presenceSnapshot used to collapse every socket sharing a
// device name into ONE `focus` (last writer wins), so a second tab erased the
// first tab's focus. The snapshot now carries a focus SET per device.
notify._test.reset();
notify.applyPresence({ devices: [
  { device: "webui-a", focus: null, focuses: ["tab-one-chat", "tab-two-chat"] },
  { device: "android-x", focus: null, focuses: ["phone-chat"] },
] });
assert.equal(notify.isRemotelyFocused("tab-one-chat"), true, "tab one focus kept");
assert.equal(notify.isRemotelyFocused("tab-two-chat"), true, "tab two focus NOT erased by its sibling");
assert.equal(notify.isRemotelyFocused("phone-chat"), true, "phone focus kept");

// a single-device focus update must move ONLY that device's focus, leaving
// every other device's chats focused
notify.applyPresence({ device: "webui-a", focus: "tab-three-chat" });
assert.equal(notify.isRemotelyFocused("tab-one-chat"), false, "tab one's stale focus dropped");
assert.equal(notify.isRemotelyFocused("tab-two-chat"), false, "tab two released");
assert.equal(notify.isRemotelyFocused("tab-three-chat"), true, "tab three focused");
assert.equal(notify.isRemotelyFocused("phone-chat"), true, "phone focus survives another device's move");

// 15) WORK/CHATS BADGE PARITY (owner 10-05): both badges read the ONE aggregate
// (getTotalUnread). The badge components render from useUnreadTotal in App.tsx —
// asserted structurally so a second counter can never reappear on Work.
{
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const workIdx = app.indexOf('group.label === "Work" && unreadTotal');
  assert.notEqual(workIdx, -1, "Work badge renders from unreadTotal (the SAME source as Chats)");
  const workBadge = app.slice(workIdx, workIdx + 400);
  assert.doesNotMatch(workBadge, /sessionTotal/, "Work badge must not carry a second counter");
}

// 16) PROXY-STAMPED STORED ID WINS (owner bug: bumps keyed off the ephemeral
// live sid sat invisible in the row list until orphan pruned). The ws-engine
// funnel must prefer payload.stored_session_id over the client sidmap.
{
  const engine = readFileSync(new URL("./ws-engine.ts", import.meta.url), "utf8");
  const i = engine.indexOf('type === "message.complete"');
  const funnel = engine.slice(i, i + 600);
  assert.match(funnel, /stored_session_id \|\| notify\.storedKeyFor/,
    "handleComplete keyed from the proxy-stamped stored id FIRST");
}

// 17) FOCUSED CHAT NEVER COUNTS, cross-device: focus on one surface ⇒ a bump
// arriving on ANOTHER surface is a markRead, not a bump (remote focus test at
// 122-145 covers the same-device side; this pins the aggregate stays 0 while
// any device holds focus).
notify._test.reset();
notify.applyPresence({ devices: [{ device: "android-x", focuses: ["cross-chat"] }] });
notify.handleComplete("live-cross", "cross-chat", { text: "done" }, "fid-cross");
assert.equal(notify.getTotalUnread(), 0, "bump while ANY device focuses the chat = read, not unread");

// 18) RACE GUARD (owner 10-06 "unread pills glitching"): a server row snapshot
// saying unread:false must NOT delete a LOCAL bump that happened AFTER that
// watermark was stamped — out-of-order arrival (live bump → stale snapshot on
// the next seed) used to delete-then-re-bump the pill, which read as flicker.
notify._test.reset();
notify.handleComplete("race-chat", "race-chat", { text: "fresh answer" });
assert.equal(notify.getTotalUnread(), 1, "local bump counted");
// the snapshot is STALE: its watermark (read just before the bump) predates it
notify.seedFromServer([{ id: "race-chat", unread: false, last_read_at: (Date.now() - 500) / 1000 }], null);
assert.equal(notify.getTotalUnread(), 1, "stale read-watermark does NOT drop a newer local bump (no flicker)");
// but a genuinely NEWER watermark (someone read it for real after the bump) still drops
notify.seedFromServer([{ id: "race-chat", unread: false, last_read_at: (Date.now() + 2000) / 1000 }], null);
assert.equal(notify.getTotalUnread(), 0, "newer watermark drops the pill as before");

console.log("unread.check.ts passed");
