"""
Aegis CLI entry point.

Commands:
  aegis setup              — interactive first-time configuration
  aegis start              — start the background daemon
  aegis stop               — stop the background daemon
  aegis status             — show daemon and session status
  aegis run <tool> [args]  — launch a CLI tool under Aegis supervision
  aegis sessions           — list active sessions
  aegis logs               — stream or show recent audit log
  aegis doctor [--fix]     — environment and configuration health check
  aegis debug bundle       — create a redacted support bundle
  aegis channel add <type> — add/reconfigure a notification channel
  aegis adapter list       — show available tool adapters
  aegis version            — show version and feature flags
  aegis lab run <scenario> — Prompt Lab: run a QA scenario (dev/CI only)
  aegis lab list           — Prompt Lab: list registered scenarios
"""

from __future__ import annotations

import sys

import click
from rich.console import Console

from aegis import __version__

console = Console()
err_console = Console(stderr=True)


# ---------------------------------------------------------------------------
# Root group
# ---------------------------------------------------------------------------


@click.group(context_settings={"help_option_names": ["-h", "--help"]})
@click.version_option(__version__, "--version", "-V", message="aegis %(version)s")
def cli() -> None:
    """Aegis — human-in-the-loop control plane for AI developer agents."""


# ---------------------------------------------------------------------------
# setup
# ---------------------------------------------------------------------------


@cli.command()
@click.option("--channel", type=click.Choice(["telegram", "slack"]), default="telegram")
@click.option("--non-interactive", is_flag=True, default=False, help="Read from env vars only")
def setup(channel: str, non_interactive: bool) -> None:
    """Interactive first-time configuration wizard."""
    from aegis.cli._setup import run_setup

    run_setup(channel=channel, non_interactive=non_interactive, console=console)


# ---------------------------------------------------------------------------
# start / stop / status
# ---------------------------------------------------------------------------


@cli.command()
@click.option(
    "--foreground", "-f", is_flag=True, default=False, help="Run in foreground (do not daemonise)"
)
def start(foreground: bool) -> None:
    """Start the Aegis daemon."""
    from aegis.cli._daemon import cmd_start

    cmd_start(foreground=foreground, console=console)


@cli.command()
def stop() -> None:
    """Stop the running Aegis daemon."""
    from aegis.cli._daemon import cmd_stop

    cmd_stop(console=console)


@cli.command()
@click.option("--json", "as_json", is_flag=True, default=False)
def status(as_json: bool) -> None:
    """Show daemon and session status."""
    from aegis.cli._status import cmd_status

    cmd_status(as_json=as_json, console=console)


# ---------------------------------------------------------------------------
# run
# ---------------------------------------------------------------------------


@cli.command(context_settings={"ignore_unknown_options": True, "allow_extra_args": True})
@click.argument("tool", default="claude")
@click.argument("tool_args", nargs=-1, type=click.UNPROCESSED)
@click.option("--session-label", default="", help="Human-readable label for this session")
@click.option("--cwd", default="", help="Working directory for the tool")
def run(tool: str, tool_args: tuple[str, ...], session_label: str, cwd: str) -> None:
    """Launch a CLI tool under Aegis supervision."""
    from aegis.cli._run import cmd_run

    command = [tool] + list(tool_args)
    cmd_run(tool=tool, command=command, label=session_label, cwd=cwd, console=console)


# ---------------------------------------------------------------------------
# sessions
# ---------------------------------------------------------------------------


@cli.command()
@click.option("--json", "as_json", is_flag=True, default=False)
def sessions(as_json: bool) -> None:
    """List active and recent sessions."""
    from aegis.cli._sessions import cmd_sessions

    cmd_sessions(as_json=as_json, console=console)


# ---------------------------------------------------------------------------
# logs
# ---------------------------------------------------------------------------


@cli.command()
@click.option("--session", "session_id", default="", help="Filter by session ID prefix")
@click.option("--tail", is_flag=True, default=False, help="Follow log output")
@click.option("--limit", default=50, help="Number of recent events to show")
@click.option("--json", "as_json", is_flag=True, default=False)
def logs(session_id: str, tail: bool, limit: int, as_json: bool) -> None:
    """Show recent audit log events."""
    from aegis.cli._logs import cmd_logs

    cmd_logs(session_id=session_id, tail=tail, limit=limit, as_json=as_json, console=console)


# ---------------------------------------------------------------------------
# doctor
# ---------------------------------------------------------------------------


@cli.command()
@click.option("--fix", is_flag=True, default=False, help="Auto-repair fixable issues")
@click.option("--json", "as_json", is_flag=True, default=False)
def doctor(fix: bool, as_json: bool) -> None:
    """Environment and configuration health check."""
    from aegis.cli._doctor import cmd_doctor

    cmd_doctor(fix=fix, as_json=as_json, console=console)


# ---------------------------------------------------------------------------
# debug
# ---------------------------------------------------------------------------


@cli.group()
def debug() -> None:
    """Debugging utilities."""


@debug.command("bundle")
@click.option("--output", default="", help="Output path for the bundle")
@click.option("--include-logs", default=500, help="Number of log lines to include")
@click.option("--no-redact", is_flag=True, default=False, help="Include secrets unredacted")
def debug_bundle(output: str, include_logs: int, no_redact: bool) -> None:
    """Create a redacted support bundle."""
    from aegis.cli._debug import cmd_debug_bundle

    cmd_debug_bundle(
        output=output, include_logs=include_logs, redact=not no_redact, console=console
    )


# ---------------------------------------------------------------------------
# channel
# ---------------------------------------------------------------------------


@cli.group()
def channel() -> None:
    """Notification channel management."""


@channel.command("add")
@click.argument("channel_type", metavar="TYPE", type=click.Choice(["telegram", "slack"]))
@click.option("--token", default="", help="Bot token")
@click.option("--users", default="", help="Comma-separated user IDs")
def channel_add(channel_type: str, token: str, users: str) -> None:
    """Add or reconfigure a notification channel."""
    from aegis.cli._channel import cmd_channel_add

    cmd_channel_add(channel_type=channel_type, token=token, users=users, console=console)


# ---------------------------------------------------------------------------
# adapter
# ---------------------------------------------------------------------------


@cli.group()
def adapter() -> None:
    """Tool adapter management."""


@adapter.command("list")
@click.option("--json", "as_json", is_flag=True, default=False)
def adapter_list(as_json: bool) -> None:
    """Show available tool adapters."""
    from aegis.adapters.base import AdapterRegistry

    # Ensure all adapters are registered by importing them
    import aegis.adapters.claude_code  # noqa: F401
    import aegis.adapters.openai_cli  # noqa: F401

    adapters = AdapterRegistry.list_all()
    if as_json:
        import json

        rows = [
            {
                "name": name,
                "tool_name": cls.tool_name,
                "description": cls.description,
                "min_version": cls.min_tool_version,
            }
            for name, cls in adapters.items()
        ]
        click.echo(json.dumps(rows, indent=2))
    else:
        console.print("\n[bold]Available Adapters[/bold]\n")
        for name, cls in adapters.items():
            console.print(
                f"  [cyan]{name:<12}[/cyan] {cls.description or '—'}"
                + (f"  (min: {cls.min_tool_version})" if cls.min_tool_version else "")
            )
        console.print()


# ---------------------------------------------------------------------------
# version
# ---------------------------------------------------------------------------


@cli.command()
@click.option("--json", "as_json", is_flag=True, default=False)
@click.option("--experimental", is_flag=True, default=False, help="Show experimental flags")
def version(as_json: bool, experimental: bool) -> None:
    """Show version information and feature flags."""
    import platform
    import sys as _sys

    flags = {
        "conpty_backend": False,
        "slack_channel": False,
        "whatsapp_channel": False,
    }
    if experimental:
        flags["windows_conpty"] = _sys.platform == "win32"

    if as_json:
        import json

        click.echo(
            json.dumps(
                {
                    "aegis": __version__,
                    "python": _sys.version.split()[0],
                    "platform": _sys.platform,
                    "arch": platform.machine(),
                    "feature_flags": flags,
                },
                indent=2,
            )
        )
    else:
        console.print(f"aegis {__version__}")
        console.print(f"Python {_sys.version.split()[0]}")
        console.print(f"Platform: {_sys.platform} {platform.machine()}")
        console.print("\nFeature flags:")
        for flag, enabled in flags.items():
            status = "[green]enabled[/green]" if enabled else "[dim]disabled[/dim]"
            console.print(f"  {flag:<22} {status}")


# ---------------------------------------------------------------------------
# lab (Prompt Lab — dev/CI only)
# ---------------------------------------------------------------------------


@cli.group()
def lab() -> None:
    """Prompt Lab — deterministic QA scenario runner (dev/CI)."""


@lab.command("list")
@click.option("--json", "as_json", is_flag=True, default=False)
def lab_list(as_json: bool) -> None:
    """List all registered Prompt Lab scenarios."""
    from aegis.cli._lab import cmd_lab_list

    cmd_lab_list(as_json=as_json, console=console)


@lab.command("run")
@click.argument("scenario", default="")
@click.option("--all", "run_all", is_flag=True, default=False, help="Run all scenarios")
@click.option("--filter", "pattern", default="", help="Run scenarios matching pattern")
@click.option("--verbose", "-v", is_flag=True, default=False)
@click.option("--json", "as_json", is_flag=True, default=False)
def lab_run(scenario: str, run_all: bool, pattern: str, verbose: bool, as_json: bool) -> None:
    """Run one or more Prompt Lab QA scenarios."""
    from aegis.cli._lab import cmd_lab_run

    cmd_lab_run(
        scenario=scenario,
        run_all=run_all,
        pattern=pattern,
        verbose=verbose,
        as_json=as_json,
        console=console,
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    cli()


if __name__ == "__main__":
    main()
