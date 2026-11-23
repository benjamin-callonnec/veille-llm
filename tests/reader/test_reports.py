import json

import pytest
from fastapi.testclient import TestClient

from veille_reader.agent import build_sdk_tools
from veille_reader.reports import ReportTools, check_html, export_name, lint_html, with_csp
from veille_reader.server import create_app
from veille_reader.skills import Skill, SkillSession
from veille_reader.storage import ReaderStore
from veille_reader.tools import Limits, ToolBudget, ToolError

from .test_agent import call, paper_tools


@pytest.mark.parametrize(
    "html",
    [
        '<script src="https://x.example/a.js"></script>',
        '<link rel="stylesheet" href="http://x.example/a.css">',
        '<img src="https://x.example/a.png">',
        '<img src="//x.example/a.png">',
        "<style>@import url(http://x.example/a.css);</style>",
        "<style>p{background:url(https://x.example/a.png)}</style>",
        "<style>p{background:url( '//x.example/a.png')}</style>",
        '<a href="https://x.example">x</a>',
        "<IMG SRC = 'HTTP://x.example/a.png'>",
    ],
)
def test_check_html_refuses_external_resources(html):
    with pytest.raises(ToolError, match="inline"):
        check_html(f"<html><body>{html}</body></html>")


def test_check_html_accepts_inline_content():
    check_html(
        '<html><body><a href="#slide2">next</a><img src="data:image/png;base64,AAAA">'
        "<style>p{background:url(data:image/png;base64,AAAA)}</style>"
        "<script>document.title='a'</script></body></html>"
    )


@pytest.mark.parametrize("html", ["", "   \n"])
def test_check_html_refuses_empty(html):
    with pytest.raises(ToolError):
        check_html(html)


def test_export_name_is_sanitised():
    assert export_name("My deck") == "My-deck.html"
    name = export_name('a/b"c\n..\\d')
    assert name.endswith(".html") and not any(c in name for c in '/"\n\\')
    assert export_name("") == "report.html" and export_name("///") == "report.html"
    assert len(export_name("x" * 500)) <= 90


PRESENT = Skill("present", "Slides.", "Do it.", ("write_report", "read_report"))


def tools_with(store, skill_session):
    reports = ReportTools(store, "a1")
    built = build_sdk_tools(paper_tools(), ToolBudget(Limits()), None, skill_session, reports)
    return {t.name: t for t in built}


def test_report_tools_exist_only_with_reports(tmp_path):
    built = build_sdk_tools(paper_tools(), ToolBudget(Limits()), None, SkillSession([PRESENT]))
    assert {"write_report", "read_report"}.isdisjoint(t.name for t in built)


def test_write_report_refused_without_skill(tmp_path):
    store = ReaderStore(tmp_path)
    tools = tools_with(store, SkillSession([PRESENT]))
    out = call(tools["write_report"], {"title": "T", "html": "<p>x</p>"})
    assert out["is_error"] is True and store.reports("a1") == []


def test_write_report_with_skill_saves_versions(tmp_path):
    store = ReaderStore(tmp_path)
    session = SkillSession([PRESENT])
    tools = tools_with(store, session)
    call(tools["use_skill"], {"name": "present"})
    out = call(tools["write_report"], {"title": "T", "html": "<p>x</p>"})
    assert "report 1, version 1" in out["content"][0]["text"]
    out = call(tools["write_report"], {"title": "T", "html": "<p>y</p>", "report_id": 1})
    assert "version 2" in out["content"][0]["text"]
    assert store.report("a1", 1)["html"] == "<p>y</p>"


def test_write_report_errors_reach_the_model(tmp_path):
    store = ReaderStore(tmp_path)
    tools = tools_with(store, SkillSession([PRESENT], forced=PRESENT))
    external = call(
        tools["write_report"], {"title": "T", "html": '<img src="https://x.example/a">'}
    )
    assert external["is_error"] is True
    unknown = call(tools["write_report"], {"title": "T", "html": "<p>x</p>", "report_id": 99})
    assert unknown["is_error"] is True
    empty_title = call(tools["write_report"], {"title": " ", "html": "<p>x</p>"})
    assert empty_title["is_error"] is True
    assert store.reports("a1") == []


def test_read_report_returns_html_as_escaped_data(tmp_path):
    store = ReaderStore(tmp_path)
    store.save_report("a1", "T", "<p>x</p>")
    tools = tools_with(store, SkillSession([PRESENT], forced=PRESENT))
    text = call(tools["read_report"], {"report_id": 1})["content"][0]["text"]
    assert "&lt;p&gt;x&lt;/p&gt;" in text and '<data source="report">' in text
    assert call(tools["read_report"], {"report_id": 7})["is_error"] is True


# --- routes ---------------------------------------------------------------------------


@pytest.fixture
def client(tmp_path):
    cat = tmp_path / "c.json"
    cat.write_text(json.dumps({"items": [{"id": "a1", "title": "A", "url": "https://x/y"}]}))
    app = create_app(tmp_path / "data", cat)
    c = TestClient(app, base_url="http://127.0.0.1:8765")
    c.store = app.state.store
    return c


def test_report_routes_list_get_restore_delete(client):
    store = client.store
    r = store.save_report("a1", "Deck", "<p>1</p>")
    store.save_report("a1", "Deck", "<p>2</p>", r["id"])
    listed = client.get("/api/items/a1/reports").json()
    assert [(x["id"], x["version"]) for x in listed] == [(r["id"], 2)]
    view = client.get(f"/api/items/a1/reports/{r['id']}").json()
    assert view["html"] == "<p>2</p>" and len(view["versions"]) == 2
    assert client.get(f"/api/items/a1/reports/{r['id']}?version=1").json()["html"] == "<p>1</p>"
    restored = client.post(f"/api/items/a1/reports/{r['id']}/restore", json={"version": 1})
    assert restored.json()["version"] == 3
    assert client.delete(f"/api/items/a1/reports/{r['id']}").status_code == 204
    assert client.get(f"/api/items/a1/reports/{r['id']}").status_code == 404


def test_report_routes_404(client):
    assert client.get("/api/items/zz/reports").status_code == 404
    assert client.get("/api/items/a1/reports/9").status_code == 404
    r = client.store.save_report("a1", "Deck", "<p>1</p>")
    assert client.get(f"/api/items/a1/reports/{r['id']}?version=9").status_code == 404
    assert client.get(f"/api/items/a1/reports/{r['id']}/export?version=9").status_code == 404
    assert (
        client.post(f"/api/items/a1/reports/{r['id']}/restore", json={"version": 9}).status_code
        == 404
    )
    assert client.delete("/api/items/a1/reports/9").status_code == 404


def test_export_sets_a_safe_attachment_name_and_keeps_the_html(client):
    html = "<html><body><h1>Hi</h1></body></html>"
    r = client.store.save_report("a1", 'A "deck"/\n x', html)
    response = client.get(f"/api/items/a1/reports/{r['id']}/export")
    assert response.text == with_csp(html)
    assert "<h1>Hi</h1>" in response.text
    assert response.headers["content-type"].startswith("text/html")
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment; filename=") and "\n" not in disposition
    assert "/" not in disposition.split("filename=")[1]


def test_export_carries_the_same_policy_as_the_viewer(client):
    r = client.store.save_report("a1", "Deck", "<!DOCTYPE html><html><body>hi</body></html>")
    text = client.get(f"/api/items/a1/reports/{r['id']}/export").text
    assert text.startswith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy"')
    assert "default-src 'none'" in text and "hi" in text


def test_regenerate_keeps_the_skill_the_user_invoked(tmp_path):
    from veille_reader import events

    seen = []

    async def runner(request):
        seen.append(request.skill)
        yield events.done(1)

    cat = tmp_path / "c.json"
    cat.write_text(json.dumps({"items": [{"id": "a1", "title": "A", "url": "https://x/y"}]}))
    skills = tmp_path / "skills"
    skills.mkdir()
    (skills / "present.md").write_text("---\nname: present\ndescription: d\n---\nDo it.")
    app = create_app(tmp_path / "data", cat, runner=runner, skills_dir=skills)
    c = TestClient(app, base_url="http://127.0.0.1:8765")
    cid = c.post("/api/items/a1/conversations", json={}).json()["id"]
    c.post(
        f"/api/items/a1/conversations/{cid}/messages",
        json={"kind": "text", "text": "/present", "skill": "present"},
    )
    c.post(f"/api/items/a1/conversations/{cid}/regenerate")
    assert [s.name for s in seen] == ["present", "present"]


GOOD_SVG = (
    '<svg viewBox="0 0 10 10" role="img"><title>Accuracy by size</title><desc>d</desc><rect/></svg>'
)


def test_lint_accepts_a_titled_svg_with_a_viewbox_and_alt_text():
    assert lint_html(f'<body>{GOOD_SVG}<img src="data:image/png;base64,AA" alt="a"></body>') == []


def test_lint_flags_an_svg_without_title_or_viewbox():
    warnings = lint_html("<svg><rect/></svg>" + GOOD_SVG + '<svg viewBox="0 0 1 1"><g/></svg>')
    assert len(warnings) == 3
    assert any("svg 1" in w and "<title>" in w for w in warnings)
    assert any("svg 1" in w and "viewBox" in w for w in warnings)
    assert any("svg 3" in w and "<title>" in w for w in warnings)
    assert not any("svg 2" in w for w in warnings)


def test_lint_flags_an_image_without_alt_and_caps_the_list():
    assert any("alt" in w for w in lint_html('<img src="data:image/png;base64,AA">'))
    many = "<svg><g/></svg>" * 20
    assert len(lint_html(many)) <= 5


def test_write_report_saves_and_tells_the_model_what_to_fix(tmp_path):
    store = ReaderStore(tmp_path)
    tools = tools_with(store, SkillSession([PRESENT], forced=PRESENT))
    out = call(tools["write_report"], {"title": "T", "html": "<svg><rect/></svg>"})
    text = out["content"][0]["text"]
    assert not out.get("is_error") and store.report("a1", 1) is not None
    assert "Saved report 1, version 1." in text and "<title>" in text and "report_id" in text
    clean = call(tools["write_report"], {"title": "T", "html": f"<body>{GOOD_SVG}</body>"})
    assert clean["content"][0]["text"] == "Saved report 2, version 1."
