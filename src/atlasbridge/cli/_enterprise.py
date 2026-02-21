"""Enterprise CLI commands — edition, features, cloud status."""

from __future__ import annotations

import click
from rich.console import Console

console = Console()


@click.command("edition")
@click.option("--json", "as_json", is_flag=True, default=False)
def edition_cmd(as_json):
    """Show the current AtlasBridge edition."""
    from atlasbridge.enterprise import detect_edition

    ed = detect_edition()
    if as_json:
        import json

        click.echo(json.dumps({"edition": ed.value}))
    else:
        console.print(f"AtlasBridge edition: [bold]{ed.value}[/bold]")


@click.command("features")
@click.option("--json", "as_json", is_flag=True, default=False)
def features_cmd(as_json):
    """Show all feature flags and their availability."""
    from atlasbridge.enterprise import list_features

    features = list_features()
    if as_json:
        import json

        click.echo(json.dumps(features, indent=2))
    else:
        console.print("\n[bold]Feature Flags[/bold]\n")
        for name, info in features.items():
            status = "[green]active[/green]" if info["status"] == "active" else "[dim]locked[/dim]"
            console.print(f"  {name:<28} {status}  (requires: {info['required_edition']})")
        console.print()


@click.group("cloud")
def cloud_group():
    """Cloud governance integration (Phase B)."""


@cloud_group.command("status")
@click.option("--json", "as_json", is_flag=True, default=False)
def cloud_status(as_json):
    """Show cloud integration status."""
    from atlasbridge.cloud import is_cloud_enabled

    config = _load_cloud_config()
    enabled = is_cloud_enabled(config)
    status = {
        "enabled": enabled,
        "endpoint": config.endpoint or "(not configured)",
        "control_channel": config.control_channel,
        "audit_streaming": config.stream_audit,
        "connected": False,
        "phase": "B (scaffolding only)",
    }
    if as_json:
        import json

        click.echo(json.dumps(status, indent=2))
    else:
        console.print("\n[bold]Cloud Integration Status[/bold]\n")
        for key, val in status.items():
            if isinstance(val, bool):
                label = "[green]yes[/green]" if val else "[dim]no[/dim]"
            else:
                label = str(val)
            console.print(f"  {key:<22} {label}")
        console.print("  [yellow]Phase B is scaffolding only — no cloud calls are made.[/yellow]")
        console.print()


def _load_cloud_config():
    """Load CloudConfig from user config, falling back to defaults."""
    from atlasbridge.cloud import CloudConfig

    try:
        from atlasbridge.core.config import _config_file_path, load_config

        cfg_path = _config_file_path()
        if not cfg_path.exists():
            return CloudConfig()
        cfg = load_config(cfg_path)
        cloud_section = getattr(cfg, "cloud", None)
        if cloud_section and isinstance(cloud_section, dict):
            return CloudConfig(
                **{k: v for k, v in cloud_section.items() if hasattr(CloudConfig, k)}
            )
    except Exception:  # noqa: BLE001
        pass
    return CloudConfig()
