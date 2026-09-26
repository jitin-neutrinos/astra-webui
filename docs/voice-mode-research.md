# Voice conversation mode for Astra — research findings

Date: 2026-09-26. Question: can astra.jitinnair.com get a "talk to it" mode like Gemini Live?

## TL;DR

Yes, and most of the hard parts already exist on this machine. The Hermes gateway
(127.0.0.1:9119) — the same server Astra already talks to for chat — ships a complete
voice backend. The desktop app uses it today. Astra just never wired it up.

Two things to know up front:
1. This PC currently has NO microphone (only an HDMI audio echo is visible). A real
   mic (headset/USB) is needed before anyone can actually speak to it.
2. The "true Gemini-Like" always-listening mode needs an extra API key/cost decision.
   The recommended v1 works with what's already installed.

## Option A — Chained voice (RECOMMENDED v1)

Browser records your voice → speech-to-text → the existing Astra chat replies →
text-to-speech plays the reply while it's still being generated.

```
Browser mic (MediaRecorder/AudioWorklet, echoCancellation on)
  → VAD silence detect (~0.8s of silence = you finished speaking)
  → POST /api/audio/transcribe        (Hermes gateway: Whisper, already running)
  → prompt.submit to existing WS chat (surface "voice-live" → spoken-prose replies)
  → WS /api/audio/speak-stream        (Hermes gateway: chatterbox TTS, your own voice,
                                       streams audio sentence-by-sentence)
  → browser plays WAV chunks as they arrive
  → barge-in: user speaks again → stop playback, start new turn
```

Hermes gateway endpoints verified on this host (all live behind the same auth Astra
already uses):
- `POST /api/audio/transcribe` — base64 audio in, transcript out; returns empty
  transcript on silence so the loop re-listens instead of erroring.
  (`~/.hermes/hermes-agent/hermes_cli/web_routers/audio.py:77`)
- `POST /api/audio/speak`, `POST /api/audio/tts-lease`,
  `WS /api/audio/speak-stream` — sentence-streamed TTS through the configured
  chatterbox voice (custom `jitin-voice.wav`). (`audio.py:284,341,373`)
- `GET /api/audio/voice-live/status` — tells the client which engine to mount
  (`chained` | `gpt-live`). (`audio.py:167`)
- The `voice-live` surface on `prompt.submit` makes Hermes answer in speakable
  prose (no tables/tool dumps) — `tui_gateway/session_notifications.py:814`,
  `methods_prompt.py:617`. Same file already carries our local `webui` surface patch.

Latency budget (published benchmarks, chained pipelines):
- VAD end-of-speech wait: ~0.8s (unavoidable)
- STT (faster-whisper class): 20–400ms depending on local GPU/CPU
- LLM first token: 0.3–1.9s depending on model
- TTS first sentence: 60–150ms (Piper-class; chatterbox similar on GPU)
- Total first-audio: ~1.6–2.4s. Good voice products live here. Gemini Live feels
  faster mainly because it skips all these steps (see Option B).

Cost: $0 marginal. Everything reuses services already running.

Work needed:
- Astra server (server.mjs): forward `/api/hx/audio/*` REST (trivial, existing
  passthrough covers it once paths allowed) + a dedicated WS tunnel for
  `speak-stream` (same pattern as the planned `/api/pty` tunnel; per-connection,
  ws-ticket auth). NOT the shared broadcast chat socket — audio is 1:1.
- Astra frontend: mic capture component + VAD (silence detection), recorder →
  transcribe call, playback queue for streamed WAV, barge-in stop, voice-mode
  UI (mic button → listening state → speaking state), both themes, light-mode
  overrides per standing rules.
- HTTPS is already satisfied (CF tunnel) — browsers only grant microphone access
  on HTTPS or localhost.

## Option B — Full-duplex realtime (the actual Gemini Live feel) — VERIFIED FEASIBLE 2026-09-26

Verified live against Jitin's own GOOGLE_API_KEY (models list, HTTP 200, pageSize=100 —
NOTE: the default list call truncates at 50 entries alphabetically; an early probe
without pageSize hid every `*live*` model and nearly produced a false "not available".
Always pass pageSize=100 and filter on the full list):

Live-capable models visible to this key:
- gemini-2.5-flash-native-audio-latest / -preview-09-2025 / -preview-12-2025
- gemini-3.1-flash-live-preview
- gemini-3.8-live, gemini-3.8-live-extended-thinking
- gemini-3.5-transcribe-live, gemini-3.5-live-translate-preview

Architecture (the "phone line"):

```
Browser (astra.jitinnair.com, HTTPS already satisfied)
  AudioWorklet: 16kHz PCM16 mic frames, echoCancellation on
  → wss:// generativelanguage.googleapis.com Live API (native audio dialog)
      ephemeral token minted by astra server /api/gemini/live-token
      (GOOGLE_API_KEY stays server-side in ~/.config/astra-webui/env)
  ← 24kHz PCM audio out, played via AudioContext queue
  Native: VAD, turn-taking, barge-in, transcription events
  Agent bridge: native FUNCTION CALLING — declare ask_agent(prompt) to the Live
      model; astra server executes it against Hermes gateway (prompt.submit via
      the existing /api/hx WS proxy, surface webui) and returns the answer;
      the Live model speaks it. Chit-chat answers by Gemini directly; anything
      needing tools/memory rides ask_agent to the real Astra brain.
```

Session limits (Google docs, live 2026-09-26):
- Connection ~10 minutes; must reconnect via session resumption handle
  (resume window 24h, unlimited reconnects; warning arrives ~60s before end).
- Audio-only context ~15 minutes (compression extends this).
- Free tier: limited concurrent sessions + daily caps; exact numbers in
  AI Studio → rate limits. gemini-2.5-flash-native-audio is the safe
  free-tier pick; 3.x live models are previews (may need paid tier).
- Paid tier cost is per-token audio (personal use: negligible).

Why this beats every alternative for "talk to my agents": the model natively
hears/interrupts (true barge-in like Gemini Live), AND keeps the real brain —
Hermes' tools, sessions, memory — behind one function call. OpenAI's version of
this pattern exists in Hermes (tools/voice_live.py) but needs an absent key.

Implementation surface (all inside astra-webui):
1. server.mjs: GET /api/gemini/live-token → mint ephemeral token; a
   POST /api/gemini/ask-agent → Hermes turn relay (reuses existing cookie/WS
   plumbing). No new services.
2. Frontend voice overlay: mic capture + Live WS client + audio playback queue +
   session-resumption auto-reconnect; UI states listening/thinking/speaking;
   live transcript; mute/end; brand-compliant both themes.
3. Turns mirrored into the chat timeline so voice conversations leave a record.
4. Fallback: if Live quota exhausted, degrade to v1 chained mode (same UI).

Verification without hardware: this PC has NO mic. E2E can still be proven by
creating a PipeWire virtual source and playing a WAV through it (pw-cli /
pactl load-module module-loopback), asserting the loop: audio in → Live session
→ ask_agent → Hermes answer → audio out. A real mic is only needed for the
human, not for the pipeline test.

## Option C — In-browser STT (private, offline)

Whisper compiled to WebGPU/WebAssembly runs in the browser itself (~40–75MB model
download on first use, 5–12x realtime on a decent GPU). Zero server cost, audio
never leaves the device. Worth considering later to cut STT latency/network from
Option A, not as a standalone direction.
https://mojostudio.in/blog/speech-recognition-whisper-wasm-webgpu-browser-2026

## Platforms NOT recommended

LiveKit / Pipecat / Daily / Voximplant: real-time media infrastructure for
multi-party, scaled deployments. For a single-user personal UI it's a forklift to
hang a picture. Skip.

## DECISION 2026-09-26 (Jitin): chatterbox is the voice of Hermes/Astra

Chatterbox (127.0.0.1:8790, GPU, voice jitin-voice.wav) benched at ~1.1-1.2s per
sentence (~4-5x realtime, 24kHz out) — fast enough to stream speech while generating.

Constraint discovered: native-audio Live dialog models speak ONLY with Google's
built-in voices; a cloned/custom voice cannot be attached. Therefore "Gemini mouth"
is incompatible with the chatterbox voice requirement. Final split:

  EARS:   gemini-3.5-transcribe-live (in the key's model list) — streaming WS,
          continuous listening, server-side VAD/endpointing, no voice of its own.
  BRAIN:  Hermes (the real Astra agent) — every spoken turn is a real prompt.submit,
          full tools/sessions/memory; surface voice-live semantics for speakable prose.
  MOUTH:  chatterbox :8790/tts per sentence (voice jitin-voice.wav), streamed to the
          browser as sentences finish; browser AudioContext queue plays them back.
  BARGE-IN: the ears never close — speech detected during playback stops the audio
          queue and cancels pending TTS immediately (true full-duplex feel).

Voice consistency: the same chatterbox voice as Telegram voice notes, CLI TTS and
the desktop — one voice everywhere. Latency honest note: first-audio lands ~2.5-4.5s
(ears finalize + Hermes first sentence + 1.1s TTS) vs ~1s for the all-Gemini mouth;
the trade is the cloned voice + real agent brain, which is what Jitin chose.

## Recommendation (superseded by DECISION above)

Build Option A now (reuses everything, zero marginal cost, your existing chatterbox
voice), keep the UI/engine seam clean so Option B (Gemini Live via ephemeral-token
bridge) can drop in later as a second engine. Hermes' `voice-live/status` endpoint
already anticipates exactly this two-engine shape.

Sources:
- Hermes code on this host (endpoints verified live): audio.py, voice_live.py paths above
- Gemini Live API overview + getting started: https://ai.google.dev/gemini-api/docs/live
- OpenAI voice agents (chained vs realtime architecture):
  https://developers.openai.com/api/docs/guides/voice-agents
- OpenAI Realtime WebRTC: https://developers.openai.com/api/docs/guides/realtime-webrtc
- Chained-pipeline latency engineering (VAD/TTFT/TTS budgets, echo cancellation,
  common mistakes): https://mangodeveloper.com/articles/ai-voice-assistant-whisper-llm-tts
- Local voice-agent reference build with benchmarks on i7-14700K-class hardware:
  https://github.com/aryeo0908/whisper-loop
- In-browser WebGPU Whisper: https://mojostudio.in/blog/speech-recognition-whisper-wasm-webgpu-browser-2026
