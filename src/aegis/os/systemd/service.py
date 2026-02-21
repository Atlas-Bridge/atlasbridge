"""
systemd user service integration for Linux.

Generates and installs a systemd user service unit file for the Aegis daemon.
The service runs under the current user's session (not as root).

Service lifecycle::

    aegis setup --install-service   # generate + install + enable
    systemctl --user start aegis    # start daemon
    systemctl --user stop aegis     # stop daemon
    systemctl --user status aegis   # check status
    journalctl --user -u aegis -f   # follow logs

The unit file is written to: ~/.config/systemd/user/aegis.service
(respects $XDG_CONFIG_HOME).
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

_SERVICE_NAME = "aegis.service"

_UNIT_TEMPLATE = """\
[Unit]
Description=Aegis — Human-in-the-Loop Control Plane for AI Agents
Documentation=https://github.com/abdulraoufatia/aegis-cli
After=network.target

[Service]
Type=simple
ExecStart={exec_path} run claude
Restart=on-failure
RestartSec=5s
Environment="AEGIS_CONFIG={config_path}"
StandardOutput=journal
StandardError=journal
SyslogIdentifier=aegis

[Install]
WantedBy=default.target
"""


def generate_unit_file(exec_path: str, config_path: str) -> str:
    """
    Generate a systemd user service unit file.

    Args:
        exec_path:   Absolute path to the ``aegis`` binary.
        config_path: Absolute path to the Aegis config TOML file.

    Returns:
        Unit file content as a string.
    """
    return _UNIT_TEMPLATE.format(
        exec_path=exec_path,
        config_path=config_path,
    )


def systemd_user_dir() -> Path:
    """Return the systemd user unit directory (~/.config/systemd/user/)."""
    xdg_config = os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config"))
    return Path(xdg_config) / "systemd" / "user"


def install_service(unit_content: str) -> Path:
    """
    Write the unit file to the systemd user directory.

    Creates ``~/.config/systemd/user/`` if it does not exist.

    Returns:
        Path where the unit file was written.
    """
    unit_dir = systemd_user_dir()
    unit_dir.mkdir(parents=True, exist_ok=True)
    unit_path = unit_dir / _SERVICE_NAME
    unit_path.write_text(unit_content, encoding="utf-8")
    unit_path.chmod(0o644)
    return unit_path


def reload_daemon() -> None:
    """Run ``systemctl --user daemon-reload`` to pick up the new unit file."""
    subprocess.run(  # nosec B603 B607
        ["systemctl", "--user", "daemon-reload"],
        check=True,
        capture_output=True,
    )


def enable_service() -> None:
    """Run ``systemctl --user enable aegis`` to auto-start on login."""
    subprocess.run(  # nosec B603 B607
        ["systemctl", "--user", "enable", "aegis"],
        check=True,
        capture_output=True,
    )


def is_systemd_available() -> bool:
    """
    Return True if systemd user sessions are available on the current system.

    Checks for the ``systemctl`` binary and a responsive user session.
    Always returns False on non-Linux platforms.
    """
    if not sys.platform.startswith("linux"):
        return False
    try:
        result = subprocess.run(  # nosec B603 B607
            ["systemctl", "--user", "status"],
            capture_output=True,
            timeout=3.0,
        )
        # 0 = running, 3 = degraded / unit not found — both mean systemd is present
        return result.returncode in (0, 3)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False
