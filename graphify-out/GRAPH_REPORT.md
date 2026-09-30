# Graph Report - astra-webui  (2026-09-30)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1405 nodes · 2425 edges · 106 communities (64 shown, 42 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 40 edges (avg confidence: 0.89)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f2cf1a73`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- TextRow
- hermes-proxy.mjs
- package.json
- chat-timeline.tsx
- tauri.conf.json
- AppDelegate
- ws-engine.ts
- gate-envelope.ts
- react
- transcode.mjs
- main.tsx
- compilerOptions
- gateway-flow.tsx
- tubes-background.tsx
- lib.rs
- components.json
- compilerOptions
- Astra Web UI — Light Mode Style Documentation
- 2. Content sketches
- verify-chat-timeline.ts
- chat-landing.tsx
- dependencies
- rename-existing-chats.py
- streaming-text.tsx
- chat-segments.ts
- media-viewer.tsx
- harness-agents.ts
- ai-tool-call.tsx
- patch_chat_landing.cjs
- Voice conversation mode for Astra — research findings
- normalize-messages.ts
- Tab
- astra-remote.json
- pdf-view.tsx
- GateActivity.kt
- .oxlintrc.json
- App.tsx
- token-tracker.tsx
- BundleToolRow
- source-filter.ts
- no-dup.check.ts
- subagent-panel.tsx
- neon-flow.tsx
- Decision: Hybrid Voice Architecture
- re
- model-switch.check.ts
- scroll-intent.check.ts
- NtfyPushService
- e2e-gate-frames.mjs
- selfcheck.sh
- media-grid.tsx
- ntfy-init.js
- tsconfig.json
- Hermes Agent
- Package.swift
- README.md
- android-selfcheck.sh
- Astra Frontend
- Capacitor Android Wrap
- Capacitor iOS Wrap
- Windows Tauri Implementation Plan
- Astra Voice Mode Research
- Enhancement Plan Document
- iOS Build Workflow
- Windows Build Workflow
- ntfy.sh
- Option A: Chained Voice
- Option B: Full-duplex Realtime
- astra
- Astra Logo (Favicon)
- Icon Sprite Sheet
- sidebar-v2.md - Sidebar Spec
- Vite Logo
- CookieEncryptPlugin.java
- NativeNtfy.kt
- MainActivity
- wake-probe.check.ts
- Findings, ranked by impact/effort
- devDependencies
- tool-io.ts
- outbox.ts
- tool-io.check.ts
- ref_components
- slash-commands.ts
- replay-dedup.check.ts
- scripts
- chat-dedup.check.ts
- verify-media.check.ts
- tool-identity.ts
- gradlew
- capacitor.config.ts
- ref_capawesome_capacitor_android_edge_to_edge_support
- ref_capawesome_capacitor_navigation_bar
- ntfy.ts
- ref_node_path
- ref_lib

## God Nodes (most connected - your core abstractions)
1. `GateActivity` - 36 edges
2. `react` - 36 edges
3. `NtfyPushService` - 25 edges
4. `cn()` - 22 edges
5. `wsGet()` - 21 edges
6. `lucide-react` - 20 edges
7. `compilerOptions` - 19 edges
8. `applySegmentOps()` - 18 edges
9. `onMessage()` - 18 edges
10. `ChatLanding()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `What astra already does right` --references--> `RichText()`  [INFERRED]
  docs/research-webui-perf-2026-09-29.md → src/components/chat-timeline.tsx
- `5. Per-requirement test checklist (R1–R10)` --references--> `applyReplyTruth()`  [INFERRED]
  docs/plans/android-bg-chat-ws-plan.md → src/lib/ws-engine.ts
- `Product context (verified facts, do not re-derive)` --references--> `pokeResumeCheck()`  [INFERRED]
  docs/plans/bg-persistence-prompt.md → src/lib/ws-engine.ts
- `Phase A — server (deploy-safe, no client change needed)` --references--> `handleWsUpgrade()`  [INFERRED]
  docs/plans/android-bg-chat-ws-plan.md → server/hermes-proxy.mjs
- `Changes` --references--> `handleWsUpgrade()`  [INFERRED]
  docs/plans/bg-persist-build-a.md → server/hermes-proxy.mjs

## Import Cycles
- 3-file cycle: `src/components/audio-player.tsx -> src/components/chat-timeline.tsx -> src/components/media-grid.tsx -> src/components/audio-player.tsx`

## Hyperedges (group relationships)
- **Voice Mode Implementation Options** — option_a_chained_voice, option_b_full_duplex, decision_hybrid_voice [EXTRACTED 1.00]

## Communities (106 total, 42 thin omitted)

### Community 0 - "TextRow"
Cohesion: 0.18
Nodes (7): TextRow(), useReveal(), stripMediaLines(), newCps, revealCps(), PAIRS, safeTail()

### Community 1 - "hermes-proxy.mjs"
Cohesion: 0.06
Nodes (59): 0. Recon corrections (facts that change the design), 1. Architecture — who holds which socket, 2. File-by-file change map, 3. Auth/ticket flow — native chat socket, 4. Notification dedupe rules (vs ntfy gates), 5. Per-requirement test checklist (R1–R10), 6. Top-3 risks + mitigations, 7. Build order (agy) (+51 more)

### Community 2 - "package.json"
Cohesion: 0.09
Nodes (22): name, private, type, version, @capacitor/android, @capacitor/assets, @capacitor/ios, @capacitor/status-bar (+14 more)

### Community 3 - "chat-timeline.tsx"
Cohesion: 0.14
Nodes (22): dompurify, clsx, tailwind-merge, APPROVAL_LABELS, APPROVAL_RECEIPT, ApprovalRow(), ClarifyCard(), md (+14 more)

### Community 4 - "tauri.conf.json"
Cohesion: 0.06
Nodes (33): app, security, windows, withGlobalTauri, build, frontendDist, bundle, active (+25 more)

### Community 5 - "AppDelegate"
Cohesion: 0.09
Nodes (20): Any, Bool, Capacitor, AppDelegate, UIScene, UISceneSession, UIWindow, SceneDelegate (+12 more)

### Community 6 - "ws-engine.ts"
Cohesion: 0.07
Nodes (79): Phase B — web (src/), BUILD — Phase B (web only): wake probes + native session bridge + storage prune, Changes, Done condition, ConnEvent, ConnState, fmtSeconds(), nextConnState() (+71 more)

### Community 7 - "gate-envelope.ts"
Cohesion: 0.17
Nodes (15): runTests(), FinalReportCard(), draftKey(), FixBody, GATE_OPEN, GateAction, GateKind, GateReply (+7 more)

### Community 8 - "react"
Cohesion: 0.12
Nodes (12): docx-preview, react, xlsx, DocPreview(), DocPreviewProps, DocxViewer, PptxViewer, XlsxViewer (+4 more)

### Community 9 - "transcode.mjs"
Cohesion: 0.05
Nodes (37): ref_node_fs, ref_node_os, blob, bmp, fake1, fake2, files, inputPath (+29 more)

### Community 10 - "main.tsx"
Cohesion: 0.31
Nodes (7): @capacitor/core, react-dom, src_index, initAndroidShell(), initShellTheme(), plugin(), reportLayout()

### Community 11 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowArbitraryExtensions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+12 more)

### Community 12 - "gateway-flow.tsx"
Cohesion: 0.16
Nodes (15): BakeKnobs, buildFocusedDocument(), clamp(), EffectDefinition, FocusTarget, GATEWAY_FLOW_DEFAULTS, GATEWAY_FLOW_DEFINITION, GatewayFlowFrame() (+7 more)

### Community 13 - "tubes-background.tsx"
Cohesion: 0.17
Nodes (17): applyGround(), Color, DARK_BLOOM, DARK_TUBES, hexToRgb(), lerpColor(), LIGHT_BLOOM, LIGHT_LIGHTS (+9 more)

### Community 14 - "lib.rs"
Cohesion: 0.17
Nodes (16): AppHandle, Instant, Mutex, notificationext, Option, astra_path(), navigate(), NTFY_ENABLED (+8 more)

### Community 15 - "components.json"
Cohesion: 0.12
Nodes (16): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+8 more)

### Community 16 - "compilerOptions"
Cohesion: 0.12
Nodes (16): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, noEmit, noFallthroughCasesInSwitch (+8 more)

### Community 17 - "Astra Web UI — Light Mode Style Documentation"
Cohesion: 0.12
Nodes (14): Constraints, Generative Gates — agent-side emission requirements, How to consume the reply, How to emit a gate, AI component layer (2026-09-29 chronological timeline), Astra Web UI — Light Mode Style Documentation, Brand accents — darkened for light surfaces, Neutrals — the inversion trick (+6 more)

### Community 18 - "2. Content sketches"
Cohesion: 0.12
Nodes (15): 0. Architecture decisions (fixed — do not deviate), 1. File-by-file map (all new), 2.1 tauri.conf.json, 2.2 capabilities/astra-remote.json, 2.3 Cargo.toml (deps section), 2.4 src/main.rs, 2.5 src/lib.rs — wiring skeleton (order matters), 2.6 scripts/ntfy-init.js — template (+7 more)

### Community 19 - "verify-chat-timeline.ts"
Cohesion: 0.13
Nodes (14): answered, bigOutput, cl, cl1, clLocked, g, multi, openAppr (+6 more)

### Community 20 - "chat-landing.tsx"
Cohesion: 0.10
Nodes (24): AttachmentTray(), BgDock(), BgDockProps, SysNoteRow(), ChatLanding(), loadHistory(), ChatMsg, hermesHomeRef (+16 more)

### Community 21 - "dependencies"
Cohesion: 0.08
Nodes (26): dependencies, @capacitor/android, @capacitor/assets, @capacitor/cli, @capacitor/core, @capacitor/ios, @capacitor/preferences, @capacitor/status-bar (+18 more)

### Community 22 - "rename-existing-chats.py"
Cohesion: 0.19
Nodes (12): json, os, candidates(), load_rewriter(), main(), One-time contextual rename of existing webui chats. Skips titles that are…, Resolve the rewriter's Gemini key: env first, then the systemd user environment…, title_with_gemini() (+4 more)

### Community 23 - "streaming-text.tsx"
Cohesion: 0.18
Nodes (10): motion, AITextLoadingProps, CROSSFADE, StreamingText(), StreamingTextProps, StreamingTextStatus, StreamingToken, tokenize() (+2 more)

### Community 24 - "chat-segments.ts"
Cohesion: 0.16
Nodes (17): apply(), GateEnvelope, applySegmentOps(), ClarifyQuestion, closeRunningThink(), hasRenderedReq(), isReqSeg(), lastAssistantHasText() (+9 more)

### Community 25 - "media-viewer.tsx"
Cohesion: 0.12
Nodes (9): yet-another-react-lightbox, AudioPlayer(), MediaViewer, usePrefersReducedMotion(), MediaViewer(), SlideAstra, SlideTypes, yet-another-react-lightbox (+1 more)

### Community 26 - "harness-agents.ts"
Cohesion: 0.23
Nodes (8): AGENT_FLAGS, merged, detectHarness(), HARNESS_BINARIES, HarnessRow, harnessRowFromToolStart(), mergeRoster(), WHY: `subagent.list` (gateway RPC) only knows Hermes `delegate_task` children.

### Community 27 - "ai-tool-call.tsx"
Cohesion: 0.15
Nodes (16): react, @radix-ui/react-collapsible, AiToolCallContentProps, AiToolCallContext, AiToolCallContextValue, AiToolCallErrorProps, AiToolCallHeader(), AiToolCallHeaderProps (+8 more)

### Community 28 - "patch_chat_landing.cjs"
Cohesion: 0.20
Nodes (7): content, fs, content, fs, content, fs, ref_fs

### Community 29 - "Voice conversation mode for Astra — research findings"
Cohesion: 0.22
Nodes (8): DECISION 2026-09-26 (Jitin): chatterbox is the voice of Hermes/Astra, Option A — Chained voice (RECOMMENDED v1), Option B — Full-duplex realtime (the actual Gemini Live feel) — VERIFIED FEASIBLE 2026-09-26, Option C — In-browser STT (private, offline), Platforms NOT recommended, Recommendation (superseded by DECISION above), TL;DR, Voice conversation mode for Astra — research findings

### Community 30 - "normalize-messages.ts"
Cohesion: 0.27
Nodes (9): ref_assert, rows10, runTests(), turns10, GATE_RE, extractAttachments(), HistoryRow, rowsToTurns() (+1 more)

### Community 32 - "astra-remote.json"
Cohesion: 0.22
Nodes (8): description, identifier, permissions, platforms, remote, urls, $schema, windows

### Community 33 - "pdf-view.tsx"
Cohesion: 0.24
Nodes (10): pdfjs-dist, PdfViewer, cachedThumb(), limit(), pdfThumb(), PdfView(), Props, running (+2 more)

### Community 34 - "GateActivity.kt"
Cohesion: 0.06
Nodes (44): Activity, android, GateActionReceiver, BroadcastReceiver, Context, Intent, GateActivity, AnimatorListenerAdapter (+36 more)

### Community 35 - ".oxlintrc.json"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 36 - "App.tsx"
Cohesion: 0.14
Nodes (17): lucide-react, App(), Shell(), Sidebar(), Status, ConfigPage(), Schema, SchemaField (+9 more)

### Community 37 - "token-tracker.tsx"
Cohesion: 0.25
Nodes (10): BeaconStatus, formatTokens(), formatUSD(), HARNESS_META, HarnessAgg, PERIODS, RecordRow, SummaryRow (+2 more)

### Community 38 - "BundleToolRow"
Cohesion: 0.35
Nodes (10): BundleToolRow(), formatDur(), stepPrefKey(), ThoughtRow(), hashKey(), load(), newestClosedStepKey(), persist() (+2 more)

### Community 39 - "source-filter.ts"
Cohesion: 0.53
Nodes (3): HUMAN_SOURCES, sourceLabel(), sourcesParam()

### Community 40 - "no-dup.check.ts"
Cohesion: 0.29
Nodes (4): B, C, E, s

### Community 41 - "subagent-panel.tsx"
Cohesion: 0.60
Nodes (4): fmtElapsed(), SubagentPanel(), SubagentRow, tailLines()

### Community 42 - "neon-flow.tsx"
Cohesion: 0.50
Nodes (4): COLORS, makeTube(), NeonFlow(), Tube

### Community 43 - "Decision: Hybrid Voice Architecture"
Cohesion: 0.50
Nodes (4): Chatterbox TTS, Decision: Hybrid Voice Architecture, Gemini Live API, Hermes Gateway

### Community 45 - "model-switch.check.ts"
Cohesion: 0.29
Nodes (5): full, m1, m2, m3, modelSwitchValue()

### Community 47 - "NtfyPushService"
Cohesion: 0.07
Nodes (24): Intent, JSONObject, NtfyPushService, WebSocketListener, WebSocketListener, Runnable, handler, IBinder (+16 more)

### Community 50 - "media-grid.tsx"
Cohesion: 0.27
Nodes (8): docIcon(), DocTile(), fmtSize(), MediaGrid(), PdfThumb(), transcodeFallback, useInView(), VideoTile()

### Community 76 - "CookieEncryptPlugin.java"
Cohesion: 0.13
Nodes (17): ExampleInstrumentedTest, CookieEncryptPlugin, ExampleUnitTest, android.content.SharedPreferences, androidx.test.ext.junit.runners.AndroidJUnit4, assert, com.getcapacitor.annotation.CapacitorPlugin, com.getcapacitor.Plugin (+9 more)

### Community 77 - "NativeNtfy.kt"
Cohesion: 0.10
Nodes (17): BootReceiver, BroadcastReceiver, Context, Intent, Plugin, PluginCall, NativeNtfy, build (+9 more)

### Community 78 - "MainActivity"
Cohesion: 0.10
Nodes (17): Bundle, Intent, MainActivity, OnBackPressedCallback, BridgeActivity, Phase C — Android (Kotlin), Non-goals, Output format (plan doc) (+9 more)

### Community 79 - "wake-probe.check.ts"
Cohesion: 0.06
Nodes (32): ref_node_assert, ref_node_child_process, ref_node_test, apply(), doneA, fin, kinds, segs (+24 more)

### Community 81 - "Findings, ranked by impact/effort"
Cohesion: 0.17
Nodes (11): 1. Block-level memoized markdown (Streamdown pattern) — HIGH impact, LOW effort, 2. rAF-batch delta ingestion — MEDIUM impact, LOW effort, 3. Virtualized history for long chats — DEFER until long-chat pain is real, 4. Worker-thread markdown/highlight — NOT YET, 5. Gateway-native affordances worth borrowing (from official docs + source), 6. Streaming flush interval knob (MUI X pattern), Astra webui — performance & capability framework research (2026-09-29), Findings, ranked by impact/effort (+3 more)

### Community 82 - "devDependencies"
Cohesion: 0.20
Nodes (10): devDependencies, oxlint, tailwindcss, @tailwindcss/vite, @types/node, @types/react, @types/react-dom, typescript (+2 more)

### Community 83 - "tool-io.ts"
Cohesion: 0.28
Nodes (12): describeInput(), describeOutput(), excerpt(), firstStrOf(), humanKey(), KEY_LABELS, LONG_KEYS, MONO_KEYS (+4 more)

### Community 84 - "outbox.ts"
Cohesion: 0.39
Nodes (7): outboxClear(), OutboxItem, outboxList(), outboxPush(), outboxRemove(), readAll(), writeAll()

### Community 85 - "tool-io.check.ts"
Cohesion: 0.08
Nodes (22): in1, in2, in3, in4, in5, in6, keys, o1 (+14 more)

### Community 88 - "replay-dedup.check.ts"
Cohesion: 0.18
Nodes (9): asst, NOTE: rowsToTurns merges consecutive assistant rows into ONE turn; separate, rows, rows2, rows3, turns, turns2, turns3 (+1 more)

### Community 89 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, preview

### Community 90 - "chat-dedup.check.ts"
Cohesion: 0.20
Nodes (8): messages, msgText, ops, opsNew, replayed, replayNew, req1, seg

### Community 91 - "verify-media.check.ts"
Cohesion: 0.07
Nodes (46): clses, drift, ok(), overflows, server, AREAS, Bento, bentoLayout() (+38 more)

### Community 92 - "tool-identity.ts"
Cohesion: 0.42
Nodes (8): browserStep(), describeTool(), excerptOf(), firstStr(), parseArgs(), parseMcp(), prettyName(), ToolInfo

### Community 93 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 103 - "ntfy.ts"
Cohesion: 0.29
Nodes (3): @capacitor/preferences, NativeNtfy, NativeNtfyPlugin

### Community 104 - "ref_node_path"
Cohesion: 0.40
Nodes (4): ref_node_path, @tailwindcss/vite, vite, @vitejs/plugin-react

### Community 107 - "ref_lib"
Cohesion: 0.12
Nodes (12): ref_lib, ChatsPanel(), SessionMeta, FileEntry, FileRow(), FilesPage(), fmtSize(), MediaViewer (+4 more)

## Knowledge Gaps
- **420 isolated node(s):** `SessionMeta`, `FileEntry`, `BakeKnobs`, `EffectDefinition`, `FocusTarget` (+415 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 624 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **42 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `react` to `pdf-view.tsx`, `package.json`, `chat-timeline.tsx`, `App.tsx`, `token-tracker.tsx`, `ws-engine.ts`, `gate-envelope.ts`, `subagent-panel.tsx`, `neon-flow.tsx`, `ref_lib`, `gateway-flow.tsx`, `tubes-background.tsx`, `main.tsx`, `media-grid.tsx`, `chat-landing.tsx`, `streaming-text.tsx`, `media-viewer.tsx`, `ai-tool-call.tsx`?**
  _High betweenness centrality (0.159) - this node is a cross-community bridge._
- **Why does `Phase B — web (src/)` connect `ws-engine.ts` to `hermes-proxy.mjs`, `App.tsx`, `NativeNtfy.kt`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `2. File-by-file change map` connect `hermes-proxy.mjs` to `MainActivity`, `ws-engine.ts`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **What connects `SessionMeta`, `FileEntry`, `BakeKnobs` to the rest of the system?**
  _420 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `hermes-proxy.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.056265984654731455 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.08695652173913043 - nodes in this community are weakly interconnected._
- **Should `chat-timeline.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.14153846153846153 - nodes in this community are weakly interconnected._