"""Unit tests for the autopilot decision trace (JSONL writer)."""

from __future__ import annotations

from pathlib import Path

from atlasbridge.core.autopilot.trace import DecisionTrace
from atlasbridge.core.policy.evaluator import evaluate
from atlasbridge.core.policy.model import MatchCriteria, Policy, PolicyRule, RequireHumanAction


def _simple_policy() -> Policy:
    return Policy(
        policy_version="0",
        name="trace-test",
        rules=[
            PolicyRule(
                id="r1",
                match=MatchCriteria(),
                action=RequireHumanAction(),
            )
        ],
    )


def _make_decision(prompt_id: str = "p1") -> object:
    return evaluate(
        policy=_simple_policy(),
        prompt_text="Continue?",
        prompt_type="yes_no",
        confidence="high",
        prompt_id=prompt_id,
        session_id="s1",
    )


class TestDecisionTrace:
    def test_record_and_tail(self, tmp_path: Path) -> None:
        trace = DecisionTrace(tmp_path / "trace.jsonl")
        d = _make_decision("p1")
        trace.record(d)  # type: ignore[arg-type]
        entries = trace.tail(10)
        assert len(entries) == 1
        assert entries[0]["prompt_id"] == "p1"

    def test_tail_empty_when_no_file(self, tmp_path: Path) -> None:
        trace = DecisionTrace(tmp_path / "nonexistent.jsonl")
        assert trace.tail() == []

    def test_tail_n_limit(self, tmp_path: Path) -> None:
        trace = DecisionTrace(tmp_path / "trace.jsonl")
        for i in range(10):
            trace.record(_make_decision(f"p{i}"))  # type: ignore[arg-type]
        entries = trace.tail(3)
        assert len(entries) == 3
        assert entries[-1]["prompt_id"] == "p9"

    def test_multiple_records_appended(self, tmp_path: Path) -> None:
        path = tmp_path / "trace.jsonl"
        trace = DecisionTrace(path)
        trace.record(_make_decision("p1"))  # type: ignore[arg-type]
        trace.record(_make_decision("p2"))  # type: ignore[arg-type]
        lines = path.read_text().strip().splitlines()
        assert len(lines) == 2

    def test_iterate_all(self, tmp_path: Path) -> None:
        trace = DecisionTrace(tmp_path / "trace.jsonl")
        for i in range(5):
            trace.record(_make_decision(f"p{i}"))  # type: ignore[arg-type]
        all_entries = list(trace)
        assert len(all_entries) == 5

    def test_to_json_round_trip(self, tmp_path: Path) -> None:
        import json

        trace = DecisionTrace(tmp_path / "trace.jsonl")
        d = _make_decision("p42")
        trace.record(d)  # type: ignore[arg-type]
        raw = (tmp_path / "trace.jsonl").read_text().strip()
        parsed = json.loads(raw)
        assert parsed["prompt_id"] == "p42"
        assert "timestamp" in parsed
        assert "idempotency_key" in parsed
