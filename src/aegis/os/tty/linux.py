"""
Linux PTY supervisor using ptyprocess.

Identical to the macOS implementation — ptyprocess is cross-platform POSIX.
The module exists as a separate file to allow future Linux-specific tuning
(e.g., cgroup integration, namespace isolation, /proc-based process inspection).
"""

from __future__ import annotations

from aegis.os.tty.macos import MacOSTTY
from aegis.os.tty.base import PTYConfig


class LinuxTTY(MacOSTTY):
    """
    PTY supervisor for Linux.

    Currently delegates entirely to MacOSTTY (both use ptyprocess).
    Linux-specific extensions (cgroups, namespaces) are reserved for v0.4.0+.
    """

    def __init__(self, config: PTYConfig, session_id: str) -> None:
        super().__init__(config, session_id)
