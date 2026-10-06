import assert from "node:assert";
import { validateBlockInner } from "./canvas-schema";
import { layoutSequence } from "./sequence-layout";

const b = validateBlockInner({ type: "sequence", actors: [{ id: "a", label: "A" }, { id: "b", label: "B" }], messages: [{ from: "a", to: "b", label: "ping" }, { from: "c", to: "a" }] }) as any;
assert.equal(b.messages.length, 2);

const l = layoutSequence(b.actors, b.messages);
assert.equal(l.messages.length, 1, "dangling from c is dropped");
console.log("ok sequence");
