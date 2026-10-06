import assert from "node:assert";
import { validateBlockInner } from "./canvas-schema";
import { sanitizeBlock } from "./canvas-sanitize";
import { canvasToMarkdown } from "./canvas-markdown";

const spec = {
  type: "table",
  columns: ["A", "B"],
  rows: [["a", 1]],
  colTypes: ["text", "color", "contrast", "unknown"],
  colMeta: [null, { levels: ["X"] }],
  footnote: "note",
  sig: { column: "B", thresholds: [0.05, 0.01] },
  units: ["kg"]
};

// 1. parser accepts and drops unknown
const b = validateBlockInner(spec) as any;
assert.deepEqual(b.colTypes, ["text", "color", "contrast", "text"]);

// 2. sanitize
const s = sanitizeBlock(b) as any;
assert.deepEqual(s.colTypes, ["text", "color", "contrast", "text"]);
assert.equal(s.footnote, "note");
assert.deepEqual(s.sig, { column: "B", thresholds: [0.05, 0.01] });

// 3. markdown
const md = canvasToMarkdown({ blocks: [b] } as any);
assert(md.includes("Units: kg"));
assert(md.includes("Significance test column: B"));
assert(md.includes("note"));

console.log("ok canvas-table-cols");
