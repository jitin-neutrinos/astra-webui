// L2 — a half-revealed canvas fence must never reach the renderer (2026-10-05).
//
// TextRow reveals text a few characters at a time and passes the revealed
// PREFIX to the markdown renderer. When that cut lands inside an astra-canvas
// fence the renderer gets a fence with no closer; the parser rejects it, the
// fail-soft rule leaves it in the markdown, and marked paints the payload as a
// code block. That is the reported symptom.
//
// Two invariants, swept over EVERY reveal position and several fence shapes:
//   1. the output never contains a partial canvas fence
//   2. prose before the first fence is never lost
//
// Run: npx tsx src/lib/canvas-reveal.check.ts
import assert from "node:assert";
import { test } from "node:test";
import { withholdOpenCanvasFence } from "./canvas-reveal.ts";
import { splitCanvasBlocks } from "./canvas-schema";

const C = JSON.stringify({ v: 1, blocks: [{ type: "kpi", label: "A", value: 1 }] });
const CODE_CARD = JSON.stringify({ v: 1, blocks: [{ type: "code", code: "x\n```\ny", language: "sh" }] });

const shapes: [string, string][] = [
  ["simple 3-tick", "Intro.\n\n```astra-canvas\n" + C + "\n```\n\nTail."],
  ["4-tick wrapper", "Intro.\n\n````astra-canvas\n" + C + "\n````\n\nTail."],
  ["ordinary code fence", "Intro.\n\n```js\nconst x=1;\n```\n\nTail."],
  ["two cards in one message", "A\n\n```astra-canvas\n" + C + "\n```\n\nMid\n\n```astra-canvas\n" + C + "\n```\n\nEnd."],
  ["canvas containing backticks", "A\n\n```astra-canvas\n" + CODE_CARD + "\n```\n\nEnd."],
];

function sweep(full: string) {
  let withheld = 0, leaked = 0, proseLost = 0;
  const preFence = full.split("```")[0].trim();
  for (let n = 0; n <= full.length; n++) {
    const shown = full.slice(0, n);
    const out = withholdOpenCanvasFence(full, shown);
    if (out !== shown) withheld++;
    const md = splitCanvasBlocks(out, true)
      .filter((p) => p.kind === "md")
      .map((p) => (p as { text: string }).text)
      .join("");
    if (md.includes("```astra-canvas")) leaked++;
    if (preFence && n > preFence.length && !out.includes(preFence.slice(0, 12))) proseLost++;
  }
  return { withheld, leaked, proseLost, frames: full.length + 1 };
}

for (const [name, full] of shapes) {
  test(`no partial fence, no prose lost — ${name}`, () => {
    const r = sweep(full);
    assert.equal(r.leaked, 0, `${r.leaked}/${r.frames} frames leaked a partial fence`);
    assert.equal(r.proseLost, 0, `${r.proseLost}/${r.frames} frames lost prose`);
  });
}

test("a fully revealed message is returned untouched", () => {
  const full = "Intro.\n\n```astra-canvas\n" + C + "\n```\n\nTail.";
  assert.equal(withholdOpenCanvasFence(full, full), full);
});

test("a prefix that ends before the fence is untouched", () => {
  const full = "Intro prose.\n\n```astra-canvas\n" + C + "\n```";
  const short = "Intro prose.\n\n```astra-can";
  assert.equal(withholdOpenCanvasFence(full, short), short);
});

test("a CLOSED fence inside the prefix passes through", () => {
  const full = "Intro.\n\n```astra-canvas\n" + C + "\n```\n\nMore text arriving after the card.";
  const prefix = full.slice(0, full.indexOf("More text"));
  assert.equal(withholdOpenCanvasFence(full, prefix), prefix, "a closed fence must not be withheld");
});

test("a ``` inside the JSON body does not count as the closer", () => {
  const full = "A\n\n```astra-canvas\n" + CODE_CARD + "\n```\n\nEnd.";
  // cut right after the inner ``` — the 3-tick fence is still OPEN here
  const cut = full.indexOf("y") + 1;
  const prefix = full.slice(0, cut);
  const out = withholdOpenCanvasFence(full, prefix);
  assert.ok(!out.includes("astra-canvas"), "an inner ``` must not be mistaken for the closer");
});