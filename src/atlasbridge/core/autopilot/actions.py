"""
Autopilot action executor — translates PolicyDecision actions into runtime effects.

Each action type maps to a concrete effect:

    auto_reply      → inject reply text into the PTY via inject_fn callback
    require_human   → forward prompt to the human via channel (route_fn callback)
    deny            → log denial, send notification, do NOT inject anything
    notify_only     → send a notification to the channel but do NOT inject or wait

Usage::

    result = await execute_action(
        decision=decision,
        prompt_event=event,
        inject_fn=lambda text: adapter.inject(text),
        route_fn=lambda event: channel.send(event),
        notify_fn=lambda msg: channel.notify(msg),
    )
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from atlasbridge.core.policy.model import (
    AutoReplyAction,
    DenyAction,
    NotifyOnlyAction,
    PolicyDecision,
    RequireHumanAction,
)

logger = logging.getLogger(__name__)


@dataclass
class ActionResult:
    """Result of executing a policy action."""

    action_type: str
    injected: bool = False
    injected_value: str = ""
    routed_to_human: bool = False
    denied: bool = False
    notified: bool = False
    error: str | None = None


# Callback type aliases
InjectFn = Callable[[str], Awaitable[None]]
RouteFn = Callable[[object], Awaitable[None]]
NotifyFn = Callable[[str], Awaitable[None]]


async def execute_action(
    decision: PolicyDecision,
    prompt_event: object,
    inject_fn: InjectFn,
    route_fn: RouteFn,
    notify_fn: NotifyFn,
) -> ActionResult:
    """
    Execute the action specified in the PolicyDecision.

    Args:
        decision:    The evaluated policy decision (contains action + metadata).
        prompt_event: The original PromptEvent (passed to route_fn for require_human).
        inject_fn:   Coroutine to inject a reply string into the PTY stdin.
        route_fn:    Coroutine to forward the PromptEvent to a human via channel.
        notify_fn:   Coroutine to send a one-way notification message to the channel.

    Returns:
        ActionResult describing what happened.
    """
    action = decision.action

    if isinstance(action, AutoReplyAction):
        try:
            await inject_fn(action.value)
            logger.info(
                "Autopilot auto_reply: rule=%s value=%r",
                decision.matched_rule_id,
                action.value,
            )
            return ActionResult(
                action_type="auto_reply",
                injected=True,
                injected_value=action.value,
            )
        except Exception as exc:
            logger.error("Autopilot auto_reply inject failed: %s", exc)
            return ActionResult(action_type="auto_reply", error=str(exc))

    elif isinstance(action, RequireHumanAction):
        try:
            await route_fn(prompt_event)
            logger.info(
                "Autopilot require_human: rule=%s — forwarded to channel",
                decision.matched_rule_id,
            )
            return ActionResult(action_type="require_human", routed_to_human=True)
        except Exception as exc:
            logger.error("Autopilot require_human route failed: %s", exc)
            return ActionResult(action_type="require_human", error=str(exc))

    elif isinstance(action, DenyAction):
        msg = action.reason or "Prompt denied by policy."
        try:
            await notify_fn(f"[DENY] {msg}")
            logger.warning(
                "Autopilot deny: rule=%s reason=%r",
                decision.matched_rule_id,
                action.reason,
            )
        except Exception as exc:
            logger.error("Autopilot deny notification failed: %s", exc)
        return ActionResult(action_type="deny", denied=True)

    elif isinstance(action, NotifyOnlyAction):
        msg = action.message or decision.explanation
        try:
            await notify_fn(msg)
            logger.info(
                "Autopilot notify_only: rule=%s",
                decision.matched_rule_id,
            )
        except Exception as exc:
            logger.error("Autopilot notify_only failed: %s", exc)
            return ActionResult(action_type="notify_only", error=str(exc))
        return ActionResult(action_type="notify_only", notified=True)

    else:
        logger.error("Autopilot: unknown action type %r — routing to human", action)
        try:
            await route_fn(prompt_event)
        except Exception as exc:
            logger.error("Autopilot fallback route failed: %s", exc)
        return ActionResult(action_type="unknown", routed_to_human=True)
