"""
Slack channel stub (v0.4.0).

The Slack channel is planned for Aegis v0.4.0. This stub raises
NotImplementedError so that the adapter registry can detect the channel
as planned-but-unavailable at runtime.

Implementation plan (v0.4.0):
  - Use Slack Bolt for Python (slack_bolt)
  - Block Kit for interactive buttons (YES_NO, MULTIPLE_CHOICE)
  - Slash command /aegis for session management
  - Allowed users: channels.slack.allowed_user_ids config key
  - Callback payload: same semantic model as Telegram
"""

from __future__ import annotations

from typing import Any, AsyncIterator

from aegis.channels.base import BaseChannel
from aegis.core.prompt.models import PromptEvent, Reply


class SlackChannel(BaseChannel):
    """
    Slack channel (v0.4.0 planned).

    Raises NotImplementedError on all methods.
    The channel name is registered so that `aegis adapter list` can show it
    with status "planned (v0.4.0)".
    """

    channel_name = "slack"
    display_name = "Slack (planned v0.4.0)"

    def __init__(self) -> None:
        raise NotImplementedError(
            "The Slack channel is not yet implemented. "
            "It is planned for Aegis v0.4.0. "
            "Use the Telegram channel for now."
        )

    async def start(self) -> None:
        raise NotImplementedError

    async def close(self) -> None:
        raise NotImplementedError

    async def send_prompt(self, event: PromptEvent) -> str:
        raise NotImplementedError

    async def notify(self, message: str, session_id: str = "") -> None:
        raise NotImplementedError

    async def edit_prompt_message(
        self,
        message_id: str,
        new_text: str,
        session_id: str = "",
    ) -> None:
        raise NotImplementedError

    async def receive_replies(self) -> AsyncIterator[Reply]:  # type: ignore[override]
        raise NotImplementedError
        yield  # make this a generator (unreachable)

    def is_allowed(self, identity: str) -> bool:
        raise NotImplementedError

    def healthcheck(self) -> dict[str, Any]:
        return {
            "status": "not_implemented",
            "channel": self.channel_name,
            "planned": "v0.4.0",
        }
