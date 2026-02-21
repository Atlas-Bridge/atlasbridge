"""aegis setup — interactive first-time configuration."""

from __future__ import annotations
from rich.console import Console


def run_setup(channel: str, non_interactive: bool, console: Console) -> None:
    console.print("[bold]Aegis Setup[/bold]")
    console.print(f"\nConfiguring channel: [cyan]{channel}[/cyan]")
    console.print("\n[yellow]Setup wizard not yet implemented (v0.2.0)[/yellow]")
    console.print("Track progress: https://github.com/aegis-cli/aegis/issues")
