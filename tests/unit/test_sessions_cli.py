"""
Tests for `atlasbridge sessions` CLI commands.

Covers:
  - sessions list (default invocation, --json, --all, empty DB, no DB)
  - sessions show (full ID, short ID, ambiguous, not found, --json)
  - sessions --help (backward compat with CI smoke test)
  - cmd_sessions_list / cmd_sessions_show unit tests via Rich Console
"""

from __future__ import annotations

import json
from io import StringIO
from unittest.mock import MagicMock, patch

import pytest
from click.testing import CliRunner
from rich.console import Console

from atlasbridge.cli.main import cli


@pytest.fixture()
def runner() -> CliRunner:
    return CliRunner()


# ---------------------------------------------------------------------------
# Fake sqlite3.Row-like objects
# ---------------------------------------------------------------------------


class _FakeRow(dict):
    """Dict that also supports key access (like sqlite3.Row)."""

    def __getitem__(self, key):  # type: ignore[override]
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


def _make_console():
    buf = StringIO()
    return Console(file=buf, force_terminal=False), buf


_SESSION_A = _FakeRow(
    id="aaaa1111-2222-3333-4444-555566667777",
    tool="claude",
    status="running",
    pid=12345,
    started_at="2025-06-15T10:00:00+00:00",
    ended_at=None,
    exit_code=None,
    cwd="/home/user/project",
    label="feat-branch",
    command='["claude"]',
    metadata="{}",
)

_SESSION_B = _FakeRow(
    id="bbbb1111-2222-3333-4444-555566667777",
    tool="openai",
    status="completed",
    pid=54321,
    started_at="2025-06-14T09:00:00+00:00",
    ended_at="2025-06-14T10:30:00+00:00",
    exit_code=0,
    cwd="/tmp",
    label="",
    command='["openai"]',
    metadata="{}",
)

_PROMPT_1 = _FakeRow(
    id="pppp1111-2222-3333-4444-555566667777",
    session_id=_SESSION_A["id"],
    prompt_type="yes_no",
    confidence="high",
    status="resolved",
    created_at="2025-06-15T10:05:00+00:00",
    excerpt="Continue? [y/n]",
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _mock_db(
    sessions: list | None = None,
    active: list | None = None,
    session: _FakeRow | None = None,
    prompts: list | None = None,
) -> MagicMock:
    """Build a mock Database with preset return values."""
    db = MagicMock()
    db.list_sessions.return_value = sessions or []
    db.list_active_sessions.return_value = active if active is not None else (sessions or [])
    db.get_session.return_value = session
    db.list_prompts_for_session.return_value = prompts or []
    db.close = MagicMock()
    return db


def _patch_open_db(mock_db: MagicMock | None):
    """Patch _open_db to return the given mock (or None for no-DB scenario)."""
    return patch("atlasbridge.cli._sessions._open_db", return_value=mock_db)


# ---------------------------------------------------------------------------
# sessions --help (CI smoke test backward compat)
# ---------------------------------------------------------------------------


class TestSessionsHelp:
    def test_help_shows_subcommands(self, runner: CliRunner) -> None:
        result = runner.invoke(cli, ["sessions", "--help"])
        assert result.exit_code == 0
        assert "list" in result.output
        assert "show" in result.output

    def test_help_exit_zero(self, runner: CliRunner) -> None:
        result = runner.invoke(cli, ["sessions", "--help"])
        assert result.exit_code == 0


# ---------------------------------------------------------------------------
# sessions list (via CliRunner)
# ---------------------------------------------------------------------------


class TestSessionsList:
    def test_no_database(self, runner: CliRunner) -> None:
        with _patch_open_db(None):
            result = runner.invoke(cli, ["sessions", "list"])
        assert result.exit_code == 0
        assert "No active sessions" in result.output

    def test_no_database_json(self, runner: CliRunner) -> None:
        with _patch_open_db(None):
            result = runner.invoke(cli, ["sessions", "list", "--json"])
        assert result.exit_code == 0
        assert json.loads(result.output) == []

    def test_empty_active(self, runner: CliRunner) -> None:
        db = _mock_db(sessions=[], active=[])
        with _patch_open_db(db):
            result = runner.invoke(cli, ["sessions", "list"])
        assert result.exit_code == 0
        assert "No active sessions" in result.output

    def test_active_sessions_table(self, runner: CliRunner) -> None:
        db = _mock_db(active=[_SESSION_A])
        with _patch_open_db(db):
            result = runner.invoke(cli, ["sessions", "list"])
        assert result.exit_code == 0
        assert "aaaa1111" in result.output
        assert "claude" in result.output
        assert "running" in result.output

    def test_all_flag_includes_completed(self, runner: CliRunner) -> None:
        db = _mock_db(sessions=[_SESSION_A, _SESSION_B])
        with _patch_open_db(db):
            result = runner.invoke(cli, ["sessions", "list", "--all"])
        assert result.exit_code == 0
        db.list_sessions.assert_called_once_with(limit=50)
        assert "aaaa1111" in result.output
        assert "bbbb1111" in result.output

    def test_json_output(self, runner: CliRunner) -> None:
        db = _mock_db(active=[_SESSION_A])
        with _patch_open_db(db):
            result = runner.invoke(cli, ["sessions", "list", "--json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert len(data) == 1
        assert data[0]["tool"] == "claude"

    def test_limit_option(self, runner: CliRunner) -> None:
        db = _mock_db(sessions=[_SESSION_A])
        with _patch_open_db(db):
            result = runner.invoke(cli, ["sessions", "list", "--all", "--limit", "10"])
        assert result.exit_code == 0
        db.list_sessions.assert_called_once_with(limit=10)

    def test_default_invocation_runs_list(self, runner: CliRunner) -> None:
        """Running `sessions` without a subcommand defaults to `list`."""
        db = _mock_db(active=[_SESSION_A])
        with _patch_open_db(db):
            result = runner.invoke(cli, ["sessions"])
        assert result.exit_code == 0
        assert "aaaa1111" in result.output


# ---------------------------------------------------------------------------
# sessions show (via CliRunner)
# ---------------------------------------------------------------------------


class TestSessionsShow:
    def test_no_database(self, runner: CliRunner) -> None:
        with _patch_open_db(None):
            result = runner.invoke(cli, ["sessions", "show", "aaaa1111"])
        assert result.exit_code != 0
        assert "No database" in result.output

    def test_full_id(self, runner: CliRunner) -> None:
        db = _mock_db(session=_SESSION_A, prompts=[_PROMPT_1])
        with _patch_open_db(db):
            result = runner.invoke(cli, ["sessions", "show", _SESSION_A["id"]])
        assert result.exit_code == 0
        assert "claude" in result.output
        assert "running" in result.output
        assert "feat-branch" in result.output
        assert "Prompts" in result.output
        assert "yes_no" in result.output

    def test_short_id_prefix_match(self, runner: CliRunner) -> None:
        db = _mock_db(prompts=[])
        db.get_session.side_effect = lambda sid: _SESSION_A if sid == _SESSION_A["id"] else None
        db.list_sessions.return_value = [_SESSION_A, _SESSION_B]
        with _patch_open_db(db):
            result = runner.invoke(cli, ["sessions", "show", "aaaa"])
        assert result.exit_code == 0
        assert "claude" in result.output

    def test_ambiguous_id(self, runner: CliRunner) -> None:
        s1 = _FakeRow(**{**_SESSION_A, "id": "aaaa1111-one"})
        s2 = _FakeRow(**{**_SESSION_B, "id": "aaaa1111-two"})
        db = _mock_db()
        db.get_session.return_value = None
        db.list_sessions.return_value = [s1, s2]
        with _patch_open_db(db):
            result = runner.invoke(cli, ["sessions", "show", "aaaa1111"])
        assert result.exit_code != 0
        assert "Ambiguous" in result.output

    def test_not_found(self, runner: CliRunner) -> None:
        db = _mock_db()
        db.get_session.return_value = None
        db.list_sessions.return_value = []
        with _patch_open_db(db):
            result = runner.invoke(cli, ["sessions", "show", "nonexistent"])
        assert result.exit_code != 0
        assert "not found" in result.output

    def test_json_output(self, runner: CliRunner) -> None:
        db = _mock_db(session=_SESSION_A, prompts=[_PROMPT_1])
        with _patch_open_db(db):
            result = runner.invoke(cli, ["sessions", "show", _SESSION_A["id"], "--json"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["tool"] == "claude"
        assert len(data["prompts"]) == 1
        assert data["prompts"][0]["prompt_type"] == "yes_no"

    def test_no_prompts(self, runner: CliRunner) -> None:
        db = _mock_db(session=_SESSION_A, prompts=[])
        with _patch_open_db(db):
            result = runner.invoke(cli, ["sessions", "show", _SESSION_A["id"]])
        assert result.exit_code == 0
        assert "Prompts:   0" in result.output


# ---------------------------------------------------------------------------
# Direct unit tests for cmd_sessions_list (via Rich Console buffer)
# ---------------------------------------------------------------------------


class TestCmdSessionsListDirect:
    def test_no_db_shows_empty(self) -> None:
        from atlasbridge.cli._sessions import cmd_sessions_list

        console, buf = _make_console()
        with _patch_open_db(None):
            cmd_sessions_list(as_json=False, show_all=False, limit=50, console=console)
        output = buf.getvalue()
        assert "No active sessions" in output

    def test_one_session_table(self) -> None:
        from atlasbridge.cli._sessions import cmd_sessions_list

        console, buf = _make_console()
        db = _mock_db(active=[_SESSION_A])
        with _patch_open_db(db):
            cmd_sessions_list(as_json=False, show_all=False, limit=50, console=console)
        output = buf.getvalue()
        assert "aaaa1111" in output
        assert "claude" in output

    def test_json_output(self, capsys) -> None:
        from atlasbridge.cli._sessions import cmd_sessions_list

        console, _ = _make_console()
        db = _mock_db(active=[_SESSION_A])
        with _patch_open_db(db):
            cmd_sessions_list(as_json=True, show_all=False, limit=50, console=console)
        captured = capsys.readouterr()
        data = json.loads(captured.out)
        assert isinstance(data, list)
        assert len(data) == 1
        assert data[0]["tool"] == "claude"
