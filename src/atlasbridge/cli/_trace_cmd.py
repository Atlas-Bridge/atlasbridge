"""
CLI commands: ``atlasbridge trace integrity-check``.

Verifies hash chain integrity of the autopilot decision trace.
"""

from __future__ import annotations

import sys

import click
from rich.console import Console

from atlasbridge.core.autopilot.trace import DecisionTrace


@click.group("trace")
def trace_group() -> None:
    """Inspect and verify the autopilot decision trace."""


@trace_group.command("integrity-check")
@click.option(
    "--path",
    "trace_path",
    default="",
    help="Path to trace JSONL file (default: auto-detect from config).",
)
def trace_integrity_check(trace_path: str) -> None:
    """Verify hash chain integrity of the decision trace.

    Reads the JSONL trace file, verifies that each entry's prev_hash
    matches the previous entry's hash, and that each hash matches the
    recomputed value.  Exits 0 if valid, 1 if the chain is broken.
    """
    from pathlib import Path

    from atlasbridge.core.autopilot.trace import TRACE_FILENAME

    console = Console(stderr=True)

    if trace_path:
        path = Path(trace_path)
    else:
        from atlasbridge.core.config import config_dir

        path = config_dir() / TRACE_FILENAME

    if not path.exists():
        console.print(f"[yellow]Trace file not found:[/yellow] {path}")
        console.print("[green]No entries to verify — OK.[/green]")
        sys.exit(0)

    valid, errors = DecisionTrace.verify_integrity(path)

    # Count entries
    entry_count = 0
    try:
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                if line.strip():
                    entry_count += 1
    except OSError:
        pass

    console.print(f"Trace file: {path}")
    console.print(f"Entries:    {entry_count}")

    if valid:
        console.print("[bold green]Integrity: VALID[/bold green]")
        sys.exit(0)
    else:
        console.print(f"[bold red]Integrity: BROKEN ({len(errors)} error(s))[/bold red]")
        for error in errors[:10]:
            console.print(f"  [red]•[/red] {error}")
        if len(errors) > 10:
            console.print(f"  ... and {len(errors) - 10} more")
        sys.exit(1)
