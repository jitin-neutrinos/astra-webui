import { test } from "node:test";
import assert from "node:assert/strict";
import { createItem, onTurnComplete, dockVisible, dismissItem, loadItems, saveItems, reconcileWithServer } from "./bg-items";
import type { BgItem, Store } from "./bg-items";

test("onTurnComplete transitions", () => {
  let items: BgItem[] = [
    createItem("steer", "s1", true), // status: running
    createItem("bg", "b1", true),    // status: queued
    createItem("bg", "b2", true)     // status: queued
  ];

  items = onTurnComplete(items);
  assert.equal(items[0].status, "done");
  assert.equal(items[1].status, "running");
  assert.equal(items[2].status, "queued");

  items = onTurnComplete(items);
  assert.equal(items[0].status, "done");
  assert.equal(items[1].status, "done");
  assert.equal(items[2].status, "running");
});

test("creation status predicate + unique ids across instances", () => {
  const i1 = createItem("bg", "idle", false);
  assert.equal(i1.status, "running");

  const i2 = createItem("bg", "live", true);
  assert.equal(i2.status, "queued");

  const i3 = createItem("steer", "idle", false);
  assert.equal(i3.status, "running");

  const i4 = createItem("bg", "dup-guard", false, [i1]);
  assert.notEqual(i4.id, i1.id);
});

test("dockVisible: undismissed only", () => {
  assert.equal(dockVisible([]), false);
  assert.equal(dockVisible([createItem("bg", "test", true)]), true);
  const items = [createItem("bg", "a", true), createItem("bg", "b", true)];
  assert.equal(dockVisible(dismissItem(items, items[0].id)), true);
  const allGone = dismissItem(dismissItem(items, items[0].id), items[1].id);
  assert.equal(dockVisible(allGone), false);
});

test("dismiss keeps the item (persist-until-dismissed contract)", () => {
  const items = [createItem("bg", "keep me", true)];
  const next = dismissItem(items, items[0].id);
  assert.equal(next.length, 1);           // still stored
  assert.equal(next[0].dismissed, true);  // hidden from dock
  assert.equal(next[0].text, "keep me");
});

test("persistence round-trip per chat", () => {
  const backing = new Map<string, string>();
  const store: Store = {
    getItem: (k) => backing.get(k) ?? null,
    setItem: (k, v) => void backing.set(k, v),
    removeItem: (k) => void backing.delete(k),
  };
  const items = [createItem("bg", "chat A item", true)];
  saveItems("sessA", items, store);
  saveItems("sessB", [createItem("bg", "chat B item", true)], store);
  assert.equal(loadItems("sessA", store)[0].text, "chat A item");
  assert.equal(loadItems("sessB", store)[0].text, "chat B item");
  assert.deepEqual(loadItems("sessC", store), []);
  // dismiss survives the round trip
  saveItems("sessA", dismissItem(items, items[0].id), store);
  assert.equal(loadItems("sessA", store)[0].dismissed, true);
  // clearing chat removes the key
  saveItems("sessA", [], store);
  assert.equal(backing.has("bg_items_sessA"), false);
});

test("replyMsgId is preserved through status transitions", () => {
  const items = [createItem("bg", "with reply", true)];
  items[0].replyMsgId = "msg-42";
  const next = onTurnComplete(items);
  assert.equal(next[0].replyMsgId, "msg-42");
  assert.equal(next[0].status, "running");
});

test("parallel submit simulation", () => {
  const items = [
    createItem("bg", "bg task", true),
    createItem("steer", "steer task", true)
  ];
  assert.equal(items[0].status, "queued");
  assert.equal(items[1].status, "running");

  const nextItems = onTurnComplete(items);
  assert.equal(nextItems[0].status, "running");
  assert.equal(nextItems[1].status, "done");
});

test("reconcile settles all live items when server idle", () => {
  const items = [
    { ...createItem("bg", "raced", true), status: "running" as const },
    { ...createItem("bg", "still queued", true), status: "queued" as const },
  ];
  const next = reconcileWithServer(items, { queued: null, running: false });
  assert.equal(next.every((it) => it.status === "done"), true);
});
