"""Unit tests for the deterministic risk classifier."""

from __future__ import annotations

from atlasbridge.enterprise.risk import (
    EnterpriseRiskClassifier,
    RiskInput,
    RiskLevel,
)


class TestRiskClassifierDeterminism:
    """Verify that identical inputs always produce identical outputs."""

    def test_same_input_same_output(self) -> None:
        inp = RiskInput(
            prompt_type="yes_no",
            action_type="auto_reply",
            confidence="high",
            branch="feature/foo",
            ci_status="passing",
        )
        r1 = EnterpriseRiskClassifier.classify(inp)
        r2 = EnterpriseRiskClassifier.classify(inp)
        assert r1.level == r2.level
        assert r1.reasons == r2.reasons

    def test_repeated_calls_stable(self) -> None:
        inp = RiskInput(
            prompt_type="free_text",
            action_type="auto_reply",
            confidence="low",
            branch="main",
            ci_status="failing",
        )
        results = [EnterpriseRiskClassifier.classify(inp) for _ in range(100)]
        assert all(r.level == results[0].level for r in results)


class TestRiskClassifierRules:
    def test_critical_auto_on_main_failing_ci(self) -> None:
        inp = RiskInput(
            prompt_type="yes_no",
            action_type="auto_reply",
            confidence="high",
            branch="main",
            ci_status="failing",
        )
        result = EnterpriseRiskClassifier.classify(inp)
        assert result.level == RiskLevel.CRITICAL

    def test_critical_auto_on_release_failing_ci(self) -> None:
        inp = RiskInput(
            prompt_type="yes_no",
            action_type="auto_reply",
            confidence="high",
            branch="release/1.0",
            ci_status="failing",
        )
        result = EnterpriseRiskClassifier.classify(inp)
        assert result.level == RiskLevel.CRITICAL

    def test_high_free_text_auto(self) -> None:
        inp = RiskInput(
            prompt_type="free_text",
            action_type="auto_reply",
            confidence="high",
            branch="feature/foo",
            ci_status="passing",
        )
        result = EnterpriseRiskClassifier.classify(inp)
        assert result.level == RiskLevel.HIGH

    def test_high_low_confidence_auto(self) -> None:
        inp = RiskInput(
            prompt_type="yes_no",
            action_type="auto_reply",
            confidence="low",
            branch="feature/foo",
            ci_status="passing",
        )
        result = EnterpriseRiskClassifier.classify(inp)
        assert result.level == RiskLevel.HIGH

    def test_medium_auto_on_main_passing_ci(self) -> None:
        inp = RiskInput(
            prompt_type="yes_no",
            action_type="auto_reply",
            confidence="high",
            branch="main",
            ci_status="passing",
        )
        result = EnterpriseRiskClassifier.classify(inp)
        assert result.level == RiskLevel.MEDIUM

    def test_medium_medium_confidence_auto(self) -> None:
        inp = RiskInput(
            prompt_type="yes_no",
            action_type="auto_reply",
            confidence="medium",
            branch="feature/foo",
            ci_status="passing",
        )
        result = EnterpriseRiskClassifier.classify(inp)
        assert result.level == RiskLevel.MEDIUM

    def test_low_require_human(self) -> None:
        inp = RiskInput(
            prompt_type="yes_no",
            action_type="require_human",
            confidence="high",
            branch="main",
            ci_status="failing",
        )
        result = EnterpriseRiskClassifier.classify(inp)
        assert result.level == RiskLevel.LOW

    def test_low_feature_branch_high_confidence(self) -> None:
        inp = RiskInput(
            prompt_type="yes_no",
            action_type="auto_reply",
            confidence="high",
            branch="feature/foo",
            ci_status="passing",
        )
        result = EnterpriseRiskClassifier.classify(inp)
        assert result.level == RiskLevel.LOW

    def test_low_no_branch(self) -> None:
        inp = RiskInput(
            prompt_type="confirm_enter",
            action_type="auto_reply",
            confidence="high",
            branch="",
            ci_status="",
        )
        result = EnterpriseRiskClassifier.classify(inp)
        assert result.level == RiskLevel.LOW


class TestProtectedBranches:
    def test_main_is_protected(self) -> None:
        assert EnterpriseRiskClassifier._is_protected_branch("main")

    def test_master_is_protected(self) -> None:
        assert EnterpriseRiskClassifier._is_protected_branch("master")

    def test_release_prefix_is_protected(self) -> None:
        assert EnterpriseRiskClassifier._is_protected_branch("release/2.0")

    def test_production_is_protected(self) -> None:
        assert EnterpriseRiskClassifier._is_protected_branch("production")

    def test_feature_branch_not_protected(self) -> None:
        assert not EnterpriseRiskClassifier._is_protected_branch("feature/foo")

    def test_empty_not_protected(self) -> None:
        assert not EnterpriseRiskClassifier._is_protected_branch("")
