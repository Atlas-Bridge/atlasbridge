"""Tests for dashboard FastAPI server endpoints."""

from __future__ import annotations

from pathlib import Path

import pytest

fastapi = pytest.importorskip("fastapi")


class TestHomeEndpoint:
    def test_home_returns_200(self, client):
        response = client.get("/")
        assert response.status_code == 200

    def test_home_contains_banner(self, client):
        response = client.get("/")
        assert "READ-ONLY GOVERNANCE VIEW" in response.text

    def test_home_shows_stats(self, client):
        response = client.get("/")
        assert "Total Sessions" in response.text

    def test_home_shows_sessions(self, client):
        response = client.get("/")
        assert "sess-001" in response.text

    def test_home_filter_by_status(self, client):
        response = client.get("/?status=running")
        assert response.status_code == 200
        assert "sess-001" in response.text
        # completed session should not appear
        assert "sess-002" not in response.text

    def test_home_filter_by_tool(self, client):
        response = client.get("/?tool=gemini")
        assert response.status_code == 200
        assert "sess-003" in response.text
        assert "sess-001" not in response.text

    def test_home_search(self, client):
        response = client.get("/?q=sess-004")
        assert response.status_code == 200
        assert "sess-004" in response.text

    def test_home_filter_no_results(self, client):
        response = client.get("/?status=nonexistent")
        assert response.status_code == 200


class TestSessionDetailEndpoint:
    def test_session_detail_returns_200(self, client):
        response = client.get("/sessions/sess-001")
        assert response.status_code == 200

    def test_session_detail_shows_prompts(self, client):
        response = client.get("/sessions/sess-001")
        assert "prompt-001" in response.text

    def test_session_detail_not_found(self, client):
        response = client.get("/sessions/nonexistent")
        assert response.status_code == 200
        assert "not found" in response.text.lower()

    def test_session_detail_shows_trace_entries(self, client):
        response = client.get("/sessions/sess-001")
        assert response.status_code == 200
        # sess-001 has 3 trace entries
        assert "auto_respond" in response.text


class TestTracesListEndpoint:
    def test_traces_list_returns_200(self, client):
        response = client.get("/traces")
        assert response.status_code == 200

    def test_traces_list_shows_entries(self, client):
        response = client.get("/traces")
        assert "auto_respond" in response.text or "escalate" in response.text

    def test_traces_list_filter_action_type(self, client):
        response = client.get("/traces?action_type=escalate")
        assert response.status_code == 200

    def test_traces_list_filter_confidence(self, client):
        response = client.get("/traces?confidence=high")
        assert response.status_code == 200

    def test_traces_list_pagination(self, client):
        response = client.get("/traces?page=1")
        assert response.status_code == 200


class TestTraceDetailEndpoint:
    def test_trace_detail_returns_200(self, client):
        response = client.get("/traces/0")
        assert response.status_code == 200

    def test_trace_detail_not_found(self, client):
        response = client.get("/traces/999")
        assert response.status_code == 200
        assert "not found" in response.text.lower()


class TestIntegrityEndpoint:
    def test_integrity_returns_200(self, client):
        response = client.get("/integrity")
        assert response.status_code == 200

    def test_integrity_shows_status(self, client):
        response = client.get("/integrity")
        assert "VERIFIED" in response.text


class TestApiStatsEndpoint:
    def test_api_stats_returns_json(self, client):
        response = client.get("/api/stats")
        assert response.status_code == 200
        data = response.json()
        assert "sessions" in data
        assert "prompts" in data
        assert "audit_events" in data
        assert "active_sessions" in data
        assert data["sessions"] == 4

    def test_api_stats_values(self, client):
        data = client.get("/api/stats").json()
        assert data["active_sessions"] == 2


class TestApiSessionsEndpoint:
    def test_api_sessions_returns_json(self, client):
        response = client.get("/api/sessions")
        assert response.status_code == 200
        data = response.json()
        assert "sessions" in data
        assert "total" in data
        assert data["total"] == 4

    def test_api_sessions_filter_by_status(self, client):
        data = client.get("/api/sessions?status=running").json()
        assert data["total"] == 2
        assert all(s["status"] == "running" for s in data["sessions"])

    def test_api_sessions_filter_by_tool(self, client):
        data = client.get("/api/sessions?tool=openai").json()
        assert data["total"] == 1


class TestIntegrityApiEndpoint:
    def test_verify_returns_json(self, client):
        response = client.post("/api/integrity/verify")
        assert response.status_code == 200
        data = response.json()
        assert "trace" in data
        assert "audit" in data
        assert data["trace"]["valid"] is True
        assert "verified_at" in data

    def test_verify_throttle_returns_429(self, client):
        # First call succeeds
        r1 = client.post("/api/integrity/verify")
        assert r1.status_code == 200
        # Second call within cooldown returns 429
        r2 = client.post("/api/integrity/verify")
        assert r2.status_code == 429
        assert "Too many requests" in r2.json()["error"]


class TestTimeagoFilter:
    def test_timeago_available_in_templates(self, client):
        """The timeago filter should be registered — pages render without error."""
        response = client.get("/")
        assert response.status_code == 200

    def test_timeago_function_directly(self):
        from atlasbridge.dashboard.app import _timeago

        assert _timeago(None) == ""
        assert _timeago("") == ""
        assert "ago" in _timeago("2020-01-01T00:00:00") or "mo" in _timeago("2020-01-01T00:00:00")
        assert _timeago("invalid") == "invalid"


class TestStaticAssets:
    def test_css_served(self, client):
        response = client.get("/static/style.css")
        assert response.status_code == 200
        assert "text/css" in response.headers.get("content-type", "")

    def test_js_served(self, client):
        response = client.get("/static/dashboard.js")
        assert response.status_code == 200
        assert "javascript" in response.headers.get("content-type", "")


class TestNoDataState:
    def test_home_with_no_db(self, tmp_path):
        from atlasbridge.dashboard.app import create_app
        from starlette.testclient import TestClient

        app = create_app(
            db_path=tmp_path / "missing.db",
            trace_path=tmp_path / "missing.jsonl",
        )
        client = TestClient(app)
        response = client.get("/")
        assert response.status_code == 200
        assert "No data yet" in response.text

    def test_traces_with_no_trace_file(self, tmp_path):
        from atlasbridge.dashboard.app import create_app
        from starlette.testclient import TestClient

        app = create_app(
            db_path=tmp_path / "missing.db",
            trace_path=tmp_path / "missing.jsonl",
        )
        client = TestClient(app)
        response = client.get("/traces")
        assert response.status_code == 200
