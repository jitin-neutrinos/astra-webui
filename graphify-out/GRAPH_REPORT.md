# Graph Report - astra-webui  (2026-10-02)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2943 nodes · 7439 edges · 159 communities (113 shown, 46 thin omitted)
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 931 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a241f432`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- safe-tail.ts
- hermes-proxy.mjs
- package.json
- chat-timeline.tsx
- tauri.conf.json
- AppDelegate
- hermes-ws.ts
- gate-envelope.ts
- media-viewer.tsx
- transcode.mjs
- bundle.js
- compilerOptions
- gateway-flow.tsx
- tubes-background.tsx
- lib.rs
- components.json
- compilerOptions
- Astra Web UI — Light Mode Style Documentation
- 2. Content sketches
- verify-chat-timeline.ts
- components/chat-landing.tsx
- dependencies
- rename-existing-chats.py
- streaming-text.tsx
- chat-segments.ts
- backup-pre/package.json
- harness-agents.ts
- ref_react
- ref_fs
- Voice conversation mode for Astra — research findings
- ol
- Tab
- astra-remote.json
- MANIFEST.json
- GateActivity
- .oxlintrc.json
- App.tsx
- token-tracker.tsx
- BundleToolRow
- source-filter.ts
- E
- training-pipeline.check.mjs
- neon-flow.tsx
- Decision: Hybrid Voice Architecture
- re
- notify.ts
- scroll-intent.check.ts
- NtfyPushService.kt
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
- ref_node_assert
- Findings, ranked by impact/effort
- devDependencies
- doc-preview.tsx
- outbox.ts
- tool-io.check.ts
- backup-pre/chat-landing.tsx
- Verified facts about the current code — do not re-derive
- replay-dedup.check.ts
- scripts
- training.mjs
- verify-media.check.ts
- n
- gradlew
- capacitor.config.ts
- ref_capawesome_capacitor_android_edge_to_edge_support
- ref_capawesome_capacitor_navigation_bar
- t
- ref_node_fs
- server.mjs
- dependencies
- chats-panel.tsx
- registry/shadcn__command__command.tsx
- ntfy-notify.mjs
- vault-seed.mjs
- NtfyPushService
- WebSocket
- i
- backup-pre/components.json
- session-row.check.ts
- .addEventListener
- files-page.tsx
- vault-page.tsx
- wake-probe.check.ts
- concurrent-queue.check.ts
- verify-history-pagination.ts
- 2. Battery optimization recommendations (no background drop, no connectivity loss)
- devDependencies
- zd
- composer-menu.ts
- mount
- o
- start
- build-prompt.md
- main.tsx
- scripts
- delete
- BUILD — Phase A (server only): zombie reap + ?sid= filter + transcode cap
- chats-sidebar.md
- onMessage
- transcode-route.check.mjs
- CHECK THIS, IN ORDER
- end-session-training-pipeline.md
- End-session training pipeline
- review-prompt.md
- ws-engine.ts
- ws-store.ts
- GateActionReceiver.kt
- bg-items.ts
- read-sync.ts
- tool-identity.ts
- Plan — Android background chat-WS persistence + memory/storage cleanup
- Fr
- model-switch.check.ts
- wsGet
- parseMarkdown
- Wb
- fy
- table
- Kn
- progressbar
- velocitytracker

## God Nodes (most connected - your core abstractions)
1. `t()` - 174 edges
2. `n()` - 163 edges
3. `i()` - 159 edges
4. `r()` - 123 edges
5. `a()` - 95 edges
6. `E()` - 80 edges
7. `e()` - 78 edges
8. `o()` - 74 edges
9. `s()` - 67 edges
10. `c()` - 48 edges

## Surprising Connections (you probably didn't know these)
- `2.7 Pause WebView timers when backgrounded (high impact, already planned)` --references--> `NtfyPushService`  [INFERRED]
  BATTERY_AUDIT_20260930.md → android/app/src/main/java/com/jitinnair/astra/NtfyPushService.kt
- `Phase A — server (deploy-safe, no client change needed)` --references--> `handleWsUpgrade()`  [INFERRED]
  docs/plans/android-bg-chat-ws-plan.md → server/hermes-proxy.mjs
- `Changes` --references--> `handleWsUpgrade()`  [INFERRED]
  docs/plans/bg-persist-build-a.md → server/hermes-proxy.mjs
- `Constraints (ponytail — non-negotiable)` --references--> `fs()`  [INFERRED]
  docs/plans/end-session-training-pipeline.md → scratch/bundle.js
- `Gate deep links: stored sid, not live sid (commit 4740735)` --references--> `notifyGateRequest()`  [INFERRED]
  docs/gate-popup-v1.10.md → server/ntfy-notify.mjs

## Import Cycles
- 3-file cycle: `src/components/audio-player.tsx -> src/components/chat-timeline.tsx -> src/components/media-grid.tsx -> src/components/audio-player.tsx`

## Hyperedges (group relationships)
- **Voice Mode Implementation Options** — option_a_chained_voice, option_b_full_duplex, decision_hybrid_voice [EXTRACTED 1.00]

## Communities (159 total, 46 thin omitted)

### Community 1 - "hermes-proxy.mjs"
Cohesion: 0.08
Nodes (49): Components, ref_node_url, BACKOFF_TABLE, broadcastFrame(), broadcastPresence(), broadcastSessionRead(), broadcastStatus(), browserSockets (+41 more)

### Community 2 - "package.json"
Cohesion: 0.05
Nodes (39): @capacitor/android, @capacitor/assets, @capacitor/cli, @capacitor/core, @capacitor/ios, @capacitor/preferences, @capacitor/status-bar, @capgo/capacitor-native-biometric (+31 more)

### Community 3 - "chat-timeline.tsx"
Cohesion: 0.07
Nodes (48): ref_clsx, ref_dompurify, ref_marked, ref_radix_ui_react_collapsible, ref_tailwind_merge, APPROVAL_LABELS, APPROVAL_RECEIPT, ApprovalRow() (+40 more)

### Community 4 - "tauri.conf.json"
Cohesion: 0.06
Nodes (33): app, security, windows, withGlobalTauri, build, frontendDist, bundle, active (+25 more)

### Community 5 - "AppDelegate"
Cohesion: 0.09
Nodes (20): Any, Bool, Capacitor, AppDelegate, UIScene, UISceneSession, UIWindow, SceneDelegate (+12 more)

### Community 6 - "hermes-ws.ts"
Cohesion: 0.15
Nodes (13): lastSessionInfo, pokeResumeCheck(), applyTurnTruth(), EventPayload, nextReconnectDelay(), RECONNECT_BASE_MS, RECONNECT_MAX_MS, SESSION_INDEX_KEY (+5 more)

### Community 7 - "gate-envelope.ts"
Cohesion: 0.14
Nodes (18): runTests(), FinalReportCard(), GateCard(), draftKey(), FixBody, GATE_OPEN, GATE_RE, GateAction (+10 more)

### Community 8 - "media-viewer.tsx"
Cohesion: 0.12
Nodes (9): ref_yet_another_react_lightbox, AudioPlayer(), MediaViewer, usePrefersReducedMotion(), MediaViewer(), SlideAstra, SlideTypes, yet-another-react-lightbox (+1 more)

### Community 9 - "transcode.mjs"
Cohesion: 0.15
Nodes (21): ref_node_crypto, ref_node_os, cachePath(), a, CACHE_DIR, kindOf(), cleanupCb(), cookieOk() (+13 more)

### Community 10 - "bundle.js"
Cohesion: 0.02
Nodes (144): home_notjitin_work_projects_astra_webui_scratch_rolldown_runtime_c0fnf6b9_js, ref_rolldown_runtime_c0fnf6b9_js, addListener(), addWindowListener(), ae(), Av(), build(), bw() (+136 more)

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
Cohesion: 0.12
Nodes (15): answered, apply(), bigOutput, cl, cl1, clLocked, g, multi (+7 more)

### Community 20 - "components/chat-landing.tsx"
Cohesion: 0.07
Nodes (32): AttachmentTray(), BgDock(), BgDockProps, SysNoteRow(), ChatLanding(), ChatMsg, hermesHomeRef, homeP() (+24 more)

### Community 21 - "dependencies"
Cohesion: 0.06
Nodes (35): dependencies, @capacitor/android, @capacitor/assets, @capacitor/cli, @capacitor/core, @capacitor/ios, @capacitor/preferences, @capacitor/status-bar (+27 more)

### Community 22 - "rename-existing-chats.py"
Cohesion: 0.19
Nodes (12): json, os, candidates(), load_rewriter(), main(), One-time contextual rename of existing webui chats. Skips titles that are…, Resolve the rewriter's Gemini key: env first, then the systemd user environment…, title_with_gemini() (+4 more)

### Community 23 - "streaming-text.tsx"
Cohesion: 0.28
Nodes (8): CROSSFADE, StreamingText(), StreamingTextProps, StreamingTextStatus, StreamingToken, tokenize(), useStreamingText(), UseStreamingTextOptions

### Community 24 - "chat-segments.ts"
Cohesion: 0.07
Nodes (33): apply(), doneA, fin, kinds, segs, segTimingProbe(), texts, thinks (+25 more)

### Community 25 - "backup-pre/package.json"
Cohesion: 0.05
Nodes (39): @capacitor/android, @capacitor/assets, @capacitor/cli, @capacitor/core, @capacitor/ios, @capacitor/preferences, @capacitor/status-bar, @capgo/capacitor-native-biometric (+31 more)

### Community 26 - "harness-agents.ts"
Cohesion: 0.23
Nodes (8): AGENT_FLAGS, merged, detectHarness(), HARNESS_BINARIES, HarnessRow, harnessRowFromToolStart(), mergeRoster(), WHY: `subagent.list` (gateway RPC) only knows Hermes `delegate_task` children.

### Community 27 - "ref_react"
Cohesion: 0.07
Nodes (24): ref_lib, @radix-ui/react-popover, @radix-ui/react-scroll-area, @radix-ui/react-separator, @radix-ui/react-switch, @radix-ui/react-tooltip, ref_react, ShineBorderProps (+16 more)

### Community 28 - "ref_fs"
Cohesion: 0.04
Nodes (32): content, fs, content, fs, content, fs, ref_fs, cmd (+24 more)

### Community 29 - "Voice conversation mode for Astra — research findings"
Cohesion: 0.22
Nodes (8): DECISION 2026-09-26 (Jitin): chatterbox is the voice of Hermes/Astra, Option A — Chained voice (RECOMMENDED v1), Option B — Full-duplex realtime (the actual Gemini Live feel) — VERIFIED FEASIBLE 2026-09-26, Option C — In-browser STT (private, offline), Platforms NOT recommended, Recommendation (superseded by DECISION above), TL;DR, Voice conversation mode for Astra — research findings

### Community 30 - "ol"
Cohesion: 0.05
Nodes (102): aa(), ac(), add(), al(), Ao(), ba(), bc(), be() (+94 more)

### Community 32 - "astra-remote.json"
Cohesion: 0.22
Nodes (8): description, identifier, permissions, platforms, remote, urls, $schema, windows

### Community 33 - "MANIFEST.json"
Cohesion: 0.06
Nodes (32): magicui/border-beam, deps, files, regdeps, magicui/shine-border, deps, files, regdeps (+24 more)

### Community 34 - "GateActivity"
Cohesion: 0.07
Nodes (37): Activity, android, GateActivity, AnimatorListenerAdapter, TextWatcher, Bundle, Intent, JSONObject (+29 more)

### Community 35 - ".oxlintrc.json"
Cohesion: 0.33
Nodes (5): plugins, rules, react/only-export-components, react/rules-of-hooks, $schema

### Community 36 - "App.tsx"
Cohesion: 0.14
Nodes (19): ref_lucide_react, Shell(), Sidebar(), Status, ApprovalsPage(), formatRelative(), GateCard(), ConfigPage() (+11 more)

### Community 37 - "token-tracker.tsx"
Cohesion: 0.25
Nodes (10): BeaconStatus, formatTokens(), formatUSD(), HARNESS_META, HarnessAgg, PERIODS, RecordRow, SummaryRow (+2 more)

### Community 38 - "BundleToolRow"
Cohesion: 0.35
Nodes (10): BundleToolRow(), formatDur(), stepPrefKey(), ThoughtRow(), hashKey(), load(), newestClosedStepKey(), persist() (+2 more)

### Community 39 - "source-filter.ts"
Cohesion: 0.43
Nodes (4): HUMAN_SOURCES, sourceLabel(), SourceModal, sourcesParam()

### Community 40 - "E"
Cohesion: 0.10
Nodes (70): A(), ap(), Au(), b(), bt(), C(), cD(), Ch() (+62 more)

### Community 41 - "training-pipeline.check.mjs"
Cohesion: 0.06
Nodes (29): ref_node_child_process, ref_node_http, ref_node_net, buf, key, sock, timer, cfg (+21 more)

### Community 42 - "neon-flow.tsx"
Cohesion: 0.50
Nodes (4): COLORS, makeTube(), NeonFlow(), Tube

### Community 43 - "Decision: Hybrid Voice Architecture"
Cohesion: 0.50
Nodes (4): Chatterbox TTS, Decision: Hybrid Voice Architecture, Gemini Live API, Hermes Gateway

### Community 45 - "notify.ts"
Cohesion: 0.06
Nodes (41): 1. What Astra actually needs (gap analysis), 2. The recommended architecture (layered, minimal-first), 3. Why the famous names don't fit, 4. Sequenced plan, Astra multi-device / multi-session chat — framework research (2026-10-01), Layer 1 — server-authoritative read state (finish what's started), Layer 2 — TinyBase for multi-tab + client-state sync, Layer 3 — per-tab concurrent sessions (small protocol change, no framework) (+33 more)

### Community 47 - "NtfyPushService.kt"
Cohesion: 0.09
Nodes (22): BootReceiver, BroadcastReceiver, Context, Intent, Intent, bitmapfactory, build, contextcompat (+14 more)

### Community 50 - "media-grid.tsx"
Cohesion: 0.14
Nodes (18): ref_pdfjs_dist, cachedThumb(), ensurePdfWorker(), limit(), pdfThumb(), PdfView(), Props, running (+10 more)

### Community 76 - "CookieEncryptPlugin.java"
Cohesion: 0.13
Nodes (17): ExampleInstrumentedTest, CookieEncryptPlugin, ExampleUnitTest, android.content.SharedPreferences, androidx.test.ext.junit.runners.AndroidJUnit4, assert, com.getcapacitor.annotation.CapacitorPlugin, com.getcapacitor.Plugin (+9 more)

### Community 77 - "NativeNtfy.kt"
Cohesion: 0.13
Nodes (13): Plugin, PluginCall, NativeNtfy, CapacitorPlugin, Phase B — web (src/), intent, jsobject, manifest (+5 more)

### Community 78 - "MainActivity"
Cohesion: 0.09
Nodes (18): Bundle, Intent, MainActivity, OnBackPressedCallback, 1B. WebView timer / rendering while backgrounded (medium impact), BridgeActivity, Phase C — Android (Kotlin), Non-goals (+10 more)

### Community 79 - "ref_node_assert"
Cohesion: 0.11
Nodes (14): ref_node_assert, b, kt, src, ctx, msgCompleteS1, msgDeltaS1, msgErrorS2 (+6 more)

### Community 81 - "Findings, ranked by impact/effort"
Cohesion: 0.17
Nodes (11): 1. Block-level memoized markdown (Streamdown pattern) — HIGH impact, LOW effort, 2. rAF-batch delta ingestion — MEDIUM impact, LOW effort, 3. Virtualized history for long chats — DEFER until long-chat pain is real, 4. Worker-thread markdown/highlight — NOT YET, 5. Gateway-native affordances worth borrowing (from official docs + source), 6. Streaming flush interval knob (MUI X pattern), Astra webui — performance & capability framework research (2026-09-29), Findings, ranked by impact/effort (+3 more)

### Community 82 - "devDependencies"
Cohesion: 0.20
Nodes (10): devDependencies, oxlint, tailwindcss, @tailwindcss/vite, @types/node, @types/react, @types/react-dom, typescript (+2 more)

### Community 83 - "doc-preview.tsx"
Cohesion: 0.10
Nodes (12): ref_docx_preview, ref_pptx_preview, ref_xlsx, DocPreview(), DocPreviewProps, DocxViewer, PdfViewer, PptxViewer (+4 more)

### Community 84 - "outbox.ts"
Cohesion: 0.39
Nodes (7): outboxClear(), OutboxItem, outboxList(), outboxPush(), outboxRemove(), readAll(), writeAll()

### Community 85 - "tool-io.check.ts"
Cohesion: 0.07
Nodes (36): in1, in2, in3, in4, in5, in6, keys, o1 (+28 more)

### Community 86 - "backup-pre/chat-landing.tsx"
Cohesion: 0.08
Nodes (27): ref_assets, ref_bg_dock, ref_chat_timeline, ref_components, ref_gates_gate_envelope, ref_media_grid, ref_subagent_panel, ref_toast_host (+19 more)

### Community 87 - "Verified facts about the current code — do not re-derive"
Cohesion: 0.24
Nodes (7): NON-GOALS — out of scope, do not touch, REPO, Verified facts about the current code — do not re-derive, 4. Behaviour preservation — the real risk, parseCommand(), ParsedCommand, send()

### Community 88 - "replay-dedup.check.ts"
Cohesion: 0.13
Nodes (17): rows10, runTests(), turns10, Segment, extractAttachments(), HistoryRow, rowsToTurns(), Turn (+9 more)

### Community 89 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, preview

### Community 90 - "training.mjs"
Cohesion: 0.17
Nodes (28): buildReviewPrompt(), deleteSessionViaGateway(), __dirname, docInventory(), dumpAndReview(), finishReview(), gatewayCookie(), gatewayReq() (+20 more)

### Community 91 - "verify-media.check.ts"
Cohesion: 0.07
Nodes (49): clses, drift, ok(), overflows, server, AREAS, Bento, bentoLayout() (+41 more)

### Community 92 - "n"
Cohesion: 0.09
Nodes (63): attachTimeline(), bl(), Bp(), bu(), checkbox(), codespan(), componentDidMount(), componentDidUpdate() (+55 more)

### Community 93 - "gradlew"
Cohesion: 0.83
Nodes (3): gradlew script, die(), warn()

### Community 103 - "t"
Cohesion: 0.07
Nodes (61): an(), as(), ay(), blockTokens(), bs(), cn(), cs(), ds() (+53 more)

### Community 104 - "ref_node_fs"
Cohesion: 0.06
Nodes (30): ref_node_fs, ref_node_path, ref_node_sqlite, ref_tailwindcss_vite, ref_vite, ref_vitejs_plugin_react, db, dir (+22 more)

### Community 105 - "server.mjs"
Cohesion: 0.14
Nodes (29): gateStats(), listGates(), allMarks(), readStateVersion(), attempts, checkPassword(), DIST, makeToken() (+21 more)

### Community 106 - "dependencies"
Cohesion: 0.07
Nodes (27): dependencies, @capacitor/android, @capacitor/assets, @capacitor/cli, @capacitor/core, @capacitor/ios, @capacitor/preferences, @capacitor/status-bar (+19 more)

### Community 107 - "chats-panel.tsx"
Cohesion: 0.09
Nodes (14): ref_motion, BorderBeamProps, BorderBeamProps, ChatsPanel(), FILTERS, fmtTok(), fmtUsd(), GlyphFC (+6 more)

### Community 108 - "registry/shadcn__command__command.tsx"
Cohesion: 0.09
Nodes (17): cmdk, @radix-ui/react-dialog, ref_registry, Command, CommandEmpty, CommandGroup, CommandInput, CommandItem (+9 more)

### Community 109 - "ntfy-notify.mjs"
Cohesion: 0.16
Nodes (16): ref_node_https, res, enrichGate(), SEVERITY_KEYWORDS, SEVERITY_ORDER, answerGateHelper(), appendToLedger(), gatherQuestions() (+8 more)

### Community 110 - "vault-seed.mjs"
Cohesion: 0.17
Nodes (16): acceptable(), bareKey(), collect(), describe(), DRY, HOME, KEY_PURPOSE, KEY_SERVICE (+8 more)

### Community 111 - "NtfyPushService"
Cohesion: 0.11
Nodes (14): ChatState, JSONObject, NtfyPushService, Runnable, SessionInfo, androidx, 1. Confirmed battery drain sources (evidence-backed), 1A. NtfyPushService — TWO persistent sockets, ONE service (high impact) (+6 more)

### Community 112 - "WebSocket"
Cohesion: 0.26
Nodes (5): WebSocketListener, WebSocketListener, Response, WebSocket, WebSocketListener

### Community 113 - "i"
Cohesion: 0.10
Nodes (50): home_notjitin_work_projects_astra_webui_scratch_prune_usi4ib8o_js, ah(), am(), bg(), Bm(), s(), Dc(), ee() (+42 more)

### Community 114 - "backup-pre/components.json"
Cohesion: 0.12
Nodes (16): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+8 more)

### Community 115 - "session-row.check.ts"
Cohesion: 0.20
Nodes (11): merged, p1, p2, rows, yearsAgo, mergeRows(), rowKey(), rowTime() (+3 more)

### Community 116 - ".addEventListener"
Cohesion: 0.08
Nodes (41): at(), Aw(), blockquote(), cb(), Cv(), Cw(), db(), dt() (+33 more)

### Community 117 - "files-page.tsx"
Cohesion: 0.11
Nodes (15): FileEntry, FilesPage(), FilterId, fmtSize(), GalleryCard(), GallerySection(), isDoc(), KIND_FILTERS (+7 more)

### Community 118 - "vault-page.tsx"
Cohesion: 0.23
Nodes (10): api(), CATEGORY_TAB, fmtUpdated(), Tab, TABS, VaultEntry, VaultPage(), loadData() (+2 more)

### Community 119 - "wake-probe.check.ts"
Cohesion: 0.17
Nodes (7): { __eng }, fakeSock, kept, sent, sock2, Timer, timers

### Community 120 - "concurrent-queue.check.ts"
Cohesion: 0.21
Nodes (9): loadQueue(), localKV, makeKV(), now, Prompt, saveQueue(), sessionOf(), sharedLocal (+1 more)

### Community 121 - "verify-history-pagination.ts"
Cohesion: 0.17
Nodes (10): ref_assert, all, badPage, deduped, held, page1, page2, page3 (+2 more)

### Community 122 - "2. Battery optimization recommendations (no background drop, no connectivity loss)"
Cohesion: 0.12
Nodes (14): 2.2 Coalesce reconnect attempts between sockets (high impact, low risk), 2.3 Delay / suppress chat notifications for brief disconnects (medium impact, low risk), 2.4 Batch notification updates (medium impact, low risk), 2.5 Reduce ping frequency for idle sockets (medium impact, low risk), 2.6 Cache `resolveSessionInfo()` results (high impact, low risk), 2.7 Pause WebView timers when backgrounded (high impact, already planned), 2.8 Batch cookie reads (low risk), 2. Battery optimization recommendations (no background drop, no connectivity loss) (+6 more)

### Community 123 - "devDependencies"
Cohesion: 0.20
Nodes (10): devDependencies, oxlint, tailwindcss, @tailwindcss/vite, @types/node, @types/react, @types/react-dom, typescript (+2 more)

### Community 124 - "zd"
Cohesion: 0.09
Nodes (38): addValue(), Ai(), Bd(), bi(), bindToMotionValue(), Di(), ep(), ff() (+30 more)

### Community 125 - "composer-menu.ts"
Cohesion: 0.22
Nodes (4): Catalog, EFFORTS, ModelGroup, TUI_COMMANDS

### Community 126 - "mount"
Cohesion: 0.08
Nodes (31): Ag(), createPanHandlers(), getSize(), getSnapshotBeforeUpdate(), handleChildMotionValue(), hide(), iv(), kg() (+23 more)

### Community 127 - "o"
Cohesion: 0.13
Nodes (28): af(), br(), cf(), Cr(), De(), df(), fp(), getDefaultTransition() (+20 more)

### Community 128 - "start"
Cohesion: 0.18
Nodes (26): addListeners(), cancel(), clear(), clearAnimation(), clearListeners(), commitStyles(), destroy(), endPanSession() (+18 more)

### Community 129 - "build-prompt.md"
Cohesion: 0.18
Nodes (10): COMPONENTS TO INSTALL — verbatim registry code, do not handroll, do not rewrite, FORCED OUTPUT / DELIVERABLES, R1 — One menu system, not two, R2 — Two levels maximum, never three, R3 — Composer layout rebuild, R4 — Surfaces, colour, type, R5 — Motion. Use exactly this set., R6 — Interaction & accessibility (all of it, not a subset) (+2 more)

### Community 130 - "main.tsx"
Cohesion: 0.10
Nodes (16): BUILD — Phase B (web only): wake probes + native session bridge + storage prune, Changes, Done condition, ref_capacitor_core, ref_capacitor_preferences, ref_react_dom, App(), src_index (+8 more)

### Community 131 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, preview

### Community 132 - "delete"
Cohesion: 0.12
Nodes (23): Ad(), addVariantChild(), bh(), Ci(), delete(), ef(), getClosestVariantNode(), gh() (+15 more)

### Community 133 - "BUILD — Phase A (server only): zombie reap + ?sid= filter + transcode cap"
Cohesion: 0.50
Nodes (3): BUILD — Phase A (server only): zombie reap + ?sid= filter + transcode cap, Changes, Done condition

### Community 136 - "onMessage"
Cohesion: 0.21
Nodes (22): applyReplyTruth(), armQueuedCap(), armWatchdog(), attachHandlers(), bumpConn(), emit(), flushPendingPreTurnRpcs(), flushQueueForSession() (+14 more)

### Community 137 - "transcode-route.check.mjs"
Cohesion: 0.10
Nodes (7): branch(), child, fakeRes(), r, HERE, HOME, validToken()

### Community 138 - "CHECK THIS, IN ORDER"
Cohesion: 0.20
Nodes (10): 10. Code quality, 1. Build gate, 2. Regression: the check files, 3. Dead code, 5. AnimatePresence correctness, 6. Reduced motion, 7. Accessibility — check the code, name the line, 8. Theme + responsive (+2 more)

### Community 139 - "end-session-training-pipeline.md"
Cohesion: 0.29
Nodes (6): Constraints (ponytail — non-negotiable), Non-goals, Output format (exact), Requirements, Role, Verified product context (frozen facts — do not re-verify, do not guess

### Community 140 - "End-session training pipeline"
Cohesion: 0.22
Nodes (8): Deploy verification trap, End ≠ new chat (owner 2026-10-01, fixed + deployed), End-session training pipeline, Flow, Live audit (2026-10-01, all clean), Pitfalls proven the hard way (2026-10-01), Verify, close()

### Community 141 - "review-prompt.md"
Cohesion: 0.33
Nodes (5): OUTPUT, REPO, ROLE, RULES, WHAT WAS BUILT

### Community 142 - "ws-engine.ts"
Cohesion: 0.17
Nodes (19): pushLiveSession(), setActiveSession(), addListener(), clearQueuedCap(), clearWatchdog(), connect(), __eng, Engine (+11 more)

### Community 143 - "ws-store.ts"
Cohesion: 0.16
Nodes (16): ref_zustand, BANNER_AFTER_MS, bannerVisible(), ConnEvent, ConnState, fmtSeconds(), nextConnState(), RESTORED_MS (+8 more)

### Community 144 - "GateActionReceiver.kt"
Cohesion: 0.13
Nodes (15): GateActionReceiver, BroadcastReceiver, Context, Intent, Android notifications v1.11 (2026-10-01), Traps, What changed (versionCode 15, commits 49cab25 + b289a32), jsonobject (+7 more)

### Community 145 - "bg-items.ts"
Cohesion: 0.22
Nodes (13): ref_node_test, BgItem, BgItemKind, BgItemStatus, createItem(), dismissItem(), dockVisible(), key() (+5 more)

### Community 146 - "read-sync.ts"
Cohesion: 0.21
Nodes (8): tinybase, deviceId(), pullServerMarks(), readStore, setPresenceFocus(), startServerSync(), startTabSync(), store

### Community 147 - "tool-identity.ts"
Cohesion: 0.32
Nodes (11): browserStep(), describeTool(), excerptOf(), fileTail(), firstStr(), hostOf(), parseArgs(), parseMcp() (+3 more)

### Community 148 - "Plan — Android background chat-WS persistence + memory/storage cleanup"
Cohesion: 0.18
Nodes (10): 0. Recon corrections (facts that change the design), 1. Architecture — who holds which socket, 2. File-by-file change map, 3. Auth/ticket flow — native chat socket, 4. Notification dedupe rules (vs ntfy gates), 5. Per-requirement test checklist (R1–R10), 6. Top-3 risks + mitigations, 7. Build order (agy) (+2 more)

### Community 149 - "Fr"
Cohesion: 0.22
Nodes (10): bn(), Dr(), Fr(), Ir(), Lr(), Or(), Pr(), Rr() (+2 more)

### Community 150 - "model-switch.check.ts"
Cohesion: 0.22
Nodes (7): full, m1, m2, m3, modelSwitchValue(), applySessionInfo(), mergeSessionInfo()

### Community 151 - "wsGet"
Cohesion: 0.47
Nodes (9): useHermesWS(), interrupt(), readStoredSid(), retryConnection(), rpc(), sendApprovalResponse(), submitBg(), submitSteer() (+1 more)

### Community 152 - "parseMarkdown"
Cohesion: 0.25
Nodes (8): onError(), parseMarkdown(), postprocess(), preprocess(), processAllTokens(), provideLexer(), provideParser(), walkTokens()

### Community 153 - "Wb"
Cohesion: 0.40
Nodes (6): Bb(), Hb(), jb(), qb(), Vb(), Wb()

### Community 154 - "fy"
Cohesion: 0.67
Nodes (3): dy(), fy(), py()

### Community 155 - "table"
Cohesion: 0.67
Nodes (3): table(), tablecell(), tablerow()

## Knowledge Gaps
- **789 isolated node(s):** `BorderBeamProps`, `BorderBeamProps`, `GlyphFC`, `FileEntry`, `FilterId` (+784 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 1143 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **46 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `g` connect `verify-chat-timeline.ts` to `start`?**
  _High betweenness centrality (0.148) - this node is a cross-community bridge._
- **Why does `addListeners()` connect `start` to `t`, `E`, `bundle.js`, `i`, `verify-chat-timeline.ts`, `.addEventListener`, `n`, `o`?**
  _High betweenness centrality (0.148) - this node is a cross-community bridge._
- **Why does `d()` connect `E` to `delete`, `t`, `training-pipeline.check.mjs`, `bundle.js`, `i`, `.addEventListener`, `zd`, `o`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **Are the 113 inferred relationships involving `t()` (e.g. with `Ai()` and `al()`) actually correct?**
  _`t()` has 113 INFERRED edges - model-reasoned connections that need verification._
- **Are the 109 inferred relationships involving `n()` (e.g. with `A()` and `al()`) actually correct?**
  _`n()` has 109 INFERRED edges - model-reasoned connections that need verification._
- **Are the 57 inferred relationships involving `i()` (e.g. with `ac()` and `am()`) actually correct?**
  _`i()` has 57 INFERRED edges - model-reasoned connections that need verification._
- **Are the 97 inferred relationships involving `r()` (e.g. with `A()` and `am()`) actually correct?**
  _`r()` has 97 INFERRED edges - model-reasoned connections that need verification._