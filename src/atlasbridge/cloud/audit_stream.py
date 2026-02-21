"""
Cloud audit stream — interface for streaming decision traces to cloud.

The audit stream sends COPIES of local decision trace entries to the
cloud governance API for centralized observability.  The local trace
file is always the source of truth — cloud streaming is fire-and-forget.

Contract:
  - Stream failure never affects local trace writing
  - Entries are buffered locally and sent in batches
  - Duplicate delivery is safe (server deduplicates by idempotency_key)
  - No sensitive data (prompt content, reply values) is streamed —
    only metadata (session_id, risk_level, action_taken, etc.)

Maturity: Specification only (Phase B)
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class AuditStreamClient(ABC):
    """Interface for streaming audit events to the cloud."""

    @abstractmethod
    async def stream_entry(self, entry: dict[str, Any]) -> bool:
        """Stream a single trace entry to the cloud.

        Returns True if accepted, False on failure.
        Failure must not raise — caller ignores the result.
        """
        ...

    @abstractmethod
    async def flush(self) -> int:
        """Flush any buffered entries.

        Returns the number of entries successfully sent.
        """
        ...

    @abstractmethod
    async def close(self) -> None:
        """Close the stream connection."""
        ...


class DisabledAuditStream(AuditStreamClient):
    """No-op audit stream used when cloud is disabled."""

    async def stream_entry(self, entry: dict[str, Any]) -> bool:
        return False

    async def flush(self) -> int:
        return 0

    async def close(self) -> None:
        pass
