import assert from "node:assert";
import { validateBlockInner } from "./canvas-schema";

const b1 = validateBlockInner({ type: "theorem", kind: "lemma", statement: "S" }) as any;
assert.equal(b1.kind, "lemma");

const b2 = validateBlockInner({ type: "algorithm", steps: [{ text: "T", indent: 2, complexity: "O(1)" }] }) as any;
assert.equal(b2.steps[0].indent, 2);

console.log("ok canvas-academic");
