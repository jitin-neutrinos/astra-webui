import assert from "node:assert";
import { validateBlockInner } from "./canvas-schema";

const b = validateBlockInner({ type: "compliance", regime: "GDPR", items: [{ ref: "A", provision: "A", obligation: "A", status: "pass" }] }) as any;
assert.equal(b.items[0].status, "pass");
console.log("ok compliance");
