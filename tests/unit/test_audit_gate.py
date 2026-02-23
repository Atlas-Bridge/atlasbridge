"""Unit tests for channel message audit logging (gate accept/reject events).

Tests verify:
  - Accepted gate decisions produce channel_message_accepted events
  - Rejected gate decisions produce channel_message_rejected events
  - Hash chain integrity after accept + reject events
  - Message body is NEVER stored — only SHA-256 hash
  - message_hash is valid SHA-256
  - Password prompt excerpt is "[REDACTED]"
  - Rate-limited excerpt is "[rate limited]"
  - Excerpt is <= 20 characters
  - redact_tokens() applied to excerpt (test with token-like string)
  - Audit schema has no raw message body column
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest

from atlasbridge.core.audit.writer import (
    _MAX_EXCERPT_CHARS,
    AuditWriter,
    message_hash,
    safe_excerpt,
)
from atlasbridge.core.store.database import Database


@pytest.fixture
def db(tmp_path: Path) -> Database:
    d = Database(tmp_path / "gate_audit_test.db")
    d.connect()
    yield d
    d.close()


@pytest.fixture
def writer(db: Database) -> AuditWriter:
    return AuditWriter(db)


class TestSafeExcerpt:
    def test_normal_short_text(self) -> None:
        assert safe_excerpt("yes") == "yes"

    def test_truncated_to_20_chars(self) -> None:
        long_text = "a" * 50
        result = safe_excerpt(long_text)
        assert len(result) <= _MAX_EXCERPT_CHARS

    def test_password_always_redacted(self) -> None:
        assert safe_excerpt("my-secret-pass", is_password=True) == "[REDACTED]"

    def test_rate_limited_placeholder(self) -> None:
        assert safe_excerpt("some message", is_rate_limited=True) == "[rate limited]"

    def test_password_takes_precedence(self) -> None:
        assert safe_excerpt("text", is_password=True, is_rate_limited=True) == "[REDACTED]"

    def test_token_redacted_in_excerpt(self) -> None:
        body = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"
        result = safe_excerpt(body)
        assert "ghp_" not in result
        assert "[REDACTED]" in result

    def test_telegram_token_redacted(self) -> None:
        body = "1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ_1234567890ab"
        result = safe_excerpt(body)
        assert "1234567890:" not in result

    def test_empty_body(self) -> None:
        assert safe_excerpt("") == ""


class TestMessageHash:
    def test_returns_sha256_hex(self) -> None:
        result = message_hash("hello")
        assert len(result) == 64
        assert all(c in "0123456789abcdef" for c in result)

    def test_consistent(self) -> None:
        assert message_hash("test") == message_hash("test")

    def test_different_inputs_different_hashes(self) -> None:
        assert message_hash("a") != message_hash("b")


class TestChannelMessageAccepted:
    def test_event_written(self, writer: AuditWriter, db: Database) -> None:
        writer.channel_message_accepted(
            session_id="sess-001",
            prompt_id="prompt-001",
            channel="telegram",
            user_id="telegram:12345",
            body="y",
            conversation_state="awaiting_input",
            accept_type="reply",
        )
        events = db.get_recent_audit_events(limit=1)
        assert len(events) == 1
        assert events[0]["event_type"] == "channel_message_accepted"
        assert events[0]["session_id"] == "sess-001"

    def test_payload_fields(self, writer: AuditWriter, db: Database) -> None:
        writer.channel_message_accepted(
            session_id="sess-002",
            prompt_id=None,
            channel="telegram",
            user_id="telegram:99",
            body="hello world",
            conversation_state="idle",
            accept_type="chat_turn",
        )
        events = db.get_recent_audit_events(limit=1)
        payload = json.loads(events[0]["payload"])
        assert payload["channel"] == "telegram"
        assert payload["user_id"] == "telegram:99"
        assert payload["conversation_state"] == "idle"
        assert payload["accept_type"] == "chat_turn"
        assert payload["message_hash"] == message_hash("hello world")
        assert payload["message_excerpt"] == "hello world"

    def test_no_raw_body_in_payload(self, writer: AuditWriter, db: Database) -> None:
        body = "this is my secret message"
        writer.channel_message_accepted(
            session_id="sess-003",
            prompt_id=None,
            channel="slack",
            user_id="U123",
            body=body,
            conversation_state="running",
            accept_type="interrupt",
        )
        events = db.get_recent_audit_events(limit=1)
        payload_str = events[0]["payload"]
        # Raw body must NOT appear in the payload
        assert body not in payload_str
        # But the hash and truncated excerpt should be there
        payload = json.loads(payload_str)
        assert payload["message_hash"] == message_hash(body)
        assert len(payload["message_excerpt"]) <= _MAX_EXCERPT_CHARS

    def test_password_excerpt_redacted(self, writer: AuditWriter, db: Database) -> None:
        writer.channel_message_accepted(
            session_id="sess-004",
            prompt_id="p-1",
            channel="telegram",
            user_id="telegram:1",
            body="SuperSecret123!",
            conversation_state="awaiting_input",
            accept_type="reply",
            is_password=True,
        )
        events = db.get_recent_audit_events(limit=1)
        payload = json.loads(events[0]["payload"])
        assert payload["message_excerpt"] == "[REDACTED]"
        # Raw body must not appear
        assert "SuperSecret" not in events[0]["payload"]


class TestChannelMessageRejected:
    def test_event_written(self, writer: AuditWriter, db: Database) -> None:
        writer.channel_message_rejected(
            session_id="sess-010",
            prompt_id=None,
            channel="telegram",
            user_id="telegram:55",
            body="hello during streaming",
            conversation_state="streaming",
            reason_code="reject_busy_streaming",
        )
        events = db.get_recent_audit_events(limit=1)
        assert len(events) == 1
        assert events[0]["event_type"] == "channel_message_rejected"

    def test_payload_fields(self, writer: AuditWriter, db: Database) -> None:
        writer.channel_message_rejected(
            session_id="sess-011",
            prompt_id=None,
            channel="slack",
            user_id="U999",
            body="test",
            conversation_state="streaming",
            reason_code="reject_busy_streaming",
        )
        events = db.get_recent_audit_events(limit=1)
        payload = json.loads(events[0]["payload"])
        assert payload["channel"] == "slack"
        assert payload["reason_code"] == "reject_busy_streaming"
        assert payload["message_hash"] == message_hash("test")

    def test_rate_limited_excerpt(self, writer: AuditWriter, db: Database) -> None:
        writer.channel_message_rejected(
            session_id="sess-012",
            prompt_id=None,
            channel="telegram",
            user_id="telegram:1",
            body="this is my actual message",
            conversation_state="running",
            reason_code="reject_rate_limited",
            is_rate_limited=True,
        )
        events = db.get_recent_audit_events(limit=1)
        payload = json.loads(events[0]["payload"])
        assert payload["message_excerpt"] == "[rate limited]"

    def test_password_rejection_redacted(self, writer: AuditWriter, db: Database) -> None:
        writer.channel_message_rejected(
            session_id="sess-013",
            prompt_id=None,
            channel="telegram",
            user_id="telegram:1",
            body="my-password-123",
            conversation_state="awaiting_input",
            reason_code="reject_unsafe_input_type",
            is_password=True,
        )
        events = db.get_recent_audit_events(limit=1)
        payload = json.loads(events[0]["payload"])
        assert payload["message_excerpt"] == "[REDACTED]"


class TestHashChainIntegrity:
    def test_chain_after_accept_and_reject(self, writer: AuditWriter, db: Database) -> None:
        writer.session_started("sess-chain", "claude", ["claude"])
        writer.channel_message_accepted(
            session_id="sess-chain",
            prompt_id=None,
            channel="telegram",
            user_id="telegram:1",
            body="y",
            conversation_state="awaiting_input",
            accept_type="reply",
        )
        writer.channel_message_rejected(
            session_id="sess-chain",
            prompt_id=None,
            channel="telegram",
            user_id="telegram:1",
            body="busy",
            conversation_state="streaming",
            reason_code="reject_busy_streaming",
        )

        events = db.get_recent_audit_events(limit=10)
        ordered = list(reversed(events))

        # Genesis event
        assert ordered[0]["prev_hash"] == ""
        # Chain links
        assert ordered[1]["prev_hash"] == ordered[0]["hash"]
        assert ordered[2]["prev_hash"] == ordered[1]["hash"]
        # All hashes are unique
        hashes = [e["hash"] for e in ordered]
        assert len(set(hashes)) == 3

    def test_no_chain_break(self, writer: AuditWriter, db: Database) -> None:
        """Gate events don't break the hash chain with pre-existing events."""
        sid = str(uuid.uuid4())
        writer.session_started(sid, "claude", ["claude"])
        writer.prompt_detected(sid, "p1", "yes_no", "high")
        writer.channel_message_accepted(
            session_id=sid,
            prompt_id="p1",
            channel="telegram",
            user_id="telegram:1",
            body="y",
            conversation_state="awaiting_input",
            accept_type="reply",
        )
        writer.reply_received(sid, "p1", "telegram:1", "y", "nonce-1")

        events = db.get_recent_audit_events(limit=10)
        ordered = list(reversed(events))

        # Verify chain is unbroken
        for i in range(1, len(ordered)):
            assert ordered[i]["prev_hash"] == ordered[i - 1]["hash"], (
                f"Chain broken at event {i}: "
                f"{ordered[i]['event_type']} prev_hash != {ordered[i - 1]['event_type']} hash"
            )
