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
    from atlasbridge.cloud import CloudConfig, is_cloud_enabled

    config = CloudConfig()  # Default disabled config
    enabled = is_cloud_enabled(config)
    status = {
        "enabled": enabled,
        "endpoint": config.endpoint or "(not configured)",
        "control_channel": config.control_channel,
        "audit_streaming": config.stream_audit,
        "connected": False,
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
        console.print()
