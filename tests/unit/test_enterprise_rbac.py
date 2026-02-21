"""Tests for atlasbridge.enterprise.rbac — role-based access control."""

from __future__ import annotations

from atlasbridge.enterprise.rbac import (
    EnterpriseRBAC,
    Identity,
    Role,
)


class TestRole:
    def test_values(self):
        assert Role.VIEWER == "viewer"
        assert Role.OPERATOR == "operator"
        assert Role.ADMIN == "admin"
        assert Role.OWNER == "owner"

    def test_is_str_enum(self):
        assert isinstance(Role.VIEWER, str)


class TestIdentity:
    def test_frozen(self):
        ident = Identity(channel_identity="telegram:123", role=Role.VIEWER)
        assert ident.channel_identity == "telegram:123"
        assert ident.role == Role.VIEWER

    def test_immutable(self):
        import pytest

        ident = Identity(channel_identity="telegram:123", role=Role.VIEWER)
        with pytest.raises(AttributeError):
            ident.role = Role.ADMIN  # type: ignore[misc]


class TestEnterpriseRBAC:
    def test_assign_and_get(self):
        rbac = EnterpriseRBAC()
        rbac.assign("telegram:123", Role.OPERATOR)
        assert rbac.get_role("telegram:123") == Role.OPERATOR

    def test_overwrite_role(self):
        rbac = EnterpriseRBAC()
        rbac.assign("telegram:123", Role.VIEWER)
        rbac.assign("telegram:123", Role.ADMIN)
        assert rbac.get_role("telegram:123") == Role.ADMIN

    def test_unknown_identity(self):
        rbac = EnterpriseRBAC()
        assert rbac.get_role("unknown:999") is None

    def test_init_with_identities(self):
        identities = [
            Identity(channel_identity="telegram:1", role=Role.VIEWER),
            Identity(channel_identity="slack:U1", role=Role.ADMIN),
        ]
        rbac = EnterpriseRBAC(identities=identities)
        assert rbac.get_role("telegram:1") == Role.VIEWER
        assert rbac.get_role("slack:U1") == Role.ADMIN


class TestPermissionChecks:
    def _rbac_with_roles(self) -> EnterpriseRBAC:
        rbac = EnterpriseRBAC()
        rbac.assign("viewer", Role.VIEWER)
        rbac.assign("operator", Role.OPERATOR)
        rbac.assign("admin", Role.ADMIN)
        rbac.assign("owner", Role.OWNER)
        return rbac

    def test_viewer_can_view_sessions(self):
        rbac = self._rbac_with_roles()
        assert rbac.check_permission("viewer", "view_sessions") is True

    def test_viewer_cannot_reply(self):
        rbac = self._rbac_with_roles()
        assert rbac.check_permission("viewer", "reply_prompt") is False

    def test_operator_can_reply(self):
        rbac = self._rbac_with_roles()
        assert rbac.check_permission("operator", "reply_prompt") is True

    def test_operator_can_view(self):
        rbac = self._rbac_with_roles()
        assert rbac.check_permission("operator", "view_sessions") is True

    def test_operator_cannot_modify_policy(self):
        rbac = self._rbac_with_roles()
        assert rbac.check_permission("operator", "modify_policy") is False

    def test_admin_can_modify_policy(self):
        rbac = self._rbac_with_roles()
        assert rbac.check_permission("admin", "modify_policy") is True

    def test_admin_cannot_manage_rbac(self):
        rbac = self._rbac_with_roles()
        assert rbac.check_permission("admin", "manage_rbac") is False

    def test_owner_can_manage_rbac(self):
        rbac = self._rbac_with_roles()
        assert rbac.check_permission("owner", "manage_rbac") is True

    def test_owner_has_all_permissions(self):
        rbac = self._rbac_with_roles()
        perms = rbac.list_permissions()
        for perm in perms:
            assert rbac.check_permission("owner", perm) is True

    def test_unknown_identity_denied(self):
        rbac = self._rbac_with_roles()
        assert rbac.check_permission("unknown", "view_sessions") is False

    def test_unknown_permission_denied(self):
        rbac = self._rbac_with_roles()
        assert rbac.check_permission("owner", "nonexistent_perm") is False


class TestListPermissions:
    def test_returns_all_permissions(self):
        rbac = EnterpriseRBAC()
        perms = rbac.list_permissions()
        assert "view_sessions" in perms
        assert "reply_prompt" in perms
        assert "modify_policy" in perms
        assert "manage_rbac" in perms

    def test_values_are_role_strings(self):
        rbac = EnterpriseRBAC()
        perms = rbac.list_permissions()
        valid_roles = {r.value for r in Role}
        for role_str in perms.values():
            assert role_str in valid_roles
