# Graph Report - astra-webui  (2026-09-26)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 455 nodes · 718 edges · 31 communities (22 shown, 9 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e692526f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- chat-timeline.tsx
- chat-landing.tsx
- hermes-proxy.mjs
- App.tsx
- package.json
- gate-envelope.ts
- compilerOptions
- gateway-flow.tsx
- components.json
- compilerOptions
- Astra Web UI — Light Mode Style Documentation
- rename-existing-chats.py
- tubes-background.tsx
- token-tracker.tsx
- hermes-ws.ts
- devDependencies
- patch_chat_landing.cjs
- streaming-text.tsx
- .oxlintrc.json
- source-filter.ts
- neon-flow.tsx
- model-switch.check.ts
- Enhancement Plan Document
- e2e-gate-frames.mjs
- selfcheck.sh
- tsconfig.json
- Astra Logo (Favicon)
- Icon Sprite Sheet
- README.md - Project Template
- sidebar-v2.md - Sidebar Spec
- Vite Logo

## God Nodes (most connected - your core abstractions)
1. `react` - 23 edges
2. `compilerOptions` - 19 edges
3. `cn()` - 15 edges
4. `ChatLanding()` - 15 edges
5. `compilerOptions` - 15 edges
6. `connectUpstream()` - 14 edges
7. `lucide-react` - 13 edges
8. `handleWsUpgrade()` - 9 edges
9. `Segment` - 8 edges
10. `usePrefersReducedMotion()` - 8 edges

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

## Communities (31 total, 9 thin omitted)

### Community 0 - "chat-timeline.tsx"
Cohesion: 0.07
Nodes (40): lucide-react, AudioPlayer(), APPROVAL_LABELS, ApprovalRow(), ClarifyCard(), formatDur(), KIND_ICON, md (+32 more)

### Community 1 - "chat-landing.tsx"
Cohesion: 0.06
Nodes (43): ref_components, answered, apply(), bigOutput, cl, cl1, clLocked, g (+35 more)

### Community 2 - "hermes-proxy.mjs"
Cohesion: 0.11
Nodes (33): ref_node_crypto, ref_node_fs, ref_node_http, BACKOFF_TABLE, broadcastFrame(), broadcastStatus(), browserSockets, bufferBrowserFrame() (+25 more)

### Community 3 - "App.tsx"
Cohesion: 0.09
Nodes (24): ref_lib, motion, react, react-dom, App(), Shell(), Sidebar(), Status (+16 more)

### Community 4 - "package.json"
Cohesion: 0.06
Nodes (34): dependencies, clsx, dompurify, lucide-react, marked, motion, react, react-dom (+26 more)

### Community 5 - "gate-envelope.ts"
Cohesion: 0.10
Nodes (27): ref_assert, ref_node_assert, runTests(), rows10, runTests(), turns10, draftKey(), FixBody (+19 more)

### Community 6 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+12 more)

### Community 7 - "gateway-flow.tsx"
Cohesion: 0.16
Nodes (15): BakeKnobs, buildFocusedDocument(), clamp(), EffectDefinition, FocusTarget, GATEWAY_FLOW_DEFAULTS, GATEWAY_FLOW_DEFINITION, GatewayFlowFrame() (+7 more)

### Community 8 - "components.json"
Cohesion: 0.12
Nodes (16): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+8 more)

### Community 9 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 10 - "Astra Web UI — Light Mode Style Documentation"
Cohesion: 0.12
Nodes (13): Constraints, Generative Gates — agent-side emission requirements, How to consume the reply, How to emit a gate, Astra Web UI — Light Mode Style Documentation, Brand accents — darkened for light surfaces, Neutrals — the inversion trick, Palette (+5 more)

### Community 11 - "rename-existing-chats.py"
Cohesion: 0.19
Nodes (12): json, os, candidates(), load_rewriter(), main(), One-time contextual rename of existing webui chats. Skips titles that are…, Resolve the rewriter's Gemini key: env first, then the systemd user environment…, title_with_gemini() (+4 more)

### Community 12 - "tubes-background.tsx"
Cohesion: 0.24
Nodes (11): ACCENTS, Color, hexToRgb(), lerpColor(), randomOf(), randomPalette(), START_LIGHTS, START_TUBES (+3 more)

### Community 13 - "token-tracker.tsx"
Cohesion: 0.24
Nodes (10): BeaconStatus, formatTokens(), formatUSD(), HARNESS_META, HarnessAgg, PERIODS, RecordRow, SummaryRow (+2 more)

### Community 14 - "hermes-ws.ts"
Cohesion: 0.25
Nodes (8): EventPayload, generateRpcId(), lastSessionInfo, SessionInfo, useHermesWS(), onMessage(), onSocketOpen(), replayOpenRequests()

### Community 15 - "devDependencies"
Cohesion: 0.20
Nodes (10): devDependencies, oxlint, tailwindcss, @tailwindcss/vite, @types/node, @types/react, @types/react-dom, typescript (+2 more)

### Community 16 - "patch_chat_landing.cjs"
Cohesion: 0.20
Nodes (7): content, fs, content, fs, content, fs, ref_fs

### Community 17 - "streaming-text.tsx"
Cohesion: 0.28
Nodes (8): CROSSFADE, StreamingText(), StreamingTextProps, StreamingTextStatus, StreamingToken, tokenize(), useStreamingText(), UseStreamingTextOptions

### Community 18 - ".oxlintrc.json"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 19 - "source-filter.ts"
Cohesion: 0.47
Nodes (3): HUMAN_SOURCES, sourceLabel(), sourcesParam()

### Community 20 - "neon-flow.tsx"
Cohesion: 0.50
Nodes (4): COLORS, makeTube(), NeonFlow(), Tube

### Community 22 - "Enhancement Plan Document"
Cohesion: 0.67
Nodes (3): audit-findings.md - Audit Report, REPRO_FINDINGS.txt - Audit Evidence, Enhancement Plan Document

## Knowledge Gaps
- **188 isolated node(s):** `LightboxImage`, `ToolInfo`, `ChatMsg`, `Panel`, `Color` (+183 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 219 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `App.tsx` to `chat-timeline.tsx`, `chat-landing.tsx`, `package.json`, `gateway-flow.tsx`, `tubes-background.tsx`, `token-tracker.tsx`, `hermes-ws.ts`, `streaming-text.tsx`, `neon-flow.tsx`?**
  _High betweenness centrality (0.235) - this node is a cross-community bridge._
- **Why does `lucide-react` connect `chat-timeline.tsx` to `chat-landing.tsx`, `App.tsx`, `package.json`, `token-tracker.tsx`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **What connects `LightboxImage`, `ToolInfo`, `ChatMsg` to the rest of the system?**
  _188 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `chat-timeline.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07138535995160314 - nodes in this community are weakly interconnected._
- **Should `chat-landing.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.0636734693877551 - nodes in this community are weakly interconnected._
- **Should `hermes-proxy.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1106612685560054 - nodes in this community are weakly interconnected._
- **Should `App.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.08858858858858859 - nodes in this community are weakly interconnected._