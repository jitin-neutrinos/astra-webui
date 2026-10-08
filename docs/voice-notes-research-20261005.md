# Voice notes on Astra web + Android — research (2026-10-05, NO changes made)

Owner ask: send **and** receive voice notes on the web UI and the Android app.
This doc is findings only — no implementation yet.

## 1. What we already have (verified in-tree today)

### Hermes-side STT (the receiving half's brain — fully built)
- `~/.hermes/hermes-agent/tools/transcription_tools.py` + `transcription_audio.py`:
  a whole STT stack with provider dispatch (`_dispatch_stt_provider`), **local
  faster-whisper** (pinned `faster-whisper==1.2.1`, Silero VAD, lazy-dep) and
  OpenAI `whisper-1` as the cloud path. Config on THIS machine already has
  `stt: { enabled: true, language: en, local: { model: base }, openai: { model: whisper-1 } }`.
- The Telegram/messaging gateway ALREADY transcribes inbound voice notes:
  `gateway/run_inbound.py` (`_transcribe_one_clip`, `_enrich_message_with_transcription`,
  echo-on-success). Ogg/Opus voice notes are handled (container police in
  `transcription_audio.py` exists precisely for Opus).
- **The Hermes desktop app already does exactly the UX we want, end to end:**
  `apps/desktop/src/app/chat/composer/hooks/use-mic-recorder.ts` (MediaRecorder,
  mime-type pick via `isTypeSupported`, live level meter, silence detection,
  `heardSpeech` guard, friendly error copy incl. permission errors) →
  `use-composer-voice.ts` → `POST /api/audio/transcribe` (data-URL body) → text
  lands in the composer (`hermes_cli/web_routers/audio.py` on the backend).
  This is the proven reference flow to copy, not a pattern to invent.
- TTS reply direction exists (chatterbox command provider, `voice: jitin-voice.wav`,
  `/api/audio/speak`, `speak-stream` WS) — out of scope for "voice notes" but adjacent.

### astra-webui today (the surfaces we'd change)
- **Nothing audio-specific exists.** No mic, no MediaRecorder, no waveform,
  no voice bubble. `media-kinds.ts` already classifies `mp3/wav/ogg/flac/m4a/opus`
  as carded audio — so a `Received voice note` can reuse the existing audio media
  card family (`media-viewer.tsx` plays `<audio>`).
- **Upload plumbing exists and is voice-agnostic**: `startUpload()` in
  `chat-landing.tsx` POSTs FormData to `/api/hx/files/upload-stream`, gets back a
  host path, then the send path appends `Attached file: <path>` to the prompt and
  (for images) calls `image.attach`. A voice note can ride this EXACTLY as-is:
  record → Blob → File → existing tray → existing upload → text attach.
- `src/index.css.pre-tok` exists as a pre-token-optimization reference — do not
  confuse with a backup for this feature.
- Android is **Capacitor 8.5** (webDir `dist`, but `server.url` loads the LIVE site;
  assets bundling is stripped each build). Installed plugins: preferences, status-bar,
  biometric + a custom CookieEncryptPlugin. NO audio/recorder plugin yet.
  `RECORD_AUDIO` permission is NOT in the manifest (grep failed). MainActivity has a
  WebViewClient but no `onPermissionRequest` handling (needed for WebView getUserMedia).

### Server-proxy reality check
- `server.mjs` proxies `/api/hx/*` to the local Hermes gateway with the session
  cookie. There is no transcription route in astra's own server, but the gateway
  is the STT engine: two viable doors exist (…/…C below).

## 2. How voice notes can FLOW (architecture options)

### Sending (web + android → agent)
- A. **Record client-side → upload → "Attached file:" text → agent transcribes in
  turn.** Zero new server code. The agent must edit the audio file (needs STT
  tool reachable in that session's toolset — already enabled in config, but must
  be verified E2E through the astra session's toolset).
- B. **Record → client-side quick STT → send text+audio.** UI can show a live or
  final transcript; still attach the audio for context. Requires a light-weight
  STT endpoint (D).
- C. **Record → `/api/audio/transcribe` on the Hermes `serve/dashboard` backend.**
  Only works if astra can reach a `hermes serve` HTTP station (the desktop does
  this on its own backend; astra is a remote webui — it would need the station's
  URL + its auth, i.e. new config/infrastructure, OR a new astra-proxy route that
  shells out to the gateway's facilities).
- **Recommended: A for the turn itself, with a UI affordance: on stop, show a
  manual note row "…".** Cheap, robust, uses 100% existing plumbing; a follow-up
  "attach transcript automatically" can use D behind the tray.

### Receiving (agent → user, in chat)
- The agent already returns audio files as `Attached file:`-style results via
  other surfaces; in astra they land as normal messages. `media-kinds.ts` will
  route `.mp3/.ogg/.m4a/...` to the audio card. **Gap:** the timeline currently
  surfaces tool results (terminal etc.) but voice-bubble presentation for a
  REPLY audio (perceived as "your voice note reply") is a pure RENDER change in
  the message renderer, plus the agent-side habit of emitting the file path.
- Optional premium: bubble-styled voice note (duration + wave bars + native
  speed control) like WhatsApp — pure CSS/canvas, no framework needed.

## 3. External frameworks / projects worth reusing (verified live today)

| Project | What it gives | License/maintenance | Fit |
|---|---|---|---|
| `@ricky0123/vad-web` (2k stars, MIT-ish custom license, last push 2026-01) | Browser voice-activity detection (Silero ONNX), callbacks on speech segments, framework-free `micVAD.start()`; prevents sending long silences and auto-trims | Active, 30 contributors | **Use** for press-and-hold or auto-silence-stop UX on both surfaces |
| Hermes desktop `use-mic-recorder.ts` (in-repo, MIT-ish Cambria family license) | The complete recorder UX incl. mime pick, level meter, silence detector, error mapping | Already our codebase's code style | **Port it** — closest reference, same stack (React hooks + MediaRecorder) |
| Hermes `web_routers/audio.py` `POST /api/audio/transcribe` | The exact server contract (data-URL body → JSON text) proven with desktop | In-repo | The door for option C; note it lives on `serve`, not `gateway run` |
| Cap-go `@capgo/capacitor-audio-recorder` (v8, MIT, active) | Capacitor plugin with **web fallback to MediaRecorder** + Android native, requestAudioRecordingPermission API, background mode guidance | v8 maintained | **Primary Android recorder** — one JS API across both surfaces; matches our Capacitor 8.5 |
| tchvu3/capacitor-voice-recorder (120★, MIT) | Same idea, older (2020), pause/resume, canRequestPermission | stable but older API | Alternative; Cap-go is more current |
| capawesome-team capacitor-plugins `audio-recorder` | Another maintained Capacitor 7/8 option | active | Backup choice |
| `opus-media-recorder` (kbumsik) | MediaRecorder polyfill that produces **Opus in Ogg/WhatsApp-style** even where `audio/webm;codecs=opus` isn't offered | old (2019), WebAssembly | Only if we need true `.ogg/opus` on Safari/older WebView; Hermes STT already accepts webm/opus, so SKIP unless a format gap shows up in testing |
| `louisyonge/opus_android` | Native Opus record/encode/decode JNI lib | old | Skip — plugin layer handles format for us |
| Moonshine / browser WASM STT (27M–245M, CPU-class) | On-device STT in the BROWSER (no upload) | OSS, active-ish | Interesting for a "no-network" quick draft transcription UX later; NOT for v1 (server STT is already there and better) |
| `hermes-station` (keyboardstaff) | A full community web client for the gateway — possibly has voice handling worth cribbing | OSS | Only as a reading reference; our takeover is already deeper |

## 4. Android specifics that WILL matter (from Capacitor issue #6967 + docs)
- Recording on Android has two possible paths:
  1. **WebView getUserMedia** — requires the app to implement
     `onPermissionRequest` in MainActivity's WebViewClient + grant
     `android.webkit.resource.AUDIO_CAPTURE`, plus `RECORD_AUDIO` in the
     manifest. Fragile on some OEM WebViews.
  2. **Native plugin (Cap-go)** — plain `RECORD_AUDIO` + runtime permission via
     the plugin's `requestAudioRecordingPermission`. Solid, consistent API,
     web build falls back to MediaRecorder so ONE code path in React.
- The APK loads the live site (`server.url`), so ANY web-only JS change reaches
  the phone without a rebuild — but a native plugin requires an APK rebuild
  (previous sessions shipped APKs via Telegram and `assembleDebug`).
- Play-audio-in-background: not needed for notes ≤ a few minutes.

## 5. Gaps to close before implementing (the actual TODO list, in order)
1. **Android: RECORD_AUDIO + Camera/Audio permission plumbing** (manifest +
   plugin). Cap-go plugin brings its own runtime request flow.
2. **Recorder component** — port `use-mic-recorder` patterns into a
   `VoiceNoteButton` on the composer bar card (fits our new parent plate:
   mic lives in the BAR, recording visual on the plate via the trace rail we
   already own).
3. **`/api/hx/audio/transcribe` proxy route** in `server.mjs` (or perf the
   gateway's tool path) — decide door A vs C; A needs no new route at all
   (the agent just transcribes in-turn like it does for text files), C needs a
   token-scoped route into a `hermes serve` backend.
4. **Voice-note rendering for received audio** — the audio media card family
   already renders; wrap it as a bubble with duration + player (CSS only).
5. **STT E2E check for `.webm/.ogg` press on the real gateway** — the STT
   stack is untested against WebView-recorded webm/opus through the AGENT's
   file edit flow (fastest verification is a synthetic `Attached file:` send).
6. **Permissions UX** — icon affordance, "hold to record" vs "tap to record",
   re-record/cancel, min-duration guard (`heardSpeech` prevents empty sends),
   25MB cap (`_MAX_TRANSCRIPTION_UPLOAD_BYTES` if we use C).

## 6. Recommended build order (on approval)
- **Phase 1 — web only, zero new server code:** VoiceNote button on the composer
  bar (from native recorder JS via Cap-go web fallback), upload via existing
  `/api/hx/files/upload-stream`, attach text as `Voice note: <host path>`
  (plus optional transcript call via NEW astra-proxy route in a SECOND pass).
- **Phase 2 — Android:** add Cap-go plugin to the APK, rebuild, ship APK.
- **Phase 3 — receiving polish:** voice bubble renderer + wizard-aware STT
  adapter (agent tool edit vs proxy) decided by measured latency on a real
  recording; revert to whichever is faster in practice.

## 7. Explicit "not yet decided" items for the owner (do NOT guess)
- Hold-to-talk vs tap-to-record? (Silence auto-stop is recommended either way.)
- Transcript-in-bubble from the start, or voice with manual "transcribe" affordance?
- Where the STT runs: agent's own tool edit (door A, zero server change) vs a
  dedicated proxy route (door C, snappier UX)? Measure before choosing.
