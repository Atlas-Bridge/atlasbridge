"""
Decision trace — append-only JSONL log of every autopilot decision.

Every PolicyDecision is written to ``~/.atlasbridge/autopilot_decisions.jsonl``.
Entries are never modified or deleted; when the file grows beyond ``max_bytes``
it is rotated (up to ``MAX_ARCHIVES`` archives are kept).

Each entry is hash-chained: every record includes ``prev_hash`` (the hash of
the preceding entry) and its own ``hash``.  This forms an append-only chain
whose integrity can be verified offline via ``verify_integrity()``.

Usage::

    trace = DecisionTrace(path)
    trace.record(decision)

    for entry in trace.tail(n=20):
        print(entry)

    valid, errors = DecisionTrace.verify_integrity(path)
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterator
from pathlib import Path

import structlog

from atlasbridge.core.policy.model import PolicyDecision

logger = structlog.get_logger()

TRACE_FILENAME = "autopilot_decisions.jsonl"


def _compute_hash(prev_hash: str, entry_dict: dict[str, object]) -> str:
    """Compute SHA-256 hash for a trace entry.

    Hash input: prev_hash + idempotency_key + action_type + canonical JSON.
    """
    chain_input = (
        f"{prev_hash}"
        f"{entry_dict.get('idempotency_key', '')}"
        f"{entry_dict.get('action_type', '')}"
        f"{json.dumps(entry_dict, separators=(',', ':'), sort_keys=True)}"
    )
    return hashlib.sha256(chain_input.encode()).hexdigest()


class DecisionTrace:
    """
    Append-only JSONL writer for autopilot decisions with size-based rotation.

    When the active trace file grows beyond ``max_bytes``, it is renamed to
    ``<name>.jsonl.1`` and a fresh file is started.  Older archives shift up
    (``...jsonl.1`` → ``...jsonl.2``, etc.).  At most ``MAX_ARCHIVES``
    archives are kept; the oldest is deleted when the limit is exceeded.

    Thread-safe for single-process use (standard append open; OS-level
    atomicity).  Not safe for concurrent multi-process writes without an
    external lock.
    """

    MAX_BYTES_DEFAULT: int = 10 * 1024 * 1024  # 10 MB
    MAX_ARCHIVES: int = 3

    def __init__(self, path: Path, max_bytes: int = MAX_BYTES_DEFAULT) -> None:
        self._path = path
        self._max_bytes = max_bytes
        self._path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._last_hash: str = self._load_last_hash()

    def _load_last_hash(self) -> str:
        """Read the hash of the last entry in the trace file (for chain continuity)."""
        if not self._path.exists():
            return ""
        try:
            with self._path.open("r", encoding="utf-8") as fh:
                last_line = ""
                for line in fh:
                    stripped = line.strip()
                    if stripped:
                        last_line = stripped
            if not last_line:
                return ""
            entry = json.loads(last_line)
            return entry.get("hash", "")
        except (OSError, json.JSONDecodeError):
            return ""

    @property
    def path(self) -> Path:
        return self._path

    # ------------------------------------------------------------------
    # Rotation
    # ------------------------------------------------------------------

    def _maybe_rotate(self) -> None:
        """Rotate if the active file exceeds max_bytes."""
        if not self._path.exists():
            return
        try:
            size = self._path.stat().st_size
        except OSError:
            return
        if size < self._max_bytes:
            return

        # Shift existing archives: .jsonl.2 → .jsonl.3, .jsonl.1 → .jsonl.2
        for i in range(self.MAX_ARCHIVES - 1, 0, -1):
            old = self._path.with_suffix(f".jsonl.{i}")
            new = self._path.with_suffix(f".jsonl.{i + 1}")
            if old.exists():
                try:
                    old.rename(new)
                except OSError as exc:
                    logger.warning(
                        "trace_rotate_failed", old=str(old), new=str(new), error=str(exc)
                    )

        # Move active file to .jsonl.1
        archive = self._path.with_suffix(".jsonl.1")
        try:
            self._path.rename(archive)
        except OSError as exc:
            logger.warning("trace_archive_failed", path=str(self._path), error=str(exc))

        # New chain starts after rotation
        self._last_hash = ""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def record(self, decision: PolicyDecision) -> None:
        """Append one decision to the trace file (rotating first if needed)."""
        self._maybe_rotate()
        try:
            entry = decision.to_dict()
            entry["prev_hash"] = self._last_hash
            entry_hash = _compute_hash(self._last_hash, entry)
            entry["hash"] = entry_hash
            line = json.dumps(entry, ensure_ascii=False)
            with self._path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
            self._last_hash = entry_hash
        except OSError as exc:
            # Trace write failure must never crash the autopilot engine
            logger.error("trace_write_failed", path=str(self._path), error=str(exc))

    def tail(self, n: int = 50) -> list[dict[str, object]]:
        """Return the last ``n`` trace entries as dicts (oldest first)."""
        if not self._path.exists():
            return []
        lines: list[str] = []
        try:
            with self._path.open("r", encoding="utf-8") as fh:
                lines = fh.readlines()
        except OSError as exc:
            logger.error("trace_read_failed", path=str(self._path), error=str(exc))
            return []

        entries: list[dict[str, object]] = []
        for line in lines[-n:]:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return entries

    def __iter__(self) -> Iterator[dict[str, object]]:
        """Iterate over all entries in the active file (oldest first)."""
        if not self._path.exists():
            return
        try:
            with self._path.open("r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        yield json.loads(line)
                    except json.JSONDecodeError:
                        continue
        except OSError as exc:
            logger.error("trace_iterate_failed", path=str(self._path), error=str(exc))

    # ------------------------------------------------------------------
    # Integrity verification
    # ------------------------------------------------------------------

    @staticmethod
    def verify_integrity(path: Path) -> tuple[bool, list[str]]:
        """Verify hash chain integrity of a trace file.

        Returns ``(valid, errors)`` where ``valid`` is True if the chain
        is intact and ``errors`` is a list of human-readable descriptions
        of any integrity violations found.

        Entries written by older versions (without ``hash``/``prev_hash``
        fields) are treated as chain-start entries.
        """
        if not path.exists():
            return True, []

        errors: list[str] = []
        prev_hash = ""
        line_no = 0

        try:
            with path.open("r", encoding="utf-8") as fh:
                for raw_line in fh:
                    raw_line = raw_line.strip()
                    if not raw_line:
                        continue
                    line_no += 1

                    try:
                        entry = json.loads(raw_line)
                    except json.JSONDecodeError as exc:
                        errors.append(f"Line {line_no}: invalid JSON — {exc}")
                        prev_hash = ""
                        continue

                    # Legacy entries without hash fields: treat as chain start
                    if "hash" not in entry or "prev_hash" not in entry:
                        prev_hash = ""
                        continue

                    # Verify prev_hash linkage
                    if entry["prev_hash"] != prev_hash:
                        errors.append(
                            f"Line {line_no}: prev_hash mismatch — "
                            f"expected {prev_hash!r}, got {entry['prev_hash']!r}"
                        )

                    # Verify self-hash
                    stored_hash = entry.pop("hash")
                    recomputed = _compute_hash(entry["prev_hash"], entry)
                    entry["hash"] = stored_hash  # restore

                    if stored_hash != recomputed:
                        errors.append(
                            f"Line {line_no}: hash mismatch — "
                            f"stored {stored_hash!r}, computed {recomputed!r}"
                        )

                    prev_hash = stored_hash

        except OSError as exc:
            errors.append(f"Failed to read trace file: {exc}")

        return len(errors) == 0, errors
