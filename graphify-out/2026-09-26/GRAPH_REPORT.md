# Graph Report - astra-webui  (2026-09-26)

## Corpus Check
- 64 files · ~52,826 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 16 file(s) not represented in the graph (top: .jsonl 10, (none) 2, .db 1)

## Summary
- 451 nodes · 717 edges · 27 communities (21 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e692526f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- chat-landing.tsx
- App.tsx
- hermes-proxy.mjs
- package.json
- chat-timeline.tsx
- compilerOptions
- gateway-flow.tsx
- components.json
- compilerOptions
- rename-existing-chats.py
- patch_chat_landing.cjs
- hermes-ws.ts
- streaming-text.tsx
- .oxlintrc.json
- neon-flow.tsx
- source-filter.ts
- model-switch.check.ts
- Enhancement Plan Document
- selfcheck.sh
- gate-envelope.ts
- tsconfig.json
- README.md - Project Template
- sidebar-v2.md - Sidebar Spec
- token-tracker.tsx
- Astra Web UI — Light Mode Style Documentation
- Generative Gates — agent-side emission requirements
- e2e-gate-frames.mjs

## God Nodes (most connected - your core abstractions)
1. `react` - 23 edges
2. `compilerOptions` - 19 edges
3. `ChatLanding()` - 15 edges
4. `cn()` - 15 edges
5. `compilerOptions` - 15 edges
6. `connectUpstream()` - 14 edges
7. `lucide-react` - 13 edges
8. `handleWsUpgrade()` - 9 edges
9. `usePrefersReducedMotion()` - 8 edges
10. `Segment` - 8 edges

## Surprising Connections (you probably didn't know these)
- `apply()` --calls--> `applySegmentOps()`  [EXTRACTED]
  scripts/verify-chat-timeline.ts → src/lib/chat-segments.ts
- `runTests()` --calls--> `rowsToTurns()`  [EXTRACTED]
  scripts/verify-history.ts → src/lib/normalize-messages.ts
- `runTests()` --calls--> `draftKey()`  [EXTRACTED]
  scripts/verify-gate-envelope.ts → src/components/gates/gate-envelope.ts
- `runTests()` --calls--> `parseArchivedGate()`  [EXTRACTED]
  scripts/verify-gate-envelope.ts → src/components/gates/gate-envelope.ts
- `runTests()` --calls--> `parseGate()`  [EXTRACTED]
  scripts/verify-gate-envelope.ts → src/components/gates/gate-envelope.ts

## Import Cycles
- None detected.

## Communities (27 total, 6 thin omitted)

### Community 0 - "chat-landing.tsx"
Cohesion: 0.06
Nodes (43): ref_components, answered, apply(), bigOutput, cl, cl1, clLocked, g (+35 more)

### Community 1 - "App.tsx"
Cohesion: 0.07
Nodes (35): ref_lib, motion, react, react-dom, App(), Shell(), Sidebar(), Status (+27 more)

### Community 2 - "hermes-proxy.mjs"
Cohesion: 0.11
Nodes (33): ref_node_crypto, ref_node_fs, ref_node_http, BACKOFF_TABLE, broadcastFrame(), broadcastStatus(), browserSockets, bufferBrowserFrame() (+25 more)

### Community 3 - "package.json"
Cohesion: 0.05
Nodes (44): dependencies, clsx, dompurify, lucide-react, marked, motion, react, react-dom (+36 more)

### Community 4 - "chat-timeline.tsx"
Cohesion: 0.07
Nodes (39): lucide-react, AudioPlayer(), APPROVAL_LABELS, ApprovalRow(), ClarifyCard(), formatDur(), KIND_ICON, md (+31 more)

### Community 5 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+12 more)

### Community 6 - "gateway-flow.tsx"
Cohesion: 0.16
Nodes (15): BakeKnobs, buildFocusedDocument(), clamp(), EffectDefinition, FocusTarget, GATEWAY_FLOW_DEFAULTS, GATEWAY_FLOW_DEFINITION, GatewayFlowFrame() (+7 more)

### Community 7 - "components.json"
Cohesion: 0.12
Nodes (16): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+8 more)

### Community 8 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 9 - "rename-existing-chats.py"
Cohesion: 0.19
Nodes (12): json, os, candidates(), load_rewriter(), main(), One-time contextual rename of existing webui chats. Skips titles that are…, Resolve the rewriter's Gemini key: env first, then the systemd user environment…, title_with_gemini() (+4 more)

### Community 10 - "patch_chat_landing.cjs"
Cohesion: 0.20
Nodes (7): content, fs, content, fs, content, fs, ref_fs

### Community 11 - "hermes-ws.ts"
Cohesion: 0.25
Nodes (8): EventPayload, generateRpcId(), lastSessionInfo, SessionInfo, useHermesWS(), onMessage(), onSocketOpen(), replayOpenRequests()

### Community 12 - "streaming-text.tsx"
Cohesion: 0.28
Nodes (8): CROSSFADE, StreamingText(), StreamingTextProps, StreamingTextStatus, StreamingToken, tokenize(), useStreamingText(), UseStreamingTextOptions

### Community 13 - ".oxlintrc.json"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 14 - "neon-flow.tsx"
Cohesion: 0.50
Nodes (4): COLORS, makeTube(), NeonFlow(), Tube

### Community 15 - "source-filter.ts"
Cohesion: 0.47
Nodes (3): HUMAN_SOURCES, sourceLabel(), sourcesParam()

### Community 17 - "Enhancement Plan Document"
Cohesion: 0.67
Nodes (3): audit-findings.md - Audit Report, REPRO_FINDINGS.txt - Audit Evidence, Enhancement Plan Document

### Community 19 - "gate-envelope.ts"
Cohesion: 0.10
Nodes (28): ref_assert, ref_node_assert, runTests(), rows10, runTests(), turns10, FinalReportCard(), GateCard() (+20 more)

### Community 23 - "token-tracker.tsx"
Cohesion: 0.24
Nodes (10): BeaconStatus, formatTokens(), formatUSD(), HARNESS_META, HarnessAgg, PERIODS, RecordRow, SummaryRow (+2 more)

### Community 24 - "Astra Web UI — Light Mode Style Documentation"
Cohesion: 0.20
Nodes (9): Astra Web UI — Light Mode Style Documentation, Brand accents — darkened for light surfaces, Neutrals — the inversion trick, Palette, Principles, Rules, Surfaces (light), Text (light) (+1 more)

### Community 25 - "Generative Gates — agent-side emission requirements"
Cohesion: 0.40
Nodes (4): Constraints, Generative Gates — agent-side emission requirements, How to consume the reply, How to emit a gate

## Knowledge Gaps
- **185 isolated node(s):** `$schema`, `plugins`, `react/rules-of-hooks`, `react/only-export-components`, `$schema` (+180 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 217 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `App.tsx` to `chat-landing.tsx`, `package.json`, `chat-timeline.tsx`, `gateway-flow.tsx`, `hermes-ws.ts`, `streaming-text.tsx`, `neon-flow.tsx`, `gate-envelope.ts`, `token-tracker.tsx`?**
  _High betweenness centrality (0.238) - this node is a cross-community bridge._
- **Why does `lucide-react` connect `chat-timeline.tsx` to `chat-landing.tsx`, `App.tsx`, `package.json`, `gate-envelope.ts`, `token-tracker.tsx`?**
  _High betweenness centrality (0.071) - this node is a cross-community bridge._
- **What connects `$schema`, `plugins`, `react/rules-of-hooks` to the rest of the system?**
  _185 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `chat-landing.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.0636734693877551 - nodes in this community are weakly interconnected._
- **Should `App.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06717687074829932 - nodes in this community are weakly interconnected._
- **Should `hermes-proxy.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1106612685560054 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.04541062801932367 - nodes in this community are weakly interconnected._