"""
Safety test: Secret redaction guarantee.

Verifies that:
  1. _redact_text() replaces all known token patterns
  2. _redact_dict() recursively redacts sensitive keys
  3. No raw secrets appear in redacted output
  4. Non-sensitive data is preserved
"""

from __future__ import annotations

from atlasbridge.cli._debug import _redact_dict, _redact_text


class TestRedactText:
    """_redact_text() must strip all known secret patterns."""

    def test_telegram_bot_token_redacted(self) -> None:
        raw = "token=1234567890:ABCDEFghijklMNopqrst_uvwxyz-1234567"
        result = _redact_text(raw)
        assert "1234567890:" not in result
        assert "<REDACTED>" in result

    def test_slack_bot_token_redacted(self) -> None:
        raw = "SLACK_BOT_TOKEN=xoxb-1234-5678-abcdefghijklmnop"
        result = _redact_text(raw)
        assert "xoxb-" not in result
        assert "<REDACTED>" in result

    def test_slack_app_token_redacted(self) -> None:
        raw = "APP_TOKEN=xapp-1-A1234-5678-abcdefghijklmnop"
        result = _redact_text(raw)
        assert "xapp-" not in result
        assert "<REDACTED>" in result

    def test_api_key_pattern_redacted(self) -> None:
        raw = "api_key=sk-abcdefghijklmnopqrstuvwxyz"
        result = _redact_text(raw)
        assert "sk-abcdef" not in result
        assert "<REDACTED>" in result

    def test_plain_text_unchanged(self) -> None:
        raw = "This is a normal log line with no secrets."
        result = _redact_text(raw)
        assert result == raw

    def test_multiple_secrets_in_one_line(self) -> None:
        raw = "bot=1234567890:ABCDEFghijklMNopqrst_uvwxyz-1234567 slack=xoxb-1-2-abc"
        result = _redact_text(raw)
        assert "1234567890:" not in result
        assert "xoxb-" not in result


class TestRedactDict:
    """_redact_dict() must recursively redact sensitive keys."""

    def test_sensitive_key_token(self) -> None:
        d = {"bot_token": "1234567890:secret"}
        result = _redact_dict(d)
        assert result["bot_token"] == "<REDACTED>"

    def test_sensitive_key_password(self) -> None:
        d = {"password": "my-secret-pass"}
        result = _redact_dict(d)
        assert result["password"] == "<REDACTED>"

    def test_sensitive_key_api_key(self) -> None:
        d = {"api_key": "sk-abcdefghijklmnopqrstuvwxyz"}
        result = _redact_dict(d)
        assert result["api_key"] == "<REDACTED>"

    def test_sensitive_key_secret(self) -> None:
        d = {"client_secret": "top-secret-value"}
        result = _redact_dict(d)
        assert result["client_secret"] == "<REDACTED>"

    def test_nested_dict_redacted(self) -> None:
        d = {"config": {"telegram": {"bot_token": "secret-token-value"}}}
        result = _redact_dict(d)
        assert result["config"]["telegram"]["bot_token"] == "<REDACTED>"

    def test_non_sensitive_keys_preserved(self) -> None:
        d = {"name": "test-session", "status": "running", "count": 42}
        result = _redact_dict(d)
        assert result["name"] == "test-session"
        assert result["status"] == "running"
        assert result["count"] == 42

    def test_string_value_with_token_pattern_redacted(self) -> None:
        """Even non-sensitive key values are scanned for token patterns."""
        d = {"log_line": "Connected with token 1234567890:ABCDEFghijklMNopqrst_uvwxyz-1234567"}
        result = _redact_dict(d)
        assert "1234567890:" not in result["log_line"]

    def test_empty_dict(self) -> None:
        assert _redact_dict({}) == {}

    def test_case_insensitive_key_matching(self) -> None:
        """Keys like 'API_KEY' should match because 'api_key' is in _SENSITIVE_KEYS."""
        d = {"API_KEY": "sk-test123456789012345678"}
        result = _redact_dict(d)
        assert result["API_KEY"] == "<REDACTED>"
