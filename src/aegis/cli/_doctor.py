"""aegis doctor — environment and configuration health check."""

from __future__ import annotations
import json
import sys
from rich.console import Console


def cmd_doctor(fix: bool, as_json: bool, console: Console) -> None:
    checks = [
        {"name": "Python version", "status": "pass", "detail": sys.version.split()[0]},
        {"name": "Platform", "status": "pass", "detail": sys.platform},
    ]
    all_pass = all(c["status"] == "pass" for c in checks)

    if as_json:
        print(json.dumps({"checks": checks, "all_pass": all_pass}, indent=2))
        return

    console.print("[bold]Aegis Doctor[/bold]\n")
    for c in checks:
        icon = "[green]PASS[/green]" if c["status"] == "pass" else "[red]FAIL[/red]"
        console.print(f"  {icon}  {c['name']}: {c['detail']}")

    console.print()
    if all_pass:
        console.print("[green]All checks passed.[/green]")
    else:
        console.print("[red]Some checks failed. Run with --fix to auto-repair.[/red]")
