"""Unit tests for DecisionTraceEntryV2 and hash chain integrity."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from atlasbridge.enterprise.audit_integrity import (
    DecisionTraceEntryV2,
    EnterpriseTraceIntegrity,
)


class TestDecisionTraceEntryV2:
    def test_compute_hash_deterministic(self) -> None:
        entry = DecisionTraceEntryV2(
            session_id="sess-1",
            prompt_id="prompt-1",
            timestamp="2026-01-01T00:00:00Z",
            policy_hash="abc123",
            risk_level="low",
            action_taken="auto_reply",
        )
        h1 = entry.compute_hash()
        h2 = entry.compute_hash()
        assert h1 == h2
        assert len(h1) == 64  # SHA-256 hex

    def test_compute_hash_differs_on_field_change(self) -> None:
        e1 = DecisionTraceEntryV2(session_id="a", timestamp="t1")
        e2 = DecisionTraceEntryV2(session_id="b", timestamp="t1")
        assert e1.compute_hash() != e2.compute_hash()

    def test_seal_sets_hashes(self) -> None:
        entry = DecisionTraceEntryV2(session_id="s1", timestamp="t1")
        entry.seal(previous_hash="prev123")
        assert entry.previous_hash == "prev123"
        assert entry.current_hash != ""
        assert entry.current_hash == entry.compute_hash()

    def test_seal_chain_linkage(self) -> None:
        e1 = DecisionTraceEntryV2(session_id="s1", timestamp="t1")
        e1.seal(previous_hash="")

        e2 = DecisionTraceEntryV2(session_id="s1", timestamp="t2")
        e2.seal(previous_hash=e1.current_hash)

        assert e2.previous_hash == e1.current_hash
        assert e2.current_hash != e1.current_hash

    def test_to_json_roundtrip(self) -> None:
        entry = DecisionTraceEntryV2(
            session_id="sess-1",
            prompt_id="prompt-1",
            risk_level="high",
            action_taken="require_human",
        )
        entry.seal(previous_hash="abc")
        json_str = entry.to_json()
        parsed = DecisionTraceEntryV2.from_json(json_str)
        assert parsed.session_id == "sess-1"
        assert parsed.risk_level == "high"
        assert parsed.current_hash == entry.current_hash
        assert parsed.previous_hash == "abc"

    def test_trace_version_is_2(self) -> None:
        entry = DecisionTraceEntryV2()
        assert entry.trace_version == "2"


class TestEnterpriseTraceIntegrity:
    def _write_chain(self, path: Path, count: int = 5) -> None:
        prev = ""
        with path.open("w", encoding="utf-8") as fh:
            for i in range(count):
                entry = DecisionTraceEntryV2(
                    session_id=f"sess-{i}",
                    prompt_id=f"prompt-{i}",
                    timestamp=f"2026-01-01T00:00:{i:02d}Z",
                )
                entry.seal(previous_hash=prev)
                fh.write(entry.to_json() + "\n")
                prev = entry.current_hash

    def test_valid_chain(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as f:
            path = Path(f.name)
        self._write_chain(path, count=10)
        result = EnterpriseTraceIntegrity.verify_chain(path)
        assert result["valid"] is True
        assert result["entries_checked"] == 10
        assert result["first_broken_at"] is None
        path.unlink()

    def test_empty_file_is_valid(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as f:
            path = Path(f.name)
        path.write_text("")
        result = EnterpriseTraceIntegrity.verify_chain(path)
        assert result["valid"] is True
        assert result["entries_checked"] == 0
        path.unlink()

    def test_nonexistent_file_is_valid(self) -> None:
        result = EnterpriseTraceIntegrity.verify_chain(Path("/nonexistent/file.jsonl"))
        assert result["valid"] is True
        assert result["entries_checked"] == 0

    def test_tampered_entry_detected(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as f:
            path = Path(f.name)
        self._write_chain(path, count=5)

        # Tamper with the third entry
        lines = path.read_text().splitlines()
        entry = json.loads(lines[2])
        entry["action_taken"] = "TAMPERED"
        lines[2] = json.dumps(entry)
        path.write_text("\n".join(lines) + "\n")

        result = EnterpriseTraceIntegrity.verify_chain(path)
        assert result["valid"] is False
        assert result["first_broken_at"] == 2
        path.unlink()

    def test_removed_entry_detected(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as f:
            path = Path(f.name)
        self._write_chain(path, count=5)

        # Remove the second entry (breaks chain at index 2)
        lines = path.read_text().splitlines()
        del lines[1]
        path.write_text("\n".join(lines) + "\n")

        result = EnterpriseTraceIntegrity.verify_chain(path)
        assert result["valid"] is False
        path.unlink()

    def test_v1_entries_skipped(self) -> None:
        """v1 entries (without trace_version=2) are ignored during verification."""
        with tempfile.NamedTemporaryFile(suffix=".jsonl", delete=False) as f:
            path = Path(f.name)

        # Write a mix of v1 and v2 entries
        with path.open("w", encoding="utf-8") as fh:
            # v1 entry (no trace_version field)
            fh.write(json.dumps({"session_id": "old", "action": "auto_reply"}) + "\n")
            # v2 entry
            e = DecisionTraceEntryV2(session_id="new", timestamp="t1")
            e.seal(previous_hash="")
            fh.write(e.to_json() + "\n")

        result = EnterpriseTraceIntegrity.verify_chain(path)
        assert result["valid"] is True
        assert result["entries_checked"] == 1  # Only the v2 entry
        path.unlink()
