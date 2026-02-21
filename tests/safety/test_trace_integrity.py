"""
Safety test: Decision trace hash chain integrity.

Verifies that:
  1. Each trace entry contains prev_hash and hash fields
  2. Hash chain is contiguous (entry N's prev_hash == entry N-1's hash)
  3. Tampering with any entry breaks the chain
  4. Empty trace file is valid
  5. Single-entry trace has empty prev_hash
  6. verify_integrity() returns True for valid chain, False for tampered
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from atlasbridge.core.autopilot.trace import DecisionTrace, _compute_hash
from atlasbridge.core.policy.model import (
    AutoReplyAction,
    PolicyDecision,
)


def _make_decision(prompt_id: str = "p-001", session_id: str = "s-001") -> PolicyDecision:
    """Create a minimal PolicyDecision for testing."""
    return PolicyDecision(
        prompt_id=prompt_id,
        session_id=session_id,
        policy_hash="abc123",
        matched_rule_id="rule-1",
        action=AutoReplyAction(value="y"),
        explanation="test decision",
        confidence="high",
        prompt_type="yes_no",
        autonomy_mode="full",
    )


@pytest.fixture()
def trace_path(tmp_path: Path) -> Path:
    return tmp_path / "trace.jsonl"


@pytest.fixture()
def trace(trace_path: Path) -> DecisionTrace:
    return DecisionTrace(trace_path)


class TestHashChainBasics:
    """Basic hash chain structure tests."""

    def test_first_entry_has_empty_prev_hash(self, trace: DecisionTrace) -> None:
        trace.record(_make_decision())
        entries = trace.tail(1)
        assert len(entries) == 1
        assert entries[0]["prev_hash"] == ""

    def test_entry_has_hash_field(self, trace: DecisionTrace) -> None:
        trace.record(_make_decision())
        entries = trace.tail(1)
        assert "hash" in entries[0]
        assert len(entries[0]["hash"]) == 64  # SHA-256 hex digest

    def test_chain_is_contiguous(self, trace: DecisionTrace) -> None:
        """Write 5 entries — each prev_hash equals the previous hash."""
        for i in range(5):
            trace.record(_make_decision(prompt_id=f"p-{i:03d}"))

        entries = trace.tail(10)
        assert len(entries) == 5

        # First entry: prev_hash is empty
        assert entries[0]["prev_hash"] == ""

        # Subsequent entries: prev_hash == previous entry's hash
        for i in range(1, 5):
            assert entries[i]["prev_hash"] == entries[i - 1]["hash"], (
                f"Entry {i}: prev_hash should equal entry {i - 1}'s hash"
            )


class TestHashDeterminism:
    """Hash computation must be deterministic."""

    def test_same_input_same_hash(self) -> None:
        entry = {"idempotency_key": "abc", "action_type": "auto_reply", "data": "test"}
        h1 = _compute_hash("", entry)
        h2 = _compute_hash("", entry)
        assert h1 == h2

    def test_different_prev_hash_different_output(self) -> None:
        entry = {"idempotency_key": "abc", "action_type": "auto_reply"}
        h1 = _compute_hash("", entry)
        h2 = _compute_hash("different", entry)
        assert h1 != h2


class TestVerifyIntegrity:
    """verify_integrity() must detect tampering."""

    def test_empty_file_is_valid(self, trace_path: Path) -> None:
        trace_path.parent.mkdir(parents=True, exist_ok=True)
        trace_path.write_text("")
        valid, errors = DecisionTrace.verify_integrity(trace_path)
        assert valid is True
        assert errors == []

    def test_nonexistent_file_is_valid(self, tmp_path: Path) -> None:
        valid, errors = DecisionTrace.verify_integrity(tmp_path / "nope.jsonl")
        assert valid is True
        assert errors == []

    def test_valid_chain_passes(self, trace: DecisionTrace, trace_path: Path) -> None:
        for i in range(5):
            trace.record(_make_decision(prompt_id=f"p-{i:03d}"))
        valid, errors = DecisionTrace.verify_integrity(trace_path)
        assert valid is True
        assert errors == []

    def test_tampered_entry_detected(self, trace: DecisionTrace, trace_path: Path) -> None:
        """Modify a field in the middle entry — integrity check must fail."""
        for i in range(3):
            trace.record(_make_decision(prompt_id=f"p-{i:03d}"))

        # Tamper with the second entry
        lines = trace_path.read_text().strip().split("\n")
        entry = json.loads(lines[1])
        entry["explanation"] = "TAMPERED"
        lines[1] = json.dumps(entry)
        trace_path.write_text("\n".join(lines) + "\n")

        valid, errors = DecisionTrace.verify_integrity(trace_path)
        assert valid is False
        assert len(errors) >= 1
        assert "hash mismatch" in errors[0].lower()

    def test_broken_prev_hash_link_detected(self, trace: DecisionTrace, trace_path: Path) -> None:
        """Modify prev_hash of the third entry — linkage broken."""
        for i in range(3):
            trace.record(_make_decision(prompt_id=f"p-{i:03d}"))

        lines = trace_path.read_text().strip().split("\n")
        entry = json.loads(lines[2])
        entry["prev_hash"] = "0" * 64
        entry["hash"] = _compute_hash("0" * 64, entry)
        lines[2] = json.dumps(entry)
        trace_path.write_text("\n".join(lines) + "\n")

        valid, errors = DecisionTrace.verify_integrity(trace_path)
        assert valid is False
        assert any("prev_hash mismatch" in e for e in errors)

    def test_single_entry_valid(self, trace: DecisionTrace, trace_path: Path) -> None:
        trace.record(_make_decision())
        valid, errors = DecisionTrace.verify_integrity(trace_path)
        assert valid is True
        assert errors == []


class TestRotationChain:
    """Rotation must start a new hash chain."""

    def test_rotation_resets_chain(self, tmp_path: Path) -> None:
        trace_path = tmp_path / "trace.jsonl"
        # Use very small max_bytes to trigger rotation
        trace = DecisionTrace(trace_path, max_bytes=50)

        # Write enough to trigger rotation
        trace.record(_make_decision(prompt_id="p-before"))

        # Force rotation by writing more
        for i in range(5):
            trace.record(_make_decision(prompt_id=f"p-after-{i}"))

        # The active file should have a valid chain starting from empty prev_hash
        valid, errors = DecisionTrace.verify_integrity(trace_path)
        assert valid is True, f"Chain errors: {errors}"


class TestChainResumeAfterRestart:
    """Chain continuity after DecisionTrace re-instantiation."""

    def test_chain_resumes_from_last_hash(self, trace_path: Path) -> None:
        # First instance writes 2 entries
        trace1 = DecisionTrace(trace_path)
        trace1.record(_make_decision(prompt_id="p-001"))
        trace1.record(_make_decision(prompt_id="p-002"))

        # Second instance (simulating restart) should resume chain
        trace2 = DecisionTrace(trace_path)
        trace2.record(_make_decision(prompt_id="p-003"))

        # Full chain should be valid
        valid, errors = DecisionTrace.verify_integrity(trace_path)
        assert valid is True, f"Chain errors after restart: {errors}"

        entries = trace2.tail(10)
        assert len(entries) == 3
        assert entries[2]["prev_hash"] == entries[1]["hash"]
