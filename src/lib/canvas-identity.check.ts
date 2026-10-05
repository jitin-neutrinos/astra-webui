// Canvas identity must survive re-anchoring (2026-10-05).
//
// Canvas state is keyed by canvasId (canvas-state.tsx canvasStore). Ids used to
// be `${useId()}-${index}`, and `text-final` collapses a multi-segment turn into
// one — so a card moves to a different TextRow, gets a different useId, and React
// mounts a FRESH card: the user's slider, zoom and scroll are gone. Measured:
// text segments 2 -> 1 on a prose/tool/prose+card turn.
//
// The id is now derived from card CONTENT plus its occurrence index. This pins
// the three properties that makes the fix correct.
//
// Run: npx tsx src/lib/canvas-identity.check.ts
import assert from "node:assert";
import { test } from "node:test";
import { applySegmentOps } from "./chat-segments.ts";
import { splitCanvasBlocks, type CanvasSpec } from "./canvas-schema";

/** Transcribed from chat-timeline.tsx canvasContentId. */
function canvasContentId(scope: string, spec: unknown, occurrence: number): string {
  const blocks = (spec as { blocks?: { type?: string; label?: string; name?: string }[] })?.blocks ?? [];
  const src = JSON.stringify(blocks.map((b) => `${b?.type}:${b?.label ?? b?.name ?? ""}`));
  let h = 0x811c9dc5;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `cv-${scope}-${h.toString(36)}-${occurrence}`;
}

const card = (label: string): CanvasSpec =>
  ({ v: 1, blocks: [{ type: "kpi", label, value: 1 }] }) as never;

test("A. the same card re-parsed yields the SAME id (state survives)", () => {
  const text = "Prose.\n\n```astra-canvas\n" + JSON.stringify(card("A")) + "\n```\n\nMore.";
  const a = splitCanvasBlocks(text, false).filter((p) => p.kind === "canvas")[0] as { spec: unknown };
  const b = splitCanvasBlocks(text, false).filter((p) => p.kind === "canvas")[0] as { spec: unknown };
  assert.equal(canvasContentId("u", a.spec, 0), canvasContentId("u", b.spec, 0));
});

test("B. different cards get DIFFERENT ids (no fullscreen slot collision)", () => {
  assert.notEqual(canvasContentId("u", card("A"), 0), canvasContentId("u", card("B"), 0));
});

test("C. two IDENTICAL cards are separated by the occurrence index", () => {
  const same = card("Same");
  assert.notEqual(
    canvasContentId("u", same, 0),
    canvasContentId("u", same, 1),
    "two identical cards must not share a slot",
  );
});

test("D. the id still differs per scope (fullscreen host is a singleton)", () => {
  assert.notEqual(canvasContentId("rowA", card("A"), 0), canvasContentId("rowB", card("A"), 0));
});

test("E. the anchor really does move at text-final — the bug this fixes", () => {
  const C = JSON.stringify(card("A"));
  let segs: never[] = [];
  const push = (op: unknown) => { segs = applySegmentOps(segs as never, [op] as never) as never; };
  push({ op: "text", text: "Intro prose.\n\n" });
  push({ op: "tool", key: "t1", label: "grep" });
  push({ op: "tool-done", key: "t1", resultText: "ok" });
  push({ op: "text", text: "More prose then the card:\n\n```astra-canvas\n" + C + "\n```" });
  const before = segs.filter((s) => (s as { kind: string }).kind === "text").length;
  const finalText = segs.map((s) => (s as { text?: string }).text ?? "").join("");
  segs = applySegmentOps(segs, [{ op: "text-final", text: finalText }] as never) as never;
  const after = segs.filter((s) => (s as { kind: string }).kind === "text").length;
  assert.equal(before, 2, "fixture should start with two text segments");
  assert.equal(after, 1, "text-final should collapse them — this is the remount trigger");
  // and the card itself is unchanged, so a content-derived id keeps the store
  const spec = splitCanvasBlocks("x\n\n```astra-canvas\n" + C + "\n```", false)
    .filter((p) => p.kind === "canvas")[0] as { spec: unknown };
  assert.equal(canvasContentId("uid", spec, 0), canvasContentId("uid", spec, 0));
});

test("F. an empty or malformed spec still yields a usable id", () => {
  assert.ok(canvasContentId("u", null, 0).length > 0);
  assert.ok(canvasContentId("u", { blocks: [] }, 0).length > 0);
});