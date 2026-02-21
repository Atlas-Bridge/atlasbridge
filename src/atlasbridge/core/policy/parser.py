"""
Policy YAML parser — loads and validates AtlasBridge Policy DSL v0.

Usage::

    policy = load_policy("~/.atlasbridge/policy.yaml")
    policy = parse_policy(yaml_string)
    policy = default_policy()   # safe all-require_human default
"""

from __future__ import annotations

from pathlib import Path

from pydantic import ValidationError

from atlasbridge.core.policy.model import (
    AutonomyMode,
    MatchCriteria,
    Policy,
    PolicyDefaults,
    PolicyRule,
    RequireHumanAction,
)


class PolicyParseError(ValueError):
    """Raised when a policy file cannot be parsed or fails validation."""


def load_policy(path: str | Path) -> Policy:
    """
    Load and validate a policy from a YAML file.

    Raises:
        PolicyParseError: if the file is missing, unreadable, or invalid.
    """
    p = Path(path).expanduser()
    if not p.exists():
        raise PolicyParseError(f"Policy file not found: {p}")
    try:
        content = p.read_text(encoding="utf-8")
    except OSError as exc:
        raise PolicyParseError(f"Cannot read policy file {p}: {exc}") from exc
    return parse_policy(content, source=str(p))


def parse_policy(yaml_text: str, source: str = "<string>") -> Policy:
    """
    Parse and validate a YAML policy string.

    Args:
        yaml_text: Raw YAML content.
        source:    Human-readable source label for error messages.

    Returns:
        A validated :class:`Policy` instance.

    Raises:
        PolicyParseError: on YAML syntax errors or schema violations.
    """
    try:
        import yaml
    except ImportError as exc:
        raise PolicyParseError(
            "PyYAML is required for policy parsing. Install it with: pip install PyYAML"
        ) from exc

    try:
        data = yaml.safe_load(yaml_text)
    except yaml.YAMLError as exc:
        raise PolicyParseError(f"YAML syntax error in {source}: {exc}") from exc

    if not isinstance(data, dict):
        raise PolicyParseError(
            f"Policy {source} must be a YAML mapping (got {type(data).__name__})"
        )

    # Validate with Pydantic
    try:
        return Policy.model_validate(data)
    except ValidationError as exc:
        # Format Pydantic errors into human-readable messages
        lines = [f"Policy validation failed in {source}:"]
        for err in exc.errors():
            loc = " → ".join(str(x) for x in err["loc"]) if err["loc"] else "(root)"
            lines.append(f"  {loc}: {err['msg']}")
        raise PolicyParseError("\n".join(lines)) from exc


def default_policy() -> Policy:
    """
    Return the built-in safe-default policy.

    All prompts are routed to human; no auto-replies.
    This is used when no policy file is configured.
    """
    return Policy(
        policy_version="0",
        name="safe-default",
        autonomy_mode=AutonomyMode.ASSIST,
        rules=[
            PolicyRule(
                id="default-require-human",
                description="Catch-all: route every prompt to the human operator.",
                match=MatchCriteria(),
                action=RequireHumanAction(
                    message="No policy file configured — all prompts require human input."
                ),
            )
        ],
        defaults=PolicyDefaults(no_match="require_human", low_confidence="require_human"),
    )


def validate_policy_file(path: str | Path) -> list[str]:
    """
    Validate a policy file and return a list of human-readable error strings.

    Returns an empty list if the policy is valid.
    """
    try:
        load_policy(path)
        return []
    except PolicyParseError as exc:
        return str(exc).splitlines()
