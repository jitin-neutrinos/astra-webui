import assert from "node:assert";
import { validateBlockInner } from "./canvas-schema";
import { sanitizeBlock } from "./canvas-sanitize";

// tree 1200 cap
const bigTree = {
  type: "tree",
  nodes: Array.from({ length: 1300 }, (_, i) => ({ id: `n${i}`, label: `n${i}` }))
};
const bt = validateBlockInner(bigTree) as any;
assert.equal(bt.nodes.length, 1200);
assert.equal(bt.pruned, true);

// references.cite
const ref = {
  type: "references",
  items: [{ title: "x", href: "x", cite: { style: "scc" } }]
};
const rb = validateBlockInner(ref) as any;
assert.equal(rb.items[0].cite.style, "scc");

const sr = sanitizeBlock(rb) as any;
assert.equal(sr.items[0].cite.style, "scc");

console.log("ok canvas-enrich-structural");
