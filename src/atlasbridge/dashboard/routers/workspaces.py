"""Workspace governance dashboard routes.

Routes registered here:
    GET  /workspaces                       — HTML workspace list page
    GET  /workspaces/{workspace_id}        — HTML workspace detail page
    GET  /api/workspaces                   — JSON list
    GET  /api/workspaces/{workspace_id}    — JSON detail
    GET  /api/workspaces/{workspace_id}/sessions — JSON sessions for workspace
    POST /api/workspaces/trust             — Grant/revoke trust
    POST /api/workspaces/posture           — Set posture bindings
    POST /api/workspaces/scan              — Run advisory scan

All mutation endpoints are localhost-only and audited.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from atlasbridge.dashboard.repo import DashboardRepo
from atlasbridge.dashboard.sanitize import is_loopback

_log = logging.getLogger("atlasbridge.dashboard.workspaces")


def make_workspace_router(
    repo: DashboardRepo,
    templates: Jinja2Templates,
    db_path: Path,
) -> APIRouter:
    """Create the APIRouter for workspace governance routes."""
    router = APIRouter()

    def _get_rw_conn():
        """Open a read-write connection for mutation endpoints."""
        import sqlite3

        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _check_localhost(request: Request) -> bool:
        """Verify request originates from localhost."""
        client = request.client
        if not client:
            return False
        return is_loopback(client.host)

    # ------------------------------------------------------------------
    # HTML routes
    # ------------------------------------------------------------------

    @router.get("/workspaces", response_class=HTMLResponse)
    async def workspaces_page(request: Request):
        workspaces = _list_workspaces_from_repo()
        return templates.TemplateResponse(
            request,
            "workspaces.html",
            {
                "workspaces": workspaces,
                "db_available": repo.db_available,
            },
        )

    @router.get("/workspaces/{workspace_id}", response_class=HTMLResponse)
    async def workspace_detail_page(request: Request, workspace_id: str):
        workspace = _get_workspace_by_id(workspace_id)
        sessions: list = []
        if workspace:
            sessions = _list_sessions_for_workspace(workspace.get("path", ""))
        return templates.TemplateResponse(
            request,
            "workspace_detail.html",
            {
                "workspace": workspace,
                "sessions": sessions,
                "db_available": repo.db_available,
            },
        )

    # ------------------------------------------------------------------
    # JSON API routes
    # ------------------------------------------------------------------

    @router.get("/api/workspaces")
    async def api_list_workspaces():
        workspaces = _list_workspaces_from_repo()
        return JSONResponse({"workspaces": workspaces, "total": len(workspaces)})

    @router.get("/api/workspaces/{workspace_id}")
    async def api_get_workspace(workspace_id: str):
        workspace = _get_workspace_by_id(workspace_id)
        if not workspace:
            return JSONResponse({"error": "Workspace not found"}, status_code=404)
        return JSONResponse(workspace)

    @router.get("/api/workspaces/{workspace_id}/sessions")
    async def api_workspace_sessions(workspace_id: str):
        workspace = _get_workspace_by_id(workspace_id)
        if not workspace:
            return JSONResponse({"error": "Workspace not found"}, status_code=404)
        sessions = _list_sessions_for_workspace(workspace.get("path", ""))
        return JSONResponse({"sessions": sessions, "total": len(sessions)})

    @router.post("/api/workspaces/trust")
    async def api_trust_workspace(request: Request):
        if not _check_localhost(request):
            return JSONResponse({"error": "Mutation endpoints are localhost-only"}, status_code=403)

        body = await request.json()
        path = body.get("path")
        trust = body.get("trust", True)
        ttl_seconds = body.get("ttl_seconds")

        if not path:
            return JSONResponse({"error": "path is required"}, status_code=400)

        from atlasbridge.core.store.workspace_trust import grant_trust, revoke_trust

        conn = _get_rw_conn()
        try:
            from atlasbridge.core.store.migrations import run_migrations

            run_migrations(conn, db_path)

            resolved = str(Path(path).resolve())
            if trust:
                grant_trust(
                    resolved,
                    conn,
                    actor="dashboard",
                    channel="dashboard",
                    ttl_seconds=ttl_seconds,
                )
                _log.info("workspace_trust_granted via dashboard: %s", resolved)
            else:
                revoke_trust(resolved, conn)
                _log.info("workspace_trust_revoked via dashboard: %s", resolved)

            return JSONResponse({"ok": True, "path": resolved, "trust": trust})
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        finally:
            conn.close()

    @router.post("/api/workspaces/posture")
    async def api_set_posture(request: Request):
        if not _check_localhost(request):
            return JSONResponse({"error": "Mutation endpoints are localhost-only"}, status_code=403)

        body = await request.json()
        workspace_id = body.get("workspace_id")
        if not workspace_id:
            return JSONResponse({"error": "workspace_id is required"}, status_code=400)

        from atlasbridge.core.store.workspace_trust import set_posture

        posture_fields = {}
        for field in (
            "profile_name",
            "autonomy_default",
            "model_tier",
            "tool_allowlist_profile",
            "posture_notes",
        ):
            if field in body:
                posture_fields[field] = body[field]

        if not posture_fields:
            return JSONResponse({"error": "At least one posture field required"}, status_code=400)

        conn = _get_rw_conn()
        try:
            from atlasbridge.core.store.migrations import run_migrations

            run_migrations(conn, db_path)
            set_posture(workspace_id, conn, **posture_fields)
            _log.info("workspace_posture_updated via dashboard: %s", workspace_id)
            return JSONResponse(
                {"ok": True, "workspace_id": workspace_id, "updated": list(posture_fields)}
            )
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        finally:
            conn.close()

    @router.post("/api/workspaces/scan")
    async def api_scan_workspace(request: Request):
        if not _check_localhost(request):
            return JSONResponse({"error": "Mutation endpoints are localhost-only"}, status_code=403)

        body = await request.json()
        workspace_id = body.get("workspace_id")
        if not workspace_id:
            return JSONResponse({"error": "workspace_id is required"}, status_code=400)

        workspace = _get_workspace_by_id(workspace_id)
        if not workspace:
            return JSONResponse({"error": "Workspace not found"}, status_code=404)

        from atlasbridge.core.store.workspace_trust import scan_workspace

        conn = _get_rw_conn()
        try:
            from atlasbridge.core.store.migrations import run_migrations

            run_migrations(conn, db_path)
            result = scan_workspace(workspace.get("path", ""), conn)
            _log.info("workspace_scanned via dashboard: %s", workspace_id)

            # Ensure JSON-serializable
            if "raw_results" in result and isinstance(result["raw_results"], str):
                try:
                    result["raw_results"] = json.loads(result["raw_results"])
                except (json.JSONDecodeError, TypeError):
                    pass
            if "risk_tags" in result and isinstance(result["risk_tags"], str):
                try:
                    result["risk_tags"] = json.loads(result["risk_tags"])
                except (json.JSONDecodeError, TypeError):
                    pass

            return JSONResponse(result)
        finally:
            conn.close()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _list_workspaces_from_repo() -> list[dict]:
        if not repo.db_available:
            return []
        assert repo._conn is not None
        from atlasbridge.core.store.workspace_trust import list_workspaces

        return list_workspaces(repo._conn)

    def _get_workspace_by_id(workspace_id: str) -> dict | None:
        if not repo.db_available:
            return None
        assert repo._conn is not None
        from atlasbridge.core.store.workspace_trust import get_workspace_by_id

        return get_workspace_by_id(workspace_id, repo._conn)

    def _list_sessions_for_workspace(path: str) -> list[dict]:
        if not repo.db_available:
            return []
        assert repo._conn is not None
        from atlasbridge.core.store.workspace_trust import list_sessions_for_workspace

        return list_sessions_for_workspace(path, repo._conn)

    return router
