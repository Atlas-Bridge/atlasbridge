"""
AtlasBridge Policy DSL v0 — deterministic, policy-driven prompt routing.

Public API::

    from atlasbridge.core.policy import Policy, evaluate, load_policy

    policy = load_policy("policy.yaml")
    decision = evaluate(policy, event, session_id="abc", tool_id="claude_code", repo="/home/user")
"""

from atlasbridge.core.policy.evaluator import evaluate
from atlasbridge.core.policy.model import (
    AutonomyMode,
    AutoReplyAction,
    DenyAction,
    NotifyOnlyAction,
    Policy,
    PolicyDecision,
    PolicyDefaults,
    PolicyRule,
    RequireHumanAction,
)
from atlasbridge.core.policy.parser import load_policy, parse_policy

__all__ = [
    "AutoReplyAction",
    "AutonomyMode",
    "DenyAction",
    "NotifyOnlyAction",
    "Policy",
    "PolicyDecision",
    "PolicyDefaults",
    "PolicyRule",
    "RequireHumanAction",
    "evaluate",
    "load_policy",
    "parse_policy",
]
