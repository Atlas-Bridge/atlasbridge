"""Unit tests for edition detection and feature flags."""

from __future__ import annotations

from atlasbridge.enterprise import (
    Edition,
    detect_edition,
    is_feature_available,
    list_features,
)


class TestEdition:
    def test_community_is_default(self) -> None:
        assert detect_edition() == Edition.COMMUNITY

    def test_edition_values(self) -> None:
        assert Edition.COMMUNITY.value == "community"
        assert Edition.CORE.value == "core"
        assert Edition.ENTERPRISE.value == "enterprise"

    def test_detect_edition_from_env_core(self, monkeypatch) -> None:
        monkeypatch.setenv("ATLASBRIDGE_EDITION", "core")
        assert detect_edition() == Edition.CORE

    def test_detect_edition_from_env_enterprise(self, monkeypatch) -> None:
        monkeypatch.setenv("ATLASBRIDGE_EDITION", "enterprise")
        assert detect_edition() == Edition.ENTERPRISE

    def test_detect_edition_from_env_community(self, monkeypatch) -> None:
        monkeypatch.setenv("ATLASBRIDGE_EDITION", "community")
        assert detect_edition() == Edition.COMMUNITY

    def test_detect_edition_case_insensitive(self, monkeypatch) -> None:
        monkeypatch.setenv("ATLASBRIDGE_EDITION", "CORE")
        assert detect_edition() == Edition.CORE

    def test_detect_edition_invalid_falls_back_to_community(self, monkeypatch) -> None:
        monkeypatch.setenv("ATLASBRIDGE_EDITION", "invalid")
        assert detect_edition() == Edition.COMMUNITY


class TestFeatureFlags:
    def test_core_features_locked_on_community(self) -> None:
        assert is_feature_available("decision_trace_v2") is False
        assert is_feature_available("risk_classifier") is False
        assert is_feature_available("policy_pinning") is False
        assert is_feature_available("rbac") is False

    def test_enterprise_features_locked_on_community(self) -> None:
        assert is_feature_available("cloud_policy_sync") is False
        assert is_feature_available("cloud_audit_stream") is False
        assert is_feature_available("web_dashboard") is False

    def test_unknown_feature_returns_false(self) -> None:
        assert is_feature_available("nonexistent_feature") is False

    def test_list_features_returns_all(self) -> None:
        features = list_features()
        assert "decision_trace_v2" in features
        assert "risk_classifier" in features
        assert "cloud_policy_sync" in features
        assert "web_dashboard" in features

    def test_list_features_includes_status(self) -> None:
        features = list_features()
        for _name, info in features.items():
            assert "required_edition" in info
            assert "available" in info
            assert "status" in info
            assert info["available"] in ("yes", "no")
            assert info["status"] in ("active", "locked")

    def test_all_community_features_locked(self) -> None:
        """On community edition, all features should be locked."""
        features = list_features()
        for _name, info in features.items():
            assert info["status"] == "locked"

    def test_core_features_active_on_core(self, monkeypatch) -> None:
        """On core edition, Phase A features should be active."""
        monkeypatch.setenv("ATLASBRIDGE_EDITION", "core")
        assert is_feature_available("decision_trace_v2") is True
        assert is_feature_available("risk_classifier") is True
        assert is_feature_available("rbac") is True
        # Enterprise features still locked
        assert is_feature_available("cloud_policy_sync") is False
        assert is_feature_available("web_dashboard") is False

    def test_all_features_active_on_enterprise(self, monkeypatch) -> None:
        """On enterprise edition, all features should be active."""
        monkeypatch.setenv("ATLASBRIDGE_EDITION", "enterprise")
        features = list_features()
        for _name, info in features.items():
            assert info["status"] == "active"
