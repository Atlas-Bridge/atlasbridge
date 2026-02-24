"""
AI Safety Regression — Boundary and edge case test vectors.

Tests extreme input sizes, unicode boundaries, empty values,
and type enum enforcement. These are the "weird machine" tests
that catch bugs at system boundaries.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from atlasbridge.core.policy.evaluator import evaluate
from atlasbridge.core.policy.model import (
    AutonomyMode,
    Policy,
    PolicyDefaults,
)
from atlasbridge.core.prompt.models import Confidence, PromptType
from atlasbridge.core.store.database import Database

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def db(tmp_path):
    d = Database(tmp_path / "boundary.db")
    d.connect()
    # Insert session records for FK constraints
    d._db.execute(
        "INSERT INTO sessions (id, tool, command, status) VALUES (?, ?, ?, ?)",
        ("s-1", "claude", "[]", "running"),
    )
    d._db.commit()
    yield d
    d.close()


def _policy(rules=None):
    return Policy(
        name="boundary-test",
        policy_version="0",
        autonomy_mode=AutonomyMode.FULL,
        rules=rules or [],
        defaults=PolicyDefaults(),
    )


def _eval(policy, **kwargs):
    defaults = {
        "prompt_text": "Continue?",
        "prompt_type": "yes_no",
        "confidence": "high",
        "prompt_id": "b-test",
        "session_id": "b-session",
    }
    defaults.update(kwargs)
    return evaluate(policy=policy, **defaults)


# ---------------------------------------------------------------------------
# 1. Prompt type enum values
# ---------------------------------------------------------------------------


class TestPromptTypeEnum:
    """All canonical PromptType values must be accepted."""

    def test_all_prompt_types_exist(self):
        expected = {"yes_no", "confirm_enter", "multiple_choice", "free_text"}
        actual = {pt.value for pt in PromptType}
        assert expected.issubset(actual)

    @pytest.mark.parametrize("pt", [pt.value for pt in PromptType])
    def test_each_prompt_type_evaluates(self, pt: str):
        """Policy evaluation must handle every PromptType without error."""
        d = _eval(_policy(), prompt_type=pt)
        assert d.action_type in ("require_human", "deny", "auto_reply")


# ---------------------------------------------------------------------------
# 2. Confidence enum values
# ---------------------------------------------------------------------------


class TestConfidenceEnum:
    def test_all_confidence_levels_exist(self):
        expected = {"low", "medium", "high"}
        actual = {c.value for c in Confidence}
        assert expected.issubset(actual)

    @pytest.mark.parametrize("conf", [c.value for c in Confidence])
    def test_each_confidence_evaluates(self, conf: str):
        d = _eval(_policy(), confidence=conf)
        assert d.action_type in ("require_human", "deny", "auto_reply")


# ---------------------------------------------------------------------------
# 3. Empty / blank inputs
# ---------------------------------------------------------------------------


class TestEmptyInputs:
    def test_empty_prompt_text(self):
        d = _eval(_policy(), prompt_text="")
        assert d.action_type == "require_human"

    def test_whitespace_only_prompt(self):
        d = _eval(_policy(), prompt_text="   \n\t  ")
        assert d.action_type == "require_human"

    def test_empty_tool_id(self):
        d = _eval(_policy(), tool_id="")
        assert d.action_type == "require_human"


# ---------------------------------------------------------------------------
# 4. Maximum length inputs
# ---------------------------------------------------------------------------


class TestMaxLength:
    def test_huge_prompt_text(self):
        """100KB prompt text must not crash the evaluator."""
        text = "Y" * 100_000
        d = _eval(_policy(), prompt_text=text)
        assert d.action_type in ("require_human", "deny", "auto_reply")

    def test_huge_session_id(self):
        d = _eval(_policy(), session_id="s" * 10_000)
        assert d.action_type in ("require_human", "deny", "auto_reply")

    def test_huge_tool_id(self):
        d = _eval(_policy(), tool_id="t" * 10_000)
        assert d.action_type in ("require_human", "deny", "auto_reply")


# ---------------------------------------------------------------------------
# 5. Unicode edge cases in policy evaluation
# ---------------------------------------------------------------------------


class TestUnicodeBoundary:
    def test_unicode_prompt_text(self):
        d = _eval(_policy(), prompt_text="\u00e9\u00e8\u00ea\u00eb continue?")
        assert d.action_type in ("require_human", "deny", "auto_reply")

    def test_cjk_prompt_text(self):
        d = _eval(_policy(), prompt_text="\u7ee7\u7eed\uff1f [y/n]")
        assert d.action_type in ("require_human", "deny", "auto_reply")

    def test_emoji_in_prompt(self):
        d = _eval(_policy(), prompt_text="\U0001f680 Deploy? [y/n]")
        assert d.action_type in ("require_human", "deny", "auto_reply")

    def test_rtl_marks(self):
        d = _eval(_policy(), prompt_text="\u202eContinue? [y/n]")
        assert d.action_type in ("require_human", "deny", "auto_reply")


# ---------------------------------------------------------------------------
# 6. Database boundary tests
# ---------------------------------------------------------------------------


class TestDatabaseBoundary:
    def test_save_prompt_with_empty_excerpt(self, db: Database):
        expires = (datetime.now(UTC) + timedelta(seconds=300)).strftime("%Y-%m-%d %H:%M:%S")
        db.save_prompt(
            prompt_id="p-empty",
            session_id="s-1",
            prompt_type="yes_no",
            confidence="high",
            excerpt="",
            nonce="n-1",
            expires_at=expires,
        )
        row = db.get_prompt("p-empty")
        assert row is not None
        assert row["excerpt"] == ""

    def test_save_prompt_with_long_excerpt(self, db: Database):
        expires = (datetime.now(UTC) + timedelta(seconds=300)).strftime("%Y-%m-%d %H:%M:%S")
        long_text = "X" * 50_000
        db.save_prompt(
            prompt_id="p-long",
            session_id="s-1",
            prompt_type="yes_no",
            confidence="high",
            excerpt=long_text,
            nonce="n-1",
            expires_at=expires,
        )
        row = db.get_prompt("p-long")
        assert row is not None
        assert len(row["excerpt"]) == 50_000

    def test_duplicate_prompt_id_rejected(self, db: Database):
        expires = (datetime.now(UTC) + timedelta(seconds=300)).strftime("%Y-%m-%d %H:%M:%S")
        db.save_prompt("p-dup", "s-1", "yes_no", "high", "?", "n1", expires)
        import sqlite3

        with pytest.raises(sqlite3.IntegrityError):
            db.save_prompt("p-dup", "s-1", "yes_no", "high", "?", "n2", expires)


# ---------------------------------------------------------------------------
# 7. Audit writer boundary tests
# ---------------------------------------------------------------------------


class TestAuditBoundary:
    def test_audit_event_with_empty_payload(self, db: Database):
        from atlasbridge.core.audit.writer import AuditWriter

        writer = AuditWriter(db)
        writer.prompt_expired("s1", "p1")
        events = db._db.execute("SELECT * FROM audit_events").fetchall()
        assert len(events) == 1
        assert events[0]["event_type"] == "prompt_expired"

    def test_audit_event_with_large_payload(self, db: Database):
        """Large payloads must not crash the hash chain."""
        from atlasbridge.core.audit.writer import AuditWriter

        writer = AuditWriter(db)
        writer.session_started("s1", "claude", ["claude"] + ["--arg"] * 1000)
        events = db._db.execute("SELECT * FROM audit_events").fetchall()
        assert len(events) == 1
        assert len(events[0]["hash"]) == 64  # valid SHA-256

    def test_audit_hash_chain_after_many_events(self, db: Database):
        """Write 100 events and verify chain integrity."""
        verify_mod = pytest.importorskip(
            "atlasbridge.core.audit.verify",
            reason="verify module not yet merged (PR #321)",
        )
        from atlasbridge.core.audit.writer import AuditWriter

        writer = AuditWriter(db)
        for i in range(100):
            writer.prompt_detected(f"s-{i % 5}", f"p-{i}", "yes_no", "high")

        result = verify_mod.verify_audit_chain(db)
        assert result.valid is True
        assert result.total_events == 100
        assert result.verified_events == 100


# ---------------------------------------------------------------------------
# 8. Secret redaction boundary
# ---------------------------------------------------------------------------


class TestSecretRedactionBoundary:
    def test_empty_string(self):
        from atlasbridge.core.audit.writer import safe_excerpt

        assert safe_excerpt("") == ""

    def test_short_string_passthrough(self):
        from atlasbridge.core.audit.writer import safe_excerpt

        assert safe_excerpt("hello") == "hello"

    def test_exactly_20_chars(self):
        from atlasbridge.core.audit.writer import safe_excerpt

        text = "A" * 20
        assert safe_excerpt(text) == text

    def test_21_chars_truncated(self):
        from atlasbridge.core.audit.writer import safe_excerpt

        text = "A" * 21
        assert len(safe_excerpt(text)) == 20
