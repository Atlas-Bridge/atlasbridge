"""
Enterprise role-based access control (RBAC).

Provides:
  - Role enum and permission model
  - EnterpriseRBAC — identity-to-role mapping and permission checks

Maturity: Experimental (Phase A scaffolding)

Note: In Phase A, RBAC is local-only.  Role assignments are stored in
the AtlasBridge config file.  Cloud-backed role resolution is a Phase B
feature.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Role(StrEnum):
    """RBAC roles, ordered by privilege level."""

    VIEWER = "viewer"  # Read audit logs, view sessions
    OPERATOR = "operator"  # Reply to prompts, pause/resume
    ADMIN = "admin"  # Modify policy, manage channels
    OWNER = "owner"  # Full access including RBAC management


# Permission → minimum role required
_PERMISSIONS: dict[str, Role] = {
    "view_sessions": Role.VIEWER,
    "view_audit": Role.VIEWER,
    "view_trace": Role.VIEWER,
    "reply_prompt": Role.OPERATOR,
    "pause_autopilot": Role.OPERATOR,
    "resume_autopilot": Role.OPERATOR,
    "modify_policy": Role.ADMIN,
    "manage_channels": Role.ADMIN,
    "manage_adapters": Role.ADMIN,
    "manage_rbac": Role.OWNER,
    "manage_config": Role.OWNER,
}

_ROLE_ORDER: dict[Role, int] = {
    Role.VIEWER: 0,
    Role.OPERATOR: 1,
    Role.ADMIN: 2,
    Role.OWNER: 3,
}


@dataclass(frozen=True)
class Identity:
    """A channel identity with an assigned role."""

    channel_identity: str  # e.g. "telegram:123456789" or "slack:U1234567890"
    role: Role


class EnterpriseRBAC:
    """Local RBAC engine.

    Maps channel identities to roles and checks permissions.
    In Phase A, role assignments come from local config.
    In Phase B+, they may be synced from a cloud directory.
    """

    def __init__(self, identities: list[Identity] | None = None) -> None:
        self._identities: dict[str, Identity] = {}
        for ident in identities or []:
            self._identities[ident.channel_identity] = ident

    def assign(self, channel_identity: str, role: Role) -> None:
        """Assign a role to a channel identity."""
        self._identities[channel_identity] = Identity(channel_identity=channel_identity, role=role)

    def get_role(self, channel_identity: str) -> Role | None:
        """Get the role for a channel identity, or None if not assigned."""
        ident = self._identities.get(channel_identity)
        return ident.role if ident else None

    def check_permission(self, channel_identity: str, permission: str) -> bool:
        """Check if an identity has a specific permission.

        Returns False if the identity has no role or insufficient privilege.
        """
        role = self.get_role(channel_identity)
        if role is None:
            return False
        required = _PERMISSIONS.get(permission)
        if required is None:
            return False
        return _ROLE_ORDER[role] >= _ROLE_ORDER[required]

    def list_permissions(self) -> dict[str, str]:
        """Return all permissions and their required roles."""
        return {perm: role.value for perm, role in _PERMISSIONS.items()}
