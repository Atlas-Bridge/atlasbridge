"""atlasbridge workspace — workspace governance management."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import click
from rich.console import Console
from rich.table import Table

console = Console()


def _open_db():
    """Open the AtlasBridge database, or return None if unavailable."""
    from atlasbridge.core.config import load_config
    from atlasbridge.core.exceptions import ConfigError, ConfigNotFoundError

    try:
        config = load_config()
        db_path = config.db_path
        if not db_path.exists():
            return None
        from atlasbridge.core.store.database import Database

        db = Database(db_path)
        db.connect()
        return db
    except (ConfigNotFoundError, ConfigError):
        return None


@click.group("workspace", invoke_without_command=True)
@click.pass_context
def workspace_group(ctx: click.Context) -> None:
    """Workspace governance management."""
    if ctx.invoked_subcommand is None:
        ctx.invoke(workspace_list)


@workspace_group.command("trust")
@click.argument("path")
@click.option("--actor", default="cli", help="Actor granting trust (for audit log)")
@click.option("--ttl", default=None, help="Time-to-live for trust (e.g. 8h, 7d, 30m)")
def workspace_trust(path: str, actor: str, ttl: str | None) -> None:
    """Grant trust to a workspace directory."""
    from atlasbridge.core.store.workspace_trust import grant_trust

    resolved = str(Path(path).resolve())
    db = _open_db()
    if db is None:
        console.print("[red]No database found. Run atlasbridge run once to initialise.[/red]")
        sys.exit(1)

    try:
        grant_trust(resolved, db._conn, actor=actor, channel="cli", ttl=ttl)
        msg = f"[green]Trusted:[/green] {resolved}"
        if ttl:
            msg += f" (expires in {ttl})"
        console.print(msg)
    except ValueError as e:
        console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)
    finally:
        db.close()


@workspace_group.command("revoke")
@click.argument("path")
def workspace_revoke(path: str) -> None:
    """Revoke trust for a workspace directory."""
    from atlasbridge.core.store.workspace_trust import revoke_trust

    resolved = str(Path(path).resolve())
    db = _open_db()
    if db is None:
        console.print("[red]No database found.[/red]")
        sys.exit(1)

    try:
        revoke_trust(resolved, db._conn)
        console.print(f"[yellow]Revoked:[/yellow] {resolved}")
    finally:
        db.close()


@workspace_group.command("remove")
@click.argument("path")
def workspace_remove(path: str) -> None:
    """Permanently delete a workspace record."""
    from atlasbridge.core.store.workspace_trust import delete_workspace

    resolved = str(Path(path).resolve())
    db = _open_db()
    if db is None:
        console.print("[red]No database found.[/red]")
        sys.exit(1)

    try:
        deleted = delete_workspace(resolved, db._conn)
        if deleted:
            console.print(f"[green]Removed:[/green] {resolved}")
        else:
            console.print(f"[dim]Not found:[/dim] {resolved}")
    finally:
        db.close()


@workspace_group.command("list")
@click.option("--json", "as_json", is_flag=True, default=False, help="Output as JSON")
def workspace_list(as_json: bool = False) -> None:
    """List all workspaces and their trust/posture status."""
    from atlasbridge.core.store.workspace_trust import list_workspaces

    db = _open_db()
    if db is None:
        if as_json:
            print("[]")
        else:
            console.print("[dim]No database found. No workspaces recorded.[/dim]")
        return

    try:
        rows = list_workspaces(db._conn)

        if as_json:
            print(json.dumps(rows, indent=2, default=str))
            return

        if not rows:
            console.print("[dim]No workspaces recorded.[/dim]")
            return

        table = Table(title="Workspace Governance", show_lines=False)
        table.add_column("Path", style="cyan")
        table.add_column("Trust", justify="center")
        table.add_column("Profile", style="dim")
        table.add_column("Autonomy", style="dim")
        table.add_column("Expires", style="dim")
        table.add_column("Actor", style="dim")

        for row in rows:
            trust_state = row.get("trust_state", "untrusted")
            if trust_state == "trusted":
                trust_str = "[green]trusted[/green]"
            elif row.get("trust_expired"):
                trust_str = "[yellow]expired[/yellow]"
            else:
                trust_str = "[red]untrusted[/red]"

            expires = row.get("trust_expires_at")
            expires_str = (expires or "")[:19] if expires else "never"

            table.add_row(
                row.get("path", ""),
                trust_str,
                row.get("profile_name") or "-",
                row.get("autonomy_default") or "-",
                expires_str,
                row.get("actor") or "-",
            )

        console.print(table)
    finally:
        db.close()


@workspace_group.command("status")
@click.argument("path")
@click.option("--json", "as_json", is_flag=True, default=False, help="Output as JSON")
def workspace_status(path: str, as_json: bool = False) -> None:
    """Check trust and posture status for a specific workspace."""
    from atlasbridge.core.store.workspace_trust import get_workspace_status

    resolved = str(Path(path).resolve())
    db = _open_db()
    if db is None:
        if as_json:
            print(json.dumps({"path": resolved, "trusted": False, "found": False}))
        else:
            console.print("[dim]No database found.[/dim]")
        return

    try:
        record = get_workspace_status(resolved, db._conn)

        if as_json:
            if record:
                print(json.dumps(record, indent=2, default=str))
            else:
                print(json.dumps({"path": resolved, "trusted": False, "found": False}))
            return

        if record is None:
            console.print(f"[dim]Not recorded:[/dim] {resolved}")
            return

        trust_state = record.get("trust_state", "untrusted")
        style = "green" if trust_state == "trusted" else "red"
        console.print(f"Path:      {record['path']}")
        console.print(f"Trust:     [{style}]{trust_state}[/{style}]")
        if record.get("trust_expired"):
            console.print("[yellow]Trust expired (TTL elapsed)[/yellow]")
        if record.get("trust_expires_at"):
            console.print(f"Expires:   {record['trust_expires_at'][:19]}")
        if record.get("actor"):
            console.print(f"Actor:     {record['actor']}")
        if record.get("granted_at"):
            console.print(f"Granted:   {record['granted_at'][:19]}")
        if record.get("revoked_at"):
            console.print(f"Revoked:   {record['revoked_at'][:19]}")
        # Posture
        profile = record.get("profile_name")
        if profile:
            console.print(f"Profile:   {profile}")
        autonomy = record.get("autonomy_default")
        if autonomy:
            console.print(f"Autonomy:  {autonomy}")
        model_tier = record.get("model_tier")
        if model_tier:
            console.print(f"Model:     {model_tier}")
        tool_prof = record.get("tool_allowlist_profile")
        if tool_prof:
            console.print(f"Tools:     {tool_prof}")
    finally:
        db.close()


@workspace_group.command("posture")
@click.argument("path")
@click.option("--profile", default=None, help="Posture profile name (e.g. safe_refactor)")
@click.option(
    "--autonomy",
    default=None,
    type=click.Choice(["OFF", "ASSIST", "FULL"], case_sensitive=False),
    help="Default autonomy mode",
)
@click.option("--model-tier", default=None, help="Default model tier")
@click.option("--tool-profile", default=None, help="Tool allowlist profile name")
@click.option("--notes", default=None, help="Optional notes")
def workspace_posture(
    path: str,
    profile: str | None,
    autonomy: str | None,
    model_tier: str | None,
    tool_profile: str | None,
    notes: str | None,
) -> None:
    """Set posture bindings for a workspace."""
    from atlasbridge.core.store.workspace_trust import (
        get_workspace_status,
        set_posture,
    )

    resolved = str(Path(path).resolve())
    db = _open_db()
    if db is None:
        console.print("[red]No database found.[/red]")
        sys.exit(1)

    try:
        record = get_workspace_status(resolved, db._conn)
        if record is None:
            console.print(f"[red]Workspace not found:[/red] {resolved}")
            console.print("Grant trust first: atlasbridge workspace trust <path>")
            sys.exit(1)

        kwargs: dict = {}
        if profile is not None:
            kwargs["profile_name"] = profile
        if autonomy is not None:
            kwargs["autonomy_default"] = autonomy.upper()
        if model_tier is not None:
            kwargs["model_tier"] = model_tier
        if tool_profile is not None:
            kwargs["tool_allowlist_profile"] = tool_profile
        if notes is not None:
            kwargs["posture_notes"] = notes

        if not kwargs:
            console.print("[dim]No posture fields specified. Use --profile, --autonomy, etc.[/dim]")
            return

        set_posture(record["id"], db._conn, **kwargs)
        console.print(f"[green]Posture updated:[/green] {resolved}")
        for k, v in kwargs.items():
            console.print(f"  {k}: {v}")
    except ValueError as e:
        console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)
    finally:
        db.close()


@workspace_group.command("scan")
@click.argument("path")
@click.option("--json", "as_json", is_flag=True, default=False, help="Output as JSON")
def workspace_scan(path: str, as_json: bool = False) -> None:
    """Run advisory risk classification scan on a workspace.

    This is a deterministic, read-only scan. It does NOT change trust
    or posture automatically. Results are advisory only.
    """
    from atlasbridge.core.store.workspace_trust import scan_workspace

    resolved = str(Path(path).resolve())
    db = _open_db()
    if db is None:
        console.print("[red]No database found.[/red]")
        sys.exit(1)

    try:
        result = scan_workspace(resolved, db._conn)

        if as_json:
            print(json.dumps(result, indent=2, default=str))
            return

        console.print(f"[bold]Workspace scan:[/bold] {resolved}")
        console.print(f"  Files scanned:    {result.get('file_count', 0)}")
        console.print(f"  Risk tags:        {', '.join(result.get('risk_tags', []))}")
        console.print(f"  Ruleset version:  {result.get('ruleset_version', '?')}")
        console.print(f"  Inputs hash:      {result.get('inputs_hash', '?')}")

        suggested = result.get("suggested_profile")
        if suggested:
            console.print(f"\n  [yellow]Suggested profile:[/yellow] {suggested}")
            console.print(
                "  [dim]Apply with: atlasbridge workspace posture "
                f"{resolved} --profile {suggested}[/dim]"
            )
        else:
            console.print("\n  [dim]No profile suggestion (no notable risk signals).[/dim]")
    finally:
        db.close()
