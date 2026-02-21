"""aegis run — launch a CLI tool under Aegis supervision."""

from __future__ import annotations
from rich.console import Console


def cmd_run(tool: str, command: list[str], label: str, cwd: str, console: Console) -> None:
    console.print(f"[bold]Aegis Run[/bold] — {' '.join(command)}")
    console.print("[yellow]Session launching not yet implemented (v0.2.0)[/yellow]")
    console.print("Run [cyan]aegis start[/cyan] to start the daemon first.")
