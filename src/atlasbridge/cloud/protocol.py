"""
Cloud control channel protocol specification.

Defines the message types and framing for the secure control channel
between the local runtime and the cloud governance API.

This is a SPECIFICATION — no wire protocol implementation exists yet.

Protocol principles:
  - Cloud OBSERVES, does not EXECUTE
  - All messages are signed by the runtime's local keypair
  - Replay protection via monotonic sequence numbers
  - Idempotent message processing (server deduplicates by message_id)

Maturity: Specification only (Phase B)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class MessageType(StrEnum):
    """Control channel message types."""

    # Runtime → Cloud
    HEARTBEAT = "heartbeat"
    SESSION_STARTED = "session_started"
    SESSION_ENDED = "session_ended"
    DECISION_MADE = "decision_made"
    ESCALATION_TRIGGERED = "escalation_triggered"
    POLICY_LOADED = "policy_loaded"

    # Cloud → Runtime (advisory only — runtime may ignore)
    POLICY_UPDATE_AVAILABLE = "policy_update_available"
    KILL_SWITCH = "kill_switch"


@dataclass
class ControlMessage:
    """A single control channel message.

    All messages carry a signature from the runtime's local keypair.
    The cloud API verifies signatures but NEVER sends execution commands.
    """

    message_id: str  # Unique, monotonic
    message_type: MessageType
    timestamp: str  # ISO8601
    org_id: str
    runtime_id: str  # Derived from local keypair public key
    sequence: int  # Monotonic sequence number for replay protection
    payload: dict[str, object] = field(default_factory=dict)
    signature: str = ""  # Ed25519 signature of (message_id + type + timestamp + payload)


@dataclass
class ProtocolSpec:
    """Protocol specification constants."""

    version: str = "1.0"
    transport: str = "wss"  # WebSocket Secure
    encoding: str = "json"
    max_message_size_bytes: int = 65536  # 64 KB
    heartbeat_interval_seconds: int = 30
    reconnect_backoff_base_seconds: float = 1.0
    reconnect_backoff_max_seconds: float = 300.0
    signature_algorithm: str = "Ed25519"

    # Idempotency: server deduplicates by message_id within this window
    dedup_window_seconds: int = 3600  # 1 hour
