import assert from "node:assert";
import { validateBlockInner } from "./canvas-schema";

const b = validateBlockInner({ type: "schema", tables: [{ name: "users", columns: [{ name: "id", type: "uuid", key: "PK" }] }] }) as any;
assert.equal(b.tables[0].columns[0].key, "PK");
console.log("ok schema");
