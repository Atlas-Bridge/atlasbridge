"""
Safety test: Injection idempotency invariants.

Verifies correctness invariants from CLAUDE.md:
  1. No duplicate injection — nonce replay rejected (decide_prompt returns 0)
  2. No expired injection — TTL enforced in WHERE clause
  3. No cross-session injection — wrong nonce rejected
  4. No unauthorised injection — unknown prompt_id rejected

These invariants are tested via the decide_prompt() atomic SQL guard
in database.py.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from atlasbridge.core.store.database import Database


@pytest.fixture()
def db(tmp_path: Path) -> Database:
    """Create a fresh in-memory-like database for each test."""
    database = Database(tmp_path / "test.db")
    database.connect()
    # Insert a session record (foreign key dependency)
    database._db.execute(
        "INSERT INTO sessions (id, tool, command, status) VALUES (?, ?, ?, ?)",
        ("sess-001", "claude", "[]", "running"),
    )
    database._db.commit()
    yield database  # type: ignore[misc]
    database.close()


def _expires_at(seconds: float = 300.0) -> str:
    """SQLite-compatible datetime string (no T, no timezone suffix)."""
    dt = datetime.now(UTC) + timedelta(seconds=seconds)
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def _save_prompt(
    db: Database,
    prompt_id: str = "prompt-001",
    session_id: str = "sess-001",
    nonce: str = "nonce-abc",
    expires_in_seconds: int = 300,
) -> None:
    """Helper: insert a prompt in 'awaiting_reply' status."""
    db.save_prompt(
        prompt_id=prompt_id,
        session_id=session_id,
        prompt_type="yes_no",
        confidence="high",
        excerpt="Continue? [y/N]",
        nonce=nonce,
        expires_at=_expires_at(expires_in_seconds),
    )


class TestInjectionIdempotency:
    """Invariant: decide_prompt() atomic guard blocks invalid injections."""

    def test_successful_decide(self, db: Database) -> None:
        """Baseline: a valid decide with correct nonce returns 1."""
        _save_prompt(db)
        result = db.decide_prompt("prompt-001", "reply_received", "tg:123", "y", "nonce-abc")
        assert result == 1

    def test_duplicate_nonce_replay_rejected(self, db: Database) -> None:
        """Invariant 1: second decide with same nonce returns 0."""
        _save_prompt(db)
        first = db.decide_prompt("prompt-001", "reply_received", "tg:123", "y", "nonce-abc")
        assert first == 1
        second = db.decide_prompt("prompt-001", "reply_received", "tg:123", "y", "nonce-abc")
        assert second == 0, "Duplicate nonce replay must be rejected"

    def test_expired_prompt_rejected(self, db: Database) -> None:
        """Invariant 2: expired prompts are not injectable."""
        _save_prompt(db, expires_in_seconds=-10)
        result = db.decide_prompt("prompt-001", "reply_received", "tg:123", "y", "nonce-abc")
        assert result == 0, "Expired prompt must be rejected"

    def test_wrong_nonce_rejected(self, db: Database) -> None:
        """Invariant 3: wrong nonce is rejected."""
        _save_prompt(db)
        result = db.decide_prompt("prompt-001", "reply_received", "tg:123", "y", "wrong-nonce")
        assert result == 0, "Wrong nonce must be rejected"

    def test_unknown_prompt_id_rejected(self, db: Database) -> None:
        """Invariant 4: unknown prompt_id returns 0."""
        result = db.decide_prompt("nonexistent-id", "reply_received", "tg:123", "y", "nonce-abc")
        assert result == 0, "Unknown prompt_id must be rejected"

    def test_wrong_status_rejected(self, db: Database) -> None:
        """Decide fails if prompt is not in 'awaiting_reply' status."""
        _save_prompt(db)
        # Manually change status to 'resolved'
        db._db.execute("UPDATE prompts SET status = 'resolved' WHERE id = 'prompt-001'")
        db._db.commit()
        result = db.decide_prompt("prompt-001", "reply_received", "tg:123", "y", "nonce-abc")
        assert result == 0, "Prompt not in awaiting_reply must be rejected"

    def test_successful_decide_sets_nonce_used(self, db: Database) -> None:
        """After a successful decide, nonce_used must be 1."""
        _save_prompt(db)
        db.decide_prompt("prompt-001", "reply_received", "tg:123", "y", "nonce-abc")
        row = db.get_prompt("prompt-001")
        assert row is not None
        assert row["nonce_used"] == 1

    def test_decide_sets_resolved_at(self, db: Database) -> None:
        """After a successful decide, resolved_at must be populated."""
        _save_prompt(db)
        db.decide_prompt("prompt-001", "reply_received", "tg:123", "y", "nonce-abc")
        row = db.get_prompt("prompt-001")
        assert row is not None
        assert row["resolved_at"] is not None

    def test_decide_sets_channel_identity(self, db: Database) -> None:
        """Channel identity is recorded on successful decide."""
        _save_prompt(db)
        db.decide_prompt("prompt-001", "reply_received", "tg:123", "y", "nonce-abc")
        row = db.get_prompt("prompt-001")
        assert row is not None
        assert row["channel_identity"] == "tg:123"
