"""
Safety test: Low confidence default-safe behavior.

Verifies that the policy evaluator always defaults to safe behavior
(require_human or deny) when confidence is low and/or no rule matches.
An auto_reply must never be the fallback action.
"""

from __future__ import annotations

import pytest

from atlasbridge.core.policy.evaluator import evaluate
from atlasbridge.core.policy.model import (
    AutoReplyAction,
    MatchCriteria,
    Policy,
    PolicyDefaults,
    PolicyRule,
)


def _make_empty_policy(
    no_match: str = "require_human", low_confidence: str = "require_human"
) -> Policy:
    """Create a policy with no rules and the given defaults."""
    return Policy(
        policy_version="0",
        rules=[],
        defaults=PolicyDefaults(no_match=no_match, low_confidence=low_confidence),
    )


def _make_policy_with_rule(min_confidence: str = "high") -> Policy:
    """Create a policy with one auto_reply rule requiring min_confidence."""
    return Policy(
        policy_version="0",
        rules=[
            PolicyRule(
                id="auto-yes",
                match=MatchCriteria(
                    prompt_type=["yes_no"],
                    min_confidence=min_confidence,
                ),
                action=AutoReplyAction(value="y"),
            ),
        ],
        defaults=PolicyDefaults(),
    )


class TestPolicyDefaultsSafety:
    """PolicyDefaults must default to safe values."""

    def test_low_confidence_default_is_require_human(self) -> None:
        defaults = PolicyDefaults()
        assert defaults.low_confidence == "require_human"

    def test_no_match_default_is_require_human(self) -> None:
        defaults = PolicyDefaults()
        assert defaults.no_match == "require_human"

    def test_defaults_only_accept_require_human_or_deny(self) -> None:
        """low_confidence and no_match must be Literal['require_human', 'deny']."""
        # Valid values
        PolicyDefaults(no_match="require_human", low_confidence="require_human")
        PolicyDefaults(no_match="deny", low_confidence="deny")

        # Invalid values must raise
        with pytest.raises(Exception):  # noqa: B017
            PolicyDefaults(no_match="auto_reply")  # type: ignore[arg-type]
        with pytest.raises(Exception):  # noqa: B017
            PolicyDefaults(low_confidence="auto_reply")  # type: ignore[arg-type]


class TestLowConfidenceEscalation:
    """Low confidence must trigger escalation, never auto_reply."""

    def test_empty_policy_always_escalates(self) -> None:
        """Policy with no rules: any input → require_human."""
        policy = _make_empty_policy()
        decision = evaluate(
            policy=policy,
            prompt_text="Continue? [y/N]",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p-001",
            session_id="s-001",
        )
        assert decision.action_type == "require_human"

    def test_low_confidence_no_rule_match_escalates(self) -> None:
        """Low confidence + no matching rule → require_human."""
        policy = _make_policy_with_rule(min_confidence="high")
        decision = evaluate(
            policy=policy,
            prompt_text="Continue? [y/N]",
            prompt_type="yes_no",
            confidence="low",
            prompt_id="p-002",
            session_id="s-002",
        )
        assert decision.action_type in ("require_human", "deny")
        assert decision.action_type != "auto_reply"

    def test_low_confidence_with_deny_default(self) -> None:
        """If low_confidence default is 'deny', low confidence returns deny."""
        policy = _make_empty_policy(low_confidence="deny")
        decision = evaluate(
            policy=policy,
            prompt_text="Continue? [y/N]",
            prompt_type="yes_no",
            confidence="low",
            prompt_id="p-003",
            session_id="s-003",
        )
        assert decision.action_type == "deny"

    @pytest.mark.parametrize(
        "prompt_type",
        ["yes_no", "confirm_enter", "multiple_choice", "free_text"],
    )
    def test_no_match_never_returns_auto_reply(self, prompt_type: str) -> None:
        """For every prompt type, no-match fallback must never be auto_reply."""
        policy = _make_empty_policy()
        decision = evaluate(
            policy=policy,
            prompt_text="Some prompt text",
            prompt_type=prompt_type,
            confidence="high",
            prompt_id="p-004",
            session_id="s-004",
        )
        assert decision.action_type != "auto_reply"

    def test_explanation_mentions_no_rule_matched(self) -> None:
        """Fallback decisions should explain why they escalated."""
        policy = _make_empty_policy()
        decision = evaluate(
            policy=policy,
            prompt_text="Continue?",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p-005",
            session_id="s-005",
        )
        assert "no rule matched" in decision.explanation.lower()
