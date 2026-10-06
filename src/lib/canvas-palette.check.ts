import assert from "node:assert";
import { validateBlockInner } from "./canvas-schema";

const b = validateBlockInner({ type: "palette", colors: [{ value: "#000" }] }) as any;
assert.equal(b.colors[0].value, "#000");
console.log("ok palette");
