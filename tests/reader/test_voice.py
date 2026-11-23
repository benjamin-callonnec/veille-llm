import json

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
