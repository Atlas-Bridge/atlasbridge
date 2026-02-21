"""
Enterprise deterministic risk classifier.

Classifies prompt risk level based ONLY on deterministic inputs:
  - prompt_type
  - action_type (from matched policy rule)
  - confidence level
  - branch context (main/release vs feature)
  - CI status

No heuristics. No ML. Fully deterministic.

Maturity: Experimental (Phase A scaffolding)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class RiskLevel(StrEnum):
    """Risk classification levels, ordered LOW → CRITICAL."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


@dataclass(frozen=True)
class RiskInput:
    """Inputs to the risk classifier.  All fields are deterministic."""

    prompt_type: str  # yes_no, confirm_enter, multiple_choice, free_text
    action_type: str  # auto_reply, require_human, deny, log_only
    confidence: str  # high, medium, low
    branch: str = ""  # git branch name (empty if unknown)
    ci_status: str = ""  # passing, failing, unknown, ""


@dataclass(frozen=True)
class RiskAssessment:
    """Output of the risk classifier."""

    level: RiskLevel
    reasons: tuple[str, ...]


class EnterpriseRiskClassifier:
    """Deterministic risk classification engine.

    Risk is computed from a fixed decision table — no learned weights,
    no probabilistic inference.  Given identical inputs, this classifier
    always produces identical output.

    Risk escalation rules (applied in order, highest wins):
      1. CRITICAL — auto_reply on main/release branch with failing CI
      2. HIGH     — free_text auto_reply, or low confidence auto_reply
      3. MEDIUM   — auto_reply on main/release, or medium confidence
      4. LOW      — everything else
    """

    # Branches that are considered protected
    PROTECTED_BRANCHES: frozenset[str] = frozenset(
        {"main", "master", "release", "production", "prod"}
    )

    @classmethod
    def classify(cls, inp: RiskInput) -> RiskAssessment:
        """Classify risk level for a given prompt context.

        This method is pure — no side effects, no I/O.
        """
        reasons: list[str] = []
        level = RiskLevel.LOW

        is_protected = cls._is_protected_branch(inp.branch)
        is_auto = inp.action_type == "auto_reply"

        # Rule 1: CRITICAL — auto on protected branch with failing CI
        if is_auto and is_protected and inp.ci_status == "failing":
            level = RiskLevel.CRITICAL
            reasons.append("auto_reply on protected branch with failing CI")
            return RiskAssessment(level=level, reasons=tuple(reasons))

        # Rule 2: HIGH — free_text auto, or low confidence auto
        if is_auto and inp.prompt_type == "free_text":
            level = max(level, RiskLevel.HIGH, key=_risk_order)
            reasons.append("auto_reply on free_text prompt")

        if is_auto and inp.confidence == "low":
            level = max(level, RiskLevel.HIGH, key=_risk_order)
            reasons.append("auto_reply with low confidence")

        if level == RiskLevel.HIGH:
            return RiskAssessment(level=level, reasons=tuple(reasons))

        # Rule 3: MEDIUM — auto on protected branch, or medium confidence
        if is_auto and is_protected:
            level = max(level, RiskLevel.MEDIUM, key=_risk_order)
            reasons.append("auto_reply on protected branch")

        if is_auto and inp.confidence == "medium":
            level = max(level, RiskLevel.MEDIUM, key=_risk_order)
            reasons.append("auto_reply with medium confidence")

        if not reasons:
            reasons.append("no risk factors detected")

        return RiskAssessment(level=level, reasons=tuple(reasons))

    @classmethod
    def _is_protected_branch(cls, branch: str) -> bool:
        """Check if a branch name matches a protected pattern."""
        if not branch:
            return False
        # Exact match or starts with release/
        normalized = branch.strip().lower()
        if normalized in cls.PROTECTED_BRANCHES:
            return True
        if normalized.startswith("release/"):
            return True
        return False


def _risk_order(level: RiskLevel) -> int:
    """Return numeric ordering for RiskLevel (for max() comparison)."""
    return {
        RiskLevel.LOW: 0,
        RiskLevel.MEDIUM: 1,
        RiskLevel.HIGH: 2,
        RiskLevel.CRITICAL: 3,
    }[level]
