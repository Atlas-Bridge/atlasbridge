"""Unit tests for operator directives (free-text input from dashboard)."""

from __future__ import annotations

from pathlib import Path

import pytest

from atlasbridge.core.store.database import Database


@pytest.fixture
def db(tmp_path: Path) -> Database:
    """Create a fresh database with all migrations applied."""
    db_path = tmp_path / "test.db"
    d = Database(db_path)
    d.connect()
    return d


class TestInsertOperatorDirective:
    def test_insert_returns_id(self, db: Database) -> None:
        directive_id = db.insert_operator_directive("session-1", "hello agent")
        assert isinstance(directive_id, str)
        assert len(directive_id) == 32  # uuid hex

    def test_insert_creates_pending_record(self, db: Database) -> None:
        directive_id = db.insert_operator_directive("session-1", "do something")
        rows = db.list_pending_directives()
        assert len(rows) == 1
        assert rows[0]["id"] == directive_id
        assert rows[0]["session_id"] == "session-1"
        assert rows[0]["content"] == "do something"
        assert rows[0]["status"] == "pending"
        assert rows[0]["actor"] == "dashboard"

    def test_insert_custom_actor(self, db: Database) -> None:
        db.insert_operator_directive("session-1", "test", actor="cli")
        rows = db.list_pending_directives()
        assert rows[0]["actor"] == "cli"


class TestListPendingDirectives:
    def test_empty_when_no_directives(self, db: Database) -> None:
        assert db.list_pending_directives() == []

    def test_returns_only_pending(self, db: Database) -> None:
        d1 = db.insert_operator_directive("s1", "first")
        db.insert_operator_directive("s2", "second")
        db.mark_directive_processed(d1)

        pending = db.list_pending_directives()
        assert len(pending) == 1
        assert pending[0]["content"] == "second"

    def test_ordered_by_created_at(self, db: Database) -> None:
        db.insert_operator_directive("s1", "first")
        db.insert_operator_directive("s1", "second")
        db.insert_operator_directive("s1", "third")

        pending = db.list_pending_directives()
        assert [r["content"] for r in pending] == ["first", "second", "third"]


class TestMarkDirectiveProcessed:
    def test_marks_processed(self, db: Database) -> None:
        directive_id = db.insert_operator_directive("s1", "test")
        db.mark_directive_processed(directive_id)

        pending = db.list_pending_directives()
        assert len(pending) == 0

    def test_sets_processed_at(self, db: Database) -> None:
        directive_id = db.insert_operator_directive("s1", "test")
        db.mark_directive_processed(directive_id)

        row = db._db.execute(
            "SELECT * FROM operator_directives WHERE id = ?", (directive_id,)
        ).fetchone()
        assert row["status"] == "processed"
        assert row["processed_at"] is not None


class TestTranscriptWriterRole:
    def test_record_input_default_role(self, db: Database) -> None:
        from atlasbridge.core.store.transcript import TranscriptWriter

        tw = TranscriptWriter(db, "session-1")
        tw.record_input("hello", prompt_id="p1")

        chunks = db.list_transcript_chunks("session-1")
        assert len(chunks) == 1
        assert chunks[0]["role"] == "user"

    def test_record_input_operator_role(self, db: Database) -> None:
        from atlasbridge.core.store.transcript import TranscriptWriter

        tw = TranscriptWriter(db, "session-1")
        tw.record_input("operator message", role="operator")

        chunks = db.list_transcript_chunks("session-1")
        assert len(chunks) == 1
        assert chunks[0]["role"] == "operator"
        assert chunks[0]["content"] == "operator message"


class TestMigrationV9:
    def test_operator_directives_table_exists(self, db: Database) -> None:
        """Migration v8→v9 creates the operator_directives table."""
        tables = db._db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='operator_directives'"
        ).fetchall()
        assert len(tables) == 1
