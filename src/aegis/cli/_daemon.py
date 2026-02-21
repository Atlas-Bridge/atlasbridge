"""aegis start / stop — daemon lifecycle commands."""

from __future__ import annotations
from rich.console import Console


def cmd_start(foreground: bool, console: Console) -> None:
    console.print("[bold]Starting Aegis daemon...[/bold]")
    console.print("[yellow]Daemon start not yet implemented (v0.2.0)[/yellow]")


def cmd_stop(console: Console) -> None:
    console.print("[bold]Stopping Aegis daemon...[/bold]")
    console.print("[yellow]Daemon stop not yet implemented (v0.2.0)[/yellow]")
