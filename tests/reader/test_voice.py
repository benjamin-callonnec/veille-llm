import asyncio
import gc
import json
import threading
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from veille_reader.server import create_app
from veille_reader.voice import (
    MAX_AUDIO_FRAME,
    MAX_SPEAK_CHARS,
    EchoEngine,
    VoiceError,
    VoiceSession,
    serve,
)


@pytest.fixture
def catalogue(tmp_path):
    path = tmp_path / "catalogue.json"
    path.write_text(json.dumps({"items": []}), encoding="utf-8")
    return path


def make_client(tmp_path, catalogue, **kw):
    app = create_app(tmp_path / "data", catalogue, **kw)
    # the test client ignores base_url for WebSockets: send the Host header ourselves
    return TestClient(app, base_url="http://127.0.0.1:8765", headers={"host": "127.0.0.1:8765"})


@pytest.fixture
def client(tmp_path, catalogue):
    return make_client(tmp_path, catalogue, voice_engine=EchoEngine())


def send(ws, **msg):
    ws.send_text(json.dumps(msg))


def recv(ws):
    return json.loads(ws.receive_text())


# --- the session (pure protocol) -------------------------------------------------------------


def session(now=lambda: 0.0):
    return VoiceSession(EchoEngine(), clock=now)


def test_stt_partial_then_final():
    s = session()
    assert s.on_text('{"type":"start_stt","rate":16000}') == [{"type": "ready"}]
    assert s.on_bytes(b"hel") == [{"type": "partial", "text": "hel"}]
    assert s.on_bytes(b"lo") == [{"type": "partial", "text": "hello"}]
    assert s.on_text('{"type":"stop_stt"}') == [{"type": "final", "text": "hello"}]


def test_audio_before_start_is_an_error():
    with pytest.raises(VoiceError) as e:
        session().on_bytes(b"x")
    assert e.value.code == "not_listening"


def test_a_second_start_replaces_nothing_and_is_refused():
    s = session()
    s.on_text('{"type":"start_stt","rate":16000}')
    with pytest.raises(VoiceError) as e:
        s.on_text('{"type":"start_stt","rate":16000}')
    assert e.value.code == "already_listening"


@pytest.mark.parametrize(
    "raw,code",
    [
        ("not json", "bad_frame"),
        ("[1]", "bad_frame"),
        ('{"type":"nope"}', "unknown_type"),
        ('{"type":"start_stt","rate":3}', "bad_rate"),
        ('{"type":"speak","id":1,"text":""}', "bad_frame"),
        ('{"type":"speak","id":"a","text":"hi"}', "bad_frame"),
        ('{"type":"speak","id":1,"text":"' + "a" * (MAX_SPEAK_CHARS + 1) + '"}', "too_long"),
    ],
)
def test_bad_text_frames(raw, code):
    with pytest.raises(VoiceError) as e:
        session().on_text(raw)
    assert e.value.code == code


def test_oversized_frames_are_fatal():
    s = session()
    s.on_text('{"type":"start_stt","rate":16000}')
    with pytest.raises(VoiceError) as e:
        s.on_bytes(b"x" * (MAX_AUDIO_FRAME + 1))
    assert e.value.code == "frame_too_large"
    assert e.value.fatal


def test_utterance_size_is_capped():
    s = session()
    s.on_text('{"type":"start_stt","rate":8000}')  # 16 kB/s: 60 s is 960 kB
    with pytest.raises(VoiceError) as e:
        for _ in range(100):
            s.on_bytes(b"x" * MAX_AUDIO_FRAME)
    assert e.value.code == "utterance_too_long"


def test_rate_limit_on_control_messages():
    s = session(now=lambda: 1.0)
    with pytest.raises(VoiceError) as e:
        for _ in range(500):
            s.on_text('{"type":"ping"}')
    assert e.value.code == "rate_limited"
    assert e.value.fatal


def test_rate_window_slides():
    t = [0.0]
    s = session(now=lambda: t[0])
    for _ in range(30):
        s.on_text('{"type":"ping"}')
    t[0] = 5.0
    assert s.on_text('{"type":"ping"}') == [{"type": "pong"}]


def test_no_engine_says_so():
    s = VoiceSession(None)
    with pytest.raises(VoiceError) as e:
        s.on_text('{"type":"start_stt","rate":16000}')
    assert e.value.code == "no_engine"


# --- the WebSocket -----------------------------------------------------------------------------


def test_hello_announces_capabilities(client):
    with client.websocket_connect("/api/voice") as ws:
        assert recv(ws) == {"type": "hello", "protocol": 1, "stt": True, "tts": True}


def test_hello_without_engine(tmp_path, catalogue):
    c = make_client(tmp_path, catalogue)
    with c.websocket_connect("/api/voice") as ws:
        assert recv(ws) == {"type": "hello", "protocol": 1, "stt": False, "tts": False}


def test_dictation_over_the_socket(client):
    with client.websocket_connect("/api/voice") as ws:
        recv(ws)
        send(ws, type="start_stt", rate=16000)
        assert recv(ws) == {"type": "ready"}
        ws.send_bytes(b"bon")
        assert recv(ws) == {"type": "partial", "text": "bon"}
        ws.send_bytes(b"jour")
        recv(ws)
        send(ws, type="stop_stt")
        assert recv(ws) == {"type": "final", "text": "bonjour"}


def test_speech_is_streamed_then_ended(client):
    with client.websocket_connect("/api/voice") as ws:
        recv(ws)
        send(ws, type="speak", id=7, text="Hello there.")
        assert recv(ws) == {"type": "audio_start", "id": 7, "format": "pcm16", "rate": 16000}
        chunks = []
        while True:
            frame = ws.receive()
            if frame.get("bytes") is not None:
                chunks.append(frame["bytes"])
            else:
                end = json.loads(frame["text"])
                break
        assert b"".join(chunks) == b"Hello there."
        assert end == {"type": "audio_end", "id": 7}


def test_errors_are_clear_and_keep_the_socket(client):
    with client.websocket_connect("/api/voice") as ws:
        recv(ws)
        ws.send_bytes(b"x")
        assert recv(ws)["code"] == "not_listening"
        send(ws, type="ping")
        assert recv(ws) == {"type": "pong"}


def test_fatal_error_closes(client):
    with client.websocket_connect("/api/voice") as ws:
        recv(ws)
        send(ws, type="start_stt", rate=16000)
        recv(ws)
        ws.send_bytes(b"x" * (MAX_AUDIO_FRAME + 1))
        assert recv(ws)["code"] == "frame_too_large"
        with pytest.raises(WebSocketDisconnect):
            ws.receive_text()


def test_reconnect_starts_clean(client):
    with client.websocket_connect("/api/voice") as ws:
        recv(ws)
        send(ws, type="start_stt", rate=16000)
        recv(ws)
        ws.send_bytes(b"abc")
        recv(ws)
    with client.websocket_connect("/api/voice") as ws:
        recv(ws)
        send(ws, type="start_stt", rate=16000)
        recv(ws)
        send(ws, type="stop_stt")
        assert recv(ws) == {"type": "final", "text": ""}


def test_cross_origin_is_rejected(client):
    with pytest.raises(WebSocketDisconnect) as e:
        with client.websocket_connect("/api/voice", headers={"origin": "https://evil.example"}):
            pass
    assert e.value.code == 1008


def test_same_origin_is_accepted(client):
    with client.websocket_connect("/api/voice", headers={"origin": "http://127.0.0.1:8765"}) as ws:
        assert recv(ws)["type"] == "hello"


def test_dev_origin_is_accepted(tmp_path, catalogue):
    c = make_client(
        tmp_path, catalogue, voice_engine=EchoEngine(), dev_origins={"http://localhost:5173"}
    )
    with c.websocket_connect("/api/voice", headers={"origin": "http://localhost:5173"}) as ws:
        assert recv(ws)["type"] == "hello"


def test_non_local_host_is_rejected(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/voice", headers={"host": "example.org"}):
            pass


def test_cross_site_fetch_metadata_is_rejected(client):
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/voice", headers={"sec-fetch-site": "cross-site"}):
            pass


def test_no_audio_is_written_to_disk(tmp_path, catalogue):
    c = make_client(tmp_path, catalogue, voice_engine=EchoEngine())
    with c.websocket_connect("/api/voice") as ws:
        recv(ws)
        send(ws, type="start_stt", rate=16000)
        recv(ws)
        ws.send_bytes(b"secret speech")
        recv(ws)
        send(ws, type="stop_stt")
        recv(ws)
    files = [p for p in (tmp_path / "data").rglob("*") if p.is_file()]
    assert all(b"secret speech" not in p.read_bytes() for p in files)


def test_cancel_stops_a_speech(tmp_path, catalogue):
    class Endless(EchoEngine):
        def synthesize(self, text):
            while True:
                yield b"x"

    c = make_client(tmp_path, catalogue, voice_engine=Endless())
    with c.websocket_connect("/api/voice") as ws:
        recv(ws)
        send(ws, type="speak", id=3, text="long")
        assert recv(ws)["type"] == "audio_start"
        send(ws, type="cancel", id=3)
        while True:
            frame = ws.receive()
            if frame.get("text") and json.loads(frame["text"]).get("type") == "cancelled":
                break
        send(ws, type="ping")
        while True:
            frame = ws.receive()
            if frame.get("text") and json.loads(frame["text"]).get("type") == "pong":
                break


def test_speak_without_engine_is_an_error(tmp_path, catalogue):
    c = make_client(tmp_path, catalogue)
    with c.websocket_connect("/api/voice") as ws:
        recv(ws)
        send(ws, type="speak", id=1, text="hi")
        assert recv(ws)["code"] == "no_engine"


# --- review fixes ------------------------------------------------------------------------------


def test_audio_after_an_utterance_too_long_is_dropped_silently_until_restart():
    s = session()
    s.on_text('{"type":"start_stt","rate":8000}')
    with pytest.raises(VoiceError) as e:
        for _ in range(100):
            s.on_bytes(b"x" * MAX_AUDIO_FRAME)
    assert e.value.code == "utterance_too_long"
    assert s.on_bytes(b"x") == []  # no flood of not_listening errors
    s.on_text('{"type":"start_stt","rate":8000}')
    assert s.on_bytes(b"ab") == [{"type": "partial", "text": "ab"}]
    s.on_text('{"type":"stop_stt"}')
    with pytest.raises(VoiceError) as again:
        s.on_bytes(b"x")
    assert again.value.code == "not_listening"


class FakeWs:
    """Just enough of a WebSocket to drive `serve` in-process."""

    def __init__(self):
        self.inbox: asyncio.Queue = asyncio.Queue()
        self.sent: list = []

    async def receive(self):
        return await self.inbox.get()

    async def send_text(self, text):
        self.sent.append(json.loads(text))

    async def send_bytes(self, data):
        self.sent.append(data)

    async def close(self, code=1000):
        pass

    def say(self, **msg):
        self.inbox.put_nowait({"type": "websocket.receive", "text": json.dumps(msg)})

    def types(self):
        return [f["type"] for f in self.sent if isinstance(f, dict)]


async def _until(predicate, timeout=2.0):
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while not predicate():
        assert loop.time() < end, "timed out"
        await asyncio.sleep(0.01)


async def _stop(ws, task):
    ws.inbox.put_nowait({"type": "websocket.disconnect"})
    await asyncio.wait_for(task, 2)


def test_replaced_speech_does_not_unregister_its_replacement():
    class Endless(EchoEngine):
        def synthesize(self, text):
            while True:
                yield b"x"
                time.sleep(0.001)

    async def scenario():
        ws = FakeWs()
        task = asyncio.create_task(serve(ws, Endless()))
        ws.say(type="speak", id=1, text="a")
        await _until(lambda: "audio_start" in ws.types())
        ws.say(type="speak", id=1, text="b")
        await _until(lambda: ws.types().count("audio_start") == 2)
        await asyncio.sleep(0.05)  # the replaced task ends: it must not forget the new one
        ws.say(type="cancel", id=1)
        await _until(lambda: "cancelled" in ws.types())
        await asyncio.sleep(0.1)
        count = len(ws.sent)
        await asyncio.sleep(0.2)
        assert len(ws.sent) == count  # the second speech really stopped
        await _stop(ws, task)

    asyncio.run(scenario())


def test_a_failing_engine_sends_an_error_frame_without_a_lost_task_exception():
    class Broken(EchoEngine):
        def synthesize(self, text):
            yield b"x"
            raise RuntimeError("model crashed")

    async def scenario():
        ws = FakeWs()
        lost = []
        asyncio.get_running_loop().set_exception_handler(lambda loop, ctx: lost.append(ctx))
        task = asyncio.create_task(serve(ws, Broken()))
        ws.say(type="speak", id=7, text="a")
        await _until(lambda: "error" in ws.types())
        error = next(f for f in ws.sent if isinstance(f, dict) and f["type"] == "error")
        assert error["code"] == "synthesis_failed"
        assert "model crashed" not in json.dumps(error)
        await _stop(ws, task)
        gc.collect()
        assert lost == []

    asyncio.run(scenario())


def test_synthesis_runs_off_the_event_loop():
    gate = threading.Event()

    class Slow(EchoEngine):
        def synthesize(self, text):
            gate.wait(3)  # blocks its thread, not the loop
            yield b"x"

    async def scenario():
        ws = FakeWs()
        task = asyncio.create_task(serve(ws, Slow()))
        ws.say(type="speak", id=1, text="a")
        await _until(lambda: "audio_start" in ws.types())
        started = time.monotonic()
        ws.say(type="ping")
        await _until(lambda: "pong" in ws.types(), timeout=1.0)
        assert time.monotonic() - started < 1.0  # answered while the engine was still blocked
        gate.set()
        await _until(lambda: "audio_end" in ws.types())
        await _stop(ws, task)

    asyncio.run(scenario())
