"""QA-013: multi-session — Two sessions do not cross-contaminate decide_prompt."""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from tests.prompt_lab.simulator import (
    LabScenario,
    PTYSimulator,
    ScenarioRegistry,
    ScenarioResults,
    TelegramStub,
)
from aegis.core.store.database import Database


@ScenarioRegistry.register
class MultiSessionScenario(LabScenario):
    scenario_id = "QA-013"
    name = "multi-session"

    async def setup(self, pty: PTYSimulator, stub: TelegramStub) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "qa013.db"
            db = Database(db_path)
            db.connect()
            try:
                sid_a = str(uuid.uuid4())
                sid_b = str(uuid.uuid4())
                pid_a = str(uuid.uuid4())
                pid_b = str(uuid.uuid4())
                nonce_a = secrets.token_hex(16)
                nonce_b = secrets.token_hex(16)
                expires_at = (datetime.now(UTC) + timedelta(seconds=600)).strftime(
                    "%Y-%m-%d %H:%M:%S"
                )

                db.save_session(sid_a, tool="claude", command=["claude"], cwd="/tmp")
                db.save_session(sid_b, tool="gemini", command=["gemini"], cwd="/tmp")

                db.save_prompt(
                    prompt_id=pid_a,
                    session_id=sid_a,
                    prompt_type="yes_no",
                    confidence="high",
                    excerpt="Session A prompt",
                    nonce=nonce_a,
                    expires_at=expires_at,
                )
                db.save_prompt(
                    prompt_id=pid_b,
                    session_id=sid_b,
                    prompt_type="yes_no",
                    confidence="high",
                    excerpt="Session B prompt",
                    nonce=nonce_b,
                    expires_at=expires_at,
                )

                # Deciding session A's prompt with session B's nonce must fail
                rows_cross = db.decide_prompt(pid_a, "reply_received", "telegram:1", "y", nonce_b)
                assert rows_cross == 0, (
                    f"Cross-session nonce must be rejected, got rowcount={rows_cross}"
                )

                # Deciding session A's prompt with correct nonce must succeed
                rows_ok = db.decide_prompt(pid_a, "reply_received", "telegram:1", "y", nonce_a)
                assert rows_ok == 1, f"Correct nonce must succeed, got rowcount={rows_ok}"

                # Session B's prompt is still pending — different session
                rows_b = db.decide_prompt(pid_b, "reply_received", "telegram:1", "n", nonce_b)
                assert rows_b == 1, f"Session B prompt should still be decidable, got {rows_b}"
            finally:
                db.close()

    def assert_results(self, results: ScenarioResults) -> None:
        assert results.error == "", f"Scenario error: {results.error}"
