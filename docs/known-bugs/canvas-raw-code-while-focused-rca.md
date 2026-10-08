# Root cause analysis — canvas renders as raw code while the chat is focused

**Reported:** with the chat focused and open, a canvas card that starts rendering is shown as a raw JSON code block. Reloading the page makes the card appear. Asked whether the 2026-10-05 fixes already cover it.

**Short answer: no, not covered.** Those fixes were a different defect (prose *disappearing* after a card). This is a separate bug with a separate cause. I have proven the mechanism in the parser and segment engine, and I have proven where my evidence stops. I have not reproduced the exact "stays wrong until reload" persistence in a browser, and I say so plainly below rather than dressing up inference as fact.

Date: 2026-10-05. Repo: `~/Work/projects/astra-webui`. HEAD `4fdceb0`. All probes read-only; no repo file was modified.

---

## 1. The confirmed defects

### D1 — a text segment can stay `status:"run"` forever (CONFIRMED, measured)

`src/lib/chat-segments.ts:196-201` opens a text segment as `status: "run"`, and only `text-final` (`:202`) closes it out as `done`. Probe:

```
NO text-final : text:run      stuck-in-run: 1  <-- STAYS STREAMING FOREVER
                               its text holds the fence? true
WITH text-final: text:done    done segments: 1  | fence intact? true
```

So any turn where `text-final` never arrives — a Stop press, a dropped socket, a crashed or backgrounded worker, a provider that emits no `message.complete.text` (the comment at `:203-206` names Anthropic on this gateway as exactly that case) — leaves the segment permanently in the streaming state.

This matters because `TextRow` branches on it (`src/components/chat-timeline.tsx`):

```tsx
const n        = useReveal(text, seg.status === "done", instant || reveal === false);  // :494
const isDone   = seg.status === "done";                                                 // :502
const displayRaw = isDone ? text : shown;                                                // :504
...
<RichText text={display} streaming={seg.status === "run"} />                             // :510
```

A stuck segment is *always* the live path: `streaming=true`, never `done`.

### D2 — the typewriter reveal slices the text before the canvas parser sees it (CONFIRMED, measured)

`TextRow` cuts the segment to the revealed character count and passes **that prefix** to `RichText` (`:495` `shown = text.slice(0, n)`, `:504`, `:510`). `splitCanvasBlocks` is then asked to parse a *truncated* document.

Measured across a fence at chars 14→89 of a 108-char message:

```
first prefix length that shows RAW CODE: 29
  prefix: "Here you go:\n\n```astra-canvas"
  window where raw JSON is on screen: 14 to 89 = 75 chars
After the closer lands: md|canvas          <- card appears
On reload (isDone -> full text): md|canvas|md
```

And with `marked` on the raw fence:

```
contains <pre><code>?                 true
contains class=language-astra-canvas? true
<pre><code class="language-astra-canvas">{&quot;v&quot;:1,…}</code></pre>
```

That `<pre><code class="language-astra-canvas">` **is the code block you saw.** The fail-soft rule ("an unparseable fence stays in the markdown") is what paints it, and it is working as designed — the input it was given is genuinely a partial fence.

### D3 — the two entry points disagree about contained fences (CONFIRMED, measured)

`planTurnCanvases` deliberately leaves a *contained* fence inline (`canvas-schema.ts:2126-2141`):

```ts
//   CONTAINED (opens and closes inside one segment) → leave it in the
//     markdown. RichText splits and renders it INLINE…
if (startSeg === endSeg) continue; // contained → inline, no cut
```

That design is sound **only if** `RichText` receives the full text. Measured for the single-segment case:

```
=== SINGLE text segment, streaming ===
  canvases rendered: 0
  md handed to the markdown renderer:
    "Here you go:\n\n```astra-canvas\n{…}\n```\n\nThat is the card."
  --> RAW JSON IN MARKDOWN? true
=== SAME text, but RichText's own splitter ===
  parts: md|canvas|md     <- RichText WOULD render a card
```

So the turn planner hoists nothing, hands the fence-bearing text down, and whether a card appears depends entirely on `RichText`'s splitter — which D2 has already cut the fence out of. When the fence lands in a *second* segment (tool call between prose and card) the same measurement holds: `canvases: 0`, raw fence left inline.

---

## 2. Why reload fixes it

Reload rebuilds from stored message rows via `normalize-messages.ts`, which produces `status:"done"` segments. `isDone` is then true, `displayRaw === text`, the fence is intact, and the splitter parses it. This is a different code path from the live one — which is why the two disagree.

---

## 3. What I have NOT proven

I want to be exact about the boundary of this evidence:

- **I did not reproduce the persistence in a browser.** Every leak I measured was 1 frame wide (`rca7`: leaking prefix lengths `29..29`, one frame). A one-frame flash does not obviously match "I had to reload". Sweeping the reveal across a fence gave `card=no, rawCode=no` for partial sweeps and `card=YES` for complete ones (`rca12`). So the *parser* is not obviously the thing that stays broken.
- **I did not capture your actual failing message.** The most likely remaining explanation is something about the real payload or delta pattern I have not reproduced — e.g. a fence whose closer never arrives because the turn was cut, leaving D1 in effect so the card never resolves at all.
- **The two known streaming-render defects compound this** and are confirmed but not root-caused here: the canvas path re-parses every markdown part on every delta, and the live incremental canvas path parses text the planner already stripped (so it never fires).

**The honest position:** D1 + D2 + D3 are real, measured, and sufficient to produce exactly the artifact you saw (`<pre><code class="language-astra-canvas">`). Whether they also explain the *persistence until reload* is the one link I have not closed. Closing it needs your message text, or a browser reproduction.

---

## 4. Fix directions (for when you approve — nothing implemented)

Ordered by leverage:

1. **Never slice a fence.** The reveal should hide a canvas fence rather than cut it: when the revealed prefix falls inside a fence span, withhold from the opener onward. Fixes D2 and removes the only route by which raw JSON can reach the screen. One guard in `TextRow`, no parser change.
2. **Close stuck segments.** When a turn ends without `text-final`, mark the open text segment `done`. Fixes D1 and removes the permanently-streaming state that makes D2 permanent. Repo history already records the reasoning at `chat-timeline.tsx:497-501` ("a sweep that never finished … left the message permanently TRUNCATED") — same class of bug, opposite symptom.
3. **Hoist contained fences in the planner too**, or make the planner's inline contract explicit and assert it. Fixes D3, which is currently a documented-but-unenforced invariant.
4. **Only these three**, then re-measure the leak window in a browser before touching the streaming-performance items.

## 5. Files implicated

| File | Line | Defect |
|---|---|---|
| `src/components/chat-timeline.tsx` | 494, 504, 510 | D2 — prefix sliced before the canvas parser |
| `src/lib/chat-segments.ts` | 196-201 | D1 — `run` never closed without `text-final` |
| `src/lib/canvas-schema.ts` | 2126-2141 | D3 — contained fence left inline, unenforced |

## 6. Audit of the other session's landing (you asked)

- Both my commits are on `HEAD` and reachable: `c40f4a8`, `4fdceb0`.
- All five fix markers present in committed source: `REACTIVE_KEYS` and `carryBinding` (`canvas-sanitize.ts`), `withhold ONLY when the tail fence` and `lastSig` (`canvas-schema.ts`), `stableSig` (`canvas-state.tsx`).
- `rounding.check.ts` and `text-wrap.check.ts` both **PASS** — my two CSS fixes are still in the working tree.
- **`src/index.css` is still uncommitted** (277 insertions vs HEAD) — that session's work is in the same file, and their export block (`.ast-cv-x-page`) is still absent from HEAD. So my two CSS lines remain uncommittable in isolation. Not landed.