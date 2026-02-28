"""
Workspace governance store.

Persists per-workspace trust decisions and posture bindings in the
AtlasBridge SQLite database. Trust is keyed by path_hash (SHA-256 of the
canonical resolved path) so symlink variations map to one record.

Concepts:
  - Trust = consent for local file/tool access (yes/no, with optional TTL)
  - Posture = explicit governance binding (profile, autonomy default, model tier)

Trust must NOT implicitly expand permissions. Posture controls permissions
via policy evaluation.

Correctness invariants:
  - get_trust() is read-only and always returns a definitive bool.
  - get_trust() checks TTL expiry deterministically.
  - grant_trust() uses INSERT OR REPLACE so it is idempotent.
  - revoke_trust() sets trusted=0 and records the revocation timestamp.
  - Posture bindings are configuration inputs to policy evaluation, not
    direct execution logic.
  - No raw API keys or secrets are stored here.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import structlog

logger = structlog.get_logger()

_TRUST_PROMPT_TEMPLATE = "Trust workspace {path} for local file/tool access?\nReply: yes or no"


def _hash_path(path: str) -> str:
    """SHA-256 of the canonical (resolved) absolute path."""
    canonical = str(Path(path).resolve())
    return hashlib.sha256(canonical.encode()).hexdigest()


def canonical_path(path: str) -> str:
    """Return the canonical resolved absolute path as a string."""
    return str(Path(path).resolve())


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _parse_ttl(ttl: str) -> timedelta:
    """Parse a TTL string like '8h', '7d', '30m' into a timedelta.

    Supported suffixes: m (minutes), h (hours), d (days).
    Raises ValueError for invalid formats.
    """
    ttl = ttl.strip().lower()
    if not ttl:
        raise ValueError("TTL string must not be empty")

    suffix = ttl[-1]
    try:
        value = int(ttl[:-1])
    except ValueError as exc:
        raise ValueError(f"Invalid TTL format: {ttl!r}. Expected <number><m|h|d>") from exc

    if value <= 0:
        raise ValueError(f"TTL value must be positive, got {value}")

    if suffix == "m":
        return timedelta(minutes=value)
    elif suffix == "h":
        return timedelta(hours=value)
    elif suffix == "d":
        return timedelta(days=value)
    else:
        raise ValueError(f"Unknown TTL suffix {suffix!r}. Use m, h, or d")


# ---------------------------------------------------------------------------
# Channel-facing helpers
# ---------------------------------------------------------------------------


def build_trust_prompt(path: str) -> str:
    """Return the clean yes/no trust prompt text for a workspace path.

    The text must never contain terminal semantics (Enter, Esc, arrow keys).
    """
    return _TRUST_PROMPT_TEMPLATE.format(path=path)


def normalise_trust_reply(value: str) -> bool | None:
    """Normalise a channel reply to a trust decision.

    Returns True (trust), False (deny), or None if the reply is ambiguous.
    """
    v = value.strip().lower()
    if v in ("yes", "y"):
        return True
    if v in ("no", "n"):
        return False
    return None


# ---------------------------------------------------------------------------
# Trust database operations
# ---------------------------------------------------------------------------


def _is_trust_expired(row: sqlite3.Row | dict[str, Any]) -> bool:
    """Check if a trust record has an expired TTL."""
    expires_at = row.get("trust_expires_at") if isinstance(row, dict) else None
    if expires_at is None and hasattr(row, "keys"):
        try:
            expires_at = row["trust_expires_at"]
        except (KeyError, IndexError):
            return False
    if not expires_at:
        return False
    try:
        exp_dt = datetime.fromisoformat(expires_at)
        if exp_dt.tzinfo is None:
            exp_dt = exp_dt.replace(tzinfo=UTC)
        return datetime.now(UTC) > exp_dt
    except (ValueError, TypeError):
        return False


def get_trust(path: str, conn: sqlite3.Connection) -> bool:
    """Return True if the workspace at *path* is currently trusted.

    Checks TTL expiry: if trust_expires_at is set and in the past,
    returns False (trust expired).
    """
    ph = _hash_path(path)
    row = conn.execute(
        "SELECT trusted, trust_expires_at FROM workspace_trust WHERE path_hash = ?",
        (ph,),
    ).fetchone()
    if not row or not row[0]:
        return False
    # Check TTL expiry
    expires_at = row[1] if len(row) > 1 else None
    if expires_at:
        try:
            exp_dt = datetime.fromisoformat(expires_at)
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=UTC)
            if datetime.now(UTC) > exp_dt:
                return False
        except (ValueError, TypeError):
            pass
    return True


def grant_trust(
    path: str,
    conn: sqlite3.Connection,
    *,
    actor: str = "unknown",
    channel: str = "",
    session_id: str = "",
    ttl: str | None = None,
    ttl_seconds: int | None = None,
) -> None:
    """Record a trust grant for *path*.

    Args:
        ttl: Human-readable TTL string like '8h', '7d'. Mutually exclusive with ttl_seconds.
        ttl_seconds: TTL in seconds. Mutually exclusive with ttl.
    """
    ph = _hash_path(path)
    now = _now()

    expires_at: str | None = None
    if ttl and ttl_seconds:
        raise ValueError("Cannot specify both ttl and ttl_seconds")
    if ttl:
        delta = _parse_ttl(ttl)
        expires_at = (datetime.now(UTC) + delta).isoformat()
    elif ttl_seconds and ttl_seconds > 0:
        expires_at = (datetime.now(UTC) + timedelta(seconds=ttl_seconds)).isoformat()

    conn.execute(
        """
        INSERT INTO workspace_trust
            (path, path_hash, trusted, actor, channel, session_id,
             granted_at, revoked_at, trust_expires_at, updated_at)
        VALUES (?, ?, 1, ?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(path_hash) DO UPDATE SET
            trusted          = 1,
            actor            = excluded.actor,
            channel          = excluded.channel,
            session_id       = excluded.session_id,
            granted_at       = excluded.granted_at,
            revoked_at       = NULL,
            trust_expires_at = excluded.trust_expires_at,
            updated_at       = excluded.updated_at
        """,
        (path, ph, actor, channel, session_id, now, expires_at, now),
    )
    conn.commit()
    logger.info(
        "workspace_trust_granted",
        path=path,
        actor=actor,
        channel=channel,
        expires_at=expires_at,
    )


def revoke_trust(path: str, conn: sqlite3.Connection) -> None:
    """Record a trust revocation for *path*."""
    ph = _hash_path(path)
    now = _now()
    conn.execute(
        """
        UPDATE workspace_trust
           SET trusted = 0, revoked_at = ?, trust_expires_at = NULL, updated_at = ?
         WHERE path_hash = ?
        """,
        (now, now, ph),
    )
    conn.commit()
    logger.info("workspace_trust_revoked", path=path)


def delete_workspace(path: str, conn: sqlite3.Connection) -> bool:
    """Permanently delete the workspace trust record for *path*.

    Returns True if a record was deleted, False if no record existed.
    """
    ph = _hash_path(path)
    cur = conn.execute(
        "DELETE FROM workspace_trust WHERE path_hash = ?",
        (ph,),
    )
    conn.commit()
    deleted = cur.rowcount > 0
    if deleted:
        logger.info("workspace_deleted", path=path)
    return deleted


# ---------------------------------------------------------------------------
# Posture binding operations
# ---------------------------------------------------------------------------

_ALLOWED_POSTURE_FIELDS: frozenset[str] = frozenset(
    {
        "profile_name",
        "autonomy_default",
        "model_tier",
        "tool_allowlist_profile",
        "posture_notes",
    }
)

_VALID_AUTONOMY_MODES: frozenset[str] = frozenset({"OFF", "ASSIST", "FULL"})


def set_posture(
    workspace_id: str,
    conn: sqlite3.Connection,
    **kwargs: Any,
) -> None:
    """Update posture binding fields on a workspace record.

    Only fields in _ALLOWED_POSTURE_FIELDS are accepted.
    Raises ValueError for unknown fields or invalid autonomy_default.
    """
    bad = set(kwargs) - _ALLOWED_POSTURE_FIELDS
    if bad:
        raise ValueError(f"Disallowed posture fields: {sorted(bad)}")

    if "autonomy_default" in kwargs and kwargs["autonomy_default"]:
        mode = kwargs["autonomy_default"].upper()
        if mode not in _VALID_AUTONOMY_MODES:
            raise ValueError(
                f"Invalid autonomy_default {mode!r}. Valid values: {sorted(_VALID_AUTONOMY_MODES)}"
            )
        kwargs["autonomy_default"] = mode

    if not kwargs:
        return

    now = _now()
    set_parts = [f"{col} = ?" for col in kwargs]
    set_parts.append("updated_at = ?")
    values = list(kwargs.values()) + [now, workspace_id]

    conn.execute(
        f"UPDATE workspace_trust SET {', '.join(set_parts)} WHERE id = ?",  # noqa: S608
        values,
    )
    conn.commit()
    logger.info("workspace_posture_updated", workspace_id=workspace_id, fields=list(kwargs))


def get_posture(workspace_id: str, conn: sqlite3.Connection) -> dict[str, Any] | None:
    """Return posture binding for a workspace, or None if not found."""
    row = conn.execute(
        """
        SELECT id, path, profile_name, autonomy_default, model_tier,
               tool_allowlist_profile, posture_notes
          FROM workspace_trust
         WHERE id = ?
        """,
        (workspace_id,),
    ).fetchone()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# Workspace context for policy evaluation
# ---------------------------------------------------------------------------


def get_workspace_context(path: str, conn: sqlite3.Connection) -> dict[str, Any]:
    """Return the full workspace context for policy evaluation.

    This is the structured payload that the policy evaluator receives.
    Includes trust state (with TTL check) and all posture fields.
    """
    ph = _hash_path(path)
    row = conn.execute(
        """
        SELECT id, path, path_hash, trusted, trust_expires_at,
               profile_name, autonomy_default, model_tier,
               tool_allowlist_profile
          FROM workspace_trust
         WHERE path_hash = ?
        """,
        (ph,),
    ).fetchone()

    if not row:
        return {
            "workspace_id": None,
            "canonical_path": canonical_path(path),
            "trust_state": "untrusted",
            "trust_expires_at": None,
            "profile_name": None,
            "autonomy_default": None,
            "model_tier": None,
            "tool_allowlist_profile": None,
        }

    row_dict = dict(row)
    trusted = bool(row_dict.get("trusted"))
    expires_at = row_dict.get("trust_expires_at")

    # Check TTL
    if trusted and expires_at:
        try:
            exp_dt = datetime.fromisoformat(expires_at)
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=UTC)
            if datetime.now(UTC) > exp_dt:
                trusted = False
        except (ValueError, TypeError):
            pass

    return {
        "workspace_id": row_dict.get("id"),
        "canonical_path": canonical_path(path),
        "trust_state": "trusted" if trusted else "untrusted",
        "trust_expires_at": expires_at,
        "profile_name": row_dict.get("profile_name"),
        "autonomy_default": row_dict.get("autonomy_default"),
        "model_tier": row_dict.get("model_tier"),
        "tool_allowlist_profile": row_dict.get("tool_allowlist_profile"),
    }


# ---------------------------------------------------------------------------
# Listing / querying
# ---------------------------------------------------------------------------


def list_workspaces(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Return all workspace trust records as plain dicts."""
    rows = conn.execute(
        """
        SELECT id, path, path_hash, trusted, actor, channel, session_id,
               granted_at, revoked_at, created_at, trust_expires_at,
               updated_at, profile_name, autonomy_default, model_tier,
               tool_allowlist_profile, posture_notes
          FROM workspace_trust
         ORDER BY created_at DESC
        """
    ).fetchall()
    result = []
    for row in rows:
        d = dict(row)
        # Compute effective trust state (check TTL)
        if d.get("trusted") and d.get("trust_expires_at"):
            try:
                exp_dt = datetime.fromisoformat(d["trust_expires_at"])
                if exp_dt.tzinfo is None:
                    exp_dt = exp_dt.replace(tzinfo=UTC)
                if datetime.now(UTC) > exp_dt:
                    d["trust_state"] = "untrusted"
                    d["trust_expired"] = True
                else:
                    d["trust_state"] = "trusted"
                    d["trust_expired"] = False
            except (ValueError, TypeError):
                d["trust_state"] = "trusted" if d.get("trusted") else "untrusted"
                d["trust_expired"] = False
        else:
            d["trust_state"] = "trusted" if d.get("trusted") else "untrusted"
            d["trust_expired"] = False
        result.append(d)
    return result


def get_workspace_status(path: str, conn: sqlite3.Connection) -> dict[str, Any] | None:
    """Return the full trust record for *path*, or None if not known."""
    ph = _hash_path(path)
    row = conn.execute(
        """
        SELECT id, path, path_hash, trusted, actor, channel, session_id,
               granted_at, revoked_at, created_at, trust_expires_at,
               updated_at, profile_name, autonomy_default, model_tier,
               tool_allowlist_profile, posture_notes
          FROM workspace_trust
         WHERE path_hash = ?
        """,
        (ph,),
    ).fetchone()
    if not row:
        return None
    d = dict(row)
    # Compute effective trust state
    if d.get("trusted") and d.get("trust_expires_at"):
        try:
            exp_dt = datetime.fromisoformat(d["trust_expires_at"])
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=UTC)
            d["trust_expired"] = datetime.now(UTC) > exp_dt
            d["trust_state"] = "untrusted" if d["trust_expired"] else "trusted"
        except (ValueError, TypeError):
            d["trust_expired"] = False
            d["trust_state"] = "trusted" if d.get("trusted") else "untrusted"
    else:
        d["trust_expired"] = False
        d["trust_state"] = "trusted" if d.get("trusted") else "untrusted"
    return d


def get_workspace_by_id(workspace_id: str, conn: sqlite3.Connection) -> dict[str, Any] | None:
    """Return a workspace record by its ID."""
    row = conn.execute(
        """
        SELECT id, path, path_hash, trusted, actor, channel, session_id,
               granted_at, revoked_at, created_at, trust_expires_at,
               updated_at, profile_name, autonomy_default, model_tier,
               tool_allowlist_profile, posture_notes
          FROM workspace_trust
         WHERE id = ?
        """,
        (workspace_id,),
    ).fetchone()
    if not row:
        return None
    d = dict(row)
    if d.get("trusted") and d.get("trust_expires_at"):
        try:
            exp_dt = datetime.fromisoformat(d["trust_expires_at"])
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=UTC)
            d["trust_expired"] = datetime.now(UTC) > exp_dt
            d["trust_state"] = "untrusted" if d["trust_expired"] else "trusted"
        except (ValueError, TypeError):
            d["trust_expired"] = False
            d["trust_state"] = "trusted"
    else:
        d["trust_expired"] = False
        d["trust_state"] = "trusted" if d.get("trusted") else "untrusted"
    return d


def list_sessions_for_workspace(
    workspace_path: str,
    conn: sqlite3.Connection,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Return sessions whose cwd matches the workspace path."""
    cp = canonical_path(workspace_path)
    rows = conn.execute(
        """
        SELECT id, tool, command, cwd, status, pid,
               started_at, ended_at, exit_code, label
          FROM sessions
         WHERE cwd = ? OR cwd LIKE ?
         ORDER BY started_at DESC
         LIMIT ?
        """,
        (cp, cp + "/%", limit),
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Advisory workspace scanner
# ---------------------------------------------------------------------------

# Scanner ruleset version — bump when rules change
SCANNER_RULESET_VERSION = "1.0.0"

# File patterns that indicate specific risk tags
_RISK_PATTERNS: dict[str, list[str]] = {
    "iac": [
        "terraform",
        "Terraform",
        ".tf",
        "ansible",
        "playbook",
        "docker-compose",
        "Dockerfile",
        "k8s",
        "kubernetes",
        "helm",
        "cloudformation",
        ".cdk.",
        "pulumi",
    ],
    "secrets_present": [
        ".env",
        ".env.local",
        ".env.production",
        "credentials",
        "secrets",
        ".pem",
        ".key",
        ".p12",
        ".pfx",
        "service-account",
        "serviceaccount",
        "id_rsa",
        "id_ed25519",
    ],
    "deployment": [
        "deploy",
        "Deploy",
        "ci/cd",
        ".github/workflows",
        ".gitlab-ci",
        "Jenkinsfile",
        "Procfile",
        "serverless",
        "fly.toml",
        "railway.json",
        "vercel.json",
        "netlify.toml",
    ],
}


def _compute_scan_inputs_hash(file_listing: list[str], ruleset_version: str) -> str:
    """Compute a deterministic hash of scan inputs for dedup."""
    payload = json.dumps(
        {"files": sorted(file_listing), "ruleset_version": ruleset_version},
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def scan_workspace(
    workspace_path: str,
    conn: sqlite3.Connection,
    *,
    max_files: int = 5000,
) -> dict[str, Any]:
    """Run a deterministic advisory classification scan on a workspace.

    Scans the file listing (bounded) and produces risk_tags. Stores the
    result as an SoR artifact with ruleset_version + inputs_hash.

    CRITICAL: does NOT auto-change posture or trust. Advisory only.

    Returns the scan artifact dict.
    """
    cp = canonical_path(workspace_path)
    workspace_dir = Path(cp)

    # Collect file listing (bounded)
    file_listing: list[str] = []
    if workspace_dir.is_dir():
        try:
            for i, p in enumerate(workspace_dir.rglob("*")):
                if i >= max_files:
                    break
                try:
                    rel = str(p.relative_to(workspace_dir))
                    file_listing.append(rel)
                except ValueError:
                    continue
        except PermissionError:
            pass

    inputs_hash = _compute_scan_inputs_hash(file_listing, SCANNER_RULESET_VERSION)

    # Check for existing artifact with same inputs
    ph = _hash_path(workspace_path)
    workspace_row = conn.execute(
        "SELECT id FROM workspace_trust WHERE path_hash = ?", (ph,)
    ).fetchone()
    workspace_id = workspace_row[0] if workspace_row else ""

    if workspace_id:
        existing = conn.execute(
            """
            SELECT * FROM workspace_scan_artifacts
             WHERE workspace_id = ? AND inputs_hash = ?
            """,
            (workspace_id, inputs_hash),
        ).fetchone()
        if existing:
            result = dict(existing)
            # Deserialize JSON fields from DB storage
            for field in ("risk_tags", "raw_results"):
                if field in result and isinstance(result[field], str):
                    try:
                        result[field] = json.loads(result[field])
                    except (json.JSONDecodeError, TypeError):
                        pass
            return result

    # Classify
    risk_tags: list[str] = []
    file_listing_lower = [f.lower() for f in file_listing]
    joined = "\n".join(file_listing_lower)

    for tag, patterns in _RISK_PATTERNS.items():
        for pattern in patterns:
            if pattern.lower() in joined:
                if tag not in risk_tags:
                    risk_tags.append(tag)
                break

    if not risk_tags:
        risk_tags.append("unknown")

    # Determine suggested profile
    suggested_profile = _suggest_profile(risk_tags)

    # Store artifact
    raw_results = {
        "file_count": len(file_listing),
        "risk_tags": risk_tags,
        "matched_patterns": {
            tag: [p for p in patterns if p.lower() in joined]
            for tag, patterns in _RISK_PATTERNS.items()
            if tag in risk_tags
        },
    }

    if workspace_id:
        conn.execute(
            """
            INSERT INTO workspace_scan_artifacts
                (workspace_id, ruleset_version, inputs_hash, risk_tags,
                 file_count, suggested_profile, raw_results)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id, inputs_hash) DO NOTHING
            """,
            (
                workspace_id,
                SCANNER_RULESET_VERSION,
                inputs_hash,
                json.dumps(risk_tags),
                len(file_listing),
                suggested_profile,
                json.dumps(raw_results, sort_keys=True),
            ),
        )
        conn.commit()

    return {
        "workspace_id": workspace_id,
        "ruleset_version": SCANNER_RULESET_VERSION,
        "inputs_hash": inputs_hash,
        "risk_tags": risk_tags,
        "file_count": len(file_listing),
        "suggested_profile": suggested_profile,
        "raw_results": raw_results,
    }


def _suggest_profile(risk_tags: list[str]) -> str | None:
    """Suggest a posture profile based on risk tags. Advisory only."""
    if "secrets_present" in risk_tags and "deployment" in risk_tags:
        return "read_only_analysis"
    if "deployment" in risk_tags or "iac" in risk_tags:
        return "plan_only"
    if "secrets_present" in risk_tags:
        return "safe_refactor"
    return None
