// Guard: the canvas parser must keep rendering the shapes the model ACTUALLY
// emits. This is a replay of real fences from the Hermes DB — the failure mode
// it protects against is silent, so pin it in the repo rather than in scratch.
//
// Regenerate the corpus with:
//   python3 ~/.hermes/cache/scratch/canvas/extract_corpus.py
//
// The corpus is deliberately NOT committed (it is session transcript data). When
// it is absent this file SKIPS rather than fails, so a clean clone stays green;
// on the owner's machine it runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { splitCanvasBlocks, planTurnCanvases, hasCanvas } from "./canvas-schema.ts";

const CORPUS = "/home/notjitin/.hermes/cache/scratch/canvas/corpus.json";

test("real historical fences render as canvas cards", { skip: existsSync(CORPUS) ? false : "no corpus on this machine" }, () => {
  const corpus: { id: number; text: string }[] = JSON.parse(readFileSync(CORPUS, "utf8"));
  const openers = (t: string) => (t.match(/```astra-canvas/g) || []).length;
  const cards = (t: string) => Math.max(
    splitCanvasBlocks(t, false).filter((p) => p.kind === "canvas").length,
    planTurnCanvases([t], false).canvases.length,
  );

  let total = 0, rendered = 0;
  const missed: string[] = [];
  for (const row of corpus) {
    const n = openers(row.text);
    if (!n) continue;
    total += n;
    const got = cards(row.text);
    rendered += got;
    if (got < n) {
      // Legitimate: prose that merely NAMES the fence. Anything else is a miss.
      const prose = /`{3,4}\s*astra-canvas\s*`{3,4}|astra-canvas fence/.test(row.text);
      missed.push(`msg ${row.id}: ${got}/${n}${prose ? " (prose mention — ok)" : "  <-- REGRESSION"}`);
    }
  }
  assert.ok(total > 0, "corpus has fences to check");
  const regressions = missed.filter((m) => m.includes("REGRESSION"));
  assert.deepEqual(regressions, [], "fences that should render but do not:\n" + regressions.join("\n"));
  // Historical floor was 6/30; the coercion work lifted it to 27/30.
  assert.ok(rendered / total >= 0.85, `only ${rendered}/${total} fences render (floor is 85%)`);
});

test("the lazy mount gate never disagrees with the renderer", { skip: existsSync(CORPUS) ? false : "no corpus on this machine" }, () => {
  const corpus: { id: number; text: string }[] = JSON.parse(readFileSync(CORPUS, "utf8"));
  for (const row of corpus) {
    const rendered = splitCanvasBlocks(row.text, false).some((p) => p.kind === "canvas");
    assert.equal(hasCanvas(row.text), rendered, `mount gate disagrees on msg ${row.id}`);
  }
});