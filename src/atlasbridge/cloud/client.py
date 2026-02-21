"""
Cloud client interfaces — policy registry and governance API.

These are INTERFACE DEFINITIONS ONLY.  No HTTP implementation exists.
Each client is designed to degrade gracefully when cloud is disabled
or unreachable — the local runtime continues to function.

Maturity: Specification only (Phase B)
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class PolicyRegistryClient(ABC):
    """Interface for cloud-hosted policy registry.

    The policy registry stores signed policy snapshots.  Local runtimes
    can pull the latest policy version and verify its signature.

    Contract:
      - Pull is always optional (local policy file takes precedence)
      - Signatures use Ed25519 (runtime holds the public key)
      - Pull failure never blocks local policy evaluation
    """

    @abstractmethod
    async def pull_policy(self, org_id: str, policy_name: str) -> dict[str, Any] | None:
        """Pull the latest signed policy snapshot.

        Returns None if unavailable or cloud is disabled.
        """
        ...

    @abstractmethod
    async def push_policy(self, org_id: str, policy_name: str, policy_yaml: str) -> bool:
        """Push a local policy to the cloud registry.

        Returns True on success, False on failure.
        """
        ...

    @abstractmethod
    async def verify_signature(self, policy_data: dict[str, Any]) -> bool:
        """Verify the Ed25519 signature of a policy snapshot."""
        ...


class EscalationRelayClient(ABC):
    """Interface for cloud-based escalation relay.

    Routes escalation events through the cloud governance API
    to additional channels (email, PagerDuty, etc.) beyond the
    local Telegram/Slack channels.

    Contract:
      - Relay failure never blocks local escalation
      - Local channels always fire first
      - Cloud relay is fire-and-forget with retry
    """

    @abstractmethod
    async def relay_escalation(
        self,
        session_id: str,
        prompt_id: str,
        escalation_data: dict[str, Any],
    ) -> bool:
        """Relay an escalation event to cloud channels.

        Returns True if accepted (not necessarily delivered).
        """
        ...
