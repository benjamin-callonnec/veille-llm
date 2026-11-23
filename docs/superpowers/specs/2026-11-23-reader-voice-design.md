# Reader voice: speech to text and text to speech (#26)

## What is real, what is plumbing

| Piece | Status |
| --- | --- |
| Dictation in the composer (push to talk, live partial, editable final text) | Real, browser Web Speech API |
| Read an answer aloud, sentence by sentence while it streams, stop and replay | Real, browser `speechSynthesis` |
| Strip citations, markdown, code and the quiz marker from what is spoken | Real |
| `/api/voice` WebSocket (framing, limits, origin check, engine interface) | Real server side and tested, but **not used by the UI yet** |
| `VoiceSocket` client (reconnection with backoff, clear errors) | Real and tested with a fake socket, not wired into a component |
| A local STT/TTS engine behind the WebSocket | Not built: only `NoEngine` (default) and a test `EchoEngine` |

Why: the Web Speech API runs entirely in the browser, so it needs no server round trip. The WebSocket only
earns its keep once a local model runs in the Python module. Building the channel and its protocol now
means that plugging a model in later is one class, not a redesign.

## UI decisions

- The microphone is a quiet icon left of the send area, shown only when the browser supports speech
  recognition and the tutor is not answering. The "+" stays reserved for attachments.
- Push to talk is a toggle (click to start, click to stop). Holding a button is hostile to keyboard and
  touch users, and dictating a paragraph while holding a button is tiring. The permission prompt appears
  on that first click only; nothing listens before.
- The live partial phrase appears inside the textarea (not a separate widget). Sure phrases are appended to
  the text; typing, sending or leaving stops the microphone, and an unfinished phrase is kept.
- A speaker icon sits in the row of actions of each answer, with a stop icon while it reads. Clicking again
  after it finished replays from the start. A reading started during streaming continues as sentences
  complete; when the stream ends the rest is spoken. One voice at a time in the page.
- Errors are one quiet line under the composer: microphone blocked, nothing heard, no connection, other.
- No new tokens: the listening state reuses `--dot-red`, so light, dark and Papier all work.

## Privacy, honestly

Chrome and Edge implement `SpeechRecognition` by sending the audio to the vendor's speech service. That
is not local and not zero-knowledge, even though it costs nothing. Safari uses on-device or Apple
recognition depending on the setting; Firefox has no recognition (the mic icon is hidden there).
`speechSynthesis` is local. The reader never records or stores audio; the browser engine hands us words.
If privacy matters more than convenience, use the local engine below once it exists.

## WebSocket protocol (version 1)

`ws://127.0.0.1:<port>/api/voice`. Control frames are JSON text, audio is binary PCM16 mono.

- Server on connect: `{type:"hello", protocol, stt, tts}` (both false when no engine is configured).
- Client: `start_stt {rate}`, binary audio frames, `stop_stt`, `speak {id, text}`, `cancel {id}`, `ping`.
- Server: `ready`, `partial {text}`, `final {text}`, `audio_start {id, format, rate}`, binary audio,
  `audio_end {id}`, `cancelled {id}`, `pong`, `error {code, message}`.
- Limits: control frame 8 kB, audio frame 64 kB, utterance 60 s of audio, `speak` text 2000 characters,
  30 control messages per second. Oversized frames and rate abuse are fatal (close 1008); others are
  an `error` frame and the socket stays open.
- Only a loopback `Host` and the same origin (or a configured dev origin, and a non-cross-site
  `Sec-Fetch-Site`) are accepted. The check is made before accepting the upgrade (close 1008), because the
  HTTP middleware does not see WebSockets.
- Audio is held in memory for an utterance and dropped on stop or disconnect. Nothing is written to disk
  (tested).
- The client reconnects with a delay that doubles from 0.5 s to 8 s, five attempts, then reports that the
  channel is unreachable. A policy refusal is not retried.
- `uvicorn` needs a WebSocket library: `websockets` was added to the `reader` group.

## Evaluation of local engines (not adopted yet)

Recommendation: when the browser path is not good enough, add **whisper.cpp** for STT first, and keep the
browser voice for TTS. Reasons below are from knowledge of these projects, not from a benchmark run here.

- **whisper.cpp** (MIT, C++, Metal/CoreML on Apple Silicon): `base` or `small` models run well above
  real time on an M-series Mac, good English and French. It transcribes chunks, not true streaming: live
  partials come from re-transcribing a sliding window, so partials are rougher than Chrome's. Needs a
  model download (75 MB to 500 MB) and either a subprocess (`whisper-server`) or a Python binding. This is
  the best fit for `VoiceEngine.start_stt`.
- **faster-whisper / mlx-whisper**: similar quality, Python-native; heavier dependencies (CTranslate2 or
  MLX). Easier to embed, but "no heavy model dependency" argues for the subprocess route first.
- **piper** (MIT, ONNX, CPU): fast, natural enough voices in English and French, a model is about 60 MB.
  Streams sentence by sentence naturally, which matches the queue. Good fit for `synthesize`, but the
  macOS system voices (`speechSynthesis`) are already decent and free, so TTS is the lower priority.
- **Kokoro / larger neural TTS**: better voices, heavier runtime; not worth it for reading answers.

Open decisions for later: where models live (`.local/reader/models`, never committed), how the engine
is chosen (a `--voice-engine` option of `veille-reader serve`), and whether the UI prefers the local
engine when `hello` reports `stt: true`.
