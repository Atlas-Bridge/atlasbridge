"""
Policy evaluator — deterministic first-match-wins rule engine.

Usage::

    decision = evaluate(
        policy=policy,
        prompt_text="Continue? [y/n]",
        prompt_type="yes_no",
        confidence="high",
        prompt_id="abc123",
        session_id="xyz789",
        tool_id="claude_code",
        repo="/home/user/project",
    )
"""

from __future__ import annotations

import logging
import re
import signal
from collections.abc import Iterator
from contextlib import contextmanager

from atlasbridge.core.policy.model import (
    ConfidenceLevel,
    DenyAction,
    Policy,
    PolicyDecision,
    PolicyRule,
    PromptTypeFilter,
    RequireHumanAction,
    confidence_from_str,
)

logger = logging.getLogger(__name__)

_REGEX_TIMEOUT_S = 0.1  # 100ms max per regex evaluation


# ---------------------------------------------------------------------------
# Timeout context manager (UNIX only; Windows silently skips)
# ---------------------------------------------------------------------------


@contextmanager
def _regex_timeout(seconds: float) -> Iterator[None]:
    """Raise TimeoutError if the block runs longer than `seconds`."""
    try:
        signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError()))
        signal.setitimer(signal.ITIMER_REAL, seconds)
        yield
    except AttributeError:
        # Windows — no SIGALRM; skip timeout enforcement
        yield
    finally:
        try:
            signal.setitimer(signal.ITIMER_REAL, 0)
        except AttributeError:
            pass


# ---------------------------------------------------------------------------
# Per-criterion matching helpers
# ---------------------------------------------------------------------------


def _match_tool_id(criterion: str, tool_id: str) -> tuple[bool, str]:
    if criterion == "*":
        return True, "tool_id: * (wildcard, always matches)"
    matched = criterion == tool_id
    return matched, f"tool_id: {criterion!r} {'==' if matched else '!='} {tool_id!r}"


def _match_repo(criterion: str | None, repo: str) -> tuple[bool, str]:
    if criterion is None:
        return True, "repo: not specified (always matches)"
    matched = repo.startswith(criterion)
    return (
        matched,
        f"repo: {repo!r} {'starts with' if matched else 'does not start with'} {criterion!r}",
    )


def _match_prompt_type(
    criterion: list[PromptTypeFilter] | None, prompt_type: str
) -> tuple[bool, str]:
    if criterion is None:
        return True, "prompt_type: not specified (always matches)"
    # ANY in list → always matches
    if PromptTypeFilter.ANY in criterion:
        return True, "prompt_type: * (wildcard, always matches)"
    matched = any(f.value == prompt_type for f in criterion)
    types_str = [f.value for f in criterion]
    return (
        matched,
        f"prompt_type: {prompt_type!r} {'in' if matched else 'not in'} {types_str}",
    )


def _match_confidence(min_confidence: ConfidenceLevel, confidence_str: str) -> tuple[bool, str]:
    event_level = confidence_from_str(confidence_str)
    matched = event_level >= min_confidence
    return (
        matched,
        f"min_confidence: {confidence_str} {'≥' if matched else '<'} {min_confidence.value}",
    )


def _match_contains(
    contains: str | None,
    contains_is_regex: bool,
    excerpt: str,
) -> tuple[bool, str]:
    if contains is None:
        return True, "contains: not specified (always matches)"

    if not contains_is_regex:
        matched = contains.lower() in excerpt.lower()
        return (
            matched,
            f"contains: substring {contains!r} {'found' if matched else 'not found'} in excerpt",
        )

    # Regex match with timeout
    try:
        with _regex_timeout(_REGEX_TIMEOUT_S):
            compiled = re.compile(contains, re.IGNORECASE | re.DOTALL)
            matched = bool(compiled.search(excerpt))
        return (
            matched,
            f"contains: regex {contains!r} {'matched' if matched else 'did not match'} excerpt",
        )
    except TimeoutError:
        logger.warning("Regex %r timed out (>100ms) — rule skipped", contains)
        return False, f"contains: regex {contains!r} timed out — rule skipped"
    except re.error as exc:
        logger.warning("Regex %r error: %s — rule skipped", contains, exc)
        return False, f"contains: regex error {exc} — rule skipped"


# ---------------------------------------------------------------------------
# Single-rule evaluation
# ---------------------------------------------------------------------------


class RuleMatchResult:
    """Result of evaluating one rule against a prompt."""

    __slots__ = ("rule_id", "matched", "reasons")

    def __init__(self, rule_id: str, matched: bool, reasons: list[str]) -> None:
        self.rule_id = rule_id
        self.matched = matched
        self.reasons = reasons


def _evaluate_rule(
    rule: PolicyRule,
    prompt_type: str,
    confidence: str,
    excerpt: str,
    tool_id: str,
    repo: str,
) -> RuleMatchResult:
    """Evaluate a single rule. Returns RuleMatchResult with per-criterion reasons."""
    m = rule.match
    reasons: list[str] = []

    checks = [
        _match_tool_id(m.tool_id, tool_id),
        _match_repo(m.repo, repo),
        _match_prompt_type(m.prompt_type, prompt_type),
        _match_confidence(m.min_confidence, confidence),
        _match_contains(m.contains, m.contains_is_regex, excerpt),
    ]

    all_pass = True
    for ok, reason in checks:
        reasons.append(("✓ " if ok else "✗ ") + reason)
        if not ok:
            all_pass = False
            # Short-circuit: don't bother evaluating remaining criteria
            break

    return RuleMatchResult(rule_id=rule.id, matched=all_pass, reasons=reasons)


# ---------------------------------------------------------------------------
# Top-level evaluate()
# ---------------------------------------------------------------------------


def evaluate(
    policy: Policy,
    prompt_text: str,
    prompt_type: str,
    confidence: str,
    prompt_id: str,
    session_id: str,
    tool_id: str = "*",
    repo: str = "",
) -> PolicyDecision:
    """
    Evaluate the policy against a prompt event. First-match-wins.

    Args:
        policy:       Validated Policy instance.
        prompt_text:  The prompt excerpt (as seen by the user).
        prompt_type:  PromptType string value (e.g. "yes_no").
        confidence:   Confidence string (e.g. "high", "medium", "low").
        prompt_id:    Unique ID of the PromptEvent.
        session_id:   Session the prompt belongs to.
        tool_id:      Adapter/tool name (e.g. "claude_code").
        repo:         Working directory of the session.

    Returns:
        :class:`PolicyDecision` with matched rule, action, and explanation.
    """
    policy_hash = policy.content_hash()
    autonomy_mode = policy.autonomy_mode.value

    # Evaluate rules in order — first match wins
    for rule in policy.rules:
        result = _evaluate_rule(
            rule=rule,
            prompt_type=prompt_type,
            confidence=confidence,
            excerpt=prompt_text,
            tool_id=tool_id,
            repo=repo,
        )
        if result.matched:
            explanation = (
                f"Rule {rule.id!r} matched"
                + (f" — {rule.description}" if rule.description else "")
                + ": "
                + "; ".join(
                    r.lstrip("✓ ").lstrip("✗ ") for r in result.reasons if r.startswith("✓")
                )
            )
            logger.debug("Policy match: rule=%s action=%s", rule.id, rule.action.type)
            return PolicyDecision(
                prompt_id=prompt_id,
                session_id=session_id,
                policy_hash=policy_hash,
                matched_rule_id=rule.id,
                action=rule.action,
                explanation=explanation,
                confidence=confidence,
                prompt_type=prompt_type,
                autonomy_mode=autonomy_mode,
            )

    # No rule matched — apply defaults
    conf_level = confidence_from_str(confidence)
    if conf_level == ConfidenceLevel.LOW:
        fallback = policy.defaults.low_confidence
        explanation = f"No rule matched and confidence is LOW — applying default: {fallback}"
    else:
        fallback = policy.defaults.no_match
        explanation = f"No rule matched — applying default: {fallback}"

    fallback_action: DenyAction | RequireHumanAction
    if fallback == "deny":
        fallback_action = DenyAction(reason="No policy rule matched (default: deny)")
    else:
        fallback_action = RequireHumanAction(
            message="No policy rule matched — human input required"
        )

    logger.debug("Policy no-match: fallback=%s", fallback)
    return PolicyDecision(
        prompt_id=prompt_id,
        session_id=session_id,
        policy_hash=policy_hash,
        matched_rule_id=None,
        action=fallback_action,
        explanation=explanation,
        confidence=confidence,
        prompt_type=prompt_type,
        autonomy_mode=autonomy_mode,
    )
