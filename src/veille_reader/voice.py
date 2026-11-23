"""Voice channel of the local reader: one WebSocket carrying audio in and out.

The protocol is small and strict. Control messages are JSON text frames, audio is binary frames
of 16-bit mono PCM. Nothing is ever written to disk: audio lives in memory for the length of an
utterance. The engine behind it is a tiny interface (`VoiceEngine`) so a local model (whisper.cpp,
piper...) can be plugged in later. With no engine configured the browser does the speech itself;
see docs/superpowers/specs/2026-11-23-reader-voice-design.md. `EchoEngine` is a test double.
"""

import asyncio
import json
import time
from collections import deque
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Protocol

from fastapi import WebSocket
from starlette.websockets import WebSocketDisconnect

PROTOCOL = 1
MAX_TEXT_FRAME = 8192  # bytes of one JSON control frame
MAX_AUDIO_FRAME = 65536  # bytes of one audio frame
MAX_UTTERANCE_SECONDS = 60
MAX_SPEAK_CHARS = 2000
MIN_RATE, MAX_RATE = 8000, 48000
OUT_RATE = 16000
RATE_LIMIT = 30  # control messages per second
CLOSE_POLICY = 1008


class VoiceError(Exception):
    """A refused message: sent to the client as an `error` frame; a fatal one also closes."""

    def __init__(self, code: str, message: str, fatal: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.fatal = fatal

    def frame(self) -> dict:
        return {"type": "error", "code": self.code, "message": self.message}


class SttSession(Protocol):
    def feed(self, chunk: bytes) -> str | None:
        """Take audio, return the transcript so far (a partial) or None."""

    def finish(self) -> str:
        """The final transcript; the session is over."""


class VoiceEngine(Protocol):
    def start_stt(self, rate: int) -> SttSession: ...

    def synthesize(self, text: str) -> Iterator[bytes]:
        """Yield PCM16 mono chunks at OUT_RATE."""


class _EchoStt:
    def __init__(self) -> None:
        self._heard = bytearray()

    def feed(self, chunk: bytes) -> str | None:
        self._heard += chunk
        return self._heard.decode("utf-8", errors="replace")

    def finish(self) -> str:
        return self._heard.decode("utf-8", errors="replace")


class EchoEngine:
    """Test engine: the "audio" is the UTF-8 text itself, in and out. Not a real recogniser."""

    def start_stt(self, rate: int) -> SttSession:
        return _EchoStt()

    def synthesize(self, text: str) -> Iterator[bytes]:
        data = text.encode("utf-8")
        for i in range(0, len(data), 8):
            yield data[i : i + 8]


@dataclass(frozen=True)
class Speak:
    id: int
    text: str


@dataclass(frozen=True)
class Cancel:
    id: int


Out = dict | Speak | Cancel


class VoiceSession:
    """The protocol state of one connection, free of any I/O so it is easy to test."""

    def __init__(
        self, engine: VoiceEngine | None, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.engine = engine
        self._clock = clock
        self._stamps: deque[float] = deque()
        self._stt: SttSession | None = None
        self._received = 0
        self._limit = 0

    def hello(self) -> dict:
        has = self.engine is not None
        return {"type": "hello", "protocol": PROTOCOL, "stt": has, "tts": has}

    def _need_engine(self) -> VoiceEngine:
        if self.engine is None:
            raise VoiceError("no_engine", "No speech engine is configured on the server.")
        return self.engine

    def _throttle(self) -> None:
        now = self._clock()
        while self._stamps and now - self._stamps[0] >= 1.0:
            self._stamps.popleft()
        self._stamps.append(now)
        if len(self._stamps) > RATE_LIMIT:
            raise VoiceError("rate_limited", "Too many messages.", fatal=True)

    def on_text(self, raw: str) -> list[Out]:
        if len(raw.encode("utf-8")) > MAX_TEXT_FRAME:
            raise VoiceError("frame_too_large", "Control frame too large.", fatal=True)
        self._throttle()
        try:
            msg = json.loads(raw)
        except ValueError:
            raise VoiceError("bad_frame", "Not valid JSON.") from None
        if not isinstance(msg, dict) or not isinstance(msg.get("type"), str):
            raise VoiceError("bad_frame", "A frame is an object with a type.")
        kind = msg["type"]
        if kind == "ping":
            return [{"type": "pong"}]
        if kind == "start_stt":
            return self._start(msg)
        if kind == "stop_stt":
            return self._stop()
        if kind == "speak":
            return [self._speak(msg)]
        if kind == "cancel":
            return [Cancel(self._id(msg))]
        raise VoiceError("unknown_type", f"Unknown message type: {kind[:40]}")

    @staticmethod
    def _id(msg: dict) -> int:
        value = msg.get("id")
        if not isinstance(value, int) or isinstance(value, bool):
            raise VoiceError("bad_frame", "id must be an integer.")
        return value

    def _start(self, msg: dict) -> list[Out]:
        engine = self._need_engine()
        if self._stt is not None:
            raise VoiceError("already_listening", "Already listening.")
        rate = msg.get("rate")
        if not isinstance(rate, int) or not MIN_RATE <= rate <= MAX_RATE:
            raise VoiceError("bad_rate", f"rate must be between {MIN_RATE} and {MAX_RATE}.")
        self._stt = engine.start_stt(rate)
        self._received = 0
        self._limit = rate * 2 * MAX_UTTERANCE_SECONDS
        return [{"type": "ready"}]

    def _stop(self) -> list[Out]:
        if self._stt is None:
            raise VoiceError("not_listening", "Not listening.")
        stt, self._stt = self._stt, None
        return [{"type": "final", "text": stt.finish()}]

    def _speak(self, msg: dict) -> Speak:
        self._need_engine()
        ident = self._id(msg)
        text = msg.get("text")
        if not isinstance(text, str) or not text.strip():
            raise VoiceError("bad_frame", "text is required.")
        if len(text) > MAX_SPEAK_CHARS:
            raise VoiceError("too_long", f"At most {MAX_SPEAK_CHARS} characters at a time.")
        return Speak(ident, text)

    def on_bytes(self, chunk: bytes) -> list[Out]:
        if len(chunk) > MAX_AUDIO_FRAME:
            raise VoiceError("frame_too_large", "Audio frame too large.", fatal=True)
        if self._stt is None:
            raise VoiceError("not_listening", "Start listening before sending audio.")
        self._received += len(chunk)
        if self._received > self._limit:
            self._stt = None
            raise VoiceError("utterance_too_long", "That utterance is too long.")
        partial = self._stt.feed(chunk)
        return [{"type": "partial", "text": partial}] if partial is not None else []

    def synthesize(self, text: str) -> Iterator[bytes]:
        return self._need_engine().synthesize(text)

    def close(self) -> None:
        """Drop any audio held for an utterance that never ended."""
        self._stt = None


async def serve(ws: WebSocket, engine: VoiceEngine | None) -> None:
    """Run one accepted connection until it closes."""
    session = VoiceSession(engine)
    send_lock = asyncio.Lock()
    speaking: dict[int, asyncio.Task] = {}

    async def send(frame: dict | bytes) -> None:
        async with send_lock:
            if isinstance(frame, bytes):
                await ws.send_bytes(frame)
            else:
                await ws.send_text(json.dumps(frame))

    async def speak(item: Speak) -> None:
        try:
            await send({"type": "audio_start", "id": item.id, "format": "pcm16", "rate": OUT_RATE})
            for chunk in session.synthesize(item.text):
                await send(chunk)
                await asyncio.sleep(0)  # a cancel can come in between two chunks
            await send({"type": "audio_end", "id": item.id})
        except VoiceError as exc:
            await send(exc.frame())
        finally:
            speaking.pop(item.id, None)

    async def run(outs: list[Out]) -> None:
        for out in outs:
            if isinstance(out, Speak):
                old = speaking.pop(out.id, None)
                if old:
                    old.cancel()
                speaking[out.id] = asyncio.create_task(speak(out))
            elif isinstance(out, Cancel):
                task = speaking.pop(out.id, None)
                if task:
                    task.cancel()
                await send({"type": "cancelled", "id": out.id})
            else:
                await send(out)

    await send(session.hello())
    try:
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                return
            try:
                if message.get("text") is not None:
                    await run(session.on_text(message["text"]))
                elif message.get("bytes") is not None:
                    await run(session.on_bytes(message["bytes"]))
            except VoiceError as exc:
                await send(exc.frame())
                if exc.fatal:
                    await ws.close(code=CLOSE_POLICY)
                    return
    except WebSocketDisconnect:
        return
    finally:
        for task in speaking.values():
            task.cancel()
        session.close()
