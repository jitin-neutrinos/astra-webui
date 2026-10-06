import assert from "node:assert";
import { validateBlockInner } from "./canvas-schema";

const b = validateBlockInner({ type: "clause", items: [{ ref: "12.3", text: "T" }] }) as any;
assert.equal(b.items[0].ref, "12.3");
console.log("ok clause");
