"""aegis setup — interactive first-time configuration wizard."""

from __future__ import annotations

import re
import shutil
import sys

from rich.console import Console
from rich.prompt import Confirm, Prompt

_TOKEN_RE = re.compile(r"\d{8,12}:[A-Za-z0-9_\-]{35,}")


def _validate_token(token: str) -> bool:
    return bool(_TOKEN_RE.fullmatch(token.strip()))


def _validate_users(users_str: str) -> list[int] | None:
    try:
        return [int(u.strip()) for u in users_str.split(",") if u.strip()]
    except ValueError:
        return None


def run_setup(
    channel: str,
    non_interactive: bool,
    console: Console,
    token: str = "",  # nosec B107 — empty default, not a hardcoded credential
    users: str = "",
) -> None:
    """Run the Aegis setup wizard."""
    import os

    from aegis.core.config import aegis_dir, save_config
    from aegis.core.exceptions import ConfigError

    console.print("[bold]Aegis Setup[/bold]")
    console.print(f"\nConfiguring channel: [cyan]{channel}[/cyan]\n")

    if channel != "telegram":
        console.print(f"[red]Channel '{channel}' is not yet implemented.[/red]")
        console.print("Only 'telegram' is supported in v0.2.0.")
        sys.exit(1)

    # -----------------------------------------------------------------------
    # Collect bot token
    # -----------------------------------------------------------------------
    if not token:
        token = os.environ.get("AEGIS_TELEGRAM_BOT_TOKEN", "")

    if not token and not non_interactive:
        console.print("Get your bot token from @BotFather on Telegram.\n")
        while True:
            token = Prompt.ask("[bold]Telegram bot token[/bold]").strip()
            if _validate_token(token):
                break
            console.print(
                "[red]Invalid token format.[/red] Expected: [dim]12345678:ABCDEFGHIJKLMNOPQRSTUVWXYZabcde...[/dim]"
            )

    if not token:
        console.print(
            "[red]No bot token provided. Set AEGIS_TELEGRAM_BOT_TOKEN or run interactively.[/red]"
        )
        sys.exit(1)

    if not _validate_token(token):
        console.print("[red]Invalid bot token format.[/red]")
        console.print("Expected format: [dim]<8-12 digits>:<35+ alphanumeric chars>[/dim]")
        sys.exit(1)

    # -----------------------------------------------------------------------
    # Collect allowed user IDs
    # -----------------------------------------------------------------------
    if not users:
        users = os.environ.get("AEGIS_TELEGRAM_ALLOWED_USERS", "")

    if not users and not non_interactive:
        console.print("\nYour Telegram user ID (find it by messaging @userinfobot).\n")
        while True:
            users = Prompt.ask("[bold]Allowed Telegram user ID(s)[/bold] (comma-separated)").strip()
            parsed = _validate_users(users)
            if parsed:
                break
            console.print("[red]Please enter numeric user IDs separated by commas.[/red]")

    if not users:
        console.print(
            "[red]No user IDs provided. Set AEGIS_TELEGRAM_ALLOWED_USERS or run interactively.[/red]"
        )
        sys.exit(1)

    parsed_users = _validate_users(users)
    if not parsed_users:
        console.print(f"[red]Invalid user IDs: {users!r}[/red]")
        sys.exit(1)

    # -----------------------------------------------------------------------
    # Write config
    # -----------------------------------------------------------------------
    config_data = {
        "telegram": {
            "bot_token": token,
            "allowed_users": parsed_users,
        }
    }

    try:
        cfg_path = save_config(config_data)
    except ConfigError as exc:
        console.print(f"[red]Failed to save config: {exc}[/red]")
        sys.exit(1)

    console.print(f"\n[green]Config saved:[/green] {cfg_path}")
    console.print(f"Aegis dir:    {aegis_dir()}")

    # -----------------------------------------------------------------------
    # Linux: offer systemd service installation
    # -----------------------------------------------------------------------
    if sys.platform.startswith("linux") and not non_interactive:
        _maybe_install_systemd(console, str(cfg_path))

    console.print("\n[green]Setup complete.[/green]")
    console.print("Run [cyan]aegis run claude[/cyan] to start supervising Claude Code.")


def _maybe_install_systemd(console: Console, config_path: str) -> None:
    """Offer to install the systemd user service on Linux."""
    if not shutil.which("systemctl"):
        return

    from aegis.os.systemd.service import (
        enable_service,
        generate_unit_file,
        install_service,
        is_systemd_available,
        reload_daemon,
    )

    if not is_systemd_available():
        return

    console.print()
    install = Confirm.ask(
        "[bold]Install systemd user service?[/bold] "
        "(enables [cyan]systemctl --user start aegis[/cyan])",
        default=True,
    )
    if not install:
        console.print("[dim]Skipped systemd service installation.[/dim]")
        return

    aegis_bin = shutil.which("aegis") or "aegis"
    unit = generate_unit_file(exec_path=aegis_bin, config_path=config_path)
    try:
        unit_path = install_service(unit)
        reload_daemon()
        enable_service()
        console.print(f"[green]Service installed:[/green] {unit_path}")
        console.print("Start now: [cyan]systemctl --user start aegis[/cyan]")
    except Exception as exc:  # noqa: BLE001
        console.print(f"[yellow]Could not install service: {exc}[/yellow]")
        console.print(
            "You can install manually later with [cyan]aegis setup --install-service[/cyan]."
        )
