"""VS Code / Claude Code monitor — captures conversations from Claude Code sessions.

Capture approach:
  JSONL transcript tailing — reads ~/.claude/projects/*/?.jsonl for conversation messages.
  Only real text content is captured; tool calls, system messages, and internal
  blocks are filtered out so the dashboard shows human-readable conversation.

One dashboard session per JSONL transcript file. Multiple concurrent conversations
in the same workspace are tracked as separate sessions, grouped by workspace_key.
Session IDs are deterministic (uuid5) so monitor restarts reuse existing sessions.

Install: pip install atlasbridge[vscode-monitor]
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

CLAUDE_IDE_DIR = Path.home() / ".claude" / "ide"
CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"

# Namespace for deterministic session UUIDs
_SESSION_NS = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")

# JSONL files modified within this window are considered "active"
ACTIVE_THRESHOLD_SECONDS = 300  # 5 minutes


@dataclass
class ClaudeSession:
    """Discovered Claude Code session from lock file."""

    session_file: str
    port: int | None
    token: str
    pid: int | None = None
    workspace: str | None = None
    ide_name: str | None = None
    transport: str | None = None


def find_claude_sessions() -> list[ClaudeSession]:
    """Scan ~/.claude/ide/ for active Claude Code lock files."""
    sessions: list[ClaudeSession] = []

    if not CLAUDE_IDE_DIR.exists():
        return sessions

    for lock_file in CLAUDE_IDE_DIR.glob("*.lock"):
        try:
            data = json.loads(lock_file.read_text())
            port = data.get("port")
            token = data.get("token", data.get("authToken", ""))
            pid = data.get("pid")
            workspace_folders = data.get("workspaceFolders", [])
            workspace = workspace_folders[0] if workspace_folders else None
            ide_name = data.get("ideName")
            transport = data.get("transport")

            # Check if the process is still running
            if pid:
                try:
                    os.kill(int(pid), 0)
                except (OSError, ValueError):
                    logger.debug("Stale lock file %s (pid %s not running)", lock_file.name, pid)
                    continue

            sessions.append(
                ClaudeSession(
                    session_file=lock_file.name,
                    port=int(port) if port else None,
                    token=str(token),
                    pid=int(pid) if pid else None,
                    workspace=workspace,
                    ide_name=ide_name,
                    transport=transport,
                )
            )
        except (json.JSONDecodeError, ValueError, OSError) as exc:
            logger.debug("Skipping lock file %s: %s", lock_file.name, exc)

    return sessions


def find_claude_processes() -> list[dict[str, Any]]:
    """Find running Claude Code processes via psutil.

    Only used for the CLI ``monitor status`` command — NOT for session registration.
    """
    try:
        import psutil
    except ImportError:
        logger.debug("psutil not available — process detection disabled")
        return []

    result: list[dict[str, Any]] = []
    for proc in psutil.process_iter(["pid", "name", "cmdline", "ppid"]):
        try:
            info = proc.info
            name = info.get("name", "")
            cmdline = info.get("cmdline", []) or []
            cmd_str = " ".join(cmdline)

            # Only match the actual Claude Code binary — not random
            # processes that happen to have "claude" in their path
            _keywords = ["claude-code", "claude_code", "@anthropic"]
            is_claude_binary = name.lower() == "claude" or (
                "claude" in name.lower()
                and any(kw in cmd_str.lower() for kw in _keywords)
            )
            if not is_claude_binary:
                continue

            ppid = info.get("ppid")
            parent_name = ""
            if ppid:
                try:
                    parent = psutil.Process(ppid)
                    parent_name = parent.name()
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass

            result.append(
                {
                    "pid": info["pid"],
                    "name": name,
                    "cmdline": cmd_str,
                    "parent": parent_name,
                    "is_vscode": "code" in parent_name.lower()
                    or "electron" in parent_name.lower(),
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    return result


def _workspace_to_project_dir(workspace: str) -> str:
    """Convert a workspace path to Claude Code's project directory name.

    Claude Code stores conversations in ~/.claude/projects/<mangled-path>/
    where the path has / replaced with - and a leading -.
    e.g. /Users/ara/Documents/GitHub/atlasbridge → -Users-ara-Documents-GitHub-atlasbridge
    """
    return "-" + workspace.lstrip("/").replace("/", "-")


def _find_active_jsonls(workspace: str | None) -> list[Path]:
    """Find recently-active JSONL transcript files for a workspace.

    Returns all top-level .jsonl files modified within ACTIVE_THRESHOLD_SECONDS,
    sorted by mtime descending. Excludes subagent files in subdirectories.
    Falls back to the single most recent file if none are within the threshold.
    """
    if not workspace or not CLAUDE_PROJECTS_DIR.exists():
        return []

    project_dir_name = _workspace_to_project_dir(workspace)
    project_dir = CLAUDE_PROJECTS_DIR / project_dir_name

    if not project_dir.exists():
        return []

    now = time.time()
    all_jsonl: list[tuple[Path, float]] = []
    for p in project_dir.glob("*.jsonl"):
        # Only top-level files (skip subagent dirs)
        if p.parent != project_dir:
            continue
        mtime = p.stat().st_mtime
        all_jsonl.append((p, mtime))

    if not all_jsonl:
        return []

    # Sort by mtime descending
    all_jsonl.sort(key=lambda t: t[1], reverse=True)

    active = [p for p, mt in all_jsonl if (now - mt) < ACTIVE_THRESHOLD_SECONDS]

    # Fallback: if nothing within threshold, return the single most recent
    if not active:
        return [all_jsonl[0][0]]

    return active


def _extract_human_text(content: Any) -> str:
    """Extract only human-readable text from Claude Code message content.

    Skips tool_use blocks, tool_result blocks, and internal system content.
    Returns empty string if there is no meaningful text to show.
    """
    if isinstance(content, str):
        text = content.strip()
        # Skip internal system blocks
        if text.startswith(("<ide_", "<system", "<environment_details")):
            return ""
        return text

    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    text = block.get("text", "").strip()
                    # Skip system/internal blocks embedded in text
                    if text and not text.startswith(("<ide_", "<system", "<environment_details")):
                        parts.append(text)
                # Skip tool_use and tool_result entirely — not human-readable
            elif isinstance(block, str):
                text = block.strip()
                if text and not text.startswith(("<ide_", "<system")):
                    parts.append(text)
        return "\n".join(parts)

    return ""


def _extract_tool_name(content: Any) -> str | None:
    """Extract the tool name from tool_use blocks in message content.

    Returns the name of the first tool_use block found, or None.
    """
    if not isinstance(content, list):
        return None
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            name = block.get("name")
            if name:
                return str(name)
    return None


def _extract_tool_use_id(content: Any) -> str | None:
    """Extract the id from tool_use blocks in message content."""
    if not isinstance(content, list):
        return None
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            tu_id = block.get("id")
            if tu_id:
                return str(tu_id)
    return None


def _extract_tool_result_id(content: Any) -> str | None:
    """Extract the tool_use_id from tool_result blocks in message content."""
    if not isinstance(content, list):
        return None
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_result":
            tu_id = block.get("tool_use_id")
            if tu_id:
                return str(tu_id)
    return None


def _extract_tool_use_summary(content: Any) -> str | None:
    """Build a human-readable summary for an assistant tool_use request.

    Returns a string like "Edit: src/file.ts" or "Bash: ls -la" or None.
    """
    if not isinstance(content, list):
        return None
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "tool_use":
            continue
        name = block.get("name", "")
        inp = block.get("input", {})
        if name == "Edit":
            fp = inp.get("file_path", "")
            return f"Edit: {_short_path(fp)}" if fp else "Edit file"
        if name == "Write":
            fp = inp.get("file_path", "")
            return f"Write: {_short_path(fp)}" if fp else "Write file"
        if name == "Bash":
            cmd = inp.get("command", "")
            short = cmd[:80] + ("..." if len(cmd) > 80 else "")
            return f"Bash: {short}" if cmd else "Run command"
        if name in ("Read", "Glob", "Grep"):
            return f"{name}: {inp.get('file_path', inp.get('pattern', ''))}"
        if name == "Task":
            desc = inp.get("description", "")
            return f"Task: {desc}" if desc else "Launch sub-agent"
        if name == "TodoWrite":
            return "Update task list"
        if name == "NotebookEdit":
            fp = inp.get("notebook_path", "")
            return f"NotebookEdit: {_short_path(fp)}" if fp else "Edit notebook"
        return f"{name}"
    return None


def _extract_tool_result_summary(content: Any) -> tuple[str | None, bool]:
    """Extract an approval/rejection summary from tool_result blocks.

    Returns (summary_text, is_rejection).
    """
    if not isinstance(content, list):
        return None, False
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "tool_result":
            continue
        is_error = block.get("is_error", False)
        text = block.get("content", "")
        if is_error and "doesn't want to proceed" in str(text):
            # User rejected the tool use
            reason = ""
            marker = "provided the following reason for the rejection:"
            if marker in str(text):
                reason = str(text).split(marker, 1)[1].strip()
            return (f"Rejected: {reason}" if reason else "Rejected"), True
        if isinstance(text, str):
            if "has been updated successfully" in text:
                return "Approved", False
            if "created successfully" in text:
                return "Approved", False
        # Generic tool result — approved
        return "Approved", False
    return None, False


def _short_path(fp: str) -> str:
    """Shorten a file path to the last 2 segments."""
    parts = fp.replace("\\", "/").split("/")
    return "/".join(parts[-2:]) if len(parts) > 2 else fp


@dataclass
class MonitoredSession:
    """Tracked session in the monitor."""

    session_id: str
    key: str  # lock file name
    seq: int = 0
    jsonl_path: Path | None = None
    jsonl_offset: int = 0
    seen_uuids: set[str] = field(default_factory=set)


class VSCodeMonitor:
    """Monitor Claude Code sessions running inside VS Code."""

    def __init__(
        self,
        dashboard_url: str = "http://localhost:3737",
        poll_interval: float = 5.0,
    ) -> None:
        self._dashboard_url = dashboard_url.rstrip("/")
        self._poll_interval = poll_interval
        self._sessions: dict[str, MonitoredSession] = {}  # key → session
        self._running = False
        self._client = httpx.AsyncClient(timeout=10.0)

    async def _register_session(
        self, key: str, vendor: str, conversation_id: str, tab_url: str,
        jsonl_path: Path | None = None,
        workspace_key: str | None = None,
    ) -> MonitoredSession:
        """Register a monitor session on the dashboard.

        Uses a deterministic UUID so restarts reuse the same session.
        """
        session_id = str(uuid.uuid5(_SESSION_NS, conversation_id))
        try:
            payload: dict[str, Any] = {
                "id": session_id,
                "vendor": vendor,
                "conversation_id": conversation_id,
                "tab_url": tab_url,
            }
            if workspace_key:
                payload["workspace_key"] = workspace_key
            await self._client.post(
                f"{self._dashboard_url}/api/monitor/sessions",
                json=payload,
            )
            logger.info("Registered monitor session %s for %s", session_id, key)
        except Exception as exc:
            logger.error("Failed to create monitor session: %s", exc)
        ms = MonitoredSession(session_id=session_id, key=key, jsonl_path=jsonl_path)
        # Start tailing from the end — only capture NEW messages going forward
        if jsonl_path and jsonl_path.exists():
            ms.jsonl_offset = jsonl_path.stat().st_size
        self._sessions[key] = ms
        return ms

    async def _tail_jsonl(self, ms: MonitoredSession) -> None:
        """Read new lines from a JSONL transcript file and send to dashboard."""
        if not ms.jsonl_path or not ms.jsonl_path.exists():
            return

        try:
            file_size = ms.jsonl_path.stat().st_size
            if file_size <= ms.jsonl_offset:
                return

            with open(ms.jsonl_path, encoding="utf-8") as f:
                f.seek(ms.jsonl_offset)
                new_data = f.read()
                ms.jsonl_offset = f.tell()

            for line in new_data.strip().split("\n"):
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                msg_type = entry.get("type")
                if msg_type not in ("user", "assistant"):
                    continue

                msg_uuid = entry.get("uuid", "")
                if msg_uuid and msg_uuid in ms.seen_uuids:
                    continue
                if msg_uuid:
                    ms.seen_uuids.add(msg_uuid)

                message = entry.get("message", {})
                role = message.get("role", msg_type)
                content_raw = message.get("content", "")
                content = _extract_human_text(content_raw)

                # Extract metadata from ALL messages first
                permission_mode = entry.get("permissionMode")
                tool_name = _extract_tool_name(content_raw)
                timestamp = entry.get("timestamp", _iso_now())

                if role == "assistant":
                    if tool_name:
                        # Assistant requested a tool — always capture as pending
                        summary = content.strip() if content and content.strip() else (
                            _extract_tool_use_summary(content_raw) or tool_name
                        )
                        tool_use_id = _extract_tool_use_id(content_raw)
                        ms.seq += 1
                        await self._send_message(
                            ms.session_id, role, summary, ms.seq, timestamp,
                            permission_mode="pending",
                            tool_name=tool_name,
                            tool_use_id=tool_use_id,
                        )
                    elif content and content.strip():
                        ms.seq += 1
                        await self._send_message(
                            ms.session_id, role, content, ms.seq, timestamp,
                            permission_mode=permission_mode,
                        )
                elif role == "user":
                    # Check for tool_result FIRST — even if text content exists
                    tool_result_id = _extract_tool_result_id(content_raw)
                    if tool_result_id:
                        result_summary, is_rejection = _extract_tool_result_summary(content_raw)
                        pm = "rejected" if is_rejection else (permission_mode or "approved")
                        ms.seq += 1
                        await self._send_message(
                            ms.session_id, role, result_summary or "Completed", ms.seq, timestamp,
                            permission_mode=pm,
                            tool_use_id=tool_result_id,
                        )
                    elif content and content.strip():
                        ms.seq += 1
                        await self._send_message(
                            ms.session_id, role, content, ms.seq, timestamp,
                            permission_mode=permission_mode,
                        )

        except Exception as exc:
            logger.debug("JSONL tail error for %s: %s", ms.jsonl_path, exc)

    async def _send_message(
        self, session_id: str, role: str, content: str, seq: int,
        captured_at: str | None = None,
        permission_mode: str | None = None,
        tool_name: str | None = None,
        tool_use_id: str | None = None,
    ) -> None:
        """Send a captured message to the dashboard."""
        try:
            msg: dict[str, Any] = {
                "role": role,
                "content": content,
                "vendor": "vscode-claude",
                "seq": seq,
                "captured_at": captured_at or _iso_now(),
            }
            if permission_mode:
                msg["permission_mode"] = permission_mode
            if tool_name:
                msg["tool_name"] = tool_name
            if tool_use_id:
                msg["tool_use_id"] = tool_use_id
            await self._client.post(
                f"{self._dashboard_url}/api/monitor/sessions/{session_id}/messages",
                json={"messages": [msg]},
            )
        except Exception as exc:
            logger.error("Failed to send monitor message: %s", exc)

    async def monitor_loop(self) -> None:
        """Main loop: discover sessions from lock files, tail transcripts."""
        self._running = True
        logger.info(
            "VS Code monitor started (poll=%.1fs, dashboard=%s)",
            self._poll_interval,
            self._dashboard_url,
        )

        while self._running:
            try:
                # Discover sessions from lock files, then find active JSONL files
                sessions = find_claude_sessions()
                for cs in sessions:
                    workspace = cs.workspace or cs.session_file
                    workspace_key = f"claude-code-{workspace}"
                    tab_url = f"vscode://claude-code/{workspace}"

                    active_jsonls = _find_active_jsonls(cs.workspace)
                    for jsonl_path in active_jsonls:
                        jsonl_uuid = jsonl_path.stem
                        key = f"jsonl:{workspace}:{jsonl_uuid}"

                        if key not in self._sessions:
                            conversation_id = f"claude-code-{workspace}:{jsonl_uuid}"
                            logger.info(
                                "Found transcript for %s: %s", workspace, jsonl_path.name
                            )
                            await self._register_session(
                                key, "vscode-claude", conversation_id, tab_url,
                                jsonl_path=jsonl_path,
                                workspace_key=workspace_key,
                            )

                    # Fallback: if no JSONL files found, register workspace-only session
                    if not active_jsonls:
                        key = f"lock:{cs.session_file}"
                        if key not in self._sessions:
                            conversation_id = f"claude-code-{workspace}"
                            await self._register_session(
                                key, "vscode-claude", conversation_id, tab_url,
                                workspace_key=workspace_key,
                            )

                # Tail JSONL transcripts for all tracked sessions
                for ms in self._sessions.values():
                    if ms.jsonl_path:
                        await self._tail_jsonl(ms)

            except Exception as exc:
                logger.error("VS Code monitor poll error: %s", exc)

            await asyncio.sleep(self._poll_interval)

    def stop(self) -> None:
        self._running = False


def _iso_now() -> str:
    from datetime import datetime

    return datetime.now(UTC).isoformat()


async def run_vscode_monitor(
    dashboard_url: str = "http://localhost:3737",
    poll_interval: float = 5.0,
) -> None:
    """Entry point for VS Code / Claude Code monitoring."""
    if not CLAUDE_IDE_DIR.exists():
        print(
            f"Claude IDE directory not found at {CLAUDE_IDE_DIR}\n"
            "Ensure Claude Code extension is installed in VS Code.",
        )

    monitor = VSCodeMonitor(dashboard_url=dashboard_url, poll_interval=poll_interval)
    print(f"VS Code monitor active — polling every {poll_interval}s")
    print(f"Dashboard: {dashboard_url}")
    print(f"Watching: {CLAUDE_IDE_DIR}")
    print(f"Transcripts: {CLAUDE_PROJECTS_DIR}")
    print("Press Ctrl+C to stop.\n")

    sessions = find_claude_sessions()
    if sessions:
        print(f"Found {len(sessions)} active Claude Code session(s):")
        for cs in sessions:
            parts = [f"pid={cs.pid}"]
            if cs.port:
                parts.append(f"port={cs.port}")
            if cs.ide_name:
                parts.append(f"ide={cs.ide_name}")
            if cs.workspace:
                parts.append(f"workspace={cs.workspace}")
                jsonls = _find_active_jsonls(cs.workspace)
                if jsonls:
                    parts.append(f"transcripts={len(jsonls)}")
                    parts.append(f"latest={jsonls[0].name}")
            print(f"  - {' '.join(parts)}")
    else:
        print("No active Claude Code lock files found. Watching for new ones...")

    print()

    try:
        await monitor.monitor_loop()
    except (KeyboardInterrupt, asyncio.CancelledError):
        monitor.stop()
        print("\nVS Code monitor stopped.")
