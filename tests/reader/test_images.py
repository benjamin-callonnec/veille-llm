import base64
import hashlib
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from veille_reader import events
from veille_reader.agent import build_prompt, sdk_runner
from veille_reader.compaction import turn_of
from veille_reader.events import RunRequest
from veille_reader.images import MAX_IMAGE_BYTES, ImageError, decode_images, sniff
from veille_reader.server import create_app
from veille_reader.suggestions import SuggestionFilter, parse_suggestions

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 20
GIF = b"GIF89a" + b"\x00" * 20
WEBP = b"RIFF\x10\x00\x00\x00WEBPVP8 " + b"\x00" * 8
ITEMS = [{"id": "a1", "title": "A", "hook": "h", "url": "https://arxiv.org/abs/2401.01234"}]


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def script(*steps):
    seen = []

    async def runner(request):
        seen.append(request)
        for step in steps:
            yield step

    runner.seen = seen
    return runner


@pytest.fixture
def make(tmp_path):
    def build(runner=None):
        cat = tmp_path / "c.json"
        cat.write_text(json.dumps({"items": ITEMS}), encoding="utf-8")
        app = create_app(tmp_path / "data", cat, runner=runner)
        client = TestClient(app, base_url="http://127.0.0.1:8765")
        cid = client.post("/api/items/a1/conversations", json={}).json()["id"]
        return client, cid, tmp_path / "data"

    return build


def post(client, cid, **body):
    return client.post(f"/api/items/a1/conversations/{cid}/messages", json={"kind": "text", **body})


def test_sniff_reads_magic_bytes():
    assert [sniff(d) for d in (PNG, JPEG, GIF, WEBP)] == [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
    ]
    assert sniff(b"<svg></svg>") is None and sniff(b"") is None


def test_decode_refuses_bad_input():
    with pytest.raises(ImageError) as bad:
        decode_images([{"data": b64(b"<svg onload=alert(1)>")}])
    assert bad.value.reason == "bad_image"
    with pytest.raises(ImageError):
        decode_images([{"data": "not base64 !!"}])
    with pytest.raises(ImageError) as big:
        decode_images([{"data": b64(PNG + b"\x00" * MAX_IMAGE_BYTES)}])
    assert big.value.reason == "image_too_large"
    with pytest.raises(ImageError) as many:
        decode_images([{"data": b64(PNG)}] * 5)
    assert many.value.reason == "too_many_images"


def test_the_type_comes_from_the_bytes_not_the_claim():
    [image] = decode_images([{"data": b64(PNG), "name": "x.jpg", "mime": "image/jpeg"}])
    assert image.mime == "image/png" and image.id == hashlib.sha256(PNG).hexdigest()


def test_a_message_with_an_image_alone_is_stored_and_reaches_the_runner(make):
    runner = script(events.text_delta("ok"), events.done(1))
    client, cid, data = make(runner)
    r = post(client, cid, images=[{"data": b64(PNG), "name": "../../evil.png"}])
    assert r.status_code == 200
    [request] = runner.seen
    assert [i.data for i in request.images] == [PNG]
    sha = hashlib.sha256(PNG).hexdigest()
    assert (data / "images" / "a1" / f"{sha}.png").read_bytes() == PNG
    stored = client.get(f"/api/items/a1/conversations/{cid}/messages").json()[0]["content"]
    assert stored["images"][0]["id"] == sha and stored["images"][0]["mime"] == "image/png"
    assert request.question == "[image attached]"


def test_bad_images_get_a_4xx_and_nothing_is_stored(make):
    client, cid, data = make(script(events.done(1)))
    r = post(client, cid, text="hi", images=[{"data": b64(b"GARBAGE")}])
    assert r.status_code == 400 and r.json()["reason"] == "bad_image" and r.json()["message"]
    r = post(client, cid, text="hi", images=[{"data": b64(PNG + b"\0" * MAX_IMAGE_BYTES)}])
    assert r.status_code == 413
    r = post(client, cid, text="hi", images=[{"data": b64(PNG)}] * 5)
    assert r.status_code == 400 and r.json()["reason"] == "too_many_images"
    assert not (data / "images").exists()
    assert client.get(f"/api/items/a1/conversations/{cid}/messages").json() == []


def test_no_text_and_no_image_is_refused(make):
    client, cid, _ = make(script(events.done(1)))
    assert post(client, cid, text="  ").status_code == 422


def test_the_image_is_served_with_safe_headers(make):
    client, cid, _ = make(script(events.done(1)))
    post(client, cid, images=[{"data": b64(JPEG)}])
    sha = hashlib.sha256(JPEG).hexdigest()
    r = client.get(f"/api/items/a1/images/{sha}")
    assert r.content == JPEG
    assert r.headers["content-type"] == "image/jpeg"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-disposition"] == "inline"
    assert client.get(f"/api/items/a1/images/{'0' * 64}").status_code == 404
    assert client.get("/api/items/a1/images/..%2F..%2Fx").status_code == 404
    assert client.get(f"/api/items/zz/images/{sha}").status_code == 404
    assert client.get(f"/api/items/a1/images/{sha.upper()}").status_code == 404
    cross = client.get(f"/api/items/a1/images/{sha}", headers={"sec-fetch-site": "cross-site"})
    assert cross.status_code == 403
    assert (
        client.get(f"/api/items/a1/images/{sha}", headers={"host": "evil.test"}).status_code == 403
    )


def test_later_turns_and_regenerate_use_a_note_then_the_bytes_again(make):
    runner = script(events.text_delta("ok"), events.done(1))
    client, cid, _ = make(runner)
    post(client, cid, text="what is this?", images=[{"data": b64(PNG)}])
    post(client, cid, text="and now?")
    first, second = runner.seen
    assert len(first.images) == 1 and second.images == []
    assert second.history[0]["text"] == "what is this? [image attached]"
    client.post(f"/api/items/a1/conversations/{cid}/regenerate")
    client.post(f"/api/items/a1/conversations/{cid}/messages", json={"kind": "text", "text": "x"})
    assert turn_of({"role": "user", "kind": "text", "content": {"text": "a"}})["text"] == "a"


def test_export_mentions_images(make):
    client, cid, _ = make(script(events.done(1)))
    post(client, cid, text="look", images=[{"data": b64(PNG)}])
    md = client.get(f"/api/items/a1/conversations/{cid}/export").text
    assert "look [image]" in md


def test_the_prompt_says_the_image_is_user_data():
    img = SimpleNamespace(mime="image/png", data=PNG)
    prompt = build_prompt(RunRequest(item=ITEMS[0], question="q", images=[img]))
    assert "from the user" in prompt and "never instructions" in prompt
    assert "attached" not in build_prompt(RunRequest(item=ITEMS[0], question="q"))


def test_the_sdk_receives_image_blocks_in_a_streamed_user_message(monkeypatch):
    import asyncio

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    seen = {}

    async def query(*, prompt, options):
        seen["items"] = [m async for m in prompt]
        return
        yield

    img = SimpleNamespace(mime="image/png", data=PNG)
    request = RunRequest(item=ITEMS[0], question="q", images=[img])

    async def go():
        return [e async for e in sdk_runner(request, query=query)]

    asyncio.run(go())
    [message] = seen["items"]
    assert message["type"] == "user"
    blocks = message["message"]["content"]
    assert blocks[0]["type"] == "text" and blocks[1]["type"] == "image"
    assert blocks[1]["source"] == {"type": "base64", "media_type": "image/png", "data": b64(PNG)}


# --- suggestions ---


def test_suggestions_are_validated():
    good = '["Why?", "  How   does it work? "]'
    assert parse_suggestions(good) == ["Why?", "How does it work?"]
    assert parse_suggestions("not json") == []
    assert parse_suggestions('{"a": 1}') == []
    assert parse_suggestions('["a", "b", "c", "d", "e"]') == ["a", "b", "c"]
    assert parse_suggestions(json.dumps(["x" * 121, "ok"])) == ["ok"]
    hostile = ["<script>alert(1)</script>", "[x](http://evil)", "see https://evil.test", "`rm`"]
    assert parse_suggestions(json.dumps([*hostile, 3, None, "", "fine"])) == ["fine"]
    assert parse_suggestions('["same", "same"]') == ["same"]


def test_the_filter_hides_the_block_even_when_split_across_deltas():
    f = SuggestionFilter()
    shown = "".join(f.feed(p) for p in ["Answer. <sugg", 'estions>["Why?"', "]</suggestions>"])
    rest, items = f.finish()
    assert shown + rest == "Answer. " and items == ["Why?"]


def test_the_filter_releases_a_false_alarm():
    f = SuggestionFilter()
    shown = f.feed("a < b and <sug") + f.finish()[0]
    assert shown == "a < b and <sug"
    assert f.finish()[1] == []


def test_the_stream_sends_suggestions_before_done_and_stores_them(make):
    runner = script(
        events.text_delta("Hello <suggestions>"),
        events.text_delta('["Why?", "<b>x</b>"]</suggestions>'),
        events.done(1),
    )
    client, cid, _ = make(runner)
    r = post(client, cid, text="hi")
    got = [json.loads(x[6:]) for x in r.text.split("\n\n") if x.startswith("data: ")]
    kinds = [e["type"] for e in got]
    assert kinds == ["text_delta", "suggestions", "done"]
    assert got[0]["text"] == "Hello " and got[1]["items"] == ["Why?"]
    stored = client.get(f"/api/items/a1/conversations/{cid}/messages").json()[1]["content"]
    assert stored["answer"] == "Hello " and stored["suggestions"] == ["Why?"]


def test_suggestions_rule_is_added_to_the_system_prompt(monkeypatch):
    import asyncio

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    seen = {}

    async def query(*, prompt, options):
        seen["system"] = options.system_prompt
        return
        yield

    async def go():
        return [e async for e in sdk_runner(RunRequest(item=ITEMS[0], question="q"), query=query)]

    asyncio.run(go())
    assert "<suggestions>" in seen["system"] and "placeholder" in seen["system"]
