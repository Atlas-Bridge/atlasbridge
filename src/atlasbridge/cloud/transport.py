"""
Cloud transport — secure control channel transport interface.

Defines the transport layer for the control channel between the local
runtime and the cloud governance API.

The transport is WebSocket-based (WSS) with automatic reconnection
and exponential backoff.  Messages are JSON-encoded and signed.

Contract:
  - Transport failure degrades gracefully (local runtime continues)
  - Reconnection is automatic with bounded backoff
  - No execution commands flow from cloud to runtime
  - Cloud-to-runtime messages are advisory only (policy update hints,
    kill switch signals that the runtime MAY honor)

Maturity: Specification only (Phase B)
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class ControlChannelTransport(ABC):
    """Interface for the secure control channel transport."""

    @abstractmethod
    async def connect(self, endpoint: str, runtime_id: str) -> bool:
        """Establish a connection to the cloud control channel.

        Returns True if connected, False if connection failed.
        """
        ...

    @abstractmethod
    async def send(self, message: dict[str, Any]) -> bool:
        """Send a signed message to the cloud.

        Returns True if sent, False if the channel is disconnected.
        """
        ...

    @abstractmethod
    async def receive(self) -> dict[str, Any] | None:
        """Receive the next advisory message from the cloud.

        Returns None if the channel is disconnected or no message is available.
        """
        ...

    @abstractmethod
    async def disconnect(self) -> None:
        """Disconnect from the cloud control channel."""
        ...

    @abstractmethod
    def is_connected(self) -> bool:
        """Check if the transport is currently connected."""
        ...


class DisabledTransport(ControlChannelTransport):
    """No-op transport used when cloud is disabled."""

    async def connect(self, endpoint: str, runtime_id: str) -> bool:
        return False

    async def send(self, message: dict[str, Any]) -> bool:
        return False

    async def receive(self) -> dict[str, Any] | None:
        return None

    async def disconnect(self) -> None:
        pass

    def is_connected(self) -> bool:
        return False
