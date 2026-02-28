"""CLI commands: atlasbridge config show | validate | migrate."""

from __future__ import annotations

import json
import sys

import click
from rich.console import Console

console = Console()


@click.group("config")
def config_group() -> None:
    """View, validate, and migrate AtlasBridge configuration."""


@config_group.command("show")
@click.option("--json", "as_json", is_flag=True, default=False, help="Output as JSON")
@click.option("--redact/--no-redact", default=True, help="Redact secrets (default: redact)")
def config_show(as_json, redact):
    """Display the current configuration."""
    from atlasbridge.core.config import _config_file_path, load_config

    cfg_path = _config_file_path()
    if not cfg_path.exists():
        console.print(f"[red]Config not found:[/red] {cfg_path}")
        console.print("Run: atlasbridge setup")
        sys.exit(1)

    try:
        cfg = load_config(cfg_path)
    except Exception as exc:
        console.print(f"[red]Config error:[/red] {exc}")
        sys.exit(1)

    data = _config_to_dict(cfg, redact=redact)
    data["_config_path"] = str(cfg_path)

    if as_json:
        click.echo(json.dumps(data, indent=2))
    else:
        _print_config_rich(data, console)


@config_group.command("validate")
def config_validate():
    """Validate the current config file against the schema."""
    from atlasbridge.core.config import _config_file_path, load_config

    cfg_path = _config_file_path()
    if not cfg_path.exists():
        console.print(f"[red]Config not found:[/red] {cfg_path}")
        sys.exit(1)

    try:
        load_config(cfg_path)
        console.print(f"[green]Config is valid:[/green] {cfg_path}")
    except Exception as exc:
        console.print(f"[red]Config validation failed:[/red] {exc}")
        sys.exit(1)


@config_group.command("migrate")
@click.option("--dry-run", is_flag=True, default=False, help="Show changes without writing")
def config_migrate(dry_run):
    """Migrate config to the latest schema version."""
    import tomllib

    from atlasbridge.core.config import _config_file_path, save_config
    from atlasbridge.core.config_migrate import (
        CURRENT_CONFIG_VERSION,
        detect_version,
        upgrade_config,
    )

    cfg_path = _config_file_path()
    if not cfg_path.exists():
        console.print(f"[red]Config not found:[/red] {cfg_path}")
        sys.exit(1)

    with open(cfg_path, "rb") as f:
        data = tomllib.load(f)

    detected = detect_version(data)
    if detected >= CURRENT_CONFIG_VERSION:
        console.print(f"Config is already at version {detected}. No migration needed.")
        return

    console.print(f"Migrating config from v{detected} to v{CURRENT_CONFIG_VERSION}...")
    data = upgrade_config(data, detected, CURRENT_CONFIG_VERSION)

    if dry_run:
        import tomli_w

        console.print("[dim]Dry run — changes not written.[/dim]")
        click.echo(tomli_w.dumps(data))
    else:
        save_config(data, cfg_path)
        console.print(f"[green]Config migrated and saved:[/green] {cfg_path}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _config_to_dict(cfg, redact=True):
    """Serialize AtlasBridgeConfig to a plain dict with optional redaction."""
    data = {}
    data["config_version"] = cfg.config_version

    data["prompts"] = {
        "timeout_seconds": cfg.prompts.timeout_seconds,
        "stuck_timeout_seconds": cfg.prompts.stuck_timeout_seconds,
        "yes_no_safe_default": cfg.prompts.yes_no_safe_default,
    }
    data["logging"] = {"level": cfg.logging.level, "format": cfg.logging.format}

    return data


def _mask(value):
    """Mask a secret value, showing first 4 and last 4 chars."""
    if len(value) <= 12:
        return "***"
    return value[:4] + "***" + value[-4:]


def _print_config_rich(data, console):
    """Print config dict in a human-friendly format."""
    path = data.pop("_config_path", "unknown")
    console.print(f"[bold]AtlasBridge Configuration[/bold]  ({path})\n")

    for section, values in data.items():
        if isinstance(values, dict):
            console.print(f"  [cyan][{section}][/cyan]")
            for k, v in values.items():
                console.print(f"    {k} = {v!r}")
        else:
            console.print(f"  {section} = {values!r}")
    console.print()
