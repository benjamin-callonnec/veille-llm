import urllib.error

import pytest

from veille_llm.retry import is_transient, retry_call


def http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError("https://example.com", code, "err", {}, None)


class Flaky:
    def __init__(self, failures):
        self.failures = list(failures)
        self.calls = 0

    def __call__(self):
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return "ok"


def test_returns_value_without_retry():
    waits = []
    assert retry_call(lambda: 42, sleep=waits.append) == 42
    assert waits == []


def test_retries_transient_errors_then_succeeds():
    fn, waits = Flaky([http_error(503), http_error(503)]), []
    assert retry_call(fn, sleep=waits.append, jitter=lambda: 0.5) == "ok"
    assert fn.calls == 3
    assert waits == [1.0, 2.0]


def test_gives_up_after_attempts():
    fn = Flaky([http_error(503)] * 5)
    with pytest.raises(urllib.error.HTTPError):
        retry_call(fn, attempts=3, sleep=lambda s: None)
    assert fn.calls == 3


def test_does_not_retry_404():
    fn = Flaky([http_error(404)])
    with pytest.raises(urllib.error.HTTPError):
        retry_call(fn, sleep=lambda s: None)
    assert fn.calls == 1


def test_wait_grows_exponentially():
    fn, waits = Flaky([TimeoutError()] * 4), []
    with pytest.raises(TimeoutError):
        retry_call(fn, attempts=4, base_delay=2.0, sleep=waits.append, jitter=lambda: 0.5)
    assert waits == [2.0, 4.0, 8.0]


def test_is_transient_classification():
    assert is_transient(http_error(429))
    assert is_transient(http_error(500))
    assert is_transient(urllib.error.URLError("down"))
    assert is_transient(TimeoutError())
    assert not is_transient(http_error(401))
    assert not is_transient(ValueError("bad"))
