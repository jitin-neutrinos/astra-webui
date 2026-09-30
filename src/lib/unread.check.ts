import assert from 'node:assert';

// Mock localStorage and document
const mockStore: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => mockStore[k] || null,
  setItem: (k: string, v: string) => { mockStore[k] = v; }
};

let title = "";
(global as any).document = {
  visibilityState: "hidden",
  set title(t: string) { title = t; },
  get title() { return title; }
};

(global as any).window = {
  dispatchEvent: () => {}
};

mockStore["astra_unread_v1"] = JSON.stringify({ "k1": 2 });
mockStore["astra_sidmap_v1"] = JSON.stringify({ "live1": "k1" });

import * as notify from "./notify";

notify.setBaseTitle("My Astra");
assert.equal(title, "(2) My Astra");
assert.equal(notify.getTotalUnread(), 2);
assert.equal(notify.getUnreadCount("k1"), 2);

// Handle complete for mapped session
notify.handleComplete("live1", { text: "hello" });
assert.equal(notify.getUnreadCount("k1"), 3);
assert.equal(title, "(3) My Astra");

// Handle complete for unmapped session
notify.handleComplete("live2", { text: "hello" });
assert.equal(notify.getUnreadCount("live2"), 1);
assert.equal(title, "(4) My Astra");

// Map session dynamically
notify.mapSession("live3", "k3");
notify.handleComplete("live3", { text: "hi" });
assert.equal(notify.getUnreadCount("k3"), 1);

// Active session skip
notify.setActiveSession("live4");
(global as any).document.visibilityState = "visible";
notify.handleComplete("live4", { text: "hi" });
assert.equal(notify.getUnreadCount("live4"), 0);
assert.equal(title, "(5) My Astra"); // unchanged

// Active session, but hidden
(global as any).document.visibilityState = "hidden";
notify.handleComplete("live4", { text: "hi" });
assert.equal(notify.getUnreadCount("live4"), 1);
assert.equal(title, "(6) My Astra"); // increased

// Error skip
notify.handleComplete("live4", { status: "error" });
assert.equal(notify.getUnreadCount("live4"), 1);

// Gate skip
notify.handleComplete("live4", { gate: "xyz" });
assert.equal(notify.getUnreadCount("live4"), 1);

// Clear chat
notify.clearChat("k1");
assert.equal(notify.getUnreadCount("k1"), 0);
assert.equal(title, "(3) My Astra"); // live2(1) + k3(1) + live4(1)

console.log("unread.check.ts passed");
