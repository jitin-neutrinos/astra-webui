import assert from "node:assert";
import { validateBlockInner } from "./canvas-schema";
import { numberMathFamily } from "./math-numbering.ts";

const b1 = validateBlockInner({ type: "math", tex: "x=1", number: true }) as any;
const b2 = validateBlockInner({ type: "theorem", kind: "theorem", statement: "x", number: 5 }) as any;
const b3 = validateBlockInner({ type: "math", tex: "x=2", number: true }) as any;
const b4 = validateBlockInner({ type: "algorithm", steps: [], number: 3 }) as any;

const blocks = [b1, b2, b3, b4];
const map = numberMathFamily(blocks);

assert.equal(map.get(b1)?.n, 1);
assert.equal(map.get(b1)?.family, "eq");

assert.equal(map.get(b2)?.n, 5);
assert.equal(map.get(b2)?.family, "thm");

assert.equal(map.get(b3)?.n, 2);
assert.equal(map.get(b3)?.family, "eq");

assert.equal(map.get(b4)?.n, 3);
assert.equal(map.get(b4)?.family, "alg");

console.log("ok ./math-numbering");
