import pytest

from veille_llm.llm import (
    LlmAuthError,
    LlmError,
    LlmLimitError,
    assert_subscription_auth,
    classify_error,
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
