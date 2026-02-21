"""
Safety test: Risk classifier determinism.

Verifies that EnterpriseRiskClassifier.classify() is a pure function:
  - Identical inputs always produce identical outputs
  - No randomness, no side effects
  - All risk levels are reachable via known inputs
  - Output (RiskAssessment) is frozen/immutable
"""

from __future__ import annotations

import copy

import pytest

from atlasbridge.enterprise.risk import (
    EnterpriseRiskClassifier,
    RiskAssessment,
    RiskInput,
    RiskLevel,
)


class TestRiskDeterminism:
    """The risk classifier must be a pure, deterministic function."""

    def test_1000_identical_calls_same_result(self) -> None:
        """Same input 1000 times must produce identical output every time."""
        inp = RiskInput(
            prompt_type="yes_no",
            action_type="auto_reply",
            confidence="high",
            branch="main",
            ci_status="passing",
        )
        baseline = EnterpriseRiskClassifier.classify(inp)
        for _ in range(1000):
            result = EnterpriseRiskClassifier.classify(inp)
            assert result.level == baseline.level
            assert result.reasons == baseline.reasons

    @pytest.mark.parametrize(
        ("inp", "expected_level"),
        [
            pytest.param(
                RiskInput("yes_no", "auto_reply", "high", "main", "failing"),
                RiskLevel.CRITICAL,
                id="critical-auto-protected-failing-ci",
            ),
            pytest.param(
                RiskInput("free_text", "auto_reply", "high", "feature/x", "passing"),
                RiskLevel.HIGH,
                id="high-free-text-auto",
            ),
            pytest.param(
                RiskInput("yes_no", "auto_reply", "low", "feature/x", "passing"),
                RiskLevel.HIGH,
                id="high-low-confidence-auto",
            ),
            pytest.param(
                RiskInput("yes_no", "auto_reply", "high", "main", "passing"),
                RiskLevel.MEDIUM,
                id="medium-auto-protected-passing",
            ),
            pytest.param(
                RiskInput("yes_no", "auto_reply", "medium", "feature/x", "passing"),
                RiskLevel.MEDIUM,
                id="medium-medium-confidence-auto",
            ),
            pytest.param(
                RiskInput("yes_no", "require_human", "high", "feature/x", "passing"),
                RiskLevel.LOW,
                id="low-require-human",
            ),
        ],
    )
    def test_all_risk_levels_reachable(self, inp: RiskInput, expected_level: RiskLevel) -> None:
        """Every RiskLevel must be producible by a known input."""
        result = EnterpriseRiskClassifier.classify(inp)
        assert result.level == expected_level

    def test_risk_assessment_is_frozen(self) -> None:
        """RiskAssessment is frozen=True — mutation must raise."""
        assessment = RiskAssessment(level=RiskLevel.LOW, reasons=("test",))
        with pytest.raises(AttributeError):
            assessment.level = RiskLevel.HIGH  # type: ignore[misc]

    def test_risk_input_is_frozen(self) -> None:
        """RiskInput is frozen=True — mutation must raise."""
        inp = RiskInput("yes_no", "auto_reply", "high")
        with pytest.raises(AttributeError):
            inp.prompt_type = "free_text"  # type: ignore[misc]

    def test_no_side_effects_on_input(self) -> None:
        """classify() must not modify the input object."""
        inp = RiskInput("yes_no", "auto_reply", "high", "main", "passing")
        inp_copy = copy.copy(inp)
        EnterpriseRiskClassifier.classify(inp)
        assert inp == inp_copy

    def test_classifier_is_classmethod(self) -> None:
        """classify() is a classmethod — no instance state involved."""
        assert isinstance(EnterpriseRiskClassifier.__dict__["classify"], classmethod)
