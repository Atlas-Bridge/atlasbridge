"""Unit tests for workspace governance — trust, posture, TTL, scanner, policy context."""

from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from atlasbridge.core.store.migrations import run_migrations
from atlasbridge.core.store.workspace_trust import (
    _compute_scan_inputs_hash,
    _hash_path,
    _parse_ttl,
    _suggest_profile,
    build_trust_prompt,
    canonical_path,
    get_posture,
    get_trust,
    get_workspace_by_id,
    get_workspace_context,
    get_workspace_status,
    grant_trust,
    list_sessions_for_workspace,
    list_workspaces,
    normalise_trust_reply,
    revoke_trust,
    scan_workspace,
    set_posture,
)


@pytest.fixture()
def conn(tmp_path: Path) -> sqlite3.Connection:
    db_path = tmp_path / "test.db"
    c = sqlite3.connect(str(db_path))
    c.row_factory = sqlite3.Row
    run_migrations(c, db_path)
    yield c
    c.close()


# ---------------------------------------------------------------------------
# Determinism: canonical_path + path_hash
# ---------------------------------------------------------------------------


class TestPathDeterminism:
    def test_canonical_path_stable(self) -> None:
        """Same path always produces the same canonical path."""
        p = "/tmp/test-workspace"
        assert canonical_path(p) == canonical_path(p)

    def test_path_hash_stable(self) -> None:
        """Same path always produces the same hash."""
        p = "/tmp/test-workspace"
        assert _hash_path(p) == _hash_path(p)

    def test_symlink_hashes_match(self, tmp_path: Path) -> None:
        """Symlink and real path produce the same hash."""
        real = tmp_path / "real"
        real.mkdir()
        link = tmp_path / "link"
        link.symlink_to(real)
        assert _hash_path(str(real)) == _hash_path(str(link))

    def test_different_paths_different_hashes(self) -> None:
        h1 = _hash_path("/tmp/a")
        h2 = _hash_path("/tmp/b")
        assert h1 != h2


# ---------------------------------------------------------------------------
# TTL parsing
# ---------------------------------------------------------------------------


class TestParseTTL:
    def test_hours(self) -> None:
        delta = _parse_ttl("8h")
        assert delta == timedelta(hours=8)

    def test_days(self) -> None:
        delta = _parse_ttl("7d")
        assert delta == timedelta(days=7)

    def test_minutes(self) -> None:
        delta = _parse_ttl("30m")
        assert delta == timedelta(minutes=30)

    def test_invalid_suffix(self) -> None:
        with pytest.raises(ValueError, match="Unknown TTL suffix"):
            _parse_ttl("10s")

    def test_invalid_format(self) -> None:
        with pytest.raises(ValueError, match="Invalid TTL format"):
            _parse_ttl("abc")

    def test_empty(self) -> None:
        with pytest.raises(ValueError, match="must not be empty"):
            _parse_ttl("")

    def test_zero(self) -> None:
        with pytest.raises(ValueError, match="must be positive"):
            _parse_ttl("0h")


# ---------------------------------------------------------------------------
# Trust with TTL
# ---------------------------------------------------------------------------


class TestTrustWithTTL:
    def test_grant_with_ttl_string(self, conn: sqlite3.Connection) -> None:
        path = "/tmp/ttl-test"
        grant_trust(path, conn, actor="cli", ttl="8h")
        assert get_trust(path, conn) is True
        status = get_workspace_status(path, conn)
        assert status is not None
        assert status["trust_expires_at"] is not None

    def test_grant_with_ttl_seconds(self, conn: sqlite3.Connection) -> None:
        path = "/tmp/ttl-seconds"
        grant_trust(path, conn, actor="cli", ttl_seconds=3600)
        assert get_trust(path, conn) is True
        status = get_workspace_status(path, conn)
        assert status is not None
        assert status["trust_expires_at"] is not None

    def test_expired_ttl_returns_untrusted(self, conn: sqlite3.Connection) -> None:
        """When TTL expires, get_trust returns False."""
        path = "/tmp/expired-ttl"
        # Grant with a very short TTL (already expired)
        grant_trust(path, conn, actor="cli", ttl_seconds=1)
        # Manually set expires_at to the past
        ph = _hash_path(path)
        past = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
        conn.execute(
            "UPDATE workspace_trust SET trust_expires_at = ? WHERE path_hash = ?",
            (past, ph),
        )
        conn.commit()
        assert get_trust(path, conn) is False

    def test_ttl_expiry_deterministic(self, conn: sqlite3.Connection) -> None:
        """Same expired state is returned consistently."""
        path = "/tmp/deterministic-ttl"
        grant_trust(path, conn, actor="cli", ttl_seconds=1)
        ph = _hash_path(path)
        past = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
        conn.execute(
            "UPDATE workspace_trust SET trust_expires_at = ? WHERE path_hash = ?",
            (past, ph),
        )
        conn.commit()
        # Multiple calls should return the same result
        assert get_trust(path, conn) is False
        assert get_trust(path, conn) is False

    def test_status_shows_trust_expired_flag(self, conn: sqlite3.Connection) -> None:
        path = "/tmp/expired-flag"
        grant_trust(path, conn, actor="cli", ttl_seconds=1)
        ph = _hash_path(path)
        past = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
        conn.execute(
            "UPDATE workspace_trust SET trust_expires_at = ? WHERE path_hash = ?",
            (past, ph),
        )
        conn.commit()
        status = get_workspace_status(path, conn)
        assert status is not None
        assert status["trust_expired"] is True
        assert status["trust_state"] == "untrusted"

    def test_no_ttl_means_never_expires(self, conn: sqlite3.Connection) -> None:
        path = "/tmp/no-ttl"
        grant_trust(path, conn, actor="cli")
        assert get_trust(path, conn) is True
        status = get_workspace_status(path, conn)
        assert status["trust_expires_at"] is None
        assert status["trust_expired"] is False

    def test_cannot_specify_both_ttl_and_ttl_seconds(self, conn: sqlite3.Connection) -> None:
        with pytest.raises(ValueError, match="Cannot specify both"):
            grant_trust("/tmp/both", conn, ttl="8h", ttl_seconds=3600)


# ---------------------------------------------------------------------------
# Posture bindings
# ---------------------------------------------------------------------------


class TestPostureBindings:
    def test_set_and_get_posture(self, conn: sqlite3.Connection) -> None:
        path = "/tmp/posture-test"
        grant_trust(path, conn, actor="cli")
        status = get_workspace_status(path, conn)
        assert status is not None
        set_posture(
            status["id"],
            conn,
            profile_name="safe_refactor",
            autonomy_default="ASSIST",
        )
        posture = get_posture(status["id"], conn)
        assert posture is not None
        assert posture["profile_name"] == "safe_refactor"
        assert posture["autonomy_default"] == "ASSIST"

    def test_invalid_autonomy_mode(self, conn: sqlite3.Connection) -> None:
        path = "/tmp/bad-autonomy"
        grant_trust(path, conn, actor="cli")
        status = get_workspace_status(path, conn)
        with pytest.raises(ValueError, match="Invalid autonomy_default"):
            set_posture(status["id"], conn, autonomy_default="TURBO")

    def test_disallowed_field(self, conn: sqlite3.Connection) -> None:
        path = "/tmp/bad-field"
        grant_trust(path, conn, actor="cli")
        status = get_workspace_status(path, conn)
        with pytest.raises(ValueError, match="Disallowed posture fields"):
            set_posture(status["id"], conn, evil_field="hack")

    def test_posture_persists_on_list(self, conn: sqlite3.Connection) -> None:
        path = "/tmp/posture-list"
        grant_trust(path, conn, actor="cli")
        status = get_workspace_status(path, conn)
        set_posture(status["id"], conn, profile_name="plan_only")
        rows = list_workspaces(conn)
        found = [r for r in rows if r["path"] == path]
        assert len(found) == 1
        assert found[0]["profile_name"] == "plan_only"


# ---------------------------------------------------------------------------
# Workspace context for policy evaluation
# ---------------------------------------------------------------------------


class TestWorkspaceContext:
    def test_context_for_unknown_path(self, conn: sqlite3.Connection) -> None:
        ctx = get_workspace_context("/tmp/unknown", conn)
        assert ctx["workspace_id"] is None
        assert ctx["trust_state"] == "untrusted"
        assert ctx["profile_name"] is None

    def test_context_for_trusted_workspace(self, conn: sqlite3.Connection) -> None:
        path = "/tmp/ctx-trusted"
        grant_trust(path, conn, actor="cli")
        ctx = get_workspace_context(path, conn)
        assert ctx["workspace_id"] is not None
        assert ctx["trust_state"] == "trusted"

    def test_context_includes_posture(self, conn: sqlite3.Connection) -> None:
        path = "/tmp/ctx-posture"
        grant_trust(path, conn, actor="cli")
        status = get_workspace_status(path, conn)
        set_posture(status["id"], conn, profile_name="read_only_analysis")
        ctx = get_workspace_context(path, conn)
        assert ctx["profile_name"] == "read_only_analysis"

    def test_context_shows_expired_as_untrusted(self, conn: sqlite3.Connection) -> None:
        path = "/tmp/ctx-expired"
        grant_trust(path, conn, actor="cli", ttl_seconds=1)
        ph = _hash_path(path)
        past = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
        conn.execute(
            "UPDATE workspace_trust SET trust_expires_at = ? WHERE path_hash = ?",
            (past, ph),
        )
        conn.commit()
        ctx = get_workspace_context(path, conn)
        assert ctx["trust_state"] == "untrusted"


# ---------------------------------------------------------------------------
# Policy evaluator with workspace fields
# ---------------------------------------------------------------------------


class TestPolicyWithWorkspaceContext:
    def test_workspace_trusted_match(self) -> None:
        """Policy rule with workspace_trusted=true matches trusted workspace."""
        from atlasbridge.core.policy.evaluator import evaluate
        from atlasbridge.core.policy.model import AutoReplyAction
        from atlasbridge.core.policy.model_v1 import (
            MatchCriteriaV1,
            PolicyRuleV1,
            PolicyV1,
        )

        policy = PolicyV1(
            policy_version="1",
            name="workspace-test",
            rules=[
                PolicyRuleV1(
                    id="trusted-auto",
                    match=MatchCriteriaV1(workspace_trusted=True),
                    action=AutoReplyAction(value="yes"),
                ),
            ],
        )

        # Trusted workspace → should match
        decision = evaluate(
            policy,
            prompt_text="Continue?",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
            workspace_trusted=True,
        )
        assert decision.matched_rule_id == "trusted-auto"

        # Untrusted workspace → should NOT match (falls to default)
        decision2 = evaluate(
            policy,
            prompt_text="Continue?",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p2",
            session_id="s1",
            workspace_trusted=False,
        )
        assert decision2.matched_rule_id is None

    def test_workspace_profile_match(self) -> None:
        """Policy rule with workspace_profile matches specific profile."""
        from atlasbridge.core.policy.evaluator import evaluate
        from atlasbridge.core.policy.model import RequireHumanAction
        from atlasbridge.core.policy.model_v1 import (
            MatchCriteriaV1,
            PolicyRuleV1,
            PolicyV1,
        )

        policy = PolicyV1(
            policy_version="1",
            name="profile-test",
            rules=[
                PolicyRuleV1(
                    id="readonly-escalate",
                    match=MatchCriteriaV1(workspace_profile="read_only_analysis"),
                    action=RequireHumanAction(message="Read-only workspace"),
                ),
            ],
        )

        decision = evaluate(
            policy,
            prompt_text="Write file?",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
            workspace_profile="read_only_analysis",
        )
        assert decision.matched_rule_id == "readonly-escalate"


# ---------------------------------------------------------------------------
# Consent flow
# ---------------------------------------------------------------------------


class TestConsentFlow:
    def test_untrusted_workspace_needs_consent(self, conn: sqlite3.Connection) -> None:
        """An untrusted workspace should require a consent prompt."""
        path = "/tmp/consent-test"
        assert get_trust(path, conn) is False
        prompt = build_trust_prompt(path)
        assert path in prompt
        assert "yes" in prompt.lower() or "no" in prompt.lower()

    def test_trusted_workspace_no_consent(self, conn: sqlite3.Connection) -> None:
        """A trusted workspace should not need a consent prompt."""
        path = "/tmp/trusted-consent"
        grant_trust(path, conn, actor="cli")
        assert get_trust(path, conn) is True


# ---------------------------------------------------------------------------
# Advisory scanner
# ---------------------------------------------------------------------------


class TestAdvisoryScanner:
    def test_scan_determinism(self, conn: sqlite3.Connection, tmp_path: Path) -> None:
        """Same file listing + ruleset produces same classification."""
        workspace = tmp_path / "scan-test"
        workspace.mkdir()
        (workspace / "main.py").write_text("print('hello')")
        (workspace / "Dockerfile").write_text("FROM python:3.11")

        grant_trust(str(workspace), conn, actor="cli")
        result1 = scan_workspace(str(workspace), conn)
        result2 = scan_workspace(str(workspace), conn)

        assert result1["inputs_hash"] == result2["inputs_hash"]
        assert result1["risk_tags"] == result2["risk_tags"]

    def test_scan_detects_iac(self, conn: sqlite3.Connection, tmp_path: Path) -> None:
        workspace = tmp_path / "iac-test"
        workspace.mkdir()
        (workspace / "main.tf").write_text("resource 'aws_instance' {}")
        (workspace / "terraform.tfvars").write_text("region = us-east-1")

        grant_trust(str(workspace), conn, actor="cli")
        result = scan_workspace(str(workspace), conn)
        assert "iac" in result["risk_tags"]

    def test_scan_detects_secrets(self, conn: sqlite3.Connection, tmp_path: Path) -> None:
        workspace = tmp_path / "secrets-test"
        workspace.mkdir()
        (workspace / ".env").write_text("SECRET=abc")
        (workspace / "app.py").write_text("pass")

        grant_trust(str(workspace), conn, actor="cli")
        result = scan_workspace(str(workspace), conn)
        assert "secrets_present" in result["risk_tags"]

    def test_scan_detects_deployment(self, conn: sqlite3.Connection, tmp_path: Path) -> None:
        workspace = tmp_path / "deploy-test"
        workspace.mkdir()
        deploy_dir = workspace / ".github" / "workflows"
        deploy_dir.mkdir(parents=True)
        (deploy_dir / "ci.yml").write_text("on: push")

        grant_trust(str(workspace), conn, actor="cli")
        result = scan_workspace(str(workspace), conn)
        assert "deployment" in result["risk_tags"]

    def test_scan_no_risk_returns_unknown(self, conn: sqlite3.Connection, tmp_path: Path) -> None:
        workspace = tmp_path / "clean-test"
        workspace.mkdir()
        (workspace / "readme.txt").write_text("hello")

        grant_trust(str(workspace), conn, actor="cli")
        result = scan_workspace(str(workspace), conn)
        assert "unknown" in result["risk_tags"]

    def test_scan_idempotency(self, conn: sqlite3.Connection, tmp_path: Path) -> None:
        """Re-running scan with same files doesn't create duplicate artifacts."""
        workspace = tmp_path / "idempotent-scan"
        workspace.mkdir()
        (workspace / "Dockerfile").write_text("FROM alpine")

        grant_trust(str(workspace), conn, actor="cli")
        scan_workspace(str(workspace), conn)
        scan_workspace(str(workspace), conn)

        ph = _hash_path(str(workspace))
        wid = conn.execute("SELECT id FROM workspace_trust WHERE path_hash = ?", (ph,)).fetchone()[
            0
        ]
        count = conn.execute(
            "SELECT count(*) FROM workspace_scan_artifacts WHERE workspace_id = ?",
            (wid,),
        ).fetchone()[0]
        assert count == 1

    def test_inputs_hash_stability(self) -> None:
        """Same file listing always produces the same inputs_hash."""
        files = ["a.py", "b.py", "c/d.py"]
        h1 = _compute_scan_inputs_hash(files, "1.0.0")
        h2 = _compute_scan_inputs_hash(files, "1.0.0")
        assert h1 == h2

    def test_inputs_hash_order_independent(self) -> None:
        """File order doesn't affect hash (sorted internally)."""
        h1 = _compute_scan_inputs_hash(["b.py", "a.py"], "1.0.0")
        h2 = _compute_scan_inputs_hash(["a.py", "b.py"], "1.0.0")
        assert h1 == h2


# ---------------------------------------------------------------------------
# Profile suggestion
# ---------------------------------------------------------------------------


class TestProfileSuggestion:
    def test_secrets_and_deploy_suggests_readonly(self) -> None:
        assert _suggest_profile(["secrets_present", "deployment"]) == "read_only_analysis"

    def test_deployment_suggests_plan_only(self) -> None:
        assert _suggest_profile(["deployment"]) == "plan_only"

    def test_iac_suggests_plan_only(self) -> None:
        assert _suggest_profile(["iac"]) == "plan_only"

    def test_secrets_suggests_safe_refactor(self) -> None:
        assert _suggest_profile(["secrets_present"]) == "safe_refactor"

    def test_unknown_no_suggestion(self) -> None:
        assert _suggest_profile(["unknown"]) is None


# ---------------------------------------------------------------------------
# Workspace listing/query
# ---------------------------------------------------------------------------


class TestWorkspaceListing:
    def test_get_by_id(self, conn: sqlite3.Connection) -> None:
        grant_trust("/tmp/id-test", conn, actor="cli")
        rows = list_workspaces(conn)
        wid = rows[0]["id"]
        workspace = get_workspace_by_id(wid, conn)
        assert workspace is not None
        assert workspace["path"] == "/tmp/id-test"

    def test_get_by_id_not_found(self, conn: sqlite3.Connection) -> None:
        assert get_workspace_by_id("nonexistent", conn) is None

    def test_list_shows_ttl_state(self, conn: sqlite3.Connection) -> None:
        grant_trust("/tmp/list-ttl", conn, actor="cli", ttl="8h")
        rows = list_workspaces(conn)
        found = [r for r in rows if r["path"] == "/tmp/list-ttl"]
        assert len(found) == 1
        assert found[0]["trust_state"] == "trusted"
        assert found[0]["trust_expired"] is False

    def test_sessions_for_workspace(self, conn: sqlite3.Connection) -> None:
        """Sessions matching workspace cwd are returned."""
        path = "/tmp/sessions-test"
        grant_trust(path, conn, actor="cli")
        # Insert a session with matching cwd
        conn.execute(
            """
            INSERT INTO sessions (id, tool, command, cwd, status, started_at)
            VALUES ('s1', 'claude', '', ?, 'completed', datetime('now'))
            """,
            (canonical_path(path),),
        )
        conn.commit()
        sessions = list_sessions_for_workspace(path, conn)
        assert len(sessions) >= 1
        assert sessions[0]["id"] == "s1"


# ---------------------------------------------------------------------------
# Migration v7→v8
# ---------------------------------------------------------------------------


class TestMigration:
    def test_migration_adds_columns(self, tmp_path: Path) -> None:
        """Migration 7→8 adds posture/TTL columns to workspace_trust."""
        db_path = tmp_path / "migrate.db"
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        run_migrations(conn, db_path)

        # Check columns exist
        cursor = conn.execute("PRAGMA table_info(workspace_trust)")
        columns = {row[1] for row in cursor.fetchall()}
        assert "trust_expires_at" in columns
        assert "profile_name" in columns
        assert "autonomy_default" in columns
        assert "model_tier" in columns
        assert "tool_allowlist_profile" in columns
        assert "posture_notes" in columns
        assert "updated_at" in columns
        conn.close()

    def test_scan_artifacts_table_exists(self, tmp_path: Path) -> None:
        db_path = tmp_path / "scan.db"
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        run_migrations(conn, db_path)

        # Table should exist
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_scan_artifacts'"
        ).fetchone()
        assert row is not None
        conn.close()


# ---------------------------------------------------------------------------
# Backward compatibility
# ---------------------------------------------------------------------------


class TestBackwardCompatibility:
    """Ensure existing trust operations still work after migration."""

    def test_grant_without_ttl(self, conn: sqlite3.Connection) -> None:
        grant_trust("/tmp/compat", conn, actor="cli")
        assert get_trust("/tmp/compat", conn) is True

    def test_revoke_still_works(self, conn: sqlite3.Connection) -> None:
        grant_trust("/tmp/compat-revoke", conn, actor="cli")
        revoke_trust("/tmp/compat-revoke", conn)
        assert get_trust("/tmp/compat-revoke", conn) is False

    def test_list_returns_new_fields(self, conn: sqlite3.Connection) -> None:
        grant_trust("/tmp/compat-list", conn, actor="cli")
        rows = list_workspaces(conn)
        row = [r for r in rows if r["path"] == "/tmp/compat-list"][0]
        assert "trust_state" in row
        assert "trust_expired" in row
        assert "profile_name" in row

    def test_normalise_trust_reply_unchanged(self) -> None:
        assert normalise_trust_reply("yes") is True
        assert normalise_trust_reply("no") is False
        assert normalise_trust_reply("maybe") is None
