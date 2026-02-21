"""
Decision trace — append-only JSONL log of every autopilot decision.

Every PolicyDecision is written to ``~/.atlasbridge/autopilot_decisions.jsonl``.
Entries are never modified or deleted; the file grows monotonically.

Usage::

    trace = DecisionTrace(path)
    trace.record(decision)

    for entry in trace.tail(n=20):
        print(entry)
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from pathlib import Path

from atlasbridge.core.policy.model import PolicyDecision

logger = logging.getLogger(__name__)

TRACE_FILENAME = "autopilot_decisions.jsonl"


class DecisionTrace:
    """
    Append-only JSONL writer for autopilot decisions.

    Thread-safe for single-process use (standard append open; OS-level atomicity).
    Not safe for concurrent multi-process writes without an external lock.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)

    def record(self, decision: PolicyDecision) -> None:
        """Append one decision to the trace file."""
        try:
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(decision.to_json() + "\n")
        except OSError as exc:
            # Trace write failure must never crash the autopilot engine
            logger.error("DecisionTrace: failed to write to %s: %s", self.path, exc)

    def tail(self, n: int = 50) -> list[dict[str, object]]:
        """Return the last ``n`` trace entries as dicts (oldest first)."""
        if not self.path.exists():
            return []
        lines: list[str] = []
        try:
            with self.path.open("r", encoding="utf-8") as fh:
                lines = fh.readlines()
        except OSError as exc:
            logger.error("DecisionTrace: cannot read %s: %s", self.path, exc)
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
        """Iterate over all entries (oldest first)."""
        if not self.path.exists():
            return
        try:
            with self.path.open("r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        yield json.loads(line)
                    except json.JSONDecodeError:
                        continue
        except OSError as exc:
            logger.error("DecisionTrace: cannot iterate %s: %s", self.path, exc)
