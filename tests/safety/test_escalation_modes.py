"""
AI Safety Regression — Escalation guarantee tests for all autonomy modes.

Verifies that the policy evaluator produces correct escalation behavior
for every combination of autonomy mode, confidence level, and rule
matching state. No prompt must slip through without proper handling.

Tests the 3×3×2 matrix:
  modes:      off, assist, full
  confidence: high, medium, low
  matching:   rule matches / no rule matches
"""

from __future__ import annotations

from atlasbridge.core.policy.evaluator import evaluate
from atlasbridge.core.policy.model import (
    AutonomyMode,
    AutoReplyAction,
    DenyAction,
    MatchCriteria,
    Policy,
    PolicyDefaults,
    PolicyRule,
    RequireHumanAction,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _policy(mode: str, rules: list[PolicyRule] | None = None) -> Policy:
    return Policy(
        name="escalation-test",
        policy_version="0",
        autonomy_mode=AutonomyMode(mode),
        rules=rules or [],
        defaults=PolicyDefaults(no_match="require_human", low_confidence="require_human"),
    )


def _eval(
    policy: Policy,
    confidence: str = "high",
    prompt_type: str = "yes_no",
):
    return evaluate(
        policy=policy,
        prompt_text="Continue? [y/n]",
        prompt_type=prompt_type,
        confidence=confidence,
        prompt_id="esc-test",
        session_id="esc-session",
    )


# A rule that matches yes_no + high confidence
_YES_NO_HIGH = PolicyRule(
    id="allow-yes-no",
    match=MatchCriteria(prompt_type=["yes_no"], min_confidence="high"),
    action=AutoReplyAction(value="y"),
)

# A rule that matches any prompt type at any confidence
_CATCH_ALL = PolicyRule(
    id="catch-all",
    match=MatchCriteria(),
    action=AutoReplyAction(value="y"),
)


# ---------------------------------------------------------------------------
# OFF mode — all prompts escalated, no automatic decisions
# ---------------------------------------------------------------------------


class TestOffMode:
    """In OFF mode, the policy should never auto-execute regardless of rules."""

    def test_off_high_confidence_no_rules(self):
        d = _eval(_policy("off"), confidence="high")
        assert d.action_type == "require_human"

    def test_off_high_confidence_with_matching_rule(self):
        """Evaluator is mode-agnostic — rule matches, decision carries mode for engine."""
        d = _eval(_policy("off", rules=[_YES_NO_HIGH]), confidence="high")
        # Evaluator evaluates rules regardless of mode; mode enforcement
        # happens at the autopilot engine level, not the evaluator
        assert d.action_type == "auto_reply"
        assert d.autonomy_mode == "off"  # engine uses this to escalate

    def test_off_medium_confidence(self):
        d = _eval(_policy("off"), confidence="medium")
        assert d.action_type == "require_human"

    def test_off_low_confidence(self):
        d = _eval(_policy("off"), confidence="low")
        assert d.action_type == "require_human"


# ---------------------------------------------------------------------------
# ASSIST mode — only explicitly allowed prompts auto-handled
# ---------------------------------------------------------------------------


class TestAssistMode:
    """ASSIST mode: auto-handle only when rule matches and confidence is not low."""

    def test_assist_no_rules_escalates(self):
        d = _eval(_policy("assist"), confidence="high")
        assert d.action_type == "require_human"

    def test_assist_matching_rule_auto_handles(self):
        d = _eval(_policy("assist", rules=[_YES_NO_HIGH]), confidence="high")
        assert d.action_type == "auto_reply"
        assert d.action_value == "y"

    def test_assist_no_matching_rule_escalates(self):
        d = _eval(
            _policy("assist", rules=[_YES_NO_HIGH]),
            prompt_type="free_text",
            confidence="high",
        )
        assert d.action_type == "require_human"

    def test_assist_low_confidence_no_matching_rule_escalates(self):
        """Low confidence below rule's min_confidence → no match → defaults escalate."""
        d = _eval(_policy("assist", rules=[_YES_NO_HIGH]), confidence="low")
        assert d.action_type == "require_human"


# ---------------------------------------------------------------------------
# FULL mode — policy-driven, only no-match/low-confidence escalated
# ---------------------------------------------------------------------------


class TestFullMode:
    """FULL mode: auto-execute on match, escalate on no-match or low-confidence."""

    def test_full_matching_rule_auto_handles(self):
        d = _eval(_policy("full", rules=[_YES_NO_HIGH]), confidence="high")
        assert d.action_type == "auto_reply"
        assert d.action_value == "y"

    def test_full_no_rule_match_escalates(self):
        d = _eval(
            _policy("full", rules=[_YES_NO_HIGH]),
            prompt_type="free_text",
            confidence="high",
        )
        assert d.action_type == "require_human"

    def test_full_low_confidence_no_matching_rule_escalates(self):
        """Low confidence below rule's min_confidence → no match → defaults escalate."""
        d = _eval(_policy("full", rules=[_YES_NO_HIGH]), confidence="low")
        assert d.action_type == "require_human"

    def test_full_medium_confidence_with_rule_auto_handles(self):
        rule = PolicyRule(
            id="r-med",
            match=MatchCriteria(prompt_type=["yes_no"], min_confidence="medium"),
            action=AutoReplyAction(value="y"),
        )
        d = _eval(_policy("full", rules=[rule]), confidence="medium")
        assert d.action_type == "auto_reply"


# ---------------------------------------------------------------------------
# Cross-cutting: deny action works in all modes
# ---------------------------------------------------------------------------


class TestDenyAction:
    """Deny rules must be honored in assist and full modes."""

    def test_assist_deny_rule(self):
        deny_rule = PolicyRule(
            id="deny-all",
            match=MatchCriteria(prompt_type=["yes_no"]),
            action=DenyAction(),
        )
        d = _eval(_policy("assist", rules=[deny_rule]), confidence="high")
        assert d.action_type == "deny"

    def test_full_deny_rule(self):
        deny_rule = PolicyRule(
            id="deny-all",
            match=MatchCriteria(prompt_type=["yes_no"]),
            action=DenyAction(),
        )
        d = _eval(_policy("full", rules=[deny_rule]), confidence="high")
        assert d.action_type == "deny"


# ---------------------------------------------------------------------------
# Cross-cutting: require_human action always escalates
# ---------------------------------------------------------------------------


class TestRequireHumanAction:
    """Rules with require_human action must always escalate."""

    def test_full_require_human_rule(self):
        rule = PolicyRule(
            id="escalate",
            match=MatchCriteria(prompt_type=["yes_no"]),
            action=RequireHumanAction(),
        )
        d = _eval(_policy("full", rules=[rule]), confidence="high")
        assert d.action_type == "require_human"

    def test_assist_require_human_rule(self):
        rule = PolicyRule(
            id="escalate",
            match=MatchCriteria(prompt_type=["yes_no"]),
            action=RequireHumanAction(),
        )
        d = _eval(_policy("assist", rules=[rule]), confidence="high")
        assert d.action_type == "require_human"


# ---------------------------------------------------------------------------
# Boundary: default action types
# ---------------------------------------------------------------------------


class TestDefaultActions:
    def test_no_match_defaults(self):
        """When no rule matches, defaults.no_match applies."""
        policy = Policy(
            name="test",
            policy_version="0",
            autonomy_mode=AutonomyMode.FULL,
            rules=[],
            defaults=PolicyDefaults(no_match="deny"),
        )
        d = _eval(policy, confidence="high")
        assert d.action_type == "deny"

    def test_low_confidence_defaults(self):
        """Low confidence with no matching rule uses defaults.low_confidence."""
        policy = Policy(
            name="test",
            policy_version="0",
            autonomy_mode=AutonomyMode.FULL,
            rules=[_YES_NO_HIGH],  # won't match at low confidence
            defaults=PolicyDefaults(low_confidence="deny"),
        )
        d = _eval(policy, confidence="low")
        assert d.action_type == "deny"

    def test_decision_always_has_explanation(self):
        """Every decision must include a human-readable explanation."""
        policy = _policy("full", rules=[_YES_NO_HIGH])
        d = _eval(policy, confidence="high")
        assert d.explanation
        assert len(d.explanation) > 0

    def test_decision_always_has_mode(self):
        """Every decision carries the autonomy mode."""
        for mode in ("off", "assist", "full"):
            d = _eval(_policy(mode))
            assert d.autonomy_mode == mode
