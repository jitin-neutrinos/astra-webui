# Revamp proposal — raw canvas JSON must never reach the screen

**Goal:** make it structurally impossible for an `astra-canvas` payload to be painted as a code block, at any point, for any reason.

**Status: nothing implemented.** This is a proposal for approval.

Date 2026-10-05. HEAD `4fdceb0`. Every number below is measured against the real modules; all probes read-only.

---

## 1. What I now know, and how it changed

My earlier RCA named three defects. Investigating further **corrected two of them and found the actual persistence mechanism**:

| Earlier claim | Correction |
|---|---|
| D2 "the typewriter cuts the fence, causing the leak" | **Wrong as the cause.** I ran the full production pipeline (`safeTail` → `splitCanvasBlocks` → `marked` → DOM check) across 91 frames of a 1-block card, a realistic 4-block card, a card containing nested backticks, a 4-tick wrapper, and two cards in one reply: **607 frames, zero leaked.** `safeTail` (`src/lib/safe-tail.ts:8`) appends a closing fence when the count is odd, but the splitter consumes it. With well-formed JSON the streaming reveal is safe. |
| D3 "contained fences left inline cause the leak" | **Real but not the cause.** Same pipeline, zero leaks. The invariant is unenforced (worth pinning) but it is not painting anything. |
| "I could not explain the persistence" | **Now explained.** See D4. |

## 2. The actual root cause of what you saw

**The leak only happens when the fence body is malformed, and the repair that fixes it is disabled while streaming.**

`src/components/chat-timeline.tsx:124`
```ts
if (streaming || text.length === 0) return;   // async repair is gated OFF during a live stream
```

The async tier (`splitCanvasBlocksAsync`, using `jsonrepair`) is the only path that rescues these three real emission shapes:

```
unquoted + prose   sync=md      async=canvas
single quotes      sync=md      async=canvas
truncated body     sync=md      async=md
```

So during a live turn, each of them stays `md` — and `marked` faithfully paints it:

```
RAW CODE ON SCREEN  unquoted + prose     syncParts=md
RAW CODE ON SCREEN  single quotes        syncParts=md
RAW CODE ON SCREEN  truncated body       syncParts=md
```

and that is exactly the `<pre><code class="language-astra-canvas">` you saw.

**Why it persists until reload** — D1 from the RCA, now shown to be the multiplier:

`src/lib/chat-segments.ts:196-201` opens a text segment as `status:"run"`; only `text-final` (`:202`) closes it.

```
NO text-final : text:run    stuck-in-run: 1  <-- STAYS STREAMING FOREVER
WITH text-final: text:done  done segments: 1  | fence intact? true
```

A stuck segment is permanently the live path, so `streaming` is permanently `true`, so the repair is permanently off, so the malformed fence stays raw code permanently. **Reload rebuilds segments from stored rows as `done`, which re-enables the repair and the card appears.** That closes the link I could not previously prove, and it explains why it only happened while the chat was focused and watching a live turn.

**Contributing (confirmed, not the cause):** a segment stuck in `run` also keeps `useReveal` sweeping. The repo already fixed the mirror-image of this bug once — `chat-timeline.tsx:497-501` records that "a sweep that never finished … left the message permanently TRUNCATED".

## 3. Fix design — four layers, each independently shippable

The aim is a *structural* guarantee, not a heuristic. Layers are ordered by leverage.

### L1 — Never render an unrecognised `astra-canvas` fence as code (the guarantee)

Today a fence the parser cannot read is handed to `marked`, which is correct behaviour for a *code* fence and wrong for this one. Make the canvas fence type a **first-class markdown directive the renderer owns**, so it can never reach the code renderer:

- Register a `marked` renderer for `code` where `lang === "astra-canvas"`.
- If the body parses → emit a canvas mount marker.
- If it does not parse → emit a neutral placeholder (a quiet "card building…" affordance), never a `<pre>`.

This alone makes raw JSON unreachable, regardless of parser state, streaming state, or segment state. Cost: one renderer override in `rich-html.ts`. Risk: low — `marked`'s renderer API is stable and already wrapped by DOMPurify.

### L2 — Never slice a fence during the reveal (removes the transient)

Withhold from the opener whenever the revealed prefix falls inside a fence span. The card then appears atomically at fence close, which is also the behaviour you asked for elsewhere ("render in real time, not emitted then displayed" — the live incremental path already exists at `chat-timeline.tsx:772-783`, it is just currently unreachable).

### L3 — Close stuck segments (removes the persistence)

When a turn ends without `text-final`, mark the open text segment `done`. Small, and it is the multiplier that turned a transient into a permanent failure.

### L4 — Make the parser's own invariants enforced

- Run the async repair tier on the **last frame of a stream** even if the turn never reported `done` (a short debounce, so the repair library still loads only for chats that need it).
- Pin the contained-fence inline contract with an assertion (D3), so a future change cannot silently break prose ordering.

## 4. What I would NOT do

- **Do not remove the fail-soft rule.** Degrading to markdown is the right default for genuinely unparseable input; the bug is that this fence type was allowed to *use* that path.
- **Do not rewrite the streaming layer for this.** L1–L3 are small and local. The separate per-delta re-parse cost is a performance item and should not be bundled into a correctness fix.
- **Do not add a dependency for L1.** `marked`'s renderer hook is enough; `remend` (11.9M dl/wk, zero deps) is the right tool only if we later want partial-JSON completion *inside* the card, which is a different feature.

## 5. Research corroboration

From the streaming research already in hand (`STREAMING-CONTENT-RESEARCH.md`):

- **LibreChat** (MIT, 45k★) — parses the *whole accumulated string* on every append rather than stitching chunks, and treats a partially-arrived fence as simply an unterminated `code` node. Their `splitBlocks` refuses to split when a node type would be severed (`html`, `definition`, `footnoteDefinition`) and returns the whole tree instead — an explicit "never cut a node" invariant, which is the same law L2 enforces.
- **Vercel `streamdown`** removed `useTransition` because transitions starved the stream at first parse. Do **not** wrap the streaming path in a transition; this repo does not, and that should be pinned.
- Their documented trade-off applies to us: block-splitting is only worth it for messages that are or have been streaming.

## 6. Proposed order and verification

| Step | Change | Verifies |
|---|---|---|
| 1 | L1 renderer override | zero `<pre>` for `astra-canvas`, measured over the 607-frame sweep |
| 2 | L3 close stuck segments | `applySegmentOps` with deltas and no `text-final` ends `done` |
| 3 | L2 withhold-during-reveal | no frame shows a partial fence |
| 4 | L4 debounced repair on stream end + invariant assert | malformed shapes still resolve without a reload |
| 5 | New gate file + manifest row | fails on pristine HEAD, passes on the fix |

Each step is independently shippable and gets its own assert-based check, per repo convention.

## 7. Honest limits

- I could not reproduce the failure **in a browser**. The mechanism is proven in the real modules; a browser run should confirm it end to end, and I would do that before declaring it fixed.
- "Unquoted + prose" and "single quotes" are rescued by the async tier. **"Truncated body" is not rescued by either tier** (`sync=md async=md`) — L1 is what makes that case safe rather than merely ugly.
- I have not measured how often real model output is malformed enough to hit this. The replay corpus exists (`canvas-replay.check.ts`) and could quantify it.