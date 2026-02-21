"""
CLI commands: ``atlasbridge policy validate`` and ``atlasbridge policy test --explain``.
"""

from __future__ import annotations

import sys

import click

from atlasbridge.core.policy.evaluator import evaluate
from atlasbridge.core.policy.explain import explain_decision, explain_policy
from atlasbridge.core.policy.parser import PolicyParseError, load_policy


@click.group("policy")
def policy_group() -> None:
    """Manage and test AtlasBridge policy files."""


@policy_group.command("validate")
@click.argument("policy_file", type=click.Path(exists=True, dir_okay=False))
def policy_validate(policy_file: str) -> None:
    """
    Validate a policy YAML file against the AtlasBridge Policy DSL v0 schema.

    Exits 0 if valid, 1 if invalid.
    """
    try:
        policy = load_policy(policy_file)
        click.echo(
            f"✓  Policy {policy.name!r} is valid "
            f"({len(policy.rules)} rule(s), mode={policy.autonomy_mode.value}, "
            f"hash={policy.content_hash()})"
        )
    except PolicyParseError as exc:
        click.echo(str(exc), err=True)
        sys.exit(1)


@policy_group.command("test")
@click.argument("policy_file", type=click.Path(exists=True, dir_okay=False))
@click.option("--prompt", "prompt_text", required=True, help="Prompt text excerpt to test.")
@click.option(
    "--type",
    "prompt_type",
    default="yes_no",
    show_default=True,
    help="Prompt type: yes_no, confirm_enter, multiple_choice, free_text.",
)
@click.option(
    "--confidence",
    default="high",
    show_default=True,
    help="Confidence level: high, medium, low.",
)
@click.option("--tool", "tool_id", default="*", show_default=True, help="Tool/adapter name.")
@click.option("--repo", default="", help="Session working directory (prefix match).")
@click.option(
    "--explain",
    is_flag=True,
    default=False,
    help="Show per-rule match details (verbose).",
)
def policy_test(
    policy_file: str,
    prompt_text: str,
    prompt_type: str,
    confidence: str,
    tool_id: str,
    repo: str,
    explain: bool,
) -> None:
    """
    Test a policy against a synthetic prompt and show the decision.

    Example::

        atlasbridge policy test ~/.atlasbridge/policy.yaml \\
            --prompt "Continue? [y/n]" --type yes_no --explain
    """
    try:
        policy = load_policy(policy_file)
    except PolicyParseError as exc:
        click.echo(str(exc), err=True)
        sys.exit(1)

    if explain:
        click.echo(
            explain_policy(
                policy=policy,
                prompt_text=prompt_text,
                prompt_type=prompt_type,
                confidence=confidence,
                tool_id=tool_id,
                repo=repo,
            )
        )
        click.echo("")

    decision = evaluate(
        policy=policy,
        prompt_text=prompt_text,
        prompt_type=prompt_type,
        confidence=confidence,
        prompt_id="test-prompt",
        session_id="test-session",
        tool_id=tool_id,
        repo=repo,
    )

    click.echo(explain_decision(decision))
