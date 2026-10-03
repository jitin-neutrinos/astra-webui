// rich-blocks.ts — block-level memoized markdown (perf audit R5, 2026-10-03).
//
// THE PROBLEM: RichText rendered markdown with
//     useMemo(() => renderRichHtml(plainText, streaming), [plainText, streaming])
// `plainText` changes on every streamed delta, so marked.parse + DOMPurify.sanitize
// re-ran over the ENTIRE accumulated reply on every token. Cost grows with reply
// length — O(n²) over a long answer, all on the main thread.
//
// THE FIX (Vercel Streamdown / hermes-desktop recipe): lex the text ONCE into
// top-level blocks and memoize each block by its own source string. While
// streaming only the LAST block changes, so only that one re-parses.
//
// IMPLEMENTATION NOTE — why this file is range-based rather than string-splitting:
// blocks are re-concatenated to render the message, so ANY character dropped at a
// boundary surfaces in the chat as a run-on paragraph or literal markdown. The
// first version of this splitter sliced strings and rejoined them, and it lost the
// "\n\n" between a paragraph and the following fence — caught by
// rich-blocks.check.ts's concatenation-fidelity cases, not by eye. So every block
// here is an INDEX RANGE into the original string, and `source` is a plain slice.
// Concatenating all sources then equals the input BY CONSTRUCTION: there is no
// separator to forget.
//
// SAFETY RULES baked in (live chat surface; a rendering regression is worse than
// the perf win):
//   • Fenced code regions are NEVER split — a lone ``` in a block is garbage.
//   • Any surprise → return null, and the caller falls back to the pre-existing
//     single-blob renderRichHtml(), which is byte-identical to prior behavior.
//   • No new dependency: marked is already present (v18, lexer() API).
import { Marked } from "marked";

const md = new Marked({ gfm: true, breaks: true });

export type RichBlock = { source: string; isLast: boolean };

/**
 * Split markdown into top-level blocks. Returns null to signal "use the
 * caller's fallback path".
 */
export function splitRichBlocks(text: string): RichBlock[] | null {
  if (!text || !text.trim()) return null;

  const ranges = text.includes("```") || text.includes("~~~")
    ? splitFenceAware(text)
    : splitWithLexer(text);

  if (!ranges || !ranges.length) return null;

  // INVARIANT: ranges must tile the whole string. If they don't, some character
  // would vanish or duplicate when the blocks are concatenated — which is a
  // rendering regression, not a cosmetic one. Rather than trust the two
  // splitters to agree, verify here and bail to the fallback path if not.
  if (!coversExactly(ranges, text.length)) return null;

  const blocks: RichBlock[] = ranges.map(([start, end]) => ({
    source: text.slice(start, end),
    isLast: false,
  }));
  blocks[blocks.length - 1].isLast = true;
  return blocks;
}

/** No fences: marked's own lexer gives clean top-level blocks and cannot
 *  mis-split an unfenced document. */
function splitWithLexer(text: string): Array<[number, number]> | null {
  try {
    const tokens = md.lexer(text, { async: false });
    if (!Array.isArray(tokens) || !tokens.length) return null;
    const ranges: Array<[number, number]> = [];
    let cursor = 0;
    for (const tok of tokens as Array<{ raw?: string }>) {
      const raw = tok?.raw;
      if (raw === undefined || raw === null) continue;
      const start = text.indexOf(raw, cursor);
      if (start === -1) return null; // lexer disagreed with the source → fallback
      const end = start + raw.length;
      ranges.push([start, end]);
      cursor = end;
    }
    // Only trust ranges that tile the text exactly.
    return coversExactly(ranges, text.length) ? ranges : null;
  } catch {
    return null;
  }
}

/** A fence line: three or more backticks/tildes at the start of a line. */
const FENCE_LINE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/gm;

/** Fence-aware split. Cut only at fence boundaries; each fenced region
 *  (opening fence → closing fence, or → end of text) is ONE atomic block.
 *  Everything between fences is split on blank lines. */
function splitFenceAware(text: string): Array<[number, number]> {
  const fences: Array<{ start: number; end: number; marker: string; info: string }> = [];
  FENCE_LINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE_LINE.exec(text)) !== null) {
    fences.push({
      start: m.index,
      end: m.index + m[0].length,
      marker: m[1],
      info: (m[2] ?? "").trim(),
    });
  }

  const ranges: Array<[number, number]> = [];
  let cursor = 0;
  let i = 0;

  while (i < fences.length) {
    const open = fences[i];

    // A fence with no info string that we haven't opened is a closer, not an
    // opener. This is what makes a bare ``` an unpaired marker in "```md\n```".
    if (open.info === "") {
      i++;
      continue;
    }

    // Find its close: same marker char, at least as long, and no info string.
    let closeAt = -1;
    for (let j = i + 1; j < fences.length; j++) {
      const cand = fences[j];
      if (cand.info === "" && cand.marker[0] === open.marker[0] && cand.marker.length >= open.marker.length) {
        closeAt = j;
        break;
      }
    }

    // Prose before the opening fence.
    for (const r of splitProse(text, cursor, open.start)) ranges.push(r);

    // The fenced region is atomic: opening fence through closing fence (or to
    // the end of the text when the fence is still streaming open).
    const regionEnd = closeAt === -1 ? fences[fences.length - 1].end : fences[closeAt].end;
    ranges.push([open.start, regionEnd]);

    cursor = regionEnd;
    i = closeAt === -1 ? fences.length : closeAt + 1;
  }

  // Trailing prose after the last fence.
  for (const r of splitProse(text, cursor, text.length)) ranges.push(r);

  return ranges;
}

/** Split [from, to) of `text` on blank lines, returning ranges.
 *
 *  Two rules, both learned the hard way (rich-blocks.check.ts caught each):
 *   1. The gap BETWEEN chunks belongs to the chunk that precedes it. A dropped
 *      "\n\n" welds a paragraph to the block after it — invisible here, obvious
 *      in the chat.
 *   2. A chunk is emitted at most once. An earlier version appended the trailing
 *      remainder twice when the slice ended in a blank run, duplicating the
 *      whole first paragraph.
 *
 *  Blank-only chunks are absorbed by extending `start` past them, so the blank
 *  run rides along with real text instead of being dropped. */
function splitProse(text: string, from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (from >= to) return out;
  const slice = text.slice(from, to);
  const blank = /\n[ \t]*\n+/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = blank.exec(slice)) !== null) {
    if (slice.slice(start, m.index).trim()) {
      // Body-bearing chunk: emit it, separator included.
      out.push([from + start, from + m.index + m[0].length]);
    }
    // Blank-only chunk: DON'T emit and DON'T advance `start`. Leaving `start`
    // put means the blank run becomes the PREFIX of the next emitted chunk, so
    // it is preserved and the ranges stay contiguous. Advancing to `cut` here
    // is what dropped the "\n\n" between a closing fence and the prose after it.
    start = slice.slice(start, m.index).trim() ? m.index + m[0].length : start;
  }
  // The remainder, emitted exactly once (content or trailing blanks alike).
  if (start < slice.length) out.push([from + start, to]);
  return out;
}

/** Ranges must tile [0, len) with no gap and no overlap. */
function coversExactly(ranges: Array<[number, number]>, len: number): boolean {
  let at = 0;
  for (const [start, end] of ranges) {
    if (start !== at || end <= start) return false;
    at = end;
  }
  return at === len;
}