"""API contract tests for workspace governance endpoints."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

fastapi = pytest.importorskip("fastapi")

from atlasbridge.core.store.migrations import run_migrations  # noqa: E402
from atlasbridge.core.store.workspace_trust import grant_trust  # noqa: E402


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    """Create a test database with migrations applied."""
    path = tmp_path / "test.db"
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    run_migrations(conn, path)
    conn.close()
    return path


@pytest.fixture()
def db_with_workspace(db_path: Path) -> tuple[Path, str]:
    """Create a database with a workspace and return (db_path, workspace_id)."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    grant_trust("/tmp/test-workspace", conn, actor="test")
    row = conn.execute(
        "SELECT id FROM workspace_trust WHERE path = ?",
        ("/tmp/test-workspace",),
    ).fetchone()
    workspace_id = row[0]
    conn.close()
    return db_path, workspace_id


@pytest.fixture()
def client(db_path: Path, monkeypatch):
    """Create a test client for the dashboard app."""
    from starlette.testclient import TestClient

    from atlasbridge.dashboard.app import create_app

    # TestClient uses "testclient" as host — patch is_loopback so POST guards pass
    monkeypatch.setattr(
        "atlasbridge.dashboard.routers.workspaces.is_loopback",
        lambda host: True,
    )
    trace_path = db_path.parent / "trace.jsonl"
    trace_path.touch()
    app = create_app(db_path=db_path, trace_path=trace_path)
    return TestClient(app)


@pytest.fixture()
def client_with_workspace(db_with_workspace: tuple[Path, str], monkeypatch):
    """Create a test client with a pre-existing workspace."""
    from starlette.testclient import TestClient

    from atlasbridge.dashboard.app import create_app

    monkeypatch.setattr(
        "atlasbridge.dashboard.routers.workspaces.is_loopback",
        lambda host: True,
    )
    db_path, workspace_id = db_with_workspace
    trace_path = db_path.parent / "trace.jsonl"
    trace_path.touch()
    app = create_app(db_path=db_path, trace_path=trace_path)
    return TestClient(app), workspace_id


# ---------------------------------------------------------------------------
# GET /api/workspaces
# ---------------------------------------------------------------------------


class TestListWorkspacesAPI:
    def test_empty_list(self, client) -> None:
        resp = client.get("/api/workspaces")
        assert resp.status_code == 200
        data = resp.json()
        assert "workspaces" in data
        assert data["total"] == 0

    def test_with_workspace(self, client_with_workspace) -> None:
        client, wid = client_with_workspace
        resp = client.get("/api/workspaces")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        paths = [w["path"] for w in data["workspaces"]]
        assert "/tmp/test-workspace" in paths


# ---------------------------------------------------------------------------
# GET /api/workspaces/:id
# ---------------------------------------------------------------------------


class TestGetWorkspaceAPI:
    def test_found(self, client_with_workspace) -> None:
        client, wid = client_with_workspace
        resp = client.get(f"/api/workspaces/{wid}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == wid
        assert data["path"] == "/tmp/test-workspace"
        assert "trust_state" in data

    def test_not_found(self, client) -> None:
        resp = client.get("/api/workspaces/nonexistent-id")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/workspaces/:id/sessions
# ---------------------------------------------------------------------------


class TestWorkspaceSessionsAPI:
    def test_sessions_for_workspace(self, client_with_workspace) -> None:
        client, wid = client_with_workspace
        resp = client.get(f"/api/workspaces/{wid}/sessions")
        assert resp.status_code == 200
        data = resp.json()
        assert "sessions" in data
        assert "total" in data

    def test_sessions_not_found(self, client) -> None:
        resp = client.get("/api/workspaces/bad-id/sessions")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/workspaces/trust
# ---------------------------------------------------------------------------


class TestTrustAPI:
    def test_grant_trust(self, client) -> None:
        resp = client.post(
            "/api/workspaces/trust",
            json={"path": "/tmp/api-trust", "trust": True},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["trust"] is True

    def test_grant_trust_with_ttl(self, client) -> None:
        resp = client.post(
            "/api/workspaces/trust",
            json={"path": "/tmp/api-ttl", "trust": True, "ttl_seconds": 3600},
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_revoke_trust(self, client) -> None:
        # First grant
        client.post(
            "/api/workspaces/trust",
            json={"path": "/tmp/api-revoke", "trust": True},
        )
        # Then revoke
        resp = client.post(
            "/api/workspaces/trust",
            json={"path": "/tmp/api-revoke", "trust": False},
        )
        assert resp.status_code == 200
        assert resp.json()["trust"] is False

    def test_missing_path(self, client) -> None:
        resp = client.post("/api/workspaces/trust", json={"trust": True})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/workspaces/posture
# ---------------------------------------------------------------------------


class TestPostureAPI:
    def test_set_posture(self, client_with_workspace) -> None:
        client, wid = client_with_workspace
        resp = client.post(
            "/api/workspaces/posture",
            json={
                "workspace_id": wid,
                "profile_name": "safe_refactor",
                "autonomy_default": "ASSIST",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert "profile_name" in data["updated"]

    def test_missing_workspace_id(self, client) -> None:
        resp = client.post(
            "/api/workspaces/posture",
            json={"profile_name": "test"},
        )
        assert resp.status_code == 400

    def test_no_posture_fields(self, client_with_workspace) -> None:
        client, wid = client_with_workspace
        resp = client.post(
            "/api/workspaces/posture",
            json={"workspace_id": wid},
        )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/workspaces/scan
# ---------------------------------------------------------------------------


class TestScanAPI:
    def test_scan(self, client_with_workspace) -> None:
        client, wid = client_with_workspace
        resp = client.post(
            "/api/workspaces/scan",
            json={"workspace_id": wid},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "risk_tags" in data
        assert "inputs_hash" in data

    def test_scan_missing_id(self, client) -> None:
        resp = client.post("/api/workspaces/scan", json={})
        assert resp.status_code == 400

    def test_scan_not_found(self, client) -> None:
        resp = client.post(
            "/api/workspaces/scan",
            json={"workspace_id": "bad-id"},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# HTML routes
# ---------------------------------------------------------------------------


class TestHTMLRoutes:
    def test_workspaces_page(self, client) -> None:
        resp = client.get("/workspaces")
        assert resp.status_code == 200
        assert "Workspaces" in resp.text

    def test_workspace_detail_page(self, client_with_workspace) -> None:
        client, wid = client_with_workspace
        resp = client.get(f"/workspaces/{wid}")
        assert resp.status_code == 200
        assert "Workspace" in resp.text

    def test_workspace_detail_not_found(self, client) -> None:
        resp = client.get("/workspaces/nonexistent")
        assert resp.status_code == 200
        assert "Not Found" in resp.text
