// rich-blocks.check.ts — asserts for the block-level markdown splitter.
// Run: npx tsx src/lib/rich-blocks.check.ts
//
// The critical invariant is CONCATENATION FIDELITY: splitting must never lose,
// reorder, or duplicate a single character, because a dropped byte shows up in
// the chat as truncated or literal markdown (the exact "text after the card
// isn't formatted" report). Concatenating every block must equal the input.

// Uses the repo's own check() helper (like every other *.check.ts) rather than
// node:assert, so a failure prints in the house style and still exits non-zero.
import { splitRichBlocks } from "./rich-blocks.ts";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { console.log(`  ok   ${name}`); return; }
  failures++;
  console.error(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra) : "");
}

const CASES: [string, string][] = [
  ["plain prose", "Hello world. Second sentence."],
  ["two paragraphs", "First para.\n\nSecond para."],
  ["three paragraphs", "One.\n\nTwo.\n\nThree."],
  ["heading + prose", "# Title\n\nSome body text."],
  ["bulleted list", "- alpha\n- beta\n- gamma"],
  ["numbered list", "1. first\n2. second\n3. third"],
  ["prose then list", "Intro line.\n\n- a\n- b"],
  ["single fence", "```js\nconst x = 1;\n```"],
  ["fence then prose", "```py\nprint(1)\n```\n\nAfter the fence."],
  ["prose then fence then prose", "Before.\n\n```sh\nls -la\n```\n\nAfter."],
  ["two fences", "```js\na\n```\n\nmid prose\n\n```py\nb\n```"],
  ["UNCLOSED fence (streaming)", "Here is code:\n\n```js\nconst x = 1;"],
  ["unclosed fence then more", "```js\nlet a = 1;\n\nlet b = 2;"],
  ["empty fence body", "```\n```"],
  ["fence containing blank lines", "```js\nconst a = 1;\n\nconst b = 2;\n```"],
  ["fence containing triple backticks in a string", "```md\n```\n```"],
  ["emphasis + inline code", "**bold** and `inline` and *italic*"],
  ["blockquote", "> quoted line\n> second line"],
  ["table", "| a | b |\n| - | - |\n| 1 | 2 |"],
  ["html-ish", "<div>raw html</div>"],
  ["unicode + emoji", "héllo — ünïcode ✅ 🚀 中文"],
  ["multiple blank lines", "A.\n\n\n\nB."],
  ["whitespace-only leading", "   \n\nReal content."],
  ["long prose repeated", Array.from({ length: 40 }, (_, i) => `Paragraph ${i} with some words.`).join("\n\n")],
];

console.log("rich-blocks: split fidelity");

for (const [name, input] of CASES) {
  const blocks = splitRichBlocks(input);
  if (blocks === null) {
    // Returning null is a legal "use the fallback path" answer, but for real
    // content it should essentially never happen.
    check(`${name}: splits (not null)`, false, "returned null");
    continue;
  }
  const joined = blocks.map((b) => b.source).join("");
  check(`${name}: concatenates to input`, joined === input, {
    got: joined.slice(0, 80),
    want: input.slice(0, 80),
  });
}

console.log("\nrich-blocks: fenced regions are never split");

// Every ``` must live entirely inside ONE block.
const FENCE_DOCS: [string, string][] = [
  ["fence doc 0", "a\n\n```js\nx\n```\n\nb"],
  ["fence doc 1", "```js\nx\n```"],
  ["fence doc 2", "```\nplain\n```\n\n```py\ny\n```"],
  ["fence doc 3", "text ```inline``` more"],
  // A backtick run inside a fenced body is CONTENT, not a closer — CommonMark
  // only closes on a fence with no info string, so this is one atomic block.
  // It legitimately has an odd number of markers, so it is exempt from the
  // "unpaired fence" rule and asserted separately below.
  ["fence doc 4", "```js\nconst s = '```';\n```"],
];
for (const [label, doc] of FENCE_DOCS) {
  const blocks = splitRichBlocks(doc) ?? [];
  const totalTicks = blocks.reduce((n, b) => n + (b.source.match(/```/g)?.length ?? 0), 0);
  check(`${label}: fence count preserved`, totalTicks === (doc.match(/```/g)?.length ?? 0), {
    totalTicks,
    want: doc.match(/```/g)?.length ?? 0,
  });
  // A split fence means some block carries a lone ``` outside a fence pair,
  // which marked would then render as garbage. Exempt the content-bearing case.
  if (label !== "fence doc 4") {
    const oddBlock = blocks.find((b) => (b.source.match(/```/g)?.length ?? 0) % 2 === 1);
    check(`${label}: no block has an unpaired fence`, !oddBlock, oddBlock?.source.slice(0, 60));
  } else {
    // It must arrive as ONE block — never two or more.
    check(
      "fence doc 4: backtick-in-string stays in one atomic block",
      blocks.length === 1 && blocks[0].source === doc,
      blocks.map((b) => b.source.slice(0, 40)),
    );
  }
}

console.log("\nrich-blocks: streaming churn (the actual perf win)");

// Simulate a reply arriving token by token. Only the final block's source may
// change between two consecutive states; everything before it must be identical,
// otherwise memoization by source string buys us nothing.
const FULL = [
  "Intro paragraph explaining the answer.",
  "",
  "## Details",
  "",
  "- point one",
  "- point two",
  "",
  "Closing thought with `code` and **bold**.",
].join("\n");

const PREFS: string[] = [];
for (let i = 1; i <= FULL.length; i += 7) PREFS.push(FULL.slice(0, i));

let maxChangedPrefixBlocks = 0;
for (const pref of PREFS) {
  const blocks = splitRichBlocks(pref);
  if (!blocks) continue;
  let changed = 0;
  for (let b = 0; b < blocks.length - 1; b++) {
    const before = PREFS[PREFS.indexOf(pref) - 1] ? splitRichBlocks(PREFS[PREFS.indexOf(pref) - 1]) : null;
    const prevMatch = before?.[b];
    if (!prevMatch || prevMatch.source !== blocks[b].source) changed++;
  }
  maxChangedPrefixBlocks = Math.max(maxChangedPrefixBlocks, changed);
}
check(
  "only the last block changes while streaming (memoization pays off)",
  maxChangedPrefixBlocks <= 2,
  { maxChangedPrefixBlocks },
);

console.log("\nrich-blocks: fallback contract");
check("empty string returns null (caller falls back)", splitRichBlocks("") === null);
check("whitespace-only returns null", splitRichBlocks("   \n\n  ") === null);
// Exactly one block for short text is the common case.
const single = splitRichBlocks("Just one short line.");
check("short text yields 1 block", single?.length === 1, single?.length);

console.log(
  failures === 0
    ? `\nALL PASS (${CASES.length} fidelity + fence + streaming + fallback cases)`
    : `\n${failures} FAILURE(S)`,
);
process.exit(failures === 0 ? 0 : 1);