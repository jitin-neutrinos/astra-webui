import { test } from "node:test";
import assert from "node:assert/strict";
import { createItem, onTurnComplete, dockVisible } from "./bg-items";
import type { BgItem } from "./bg-items";

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

test("creation status predicate", () => {
  const i1 = createItem("bg", "idle", false);
  assert.equal(i1.status, "running");
  
  const i2 = createItem("bg", "live", true);
  assert.equal(i2.status, "queued");
  
  const i3 = createItem("steer", "idle", false);
  assert.equal(i3.status, "running");
});

test("dockVisible", () => {
  assert.equal(dockVisible([]), false);
  assert.equal(dockVisible([createItem("bg", "test", true)]), true);
});

test("parallel submit simulation", () => {
  // simulate bg then steer
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
