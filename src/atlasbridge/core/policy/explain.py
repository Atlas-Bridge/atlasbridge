"""
Policy explain — human-readable output for the ``atlasbridge policy test --explain`` command.

Usage::

    output = explain_decision(decision, policy)
    print(output)

    # Or explain all rules against a prompt:
    output = explain_policy(policy, prompt_text="Continue? [y/n]", ...)
    print(output)
"""

from __future__ import annotations

from atlasbridge.core.policy.evaluator import RuleMatchResult, _evaluate_rule
from atlasbridge.core.policy.model import Policy, PolicyDecision


def explain_decision(decision: PolicyDecision) -> str:
    """
    Format a PolicyDecision as a human-readable explanation.

    Returns a multi-line string suitable for CLI output.
    """
    lines: list[str] = []
    lines.append(f"Decision:      {decision.action_type.upper()}")
    if decision.action_value:
        lines.append(f"Reply value:   {decision.action_value!r}")
    lines.append(f"Matched rule:  {decision.matched_rule_id or '(none — default applied)'}")
    lines.append(f"Confidence:    {decision.confidence}")
    lines.append(f"Prompt type:   {decision.prompt_type}")
    lines.append(f"Autonomy mode: {decision.autonomy_mode}")
    lines.append(f"Policy hash:   {decision.policy_hash}")
    lines.append(f"Idem key:      {decision.idempotency_key}")
    lines.append("")
    lines.append(f"Explanation:   {decision.explanation}")
    return "\n".join(lines)


def explain_policy(
    policy: Policy,
    prompt_text: str,
    prompt_type: str,
    confidence: str,
    tool_id: str = "*",
    repo: str = "",
) -> str:
    """
    Walk all rules in the policy and show which matched / failed, then show the final decision.

    This is the verbose mode used by ``atlasbridge policy test --explain``.
    """
    lines: list[str] = []
    lines.append(
        f"Policy: {policy.name!r}  (version={policy.policy_version}, hash={policy.content_hash()})"
    )
    lines.append(
        f"Input:  prompt_type={prompt_type!r}  confidence={confidence!r}  tool_id={tool_id!r}"
    )
    if repo:
        lines.append(f"        repo={repo!r}")
    lines.append("")

    first_match: RuleMatchResult | None = None
    for rule in policy.rules:
        result = _evaluate_rule(
            rule=rule,
            prompt_type=prompt_type,
            confidence=confidence,
            excerpt=prompt_text,
            tool_id=tool_id,
            repo=repo,
        )
        status = "MATCH" if result.matched else "skip"
        lines.append(f"  Rule {rule.id!r:40s} [{status}]")
        for reason in result.reasons:
            lines.append(f"      {reason}")
        if result.matched and first_match is None:
            first_match = result
            lines.append(f"      → action: {rule.action.type}")
            lines.append("")
            lines.append("  (Remaining rules not evaluated — first match wins)")
            break
        lines.append("")

    if first_match is None:
        lines.append(f"  No rule matched → applying default ({policy.defaults.no_match})")

    return "\n".join(lines)
