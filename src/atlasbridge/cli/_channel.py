"""atlasbridge channel — notification channel management (removed)."""

from __future__ import annotations

import click
from rich.console import Console

console = Console()


@click.group("channel")
def channel_group() -> None:
    """Notification channel management (channels have been removed)."""


@channel_group.command("add")
@click.argument("channel_type", metavar="TYPE")
def channel_add_cmd(channel_type: str) -> None:
    """Add a notification channel (removed)."""
    console.print(
        "[yellow]Notification channels (Telegram/Slack) have been removed.[/yellow]\n"
        "AtlasBridge now operates without external notification channels."
    )


@channel_group.command("remove")
@click.argument("channel_type", metavar="TYPE")
def channel_remove_cmd(channel_type: str) -> None:
    """Remove a notification channel (removed)."""
    console.print(
        "[yellow]Notification channels (Telegram/Slack) have been removed.[/yellow]\n"
        "No channels to remove."
    )
