import assert from "node:assert";
import { validateBlockInner } from "./canvas-schema";

const b = validateBlockInner({ type: "scorecard", method: "sus", items: [{ criterion: "A", score: 5 }] }) as any;
assert.equal(b.items[0].score, 5);
console.log("ok scorecard");
