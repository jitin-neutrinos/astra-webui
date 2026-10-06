import assert from "node:assert";
import { validateBlockInner } from "./canvas-schema";

const b = validateBlockInner({ type: "obligations", rows: [{ obligation: "Pay", party: "Tenant" }] }) as any;
assert.equal(b.rows[0].party, "Tenant");
console.log("ok obligations");
