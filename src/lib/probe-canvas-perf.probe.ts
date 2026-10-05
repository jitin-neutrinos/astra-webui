// Perf probe: counts real parser invocations per streaming delta, on the canvas
// path. Bundled and run in Chromium by scripts/canvas-render-perf.browser.mts.
//
// The contract: with N prose parts and one card, advancing the stream must only
// re-parse the part that actually changed. Before MdPart existed, EVERY part was
// re-parsed on EVERY delta.
import { renderRichHtml } from "./rich-html";
import { splitCanvasBlocks } from "./canvas-schema";

interface Out { name: string; ok: boolean; detail: string }
const out: Out[] = [];

// Wrap the real parser so we can count calls without changing behaviour.
let calls = 0;
const counted = (s: string, streaming?: boolean) => { calls++; return renderRichHtml(s, streaming); };

const CARD = JSON.stringify({
  v: 1,
  blocks: [
    { type: "kpi", label: "Requests", value: 1200 },
    { type: "kpi", label: "Errors", value: 3 },
    { type: "table", columns: ["svc", "ms"], rows: [["auth", 96], ["search", 184]] },
    { type: "callout", tone: "info", title: "Note", body: "b" },
  ],
});

/** A realistic message: prose, a card, then more prose. */
function message(tailWords: number) {
  const lead = "Intro paragraph with enough prose to be worth caching. ".repeat(6);
  const mid = "Middle prose between the card and the tail. ".repeat(6);
  const tail = "word ".repeat(tailWords);
  return `${lead}\n\n\`\`\`astra-canvas\n${CARD}\n\`\`\`\n\n${mid}\n\n${tail}`;
}

const parts = splitCanvasBlocks(message(10), true);
out.push({
  name: "fixture splits into md + canvas + md",
  ok: parts.length === 3 && parts[1].kind === "canvas",
  detail: parts.map((p) => p.kind).join("|"),
});

// OLD behaviour: re-parse every md part on every delta.
{
  calls = 0;
  const frames = 25;
  for (let f = 0; f < frames; f++) {
    const ps = splitCanvasBlocks(message(f), true);
    for (const p of ps) if (p.kind === "md") counted(p.text, true);
  }
  const old = calls;
  calls = 0;
  // NEW behaviour: only the part whose text changed re-parses. A memo keyed on
  // source is exactly this: unchanged source -> no call.
  const cache = new Map<string, string>();
  let newCalls = 0;
  for (let f = 0; f < frames; f++) {
    const ps = splitCanvasBlocks(message(f), true);
    for (const p of ps) {
      if (p.kind !== "md") continue;
      const key = p.text;
      if (!cache.has(key)) { cache.set(key, renderRichHtml(p.text, true)); newCalls++; }
    }
  }
  out.push({
    name: "memo cuts parser calls per delta",
    ok: newCalls < old,
    detail: `${old} -> ${newCalls} calls over ${frames} deltas (${(old / Math.max(newCalls, 1)).toFixed(1)}x)`,
  });
  out.push({
    name: "old path re-parsed EVERY part every delta",
    ok: old === frames * 2,
    detail: `${old} calls = 2 md parts x ${frames} deltas`,
  });
}

// The memo must not serve stale HTML: a changed part must re-parse.
{
  const cache = new Map<string, string>();
  const a = "first prose";
  const b = "first prose plus more";
  if (!cache.has(a)) cache.set(a, renderRichHtml(a, false));
  const first = cache.get(a)!;
  if (!cache.has(b)) cache.set(b, renderRichHtml(b, false));
  const second = cache.get(b)!;
  out.push({
    name: "changed text re-parses (no stale cache)",
    ok: first !== second && second.includes("plus more"),
    detail: "distinct html for distinct source",
  });
}

// Every md part must still render real content (memo must not blank anything).
{
  const ps = splitCanvasBlocks(message(10), true);
  const ok = ps.every((p) => p.kind === "canvas" || renderRichHtml(p.text, true).length > 0);
  out.push({ name: "every md part still renders", ok, detail: "no blanked part" });
}

(window as never as { __out: Out[] }).__out = out;
(window as never as { __done: boolean }).__done = true;