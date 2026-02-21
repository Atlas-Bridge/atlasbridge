"""Unit tests for policy pinning."""

from __future__ import annotations

from atlasbridge.enterprise.lifecycle import PolicyPin, PolicyPinManager


class TestPolicyPin:
    def test_valid_when_hash_matches(self) -> None:
        pin = PolicyPin(
            session_id="sess-1",
            policy_hash="abc123",
            policy_version="1",
            pinned_at="2026-01-01T00:00:00Z",
        )
        assert pin.is_valid("abc123") is True

    def test_invalid_when_hash_differs(self) -> None:
        pin = PolicyPin(
            session_id="sess-1",
            policy_hash="abc123",
            policy_version="1",
            pinned_at="2026-01-01T00:00:00Z",
        )
        assert pin.is_valid("xyz789") is False


class TestPolicyPinManager:
    def test_pin_and_check_match(self) -> None:
        mgr = PolicyPinManager()
        mgr.pin("sess-1", "hash-a", "1")
        assert mgr.check("sess-1", "hash-a") is True

    def test_pin_and_check_mismatch(self) -> None:
        mgr = PolicyPinManager()
        mgr.pin("sess-1", "hash-a", "1")
        assert mgr.check("sess-1", "hash-b") is False

    def test_check_nonexistent_returns_none(self) -> None:
        mgr = PolicyPinManager()
        assert mgr.check("unknown", "hash-a") is None

    def test_unpin_removes(self) -> None:
        mgr = PolicyPinManager()
        mgr.pin("sess-1", "hash-a", "1")
        mgr.unpin("sess-1")
        assert mgr.check("sess-1", "hash-a") is None

    def test_get_returns_pin(self) -> None:
        mgr = PolicyPinManager()
        mgr.pin("sess-1", "hash-a", "1")
        pin = mgr.get("sess-1")
        assert pin is not None
        assert pin.policy_hash == "hash-a"

    def test_get_nonexistent_returns_none(self) -> None:
        mgr = PolicyPinManager()
        assert mgr.get("unknown") is None

    def test_repin_overwrites(self) -> None:
        mgr = PolicyPinManager()
        mgr.pin("sess-1", "hash-a", "1")
        mgr.pin("sess-1", "hash-b", "2")
        assert mgr.check("sess-1", "hash-b") is True
        assert mgr.check("sess-1", "hash-a") is False
