from veille_llm.newsletter.subscribers import EnvSubscribers, FileSubscribers, parse_addresses


def test_parse_lowercases_dedupes_sorts_and_counts_rejected():
    valid, rejected = parse_addresses("B@x.org, a@x.org ,A@X.ORG,not-an-address,,c@x")
    assert valid == ["a@x.org", "b@x.org"]
    assert rejected == 2


def test_parse_rejects_header_injection_and_odd_characters():
    raw = "ok@x.org,evil@x.org\r\nBcc: spy@x.org,sp ace@x.org,<tag>@x.org,a@b@c.org"
    valid, rejected = parse_addresses(raw)
    assert valid == ["ok@x.org"]
    assert rejected == 4


def test_env_store_reads_a_comma_separated_variable():
    store = EnvSubscribers({"SUBSCRIBERS": "a@x.org,b@x.org"})
    assert store.list() == ["a@x.org", "b@x.org"]


def test_env_store_without_the_variable_is_empty_not_an_error():
    assert EnvSubscribers({}).list() == []


def test_file_store_reads_one_address_per_line_and_ignores_comments(tmp_path):
    path = tmp_path / "subscribers.txt"
    path.write_text("# friends\nb@x.org\n\na@x.org\n")
    assert FileSubscribers(path).list() == ["a@x.org", "b@x.org"]


def test_file_store_that_does_not_exist_is_empty(tmp_path):
    assert FileSubscribers(tmp_path / "missing.txt").list() == []
