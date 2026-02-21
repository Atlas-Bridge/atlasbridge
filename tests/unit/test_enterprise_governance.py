"""Tests for atlasbridge.enterprise.governance — policy lifecycle management."""

from __future__ import annotations

from atlasbridge.enterprise.governance import (
    EnterprisePolicyLifecycle,
    PolicySnapshot,
)


class TestPolicySnapshot:
    def test_fields(self):
        snap = PolicySnapshot(
            policy_hash="abc123",
            policy_version="0",
            policy_name="test",
            rule_count=3,
            captured_at="2026-02-21T10:00:00Z",
            raw_yaml="policy_version: '0'",
        )
        assert snap.policy_hash == "abc123"
        assert snap.policy_version == "0"
        assert snap.policy_name == "test"
        assert snap.rule_count == 3
        assert snap.captured_at == "2026-02-21T10:00:00Z"
        assert snap.raw_yaml == "policy_version: '0'"

    def test_raw_yaml_default(self):
        snap = PolicySnapshot(
            policy_hash="abc",
            policy_version="0",
            policy_name="test",
            rule_count=0,
            captured_at="2026-01-01T00:00:00Z",
        )
        assert snap.raw_yaml == ""

    def test_repr_excludes_raw_yaml(self):
        snap = PolicySnapshot(
            policy_hash="abc",
            policy_version="0",
            policy_name="test",
            rule_count=0,
            captured_at="2026-01-01T00:00:00Z",
            raw_yaml="long yaml content here",
        )
        assert "long yaml" not in repr(snap)


class TestComputeHash:
    def test_deterministic(self):
        yaml_text = "policy_version: '0'\nname: test\n"
        h1 = EnterprisePolicyLifecycle.compute_hash(yaml_text)
        h2 = EnterprisePolicyLifecycle.compute_hash(yaml_text)
        assert h1 == h2

    def test_different_content_different_hash(self):
        h1 = EnterprisePolicyLifecycle.compute_hash("policy_version: '0'")
        h2 = EnterprisePolicyLifecycle.compute_hash("policy_version: '1'")
        assert h1 != h2

    def test_sha256_format(self):
        h = EnterprisePolicyLifecycle.compute_hash("test")
        assert len(h) == 64  # full SHA-256 hex
        assert all(c in "0123456789abcdef" for c in h)


class TestDiffPolicies:
    def _snap(self, *, hash: str = "abc", version: str = "0", rules: int = 3) -> PolicySnapshot:
        return PolicySnapshot(
            policy_hash=hash,
            policy_version=version,
            policy_name="test",
            rule_count=rules,
            captured_at="2026-01-01T00:00:00Z",
        )

    def test_unchanged(self):
        snap = self._snap()
        diff = EnterprisePolicyLifecycle.diff_policies(snap, snap)
        assert diff["changed"] is False
        assert diff["old_hash"] == diff["new_hash"]

    def test_changed_hash(self):
        old = self._snap(hash="aaa")
        new = self._snap(hash="bbb")
        diff = EnterprisePolicyLifecycle.diff_policies(old, new)
        assert diff["changed"] is True
        assert diff["old_hash"] == "aaa"
        assert diff["new_hash"] == "bbb"

    def test_rule_count_shown(self):
        old = self._snap(rules=3)
        new = self._snap(rules=5, hash="different")
        diff = EnterprisePolicyLifecycle.diff_policies(old, new)
        assert diff["old_rule_count"] == 3
        assert diff["new_rule_count"] == 5

    def test_version_shown(self):
        old = self._snap(version="0")
        new = self._snap(version="1", hash="different")
        diff = EnterprisePolicyLifecycle.diff_policies(old, new)
        assert diff["old_version"] == "0"
        assert diff["new_version"] == "1"


class TestValidatePin:
    def test_matching_hashes(self):
        assert EnterprisePolicyLifecycle.validate_pin("abc123", "abc123") is True

    def test_mismatching_hashes(self):
        assert EnterprisePolicyLifecycle.validate_pin("abc123", "def456") is False
