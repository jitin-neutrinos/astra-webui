# Astra webui — performance & capability framework research (2026-09-29)

Sources: official Hermes docs + tui_gateway source (read directly), NousResearch/hermes-agent GitHub,
Vercel Streamdown + AI SDK cookbook, MUI X Chat perf guide, TanStack Virtual, Orbit engineering blog,
nodefunc React streaming guide. Verified against astra's actual code (marked + DOMPurify RichText,
setMessages-per-delta React state).

## What astra already does right
- marked + DOMPurify in `RichText` with `useMemo` on `[text, streaming]` (chat-timeline.tsx:21).
- Streaming reveal decoupled from arrival (useReveal 40-52cps) — arrival bursts never paint per-token.
- Session drafts, connection banner, WS resilience — solid.

## Findings, ranked by impact/effort

### 1. Block-level memoized markdown (Streamdown pattern) — HIGH impact, LOW effort
Every delta re-runs `md.parse` + `DOMPurify.sanitize` over the WHOLE streamed text inside RichText's
useMemo (text changes every delta). Cost grows O(n²) over a long reply. The established fix
(Vercel MemoizedMarkdown recipe, Streamdown internals, and hermes desktop's own markdown-text.tsx):
1. `marked.lexer(text)` → top-level blocks; render each block as its own memoized component.
2. Only the last block's content changes during streaming → only it re-parses.
3. Hermes desktop adds an LRU of block arrays keyed by source string (repeat parses on remount → ~free).
Astra can adopt the exact recipe without adding Streamdown: `Marked` is already installed
(`md.lexer()`), memo boundary per block, DOMPurify per block. Copy-button effect must move to the
block level. Est. diff: ~60 lines in chat-timeline.tsx.

### 2. rAF-batch delta ingestion — MEDIUM impact, LOW effort
WS deltas → setMessages per frame. If arrival exceeds paint rate, React thrashes. Coalesce incoming
deltas in a ref buffer, flush to state on requestAnimationFrame (single pattern from n4n/nodefunc
guides). Small change in hermes-ws.ts event dispatch. Pairs with #1.

### 3. Virtualized history for long chats — DEFER until long-chat pain is real
TanStack Virtual + astra's variable-height bubbles needs a measure-once height cache (Orbit's
lesson: AI chat breaks naive virtualization — async highlight, immutable completed messages,
persist heights per session:message). Real but heavy; astra threads are typically <500 messages.
Skip now; revisit if a thread visibly lags.

### 4. Worker-thread markdown/highlight — NOT YET
Only pays when #1 lands and profiling still shows main-thread stall on huge code blocks. marked is
sync; moving parse to a Worker costs an async bridge through the reveal animation. Park.

### 5. Gateway-native affordances worth borrowing (from official docs + source)
- `session.resume` snapshot carries `queued: {user}`, `running`, `inflight.corrections` — the bg dock
  can read server truth with zero gateway changes (this round's R3 uses it).
- TUI has `/queue list|rm|edit|move` — client-side management of the run-after queue is a Hermes
  pattern; webui can mirror "list" via the same snapshot field (rm/edit/move have no webui RPC —
  out of scope this round).
- Upstream bug to know about: NousResearch/hermes-agent#26813 — in `busy_input_mode: steer`,
  `/stop` from a client is fed to the agent as steer text instead of interrupting. Astra's /steer
  bridge flips the global config for ~one RPC; exposure is a narrow race (another client issuing
  /stop exactly mid-bridge). Low risk single-user; noted, not fixed (upstream).
- Steer fallbacks (docs): agent-not-started → queue; images attached → queue. Astra's /steer
  already refuses attachments before submit — correct per gateway contract.

### 6. Streaming flush interval knob (MUI X pattern)
Server-side batching of deltas (~16-50ms) cuts frame pressure further if #2 isn't enough. The
gateway publishes frames unbatched; a client-side rAF flush (#2) is the lazier equivalent. Skip
server changes.

## Recommended adoption order
1. Block-memoized markdown (this round or next — independent of bg/steer work).
2. rAF delta batching (same pass as #1, ~15 lines).
3. Re-profile; only then consider virtualization/worker work.

## Frameworks evaluated and NOT adopted (with reason)
- Streamdown (Vercel): would replace marked+DOMPurify+copy-button plumbing wholesale; brings Shiki,
  caret, plugin system astra doesn't need; astra's reveal pipeline is custom. Recipe borrowed, dep skipped.
- @mui/x-chat / assistant-ui: full chat runtimes; astra already has its own timeline engine
  (chat-segments.ts) tuned to gateway frames. Porting = rewrite, no capability gain.
- react-virtual / virtuoso: deferred (#3).
