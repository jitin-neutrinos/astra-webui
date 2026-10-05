// Behavioural proof for the three canvas-state fixes, run against the REAL
// module. Run: npx tsx src/lib/canvas-state.behaviour.mts
//
// This is the companion to src/lib/canvas-state-keepalive.check.ts, which
// asserts the same three rules by source shape so it can run under the bare
// `node` check runner (Node cannot load a .tsx — see that file's header).
// Together: this file proves the behaviour is right, the check pins it.
//
// A. key-reorder-only re-parse must NOT reset the user's edits
// B. the LRU must never evict a MOUNTED store, but must still evict dead ones
// C. the store must expose the id that useCanvasReset looks up
import assert from "node:assert";
import { canvasStore } from "../components/canvas/canvas-state.tsx";

// A — a re-parse with the same values in a different key order
{
  const s = canvasStore("beh-order", { seats: 10, price: 5 });
  s.set("seats", 30); // user drags the slider
  canvasStore("beh-order", { price: 5, seats: 10 }); // same values, other order
  assert.equal(s.snapshot().seats, 30, `edit lost on key reorder: ${s.snapshot().seats}`);
  console.log("ok A1 - key reorder preserves the edit (seats =", s.snapshot().seats + ")");
}
{ // …but a GENUINE value change must still reset
  const s = canvasStore("beh-change", { seats: 10 });
  s.set("seats", 99);
  canvasStore("beh-change", { seats: 20 });
  assert.equal(s.snapshot().seats, 20, "a real change must reset the store");
  console.log("ok A2 - a real value change still resets (seats =", s.snapshot().seats + ")");
}

// B — a mounted store survives pressure; a dead one does not
{
  const live = canvasStore("beh-live", { n: 1 });
  live.mounted = 1; // as a mounted CanvasStateProvider would hold it
  live.set("n", 42);
  for (let i = 0; i < 60; i++) canvasStore(`beh-fill-${i}`, { n: i });
  assert.equal(canvasStore("beh-live", { n: 1 }), live, "a MOUNTED store was evicted — the card would freeze");
  assert.equal(live.snapshot().n, 42, "live store lost its value");
  console.log("ok B1 - mounted store survived 60 new stores, n still", live.snapshot().n);
}
{
  const dead = canvasStore("beh-dead", { n: 7 });
  for (let i = 0; i < 60; i++) canvasStore(`beh-dfill-${i}`, { n: i });
  assert.notEqual(canvasStore("beh-dead", { n: 7 }), dead, "unmounted stores must still be evicted");
  console.log("ok B2 - unmounted stores still evicted (the cap is intact)");
}

// C — the store carries the id reset needs
{
  assert.equal(canvasStore("beh-id", { seats: 10 }).id, "beh-id");
  console.log("ok C - store exposes its own id: beh-id");
}

console.log("\nALL 5 BEHAVIOUR ASSERTIONS PASS");