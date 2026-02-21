"""
Cloud policy registry — stub implementation.

Provides a no-op implementation of PolicyRegistryClient that is used
when cloud features are disabled.  This ensures the runtime can
reference the client interface without conditional imports.

Maturity: Stub (Phase B — interface only)
"""

from __future__ import annotations

from typing import Any

from atlasbridge.cloud.client import PolicyRegistryClient


class DisabledPolicyRegistry(PolicyRegistryClient):
    """No-op policy registry used when cloud is disabled."""

    async def pull_policy(self, org_id: str, policy_name: str) -> dict[str, Any] | None:
        return None

    async def push_policy(self, org_id: str, policy_name: str, policy_yaml: str) -> bool:
        return False

    async def verify_signature(self, policy_data: dict[str, Any]) -> bool:
        return False
