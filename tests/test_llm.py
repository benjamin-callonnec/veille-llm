import asyncio
from types import SimpleNamespace

import pytest

from veille_llm.llm import (
    LlmAuthError,
    LlmError,
    LlmLimitError,
    LlmOptions,
    LlmResult,
    RawReply,
    _reply_from_result,
    assert_subscription_auth,
    classify_error,
    complete_json,
    is_retryable,
    redact,
)


def test_refuses_when_api_key_is_set():
    with pytest.raises(LlmError):
        assert_subscription_auth({"ANTHROPIC_API_KEY": "sk-ant-api03-whatever"})


def test_accepts_empty_or_missing_api_key():
    assert_subscription_auth({})
    assert_subscription_auth({"ANTHROPIC_API_KEY": ""})


def test_classify_error_maps_401_to_auth():
    assert classify_error("API Error: 401 Invalid bearer token") is LlmAuthError
    assert classify_error("Authentication failed") is LlmAuthError


def test_classify_error_maps_usage_limit_to_limit():
    assert classify_error("Claude usage limit reached") is LlmLimitError
    assert classify_error("Rate limit exceeded (429)") is LlmLimitError


def test_classify_error_defaults_to_llm_error():
    assert classify_error("something odd happened") is LlmError


def test_limit_and_auth_errors_are_not_retryable():
    assert not is_retryable(LlmLimitError("usage limit reached"))
    assert not is_retryable(LlmAuthError("401"))


def test_server_errors_are_retryable():
    assert is_retryable(LlmError("API Error: 503 Service Unavailable"))
    assert is_retryable(LlmError("Overloaded"))
    assert not is_retryable(LlmError("something odd happened"))


def test_redact_masks_oauth_tokens():
    text = "failed with token sk-ant-oat01-AbC_dEf-123 in header"
    assert "sk-ant" not in redact(text)
    assert "[REDACTED]" in redact(text)


# --- complete_json ---------------------------------------------------------

SCHEMA = {
    "type": "object",
    "properties": {"interesting": {"type": "boolean"}},
    "required": ["interesting"],
}


def _runner(text="", error=None, seen=None):
    async def run(prompt, options):
        if seen is not None:
            seen.append(options)
        if error is not None:
            raise error
        return RawReply(text=text, input_tokens=12, output_tokens=5, cost_usd=0.001)

    return run


def _call(runner):
    return asyncio.run(complete_json("classify", SCHEMA, runner=runner))


@pytest.fixture(autouse=True)
def _no_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)


def test_returns_validated_json_and_usage():
    result = _call(_runner('{"interesting": true}'))
    assert result == LlmResult(
        data={"interesting": True}, input_tokens=12, output_tokens=5, cost_usd=0.001
    )


def test_accepts_fenced_json_block():
    assert _call(_runner('```json\n{"interesting": false}\n```')).data == {"interesting": False}


def test_rejects_prose_around_json():
    with pytest.raises(LlmError):
        _call(_runner('Sure! Here it is: {"interesting": true}'))


def test_rejects_json_that_violates_schema():
    with pytest.raises(LlmError):
        _call(_runner('{"interesting": "yes"}'))


def test_rejects_empty_reply():
    with pytest.raises(LlmError):
        _call(_runner(""))


def test_runs_with_no_tools_and_one_turn():
    seen = []
    _call(_runner('{"interesting": true}', seen=seen))
    assert isinstance(seen[0], LlmOptions)
    assert seen[0].tools == []
    assert seen[0].max_turns == 1
    assert seen[0].model == "claude-sonnet-5-5"


def test_runner_limit_error_becomes_llm_limit_error():
    with pytest.raises(LlmLimitError):
        _call(_runner(error=RuntimeError("Claude usage limit reached")))


def test_token_in_runner_error_is_redacted():
    with pytest.raises(LlmError) as info:
        _call(_runner(error=RuntimeError("boom sk-ant-oat01-SECRET123")))
    assert "SECRET123" not in str(info.value)


def test_refuses_before_calling_runner_when_api_key_set(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-x")
    seen = []
    with pytest.raises(LlmError):
        _call(_runner('{"interesting": true}', seen=seen))
    assert seen == []


# --- real runner wiring ----------------------------------------------------


def test_complete_json_uses_claude_runner_by_default(monkeypatch):
    calls = []

    async def fake(prompt, options):
        calls.append(options)
        return RawReply(
            text='{"interesting": true}', input_tokens=1, output_tokens=1, cost_usd=None
        )

    monkeypatch.setattr("veille_llm.llm.claude_runner", fake)
    result = asyncio.run(complete_json("classify", SCHEMA))
    assert result.data == {"interesting": True}
    assert len(calls) == 1


def test_reply_from_result_reads_text_usage_and_cost():
    msg = SimpleNamespace(
        is_error=False,
        result='{"interesting": true}',
        usage={"input_tokens": 30, "output_tokens": 8},
        total_cost_usd=0.002,
        errors=None,
    )
    assert _reply_from_result(msg) == RawReply(
        text='{"interesting": true}', input_tokens=30, output_tokens=8, cost_usd=0.002
    )


def test_reply_from_result_raises_on_error_result():
    msg = SimpleNamespace(
        is_error=True,
        result="Claude usage limit reached",
        usage=None,
        total_cost_usd=None,
        errors=None,
    )
    with pytest.raises(RuntimeError, match="usage limit"):
        _reply_from_result(msg)
