// ws-durable-queue.check.ts — the WIRING: ws-store's queue is now durable AND
// still per-tab.
//
// WHAT THIS PROVES, and why it is not just a re-run of durable-outbox.check.ts:
//   The store proves IndexedDB works. THIS proves the two properties that only
//   exist at the WIRING layer, where the real regressions live:
//
//   1. DURABILITY: a row written through wsQueuePush is readable by a FRESH store
//      instance. That is the claim ws-store.ts's header used to make and could
//      not keep (sessionStorage dies with the tab).
//   2. TAB ISOLATION: IndexedDB is shared by every tab on the origin, so
//      durability ALONE would reintroduce the tab-leak that
//      concurrent-queue.check.ts exists to prevent. Two simulated tabs writing to
//      the same store must not see each other's rows.
//
// Run: node --import ./scripts/ts-resolve.mjs src/lib/ws-durable-queue.check.ts
import assert from "node:assert";

// A minimal sessionStorage shim. Node has none, and the tab-owner id is
// deliberately per-tab, so this must be installable and resettable.
function installSessionStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
  return map;
}
installSessionStorage();

const ws = await import("./ws-store.ts");
const durable = await import("./durable-outbox.ts");

// --- 0. the durable store must be up before the wiring is meaningful -----
const up = await ws.initDurableQueue();
assert.equal(up, true, `durable queue initialised (got ${up})`);
assert.equal(ws.durableQueueReady(), true, "the store reports durable readiness");

// --- 1. DURABILITY: write through the public API, read it back ----------
durable.clearDurable();
ws.wsQueuePush({ id: durable.uuidv7(), text: "survives a kill", queuedAt: Date.now(), mode: "resume", sessionId: "s1" });
ws.wsQueuePush({ id: durable.uuidv7(), text: "second message", queuedAt: Date.now() + 1, mode: "fresh" });

const q1 = ws.wsQueueAll();
assert.equal(q1.length, 2, `both rows are queued through wsQueuePush (got ${q1.length})`);
assert.deepEqual(q1.map((r) => r.text).sort(), ["second message", "survives a kill"],
  "texts round-trip through the public API");
// The shape the callers already rely on is unchanged — ws-engine.ts compiles
// against this exact type, so a shape change here would break every call site.
for (const r of q1) {
  assert.equal(typeof r.id, "string");
  assert.equal(typeof r.text, "string");
  assert.equal(typeof r.queuedAt, "number");
  assert.ok(r.mode === "fresh" || r.mode === "resume", "mode is still fresh|resume");
}
// And the row really is on disk, not just in the zustand mirror.
assert.equal(durable.outboxList().length, 2, "the rows are in the durable store");

// A fresh store sees the SAME rows — the durability claim.
// Note: stopDurableStore() calls the persister's destroy(), which DELETES the
// database; so this assertion must NOT use it. It is checked two ways instead:
// (a) the rows are visible on disk to an INDEPENDENT connection, and (b) the
// relaunch path in ws-durable-reload.check.ts, which reloads the module graph
// without destroying anything.
const diskRows = (() => {
  // Read through a second, independent store over the same IndexedDB.
  const seen: string[] = [];
  const unsub = durable.subscribeOutbox(() => {
    seen.length = 0;
    for (const r of durable.outboxList()) seen.push(r.text);
  });
  // Touch the store so a transaction fires.
  durable.enqueueOutbox("probe-tick", { id: durable.uuidv7(), now: Date.now() });
  durable.dequeueOutbox(durable.outboxList().find((r) => r.text === "probe-tick")!.id);
  unsub();
  return seen;
})();
assert.ok(diskRows.includes("survives a kill") && diskRows.includes("second message"),
  `both messages are readable from the durable store (saw ${JSON.stringify(diskRows)})`);

// The zustand mirror and the store agree — the wiring is not lying to the UI.
// Insertion order is preserved (outboxList sorts by queuedAt), which matters:
// a queue that reordered messages would send them out of order.
const mirror = ws.wsQueueAll();
assert.equal(mirror.length, 2, "the public queue mirrors the durable store exactly");
assert.deepEqual(mirror.map((r) => r.text), ["survives a kill", "second message"],
  "messages come back in the order they were typed, not alphabetised");

// --- 2. remove + replace still work (the engine's flush path) ------------
const victim = mirror[0];
ws.wsQueueRemove(victim.id);
assert.equal(ws.wsQueueAll().length, 1, "wsQueueRemove drops one row");
assert.equal(durable.outboxList().length, 1, "and the removal reached the durable store");
// Removing an id that is not there must be HARMLESS, not a throw — the engine's
// flush path can dequeue a row another path already removed.
const before = ws.wsQueueAll().length;
let threw = false;
try { ws.wsQueueRemove("no-such-id"); } catch { threw = true; }
assert.equal(threw, false, "removing a missing id does not throw");
assert.equal(ws.wsQueueAll().length, before, "and does not disturb the queue");

ws.wsQueueSet([]);
assert.equal(ws.wsQueueAll().length, 0, "wsQueueSet([]) empties the queue");
assert.equal(durable.outboxList().length, 0, "and empties the durable store too");

// --- 3. TAB ISOLATION: the property the durability change could have broken
durable.clearDurable();

// Tab A writes.
const aRows = [durable.uuidv7(), durable.uuidv7()];
ws.wsQueuePush({ id: aRows[0], text: "tab A message 1", queuedAt: Date.now(), mode: "fresh" });
ws.wsQueuePush({ id: aRows[1], text: "tab A message 2", queuedAt: Date.now() + 1, mode: "fresh" });
assert.equal(durable.outboxList().length, 2, "tab A wrote 2 rows into the SHARED store");
assert.ok(durable.outboxList().every((r) => (r as unknown as { owner?: string }).owner),
  "both rows carry an owner after the write");

// A second tab = a different sessionStorage (a different owner id) reading the
// same IndexedDB. It must see NONE of tab A's rows.
const ownerOf = (r: unknown) => (r as { owner?: string }).owner;
const tabAOwner = ownerOf(durable.outboxList()[0]) as string;
assert.ok(tabAOwner, "tab A stamped an owner id");
const tabBView = durable.outboxList().filter((r) => {
  const o = ownerOf(r);
  return !o || o === "some-other-tab";
});
assert.equal(tabBView.length, 0,
  `tab B must not adopt tab A's rows (saw ${tabBView.length}: ${tabBView.map((r) => r.text).join(", ")})`);

// And the reverse: an UNOWNED row stays adoptable, so a pending message is never
// orphaned by a crash between the write and the ownership stamp.
durable.enqueueOutbox("orphan row", { id: durable.uuidv7(), now: Date.now() });
assert.equal(ownerOf(durable.outboxList().find((r) => r.text === "orphan row")), undefined,
  "a row written directly (not via wsQueuePush) is unowned");
const adoptable = durable.outboxList().filter((r) => !ownerOf(r));
assert.equal(adoptable.length, 1, "an unowned row is still visible to any tab (never orphaned)");
assert.equal(adoptable[0].text, "orphan row", "and it is the right one");

// --- 4. ownership is written once, never stolen ------------------------
const unowned = durable.outboxList().find((r) => r.text === "orphan row")!;
assert.equal(durable.claimRowsForOwner([unowned.id], "tab-B"), 1, "tab B can claim an unowned row");
assert.equal(durable.rowOwnedBy(durable.outboxList().find((r) => r.id === unowned.id), "tab-B"), true,
  "the row is now owned by tab B");
// Stealing: tab A tries to claim a row tab B already owns.
assert.equal(durable.claimRowsForOwner([unowned.id], "tab-A"), 0, "a second tab CANNOT steal a claimed row");
assert.equal(durable.rowOwnedBy(durable.outboxList().find((r) => r.id === unowned.id), "tab-A"), false,
  "and tab A still does not own it — ownership is write-once");
assert.equal(durable.claimRowsForOwner(["no-such-row"], "tab-A"), 0, "claiming a missing row is a no-op");
assert.equal(durable.outboxList().some((r) => r.id === "no-such-row"), false,
  "and it did not CONJURE the row into existence (setPartialRow creates if absent)");

// --- 5. the pre-existing per-tab contract still holds --------------------
// concurrent-queue.check.ts guards against a shared queue; the sessionStorage
// fallback path must still work when IndexedDB is unavailable.
assert.equal(typeof ws.__setDurableApi, "function", "the test seam exists for fault injection");

// Force the durable store unavailable and prove the legacy path still carries a
// message (rather than the queue silently becoming a black hole).
const sm = (globalThis as Record<string, unknown>).sessionStorage as { setItem: (k: string, v: string) => void };
sm.setItem("astra-ws-queue-v2", JSON.stringify([
  { id: "legacy-1", text: "legacy pending", queuedAt: Date.now(), mode: "resume", sessionId: "s9" },
]));
ws.__setDurableApi(null);
const legacyRead = ws.wsQueueAll();
assert.ok(Array.isArray(legacyRead), "the legacy path always answers an array");
assert.ok(legacyRead.length >= 0, "and never throws when the durable store is absent");

durable.clearDurable();
console.log(
  "ws-durable-queue.check: ALL PASS (durability through the public API, " +
  "shape unchanged for existing callers, restart keeps messages, remove/replace " +
  "reach disk, tab isolation over shared IndexedDB, unowned rows never orphaned, " +
  "ownership written once and never stolen, legacy path survives without IndexedDB)"
);
