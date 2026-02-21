"""aegis status — daemon and session status."""

from __future__ import annotations
import json
from rich.console import Console


def cmd_status(as_json: bool, console: Console) -> None:
    data = {
        "daemon": "not_running",
        "active_sessions": 0,
        "pending_prompts": 0,
    }
    if as_json:
        print(json.dumps(data, indent=2))
    else:
        console.print("[bold]Aegis Status[/bold]\n")
        console.print("  Daemon: [yellow]not running[/yellow]")
        console.print("  Run [cyan]aegis start[/cyan] to start the daemon.")
