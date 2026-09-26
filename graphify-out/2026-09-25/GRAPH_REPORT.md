# Graph Report - astra-webui  (2026-09-24)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 347 nodes · 503 edges · 23 communities (16 shown, 7 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1a239dbf`
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
- dependencies
- patch_chat_landing.cjs
- hermes-ws.ts
- streaming-text.tsx
- .oxlintrc.json
- neon-flow.tsx
- source-filter.check.ts
- model-switch.check.ts
- Enhancement Plan Document
- selfcheck.sh
- normalize-messages.ts
- tsconfig.json
- README.md - Project Template
- sidebar-v2.md - Sidebar Spec

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 19 edges
2. `react` - 16 edges
3. `compilerOptions` - 15 edges
4. `connectUpstream()` - 14 edges
5. `ChatLanding()` - 12 edges
6. `handleWsUpgrade()` - 9 edges
7. `applySegmentOps()` - 8 edges
8. `lucide-react` - 8 edges
9. `FrameDecoder` - 7 edges
10. `encodeFrame()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `apply()` --calls--> `applySegmentOps()`  [EXTRACTED]
  scripts/verify-chat-timeline.ts → src/lib/chat-segments.ts
- `audit-findings.md - Audit Report` --informs--> `Enhancement Plan Document`  [EXTRACTED]
  .audit-evidence/audit-findings.md → enhancement-plan.md
- `REPRO_FINDINGS.txt - Audit Evidence` --informs--> `Enhancement Plan Document`  [EXTRACTED]
  .audit-evidence/REPRO_FINDINGS.txt → enhancement-plan.md
- `ApprovalRow()` --calls--> `cn()`  [EXTRACTED]
  src/components/chat-timeline.tsx → src/lib/utils.ts
- `ClarifyCard()` --calls--> `cn()`  [EXTRACTED]
  src/components/chat-timeline.tsx → src/lib/utils.ts

## Import Cycles
- None detected.

## Communities (23 total, 7 thin omitted)

### Community 0 - "chat-landing.tsx"
Cohesion: 0.07
Nodes (43): ref_components, ref_node_assert, answered, apply(), bigOutput, cl, cl1, clLocked (+35 more)

### Community 1 - "App.tsx"
Cohesion: 0.07
Nodes (31): ref_lib, lucide-react, motion, react, App(), Status, ChatsPanel(), SessionMeta (+23 more)

### Community 2 - "hermes-proxy.mjs"
Cohesion: 0.11
Nodes (33): ref_node_crypto, ref_node_fs, ref_node_http, BACKOFF_TABLE, broadcastFrame(), broadcastStatus(), browserSockets, bufferBrowserFrame() (+25 more)

### Community 3 - "package.json"
Cohesion: 0.06
Nodes (35): devDependencies, oxlint, tailwindcss, @tailwindcss/vite, @types/node, @types/react, @types/react-dom, typescript (+27 more)

### Community 4 - "chat-timeline.tsx"
Cohesion: 0.11
Nodes (21): APPROVAL_LABELS, ApprovalRow(), ClarifyCard(), md, MEDIA_RE, MediaCard(), mediaPaths(), prettyPrint() (+13 more)

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

### Community 9 - "dependencies"
Cohesion: 0.20
Nodes (10): dependencies, clsx, dompurify, lucide-react, marked, motion, react, react-dom (+2 more)

### Community 10 - "patch_chat_landing.cjs"
Cohesion: 0.20
Nodes (7): content, fs, content, fs, content, fs, ref_fs

### Community 11 - "hermes-ws.ts"
Cohesion: 0.27
Nodes (7): EventPayload, generateRpcId(), lastSessionInfo, SessionInfo, useHermesWS(), onMessage(), replayOpenRequests()

### Community 12 - "streaming-text.tsx"
Cohesion: 0.28
Nodes (8): CROSSFADE, StreamingText(), StreamingTextProps, StreamingTextStatus, StreamingToken, tokenize(), useStreamingText(), UseStreamingTextOptions

### Community 13 - ".oxlintrc.json"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 14 - "neon-flow.tsx"
Cohesion: 0.50
Nodes (4): COLORS, makeTube(), NeonFlow(), Tube

### Community 17 - "Enhancement Plan Document"
Cohesion: 0.67
Nodes (3): audit-findings.md - Audit Report, REPRO_FINDINGS.txt - Audit Evidence, Enhancement Plan Document

## Knowledge Gaps
- **156 isolated node(s):** `ChatMsg`, `Panel`, `Status`, `SessionMeta`, `FileEntry` (+151 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 178 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `App.tsx` to `chat-landing.tsx`, `package.json`, `chat-timeline.tsx`, `gateway-flow.tsx`, `hermes-ws.ts`, `streaming-text.tsx`, `neon-flow.tsx`?**
  _High betweenness centrality (0.263) - this node is a cross-community bridge._
- **Why does `lucide-react` connect `App.tsx` to `chat-landing.tsx`, `package.json`, `chat-timeline.tsx`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._
- **What connects `ChatMsg`, `Panel`, `Status` to the rest of the system?**
  _156 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `chat-landing.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.06547619047619048 - nodes in this community are weakly interconnected._
- **Should `App.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07171717171717172 - nodes in this community are weakly interconnected._
- **Should `hermes-proxy.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.1106612685560054 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.05689900426742532 - nodes in this community are weakly interconnected._