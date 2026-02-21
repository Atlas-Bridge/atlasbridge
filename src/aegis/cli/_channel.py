"""aegis channel add — add/reconfigure a notification channel."""

from __future__ import annotations
from rich.console import Console


def cmd_channel_add(channel_type: str, token: str, users: str, console: Console) -> None:
    console.print(f"[bold]Adding {channel_type} channel...[/bold]")
    console.print("[yellow]Channel configuration not yet implemented (v0.2.0)[/yellow]")
    console.print("Run [cyan]aegis setup[/cyan] to configure channels interactively.")
