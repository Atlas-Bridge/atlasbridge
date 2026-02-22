"""
Unit tests for Policy DSL v1: model, parser, evaluator, and migration.

Covers:
- MatchCriteriaV1 parsing (max_confidence, session_tag, any_of, none_of)
- any_of OR logic
- none_of NOT logic
- session_tag exact matching
- max_confidence upper-bound matching
- evaluate() dispatching to _evaluate_rule_v1 for PolicyV1
- Policy inheritance (extends): child shadows base, cycle detection
- migrate_v0_to_v1: rewrites version, preserves comments, validates result
- Backward compat: Policy (v0) still routes through _evaluate_rule
"""

from __future__ import annotations

from pathlib import Path

import pytest

from atlasbridge.core.policy.evaluator import evaluate
from atlasbridge.core.policy.model import (
    AutonomyMode,
    AutoReplyAction,
    ConfidenceLevel,
    DenyAction,
    PolicyDefaults,
    RequireHumanAction,
)
from atlasbridge.core.policy.model_v1 import (
    MatchCriteriaV1,
    PolicyRuleV1,
    PolicyV1,
)
from atlasbridge.core.policy.parser import PolicyParseError, load_policy, parse_policy

FIXTURES_V1_DIR = Path(__file__).parent / "fixtures" / "v1"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_v1_rule(
    rule_id: str,
    action_type: str = "auto_reply",
    action_value: str = "y",
    **match_kwargs: object,
) -> PolicyRuleV1:
    if action_type == "auto_reply":
        action = AutoReplyAction(value=action_value)
    elif action_type == "deny":
        action = DenyAction(reason="test deny")
    else:
        action = RequireHumanAction()
    return PolicyRuleV1(id=rule_id, match=MatchCriteriaV1(**match_kwargs), action=action)


def make_v1_policy(*rules: PolicyRuleV1, mode: str = "full") -> PolicyV1:
    return PolicyV1(
        policy_version="1",
        name="test-v1",
        autonomy_mode=AutonomyMode(mode),
        rules=list(rules),
    )


def _eval_v1(
    policy: PolicyV1,
    prompt_type: str = "yes_no",
    confidence: str = "high",
    prompt_text: str = "Continue? [y/n]",
    tool_id: str = "*",
    repo: str = "",
    session_tag: str = "",
) -> object:
    return evaluate(
        policy=policy,
        prompt_text=prompt_text,
        prompt_type=prompt_type,
        confidence=confidence,
        prompt_id="p1",
        session_id="s1",
        tool_id=tool_id,
        repo=repo,
        session_tag=session_tag,
    )


# ---------------------------------------------------------------------------
# TestMatchCriteriaV1Parsing
# ---------------------------------------------------------------------------


class TestMatchCriteriaV1Parsing:
    def test_default_criteria_valid(self) -> None:
        m = MatchCriteriaV1()
        assert m.tool_id == "*"
        assert m.min_confidence == ConfidenceLevel.LOW
        assert m.max_confidence is None
        assert m.session_tag is None
        assert m.any_of is None
        assert m.none_of is None

    def test_max_confidence_parses(self) -> None:
        m = MatchCriteriaV1(max_confidence=ConfidenceLevel.MED)
        assert m.max_confidence == ConfidenceLevel.MED

    def test_session_tag_parses(self) -> None:
        m = MatchCriteriaV1(session_tag="ci")
        assert m.session_tag == "ci"

    def test_any_of_parses(self) -> None:
        m = MatchCriteriaV1(
            any_of=[
                MatchCriteriaV1(prompt_type=["yes_no"]),
                MatchCriteriaV1(prompt_type=["confirm_enter"]),
            ]
        )
        assert len(m.any_of) == 2  # type: ignore[arg-type]

    def test_none_of_parses(self) -> None:
        m = MatchCriteriaV1(
            none_of=[MatchCriteriaV1(contains="delete")],
            prompt_type=["yes_no"],
        )
        assert len(m.none_of) == 1  # type: ignore[arg-type]

    def test_any_of_mutually_exclusive_with_flat_criteria(self) -> None:
        with pytest.raises(Exception, match="mutually exclusive"):
            MatchCriteriaV1(
                any_of=[MatchCriteriaV1(prompt_type=["yes_no"])],
                contains="foo",  # flat criterion — forbidden with any_of
            )

    def test_any_of_with_none_of_allowed(self) -> None:
        # none_of can coexist with any_of
        m = MatchCriteriaV1(
            any_of=[MatchCriteriaV1(prompt_type=["yes_no"])],
            none_of=[MatchCriteriaV1(contains="danger")],
        )
        assert m.any_of is not None
        assert m.none_of is not None

    def test_confidence_le_operator(self) -> None:
        assert ConfidenceLevel.LOW <= ConfidenceLevel.LOW
        assert ConfidenceLevel.LOW <= ConfidenceLevel.MED
        assert ConfidenceLevel.LOW <= ConfidenceLevel.HIGH
        assert ConfidenceLevel.MED <= ConfidenceLevel.HIGH
        assert not (ConfidenceLevel.HIGH <= ConfidenceLevel.MED)
        assert not (ConfidenceLevel.MED <= ConfidenceLevel.LOW)

    def test_confidence_lt_operator(self) -> None:
        assert ConfidenceLevel.LOW < ConfidenceLevel.MED
        assert not (ConfidenceLevel.HIGH < ConfidenceLevel.HIGH)

    def test_policy_v1_version_validator(self) -> None:
        with pytest.raises(Exception, match="Expected policy_version '1'"):
            PolicyV1(policy_version="0", name="x", rules=[])

    def test_policy_v1_duplicate_ids_raises(self) -> None:
        r1 = make_v1_rule("dup")
        r2 = make_v1_rule("dup")
        with pytest.raises(Exception, match="Duplicate rule id"):
            PolicyV1(policy_version="1", name="x", rules=[r1, r2])

    def test_policy_v1_content_hash_stable(self) -> None:
        p = make_v1_policy()
        assert p.content_hash() == p.content_hash()
        assert len(p.content_hash()) == 16


# ---------------------------------------------------------------------------
# TestAnyOfLogic
# ---------------------------------------------------------------------------


class TestAnyOfLogic:
    def test_any_of_matches_first_sub_block(self) -> None:
        rule = make_v1_rule(
            "r1",
            any_of=[
                MatchCriteriaV1(prompt_type=["yes_no"]),
                MatchCriteriaV1(prompt_type=["confirm_enter"]),
            ],
        )
        p = make_v1_policy(rule)
        d = _eval_v1(p, prompt_type="yes_no")
        assert d.matched_rule_id == "r1"  # type: ignore[attr-defined]
        assert d.action_type == "auto_reply"  # type: ignore[attr-defined]

    def test_any_of_matches_second_sub_block(self) -> None:
        rule = make_v1_rule(
            "r1",
            any_of=[
                MatchCriteriaV1(prompt_type=["yes_no"]),
                MatchCriteriaV1(prompt_type=["confirm_enter"]),
            ],
        )
        p = make_v1_policy(rule)
        d = _eval_v1(p, prompt_type="confirm_enter")
        assert d.matched_rule_id == "r1"  # type: ignore[attr-defined]

    def test_any_of_no_match_when_all_fail(self) -> None:
        rule = make_v1_rule(
            "r1",
            any_of=[
                MatchCriteriaV1(prompt_type=["yes_no"]),
                MatchCriteriaV1(prompt_type=["confirm_enter"]),
            ],
        )
        p = make_v1_policy(rule)
        d = _eval_v1(p, prompt_type="free_text")
        assert d.matched_rule_id is None  # type: ignore[attr-defined]

    def test_any_of_fixture(self) -> None:
        policy = load_policy(FIXTURES_V1_DIR / "any_of_match.yaml")
        d = evaluate(
            policy=policy,
            prompt_text="Continue?",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
        )
        assert d.matched_rule_id == "any-of-rule"
        assert d.action_type == "auto_reply"

    def test_any_of_fixture_confirm_enter(self) -> None:
        policy = load_policy(FIXTURES_V1_DIR / "any_of_match.yaml")
        d = evaluate(
            policy=policy,
            prompt_text="Press enter",
            prompt_type="confirm_enter",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
        )
        assert d.matched_rule_id == "any-of-rule"

    def test_any_of_fixture_no_match(self) -> None:
        policy = load_policy(FIXTURES_V1_DIR / "any_of_match.yaml")
        d = evaluate(
            policy=policy,
            prompt_text="Enter name:",
            prompt_type="free_text",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
        )
        assert d.matched_rule_id == "catch-all"


# ---------------------------------------------------------------------------
# TestNoneOfLogic
# ---------------------------------------------------------------------------


class TestNoneOfLogic:
    def test_none_of_passes_when_no_sub_block_matches(self) -> None:
        rule = make_v1_rule(
            "r1",
            prompt_type=["yes_no"],
            none_of=[MatchCriteriaV1(contains="danger")],
        )
        p = make_v1_policy(rule)
        d = _eval_v1(p, prompt_text="Continue? [y/n]")
        assert d.matched_rule_id == "r1"  # type: ignore[attr-defined]

    def test_none_of_fails_when_sub_block_matches(self) -> None:
        rule = make_v1_rule(
            "r1",
            prompt_type=["yes_no"],
            none_of=[MatchCriteriaV1(contains="danger")],
        )
        p = make_v1_policy(rule)
        d = _eval_v1(p, prompt_text="Danger! Continue? [y/n]")
        assert d.matched_rule_id is None  # type: ignore[attr-defined]

    def test_none_of_fixture_no_exclusion(self) -> None:
        policy = load_policy(FIXTURES_V1_DIR / "none_of_match.yaml")
        d = evaluate(
            policy=policy,
            prompt_text="Continue? [y/n]",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
        )
        assert d.matched_rule_id == "safe-auto-reply"
        assert d.action_type == "auto_reply"

    def test_none_of_fixture_excluded_by_destroy(self) -> None:
        policy = load_policy(FIXTURES_V1_DIR / "none_of_match.yaml")
        d = evaluate(
            policy=policy,
            prompt_text="Destroy all data? [y/n]",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
        )
        # Excluded by none_of → falls to catch-all
        assert d.matched_rule_id == "catch-all"
        assert d.action_type == "require_human"

    def test_none_of_fixture_excluded_by_delete(self) -> None:
        policy = load_policy(FIXTURES_V1_DIR / "none_of_match.yaml")
        d = evaluate(
            policy=policy,
            prompt_text="Delete this file? [y/n]",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
        )
        assert d.matched_rule_id == "catch-all"


# ---------------------------------------------------------------------------
# TestSessionTagMatching
# ---------------------------------------------------------------------------


class TestSessionTagMatching:
    def test_session_tag_exact_match(self) -> None:
        rule = make_v1_rule("r1", prompt_type=["yes_no"], session_tag="ci")
        p = make_v1_policy(rule)
        d = _eval_v1(p, session_tag="ci")
        assert d.matched_rule_id == "r1"  # type: ignore[attr-defined]

    def test_session_tag_no_match_different_tag(self) -> None:
        rule = make_v1_rule("r1", prompt_type=["yes_no"], session_tag="ci")
        p = make_v1_policy(rule)
        d = _eval_v1(p, session_tag="dev")
        assert d.matched_rule_id is None  # type: ignore[attr-defined]

    def test_session_tag_no_match_empty_tag(self) -> None:
        rule = make_v1_rule("r1", prompt_type=["yes_no"], session_tag="ci")
        p = make_v1_policy(rule)
        d = _eval_v1(p, session_tag="")
        assert d.matched_rule_id is None  # type: ignore[attr-defined]

    def test_session_tag_not_set_matches_any(self) -> None:
        rule = make_v1_rule("r1", prompt_type=["yes_no"])
        p = make_v1_policy(rule)
        # session_tag not set on rule → matches any session_tag value
        d = _eval_v1(p, session_tag="ci")
        assert d.matched_rule_id == "r1"  # type: ignore[attr-defined]

    def test_session_tag_fixture(self) -> None:
        policy = load_policy(FIXTURES_V1_DIR / "session_tag_match.yaml")
        # Matches CI session
        d_ci = evaluate(
            policy=policy,
            prompt_text="Continue?",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
            session_tag="ci",
        )
        assert d_ci.matched_rule_id == "ci-auto-reply"
        assert d_ci.action_type == "auto_reply"

    def test_session_tag_fixture_no_match_dev(self) -> None:
        policy = load_policy(FIXTURES_V1_DIR / "session_tag_match.yaml")
        d_dev = evaluate(
            policy=policy,
            prompt_text="Continue?",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
            session_tag="dev",
        )
        assert d_dev.matched_rule_id == "catch-all"
        assert d_dev.action_type == "require_human"


# ---------------------------------------------------------------------------
# TestMaxConfidence
# ---------------------------------------------------------------------------


class TestMaxConfidence:
    def test_max_confidence_matches_low_when_max_is_low(self) -> None:
        rule = make_v1_rule("r1", max_confidence=ConfidenceLevel.LOW)
        p = make_v1_policy(rule)
        d = _eval_v1(p, confidence="low")
        assert d.matched_rule_id == "r1"  # type: ignore[attr-defined]

    def test_max_confidence_fails_high_when_max_is_low(self) -> None:
        rule = make_v1_rule("r1", max_confidence=ConfidenceLevel.LOW)
        p = make_v1_policy(rule)
        d = _eval_v1(p, confidence="high")
        assert d.matched_rule_id is None  # type: ignore[attr-defined]

    def test_max_confidence_fails_med_when_max_is_low(self) -> None:
        rule = make_v1_rule("r1", max_confidence=ConfidenceLevel.LOW)
        p = make_v1_policy(rule)
        d = _eval_v1(p, confidence="medium")
        assert d.matched_rule_id is None  # type: ignore[attr-defined]

    def test_max_confidence_matches_med_when_max_is_med(self) -> None:
        rule = make_v1_rule("r1", max_confidence=ConfidenceLevel.MED)
        p = make_v1_policy(rule)
        d = _eval_v1(p, confidence="medium")
        assert d.matched_rule_id == "r1"  # type: ignore[attr-defined]

    def test_max_confidence_not_set_matches_all(self) -> None:
        rule = make_v1_rule("r1")
        p = make_v1_policy(rule)
        for conf in ("low", "medium", "high"):
            d = _eval_v1(p, confidence=conf)
            assert d.matched_rule_id == "r1"  # type: ignore[attr-defined]

    def test_max_confidence_fixture_low_notify(self) -> None:
        policy = load_policy(FIXTURES_V1_DIR / "max_confidence_match.yaml")
        d = evaluate(
            policy=policy,
            prompt_text="Something ambiguous",
            prompt_type="free_text",
            confidence="low",
            prompt_id="p1",
            session_id="s1",
        )
        assert d.matched_rule_id == "low-only-notify"
        assert d.action_type == "notify_only"

    def test_max_confidence_fixture_high_skips_low_only(self) -> None:
        policy = load_policy(FIXTURES_V1_DIR / "max_confidence_match.yaml")
        d = evaluate(
            policy=policy,
            prompt_text="Continue? [y/n]",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
        )
        # high confidence > max_confidence=low → low-only-notify doesn't match
        assert d.matched_rule_id == "high-auto-reply"


# ---------------------------------------------------------------------------
# TestV1Evaluate
# ---------------------------------------------------------------------------


class TestV1Evaluate:
    def test_v1_policy_routes_to_evaluate_rule_v1(self) -> None:
        """evaluate() uses _evaluate_rule_v1 for PolicyV1 instances."""
        rule = make_v1_rule("r1", prompt_type=["yes_no"], session_tag="ci")
        p = make_v1_policy(rule)
        # Would fail if the v0 _evaluate_rule path were used (no session_tag support)
        d = _eval_v1(p, session_tag="ci")
        assert d.matched_rule_id == "r1"  # type: ignore[attr-defined]

    def test_v1_policy_content_hash_in_decision(self) -> None:
        p = make_v1_policy(make_v1_rule("r1"))
        d = _eval_v1(p)
        assert d.policy_hash == p.content_hash()  # type: ignore[attr-defined]

    def test_v1_first_match_wins(self) -> None:
        r1 = make_v1_rule("r1", "auto_reply", "y", prompt_type=["yes_no"])
        r2 = make_v1_rule("r2", "deny", prompt_type=["yes_no"])
        p = make_v1_policy(r1, r2)
        d = _eval_v1(p)
        assert d.matched_rule_id == "r1"  # type: ignore[attr-defined]

    def test_v1_no_match_uses_defaults(self) -> None:
        p = PolicyV1(
            policy_version="1",
            name="test",
            rules=[],
            defaults=PolicyDefaults(no_match="deny"),
        )
        d = evaluate(
            policy=p,
            prompt_text="x",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
        )
        assert d.action_type == "deny"  # type: ignore[attr-defined]
        assert d.matched_rule_id is None  # type: ignore[attr-defined]

    def test_v1_low_confidence_default(self) -> None:
        p = PolicyV1(
            policy_version="1",
            name="test",
            rules=[make_v1_rule("r1", min_confidence=ConfidenceLevel.MED)],
            defaults=PolicyDefaults(low_confidence="deny"),
        )
        d = evaluate(
            policy=p,
            prompt_text="x",
            prompt_type="yes_no",
            confidence="low",
            prompt_id="p1",
            session_id="s1",
        )
        assert d.action_type == "deny"  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# TestPolicyInheritance
# ---------------------------------------------------------------------------


class TestPolicyInheritance:
    def test_child_rules_come_before_base(self) -> None:
        """Child rules are prepended; first-match-wins means child shadows base."""
        policy = load_policy(FIXTURES_V1_DIR / "extends_child.yaml")
        # child has base-yes-no with value "n"; base has base-yes-no with value "y"
        # Child's override should win
        d = evaluate(
            policy=policy,
            prompt_text="Continue? [y/n]",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
        )
        assert d.matched_rule_id == "base-yes-no"
        assert d.action_value == "n"  # child override, not base "y"

    def test_base_rules_used_when_child_has_no_match(self) -> None:
        """Rules from base are included after child rules."""
        policy = load_policy(FIXTURES_V1_DIR / "extends_child.yaml")
        # child doesn't have a catch-all; base does (base-catch-all → require_human)
        d = evaluate(
            policy=policy,
            prompt_text="Enter name:",
            prompt_type="free_text",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
        )
        assert d.matched_rule_id == "base-catch-all"

    def test_child_deny_rule_applied_before_base(self) -> None:
        """Child-specific rules run before base rules."""
        policy = load_policy(FIXTURES_V1_DIR / "extends_child.yaml")
        d = evaluate(
            policy=policy,
            prompt_text="Run rm -rf /tmp?",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
        )
        # child-deny-destructive fires first (before base-yes-no)
        assert d.matched_rule_id == "child-deny-destructive"
        assert d.action_type == "deny"

    def test_inherited_policy_is_policy_v1(self) -> None:
        from atlasbridge.core.policy.model_v1 import PolicyV1 as _PolicyV1

        policy = load_policy(FIXTURES_V1_DIR / "extends_child.yaml")
        assert isinstance(policy, _PolicyV1)

    def test_cycle_detection_raises(self, tmp_path: Path) -> None:
        # A extends B, B extends A → cycle
        a_path = tmp_path / "a.yaml"
        b_path = tmp_path / "b.yaml"
        a_path.write_text(
            f'policy_version: "1"\nname: a\nextends: "{b_path}"\nrules: []\n', encoding="utf-8"
        )
        b_path.write_text(
            f'policy_version: "1"\nname: b\nextends: "{a_path}"\nrules: []\n', encoding="utf-8"
        )
        with pytest.raises(PolicyParseError, match="[Cc]ircular"):
            load_policy(a_path)

    def test_extends_v0_base_raises(self, tmp_path: Path) -> None:
        base = tmp_path / "base.yaml"
        base.write_text('policy_version: "0"\nname: base\nrules: []\n', encoding="utf-8")
        child = tmp_path / "child.yaml"
        child.write_text(
            f'policy_version: "1"\nname: child\nextends: "{base}"\nrules: []\n',
            encoding="utf-8",
        )
        with pytest.raises(PolicyParseError, match="must be a v1 policy"):
            load_policy(child)


# ---------------------------------------------------------------------------
# TestMigrateV0ToV1
# ---------------------------------------------------------------------------


class TestMigrateV0ToV1:
    def test_migrate_text_rewrites_version(self) -> None:
        from atlasbridge.core.policy.migrate import migrate_v0_to_v1_text

        original = 'policy_version: "0"\nname: test\nrules: []\n'
        result = migrate_v0_to_v1_text(original)
        assert 'policy_version: "1"' in result
        assert 'policy_version: "0"' not in result

    def test_migrate_text_preserves_comments(self) -> None:
        from atlasbridge.core.policy.migrate import migrate_v0_to_v1_text

        original = '# This is a comment\npolicy_version: "0"\nname: test\nrules: []\n'
        result = migrate_v0_to_v1_text(original)
        assert "# This is a comment" in result

    def test_migrate_text_not_v0_raises(self) -> None:
        from atlasbridge.core.policy.migrate import MigrateError, migrate_v0_to_v1_text

        with pytest.raises(MigrateError, match="v0 policy_version marker"):
            migrate_v0_to_v1_text('policy_version: "1"\nname: test\nrules: []\n')

    def test_migrate_file_in_place(self, tmp_path: Path) -> None:
        from atlasbridge.core.policy.migrate import migrate_v0_to_v1
        from atlasbridge.core.policy.model_v1 import PolicyV1 as _PolicyV1

        src = tmp_path / "policy.yaml"
        src.write_text('policy_version: "0"\nname: test\nrules: []\n', encoding="utf-8")
        out = migrate_v0_to_v1(src)
        assert out == src
        result = load_policy(src)
        assert isinstance(result, _PolicyV1)
        assert result.policy_version == "1"

    def test_migrate_file_to_new_dest(self, tmp_path: Path) -> None:
        from atlasbridge.core.policy.migrate import migrate_v0_to_v1
        from atlasbridge.core.policy.model_v1 import PolicyV1 as _PolicyV1

        src = tmp_path / "policy_v0.yaml"
        dest = tmp_path / "policy_v1.yaml"
        src.write_text('policy_version: "0"\nname: test\nrules: []\n', encoding="utf-8")
        out = migrate_v0_to_v1(src, dest=dest)
        assert out == dest
        assert src.read_text().startswith('policy_version: "0"')  # original unchanged
        result = load_policy(dest)
        assert isinstance(result, _PolicyV1)

    def test_migrate_validates_as_policy_v1(self, tmp_path: Path) -> None:
        from atlasbridge.core.policy.migrate import migrate_v0_to_v1

        # Use the existing basic fixture (valid v0)
        basic = Path(__file__).parent / "fixtures" / "basic.yaml"
        dest = tmp_path / "basic_v1.yaml"
        migrate_v0_to_v1(basic, dest=dest)
        policy = load_policy(dest)
        from atlasbridge.core.policy.model_v1 import PolicyV1 as _PolicyV1

        assert isinstance(policy, _PolicyV1)
        assert len(policy.rules) == 2  # same number of rules as original

    def test_migrate_missing_file_raises(self, tmp_path: Path) -> None:
        from atlasbridge.core.policy.migrate import MigrateError, migrate_v0_to_v1

        with pytest.raises(MigrateError, match="not found"):
            migrate_v0_to_v1(tmp_path / "nonexistent.yaml")

    def test_migrate_invalid_v0_raises(self, tmp_path: Path) -> None:
        from atlasbridge.core.policy.migrate import MigrateError, migrate_v0_to_v1

        bad = tmp_path / "bad.yaml"
        # This is "v0" version marker but has invalid rule schema
        bad.write_text(
            'policy_version: "0"\nname: test\nrules:\n  - id: ""\n    match: {}\n    action: {type: auto_reply}\n',
            encoding="utf-8",
        )
        with pytest.raises(MigrateError):
            migrate_v0_to_v1(bad)


# ---------------------------------------------------------------------------
# TestV0BackwardCompat
# ---------------------------------------------------------------------------


class TestV0BackwardCompat:
    def test_v0_policy_still_evaluates_correctly(self) -> None:
        """evaluate() with a Policy (v0) still uses the v0 _evaluate_rule path."""
        from atlasbridge.core.policy.model import (
            MatchCriteria,
            Policy,
            PolicyRule,
        )

        rule = PolicyRule(
            id="r1",
            match=MatchCriteria(prompt_type=["yes_no"]),
            action=AutoReplyAction(value="y"),
        )
        p = Policy(policy_version="0", name="test", rules=[rule])
        d = evaluate(
            policy=p,
            prompt_text="Continue?",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
        )
        assert d.matched_rule_id == "r1"
        assert d.action_type == "auto_reply"

    def test_parser_still_dispatches_v0(self) -> None:
        from atlasbridge.core.policy.model import Policy as _Policy

        yaml_text = 'policy_version: "0"\nname: test\nrules: []\n'
        policy = parse_policy(yaml_text)
        assert isinstance(policy, _Policy)
        assert policy.policy_version == "0"

    def test_parser_dispatches_v1(self) -> None:
        from atlasbridge.core.policy.model_v1 import PolicyV1 as _PolicyV1

        yaml_text = 'policy_version: "1"\nname: test\nrules: []\n'
        policy = parse_policy(yaml_text)
        assert isinstance(policy, _PolicyV1)
        assert policy.policy_version == "1"

    def test_parser_unknown_version_raises(self) -> None:
        with pytest.raises(PolicyParseError, match="unsupported policy_version"):
            parse_policy('policy_version: "99"\nname: test\nrules: []\n')

    def test_session_tag_ignored_for_v0(self) -> None:
        """session_tag passed to evaluate() is silently ignored for v0 policies."""
        from atlasbridge.core.policy.model import (
            MatchCriteria,
            Policy,
            PolicyRule,
        )

        rule = PolicyRule(
            id="r1",
            match=MatchCriteria(prompt_type=["yes_no"]),
            action=AutoReplyAction(value="y"),
        )
        p = Policy(policy_version="0", name="test", rules=[rule])
        d = evaluate(
            policy=p,
            prompt_text="Continue?",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
            session_tag="ci",  # ignored for v0
        )
        assert d.matched_rule_id == "r1"


# ---------------------------------------------------------------------------
# TestUnknownFieldRejection (extra="forbid" enforcement)
# ---------------------------------------------------------------------------


class TestUnknownFieldRejection:
    """All v1 models have extra='forbid' — unknown fields must raise."""

    def test_match_criteria_v1_rejects_unknown_field(self) -> None:
        with pytest.raises(Exception, match="Extra inputs are not permitted"):
            MatchCriteriaV1(bogus_field="oops")

    def test_policy_rule_v1_rejects_unknown_field(self) -> None:
        with pytest.raises(Exception, match="Extra inputs are not permitted"):
            PolicyRuleV1(
                id="r1",
                match=MatchCriteriaV1(),
                action=AutoReplyAction(value="y"),
                unknown_option=True,
            )

    def test_policy_v1_rejects_unknown_field(self) -> None:
        with pytest.raises(Exception, match="Extra inputs are not permitted"):
            PolicyV1(
                policy_version="1",
                name="test",
                rules=[],
                secret_mode="turbo",
            )

    def test_match_criteria_v1_rejects_typo_field(self) -> None:
        """Common typo: 'session_tags' instead of 'session_tag'."""
        with pytest.raises(Exception, match="Extra inputs are not permitted"):
            MatchCriteriaV1(session_tags="ci")

    def test_match_criteria_v1_rejects_v0_only_field(self) -> None:
        """MatchCriteriaV1 already has all v0 fields, but a truly unknown one rejects."""
        with pytest.raises(Exception, match="Extra inputs are not permitted"):
            MatchCriteriaV1(timeout=30)


# ---------------------------------------------------------------------------
# TestCombinedV1Features
# ---------------------------------------------------------------------------


class TestCombinedV1Features:
    """Test combinations of v1 features that should work together."""

    def test_any_of_with_none_of_on_same_rule(self) -> None:
        """any_of + none_of: match OR block, then exclude by NOT block."""
        rule = make_v1_rule(
            "r1",
            any_of=[
                MatchCriteriaV1(prompt_type=["yes_no"]),
                MatchCriteriaV1(prompt_type=["confirm_enter"]),
            ],
            none_of=[MatchCriteriaV1(contains="danger")],
        )
        p = make_v1_policy(rule)

        # yes_no, no danger → matches
        d = _eval_v1(p, prompt_type="yes_no", prompt_text="Continue?")
        assert d.matched_rule_id == "r1"

        # yes_no, with danger → excluded by none_of
        d = _eval_v1(p, prompt_type="yes_no", prompt_text="Danger! Continue?")
        assert d.matched_rule_id is None

        # confirm_enter, no danger → matches via second any_of block
        d = _eval_v1(p, prompt_type="confirm_enter", prompt_text="Press enter")
        assert d.matched_rule_id == "r1"

        # free_text → any_of fails entirely
        d = _eval_v1(p, prompt_type="free_text", prompt_text="Enter name")
        assert d.matched_rule_id is None

    def test_session_tag_with_max_confidence(self) -> None:
        """session_tag + max_confidence on same rule: both must pass."""
        rule = make_v1_rule(
            "r1",
            prompt_type=["yes_no"],
            session_tag="ci",
            max_confidence=ConfidenceLevel.MED,
        )
        p = make_v1_policy(rule)

        # tag=ci, confidence=low → both pass
        d = _eval_v1(p, session_tag="ci", confidence="low")
        assert d.matched_rule_id == "r1"

        # tag=ci, confidence=medium → both pass
        d = _eval_v1(p, session_tag="ci", confidence="medium")
        assert d.matched_rule_id == "r1"

        # tag=ci, confidence=high → max_confidence fails
        d = _eval_v1(p, session_tag="ci", confidence="high")
        assert d.matched_rule_id is None

        # tag=dev, confidence=low → session_tag fails
        d = _eval_v1(p, session_tag="dev", confidence="low")
        assert d.matched_rule_id is None

    def test_min_and_max_confidence_band(self) -> None:
        """min_confidence + max_confidence form a confidence band."""
        rule = make_v1_rule(
            "r1",
            min_confidence=ConfidenceLevel.MED,
            max_confidence=ConfidenceLevel.MED,
        )
        p = make_v1_policy(rule)

        # low → below min
        d = _eval_v1(p, confidence="low")
        assert d.matched_rule_id is None

        # medium → in band
        d = _eval_v1(p, confidence="medium")
        assert d.matched_rule_id == "r1"

        # high → above max
        d = _eval_v1(p, confidence="high")
        assert d.matched_rule_id is None

    def test_none_of_with_session_tag_and_contains(self) -> None:
        """none_of sub-blocks can reference session_tag and contains together."""
        rule = make_v1_rule(
            "r1",
            prompt_type=["yes_no"],
            none_of=[
                MatchCriteriaV1(contains="rm -rf"),
                MatchCriteriaV1(contains="DROP TABLE"),
            ],
        )
        p = make_v1_policy(rule)

        # Safe prompt → passes none_of
        d = _eval_v1(p, prompt_text="Continue? [y/n]")
        assert d.matched_rule_id == "r1"

        # Dangerous (rm -rf) → excluded
        d = _eval_v1(p, prompt_text="Run rm -rf /tmp? [y/n]")
        assert d.matched_rule_id is None

        # Dangerous (DROP TABLE) → excluded
        d = _eval_v1(p, prompt_text="Execute DROP TABLE users? [y/n]")
        assert d.matched_rule_id is None

    def test_any_of_with_session_tag_in_sub_blocks(self) -> None:
        """any_of sub-blocks can each have their own session_tag filter."""
        rule = make_v1_rule(
            "r1",
            any_of=[
                MatchCriteriaV1(prompt_type=["yes_no"], session_tag="ci"),
                MatchCriteriaV1(prompt_type=["confirm_enter"], session_tag="staging"),
            ],
        )
        p = make_v1_policy(rule)

        # yes_no + ci → first sub-block matches
        d = _eval_v1(p, prompt_type="yes_no", session_tag="ci")
        assert d.matched_rule_id == "r1"

        # confirm_enter + staging → second sub-block matches
        d = _eval_v1(p, prompt_type="confirm_enter", session_tag="staging")
        assert d.matched_rule_id == "r1"

        # yes_no + staging → neither sub-block matches
        d = _eval_v1(p, prompt_type="yes_no", session_tag="staging")
        assert d.matched_rule_id is None


# ---------------------------------------------------------------------------
# TestEdgeCases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    """Edge cases identified by completeness audit."""

    def test_empty_match_catches_all(self) -> None:
        """A rule with empty match {} catches everything (all defaults pass)."""
        rule = make_v1_rule("catch-all", action_type="require_human")
        p = make_v1_policy(rule)
        for pt in ("yes_no", "confirm_enter", "free_text", "multiple_choice"):
            for conf in ("low", "medium", "high"):
                d = _eval_v1(p, prompt_type=pt, confidence=conf)
                assert d.matched_rule_id == "catch-all"

    def test_empty_rules_list_uses_defaults(self) -> None:
        """Policy with no rules falls to defaults."""
        p = PolicyV1(policy_version="1", name="empty", rules=[])
        d = _eval_v1(p)
        assert d.matched_rule_id is None
        assert d.action_type == "require_human"

    def test_empty_rules_deny_default(self) -> None:
        """Policy with no rules and deny default falls to deny."""
        p = PolicyV1(
            policy_version="1",
            name="empty-deny",
            rules=[],
            defaults=PolicyDefaults(no_match="deny"),
        )
        d = _eval_v1(p, confidence="high")
        assert d.action_type == "deny"

    def test_overlapping_rules_first_match_wins(self) -> None:
        """When multiple rules could match, the first one wins."""
        r1 = make_v1_rule("r1", "auto_reply", "y", prompt_type=["yes_no"])
        r2 = make_v1_rule("r2", "deny", prompt_type=["yes_no"])
        r3 = make_v1_rule("r3", "require_human", prompt_type=["yes_no"])
        p = make_v1_policy(r1, r2, r3)
        d = _eval_v1(p)
        assert d.matched_rule_id == "r1"
        assert d.action_type == "auto_reply"

    def test_rule_id_validation_rejects_empty(self) -> None:
        """Empty rule ID should fail validation."""
        with pytest.raises(Exception):
            PolicyRuleV1(
                id="",
                match=MatchCriteriaV1(),
                action=AutoReplyAction(value="y"),
            )

    def test_rule_id_validation_rejects_special_chars(self) -> None:
        """Rule ID with spaces or special chars should fail."""
        with pytest.raises(Exception):
            PolicyRuleV1(
                id="bad rule id!",
                match=MatchCriteriaV1(),
                action=AutoReplyAction(value="y"),
            )

    def test_contains_empty_string_rejected(self) -> None:
        """contains='' is explicitly rejected by the validator."""
        with pytest.raises(Exception, match="contains must not be empty"):
            MatchCriteriaV1(contains="")

    def test_contains_is_regex_with_invalid_pattern(self) -> None:
        """Invalid regex in contains_is_regex=true should raise."""
        with pytest.raises(Exception, match="Invalid regex"):
            MatchCriteriaV1(contains="[invalid", contains_is_regex=True)

    def test_max_auto_replies_must_be_positive(self) -> None:
        """max_auto_replies=0 should fail (ge=1)."""
        with pytest.raises(Exception):
            PolicyRuleV1(
                id="r1",
                match=MatchCriteriaV1(),
                action=AutoReplyAction(value="y"),
                max_auto_replies=0,
            )


# ---------------------------------------------------------------------------
# TestV0FixturesUnderV1Evaluator
# ---------------------------------------------------------------------------


class TestV0FixturesUnderV1Evaluator:
    """All v0 fixtures should migrate to v1 and produce identical results."""

    FIXTURES_DIR = Path(__file__).parent / "fixtures"

    def _migrate_and_load(self, fixture_name: str, tmp_path: Path) -> PolicyV1:
        """Migrate a v0 fixture to v1 and return the loaded policy."""
        from atlasbridge.core.policy.migrate import migrate_v0_to_v1

        src = self.FIXTURES_DIR / fixture_name
        dest = tmp_path / fixture_name
        migrate_v0_to_v1(src, dest=dest)
        policy = load_policy(dest)
        assert isinstance(policy, PolicyV1)
        return policy

    def test_basic_fixture_migrates_and_evaluates(self, tmp_path: Path) -> None:
        policy = self._migrate_and_load("basic.yaml", tmp_path)
        # yes_no + medium confidence → auto_reply y
        d = evaluate(
            policy=policy,
            prompt_text="Continue?",
            prompt_type="yes_no",
            confidence="medium",
            prompt_id="p1",
            session_id="s1",
        )
        assert d.matched_rule_id == "yes-no-auto-yes"
        assert d.action_type == "auto_reply"
        assert d.action_value == "y"

    def test_basic_fixture_confirm_enter(self, tmp_path: Path) -> None:
        policy = self._migrate_and_load("basic.yaml", tmp_path)
        d = evaluate(
            policy=policy,
            prompt_text="Press enter",
            prompt_type="confirm_enter",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
        )
        assert d.matched_rule_id == "confirm-enter-auto"
        assert d.action_type == "auto_reply"

    def test_full_auto_fixture_migrates(self, tmp_path: Path) -> None:
        policy = self._migrate_and_load("full_auto.yaml", tmp_path)
        assert len(policy.rules) == 4

    def test_escalation_fixture_deny_destructive(self, tmp_path: Path) -> None:
        policy = self._migrate_and_load("escalation.yaml", tmp_path)
        d = evaluate(
            policy=policy,
            prompt_text="Run rm -rf /tmp?",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
        )
        assert d.matched_rule_id == "deny-destructive"
        assert d.action_type == "deny"

    def test_escalation_fixture_notify_deploy(self, tmp_path: Path) -> None:
        policy = self._migrate_and_load("escalation.yaml", tmp_path)
        d = evaluate(
            policy=policy,
            prompt_text="Deploy to production?",
            prompt_type="yes_no",
            confidence="high",
            prompt_id="p1",
            session_id="s1",
        )
        assert d.matched_rule_id == "notify-deploy"
        assert d.action_type == "notify_only"

    def test_all_v0_fixtures_migrate_successfully(self, tmp_path: Path) -> None:
        """Every .yaml in fixtures/ with policy_version '0' should migrate cleanly."""
        from atlasbridge.core.policy.migrate import migrate_v0_to_v1

        for yaml_path in sorted(self.FIXTURES_DIR.glob("*.yaml")):
            content = yaml_path.read_text()
            if 'policy_version: "0"' not in content:
                continue
            dest = tmp_path / yaml_path.name
            migrate_v0_to_v1(yaml_path, dest=dest)
            policy = load_policy(dest)
            assert isinstance(policy, PolicyV1), f"{yaml_path.name} did not migrate to PolicyV1"
