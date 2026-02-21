"""
Enterprise policy lifecycle governance.

Provides:
  - EnterprisePolicyLifecycle — policy versioning, approval workflows, diff
  - Policy hash computation and pinning validation

Maturity: Experimental (Phase A scaffolding)
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Any


@dataclass
class PolicySnapshot:
    """Immutable snapshot of a policy at a point in time."""

    policy_hash: str
    policy_version: str
    policy_name: str
    rule_count: int
    captured_at: str  # ISO8601
    raw_yaml: str = field(repr=False, default="")


class EnterprisePolicyLifecycle:
    """Policy lifecycle management for enterprise deployments.

    Wraps core policy operations with:
    - Policy hash computation and verification
    - Policy diff between two snapshots
    - Policy pinning validation (session-level)

    This class does NOT modify core policy logic. It layers governance
    on top via composition, not inheritance.
    """

    @staticmethod
    def compute_hash(policy_yaml: str) -> str:
        """Compute a deterministic SHA-256 hash of a policy file.

        The hash is computed on the raw YAML content (not parsed model)
        to detect any change, including comments and formatting.
        """
        return hashlib.sha256(policy_yaml.encode("utf-8")).hexdigest()

    @staticmethod
    def diff_policies(old: PolicySnapshot, new: PolicySnapshot) -> dict[str, Any]:
        """Compare two policy snapshots and return a structured diff summary.

        Returns a dict with:
          changed: bool
          old_hash: str
          new_hash: str
          old_rule_count: int
          new_rule_count: int
        """
        return {
            "changed": old.policy_hash != new.policy_hash,
            "old_hash": old.policy_hash,
            "new_hash": new.policy_hash,
            "old_version": old.policy_version,
            "new_version": new.policy_version,
            "old_rule_count": old.rule_count,
            "new_rule_count": new.rule_count,
        }

    @staticmethod
    def validate_pin(session_policy_hash: str, current_policy_hash: str) -> bool:
        """Check if the current policy matches the session-pinned hash.

        Returns True if hashes match (no mid-session policy change).
        """
        return session_policy_hash == current_policy_hash
