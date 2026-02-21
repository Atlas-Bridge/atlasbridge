"""
Unit tests for AutopilotEngine: rate limits and state history.

Tests:
  1. test_rate_limit_escalates_after_max       — rule with max_auto_replies=2; 3rd call escalates
  2. test_rate_limit_per_rule                  — two rules each with max 1; counts are per rule_id
  3. test_rate_limit_per_session               — same rule, different sessions have separate counts
  4. test_rate_limit_reset_session             — reset_session() clears counter; auto-reply resumes
  5. test_state_history_appended_on_transition — pause() writes entry to history file
  6. test_state_history_triggered_by           — pause(triggered_by=...) recorded in history
  7. test_state_history_multiple_entries       — three transitions produce three JSONL lines
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from atlasbridge.core.autopilot.engine import HISTORY_FILENAME, AutopilotEngine
from atlasbridge.core.policy.model import (
    AutonomyMode,
    AutoReplyAction,
    MatchCriteria,
    Policy,
    PolicyRule,
    RequireHumanAction,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_policy(*rules: PolicyRule, mode: str = "full") -> Policy:
    return Policy(
        policy_version="0",
        name="test",
        autonomy_mode=AutonomyMode(mode),
        rules=list(rules),
    )


def make_auto_reply_rule(rule_id: str, max_auto_replies: int | None = None) -> PolicyRule:
    return PolicyRule(
        id=rule_id,
        match=MatchCriteria(prompt_type=["yes_no"]),
        action=AutoReplyAction(value="y"),
        max_auto_replies=max_auto_replies,
    )


def make_require_human_rule(rule_id: str) -> PolicyRule:
    return PolicyRule(
        id=rule_id,
        match=MatchCriteria(prompt_type=["free_text"]),
        action=RequireHumanAction(),
    )


def make_engine(
    tmp_path: Path,
    policy: Policy,
    *,
    injected: list[str] | None = None,
    routed: list[object] | None = None,
) -> AutopilotEngine:
    """Build an AutopilotEngine wired to simple in-memory callbacks."""
    if injected is None:
        injected = []
    if routed is None:
        routed = []

    async def inject_fn(value: str) -> None:
        injected.append(value)

    async def route_fn(event: object) -> None:
        routed.append(event)

    async def notify_fn(msg: str) -> None:
        pass

    return AutopilotEngine(
        policy=policy,
        trace_path=tmp_path / "trace.jsonl",
        state_path=tmp_path / "state.json",
        history_path=tmp_path / HISTORY_FILENAME,
        inject_fn=inject_fn,
        route_fn=route_fn,
        notify_fn=notify_fn,
    )


async def call_handle(engine: AutopilotEngine, session_id: str = "sess1") -> object:
    return await engine.handle_prompt(
        prompt_event=object(),
        prompt_id=f"pid-{session_id}",
        session_id=session_id,
        prompt_type="yes_no",
        confidence="high",
        prompt_text="Continue? [y/n]",
    )


# ---------------------------------------------------------------------------
# Rate limit tests
# ---------------------------------------------------------------------------


class TestRateLimits:
    def test_rate_limit_escalates_after_max(self, tmp_path: Path) -> None:
        """Rule with max_auto_replies=2: first two calls inject, third escalates."""
        injected: list[str] = []
        routed: list[object] = []
        rule = make_auto_reply_rule("r1", max_auto_replies=2)
        policy = make_policy(rule)
        engine = make_engine(tmp_path, policy, injected=injected, routed=routed)

        async def run() -> None:
            r1 = await call_handle(engine, "s1")
            r2 = await call_handle(engine, "s1")
            r3 = await call_handle(engine, "s1")
            assert r1.injected is True
            assert r2.injected is True
            assert r3.injected is False
            assert r3.routed_to_human is True

        asyncio.get_event_loop().run_until_complete(run())
        assert len(injected) == 2
        assert len(routed) == 1

    def test_rate_limit_per_rule(self, tmp_path: Path) -> None:
        """Two rules each with max_auto_replies=1; counts are tracked per rule_id."""
        injected: list[str] = []
        routed: list[object] = []
        r1 = make_auto_reply_rule("r1", max_auto_replies=1)
        r2 = PolicyRule(
            id="r2",
            match=MatchCriteria(prompt_type=["confirm_enter"]),
            action=AutoReplyAction(value=""),
            max_auto_replies=1,
        )
        policy = make_policy(r1, r2)
        engine = make_engine(tmp_path, policy, injected=injected, routed=routed)

        async def run() -> None:
            # r1 fires once (yes_no)
            res1 = await engine.handle_prompt(
                prompt_event=object(),
                prompt_id="p1",
                session_id="s1",
                prompt_type="yes_no",
                confidence="high",
                prompt_text="Continue?",
            )
            # r1 second time → rate limited
            res2 = await engine.handle_prompt(
                prompt_event=object(),
                prompt_id="p2",
                session_id="s1",
                prompt_type="yes_no",
                confidence="high",
                prompt_text="Continue?",
            )
            # r2 fires once (confirm_enter)
            res3 = await engine.handle_prompt(
                prompt_event=object(),
                prompt_id="p3",
                session_id="s1",
                prompt_type="confirm_enter",
                confidence="high",
                prompt_text="Press Enter",
            )
            assert res1.injected is True
            assert res2.routed_to_human is True
            assert res3.injected is True

        asyncio.get_event_loop().run_until_complete(run())

    def test_rate_limit_per_session(self, tmp_path: Path) -> None:
        """Same rule with max_auto_replies=1; different session_ids have separate counters."""
        injected: list[str] = []
        rule = make_auto_reply_rule("r1", max_auto_replies=1)
        policy = make_policy(rule)
        engine = make_engine(tmp_path, policy, injected=injected)

        async def run() -> None:
            res_s1a = await call_handle(engine, "session-A")
            res_s1b = await call_handle(engine, "session-A")
            res_s2 = await call_handle(engine, "session-B")
            assert res_s1a.injected is True
            assert res_s1b.routed_to_human is True
            assert res_s2.injected is True

        asyncio.get_event_loop().run_until_complete(run())

    def test_rate_limit_reset_session(self, tmp_path: Path) -> None:
        """reset_session() clears the counter; auto-reply works again after reset."""
        injected: list[str] = []
        rule = make_auto_reply_rule("r1", max_auto_replies=1)
        policy = make_policy(rule)
        engine = make_engine(tmp_path, policy, injected=injected)

        async def run() -> None:
            r1 = await call_handle(engine, "s1")
            r2 = await call_handle(engine, "s1")
            assert r1.injected is True
            assert r2.routed_to_human is True

            engine.reset_session("s1")

            r3 = await call_handle(engine, "s1")
            assert r3.injected is True

        asyncio.get_event_loop().run_until_complete(run())
        assert len(injected) == 2


# ---------------------------------------------------------------------------
# State history tests
# ---------------------------------------------------------------------------


class TestStateHistory:
    def test_state_history_appended_on_transition(self, tmp_path: Path) -> None:
        """pause() writes a JSONL entry to the history file."""
        policy = make_policy(make_auto_reply_rule("r1"))
        engine = make_engine(tmp_path, policy)
        history_path = tmp_path / HISTORY_FILENAME

        assert not history_path.exists() or history_path.stat().st_size == 0

        engine.pause()

        assert history_path.exists()
        lines = [ln for ln in history_path.read_text().splitlines() if ln.strip()]
        assert len(lines) == 1
        entry = json.loads(lines[0])
        assert entry["from_state"] == "running"
        assert entry["to_state"] == "paused"
        assert "timestamp" in entry

    def test_state_history_triggered_by(self, tmp_path: Path) -> None:
        """pause(triggered_by='telegram:123') is recorded in the history entry."""
        policy = make_policy(make_auto_reply_rule("r1"))
        engine = make_engine(tmp_path, policy)
        history_path = tmp_path / HISTORY_FILENAME

        engine.pause(triggered_by="telegram:123")

        lines = [ln for ln in history_path.read_text().splitlines() if ln.strip()]
        entry = json.loads(lines[0])
        assert entry["triggered_by"] == "telegram:123"

    def test_state_history_multiple_entries(self, tmp_path: Path) -> None:
        """Three transitions produce three JSONL lines in order."""
        policy = make_policy(make_auto_reply_rule("r1"))
        engine = make_engine(tmp_path, policy)
        history_path = tmp_path / HISTORY_FILENAME

        engine.pause(triggered_by="cli")
        engine.resume(triggered_by="telegram:999")
        engine.stop(triggered_by="slack:U001")

        lines = [ln for ln in history_path.read_text().splitlines() if ln.strip()]
        assert len(lines) == 3

        e0 = json.loads(lines[0])
        e1 = json.loads(lines[1])
        e2 = json.loads(lines[2])

        assert e0["from_state"] == "running" and e0["to_state"] == "paused"
        assert e1["from_state"] == "paused" and e1["to_state"] == "running"
        assert e2["from_state"] == "running" and e2["to_state"] == "stopped"

        assert e0["triggered_by"] == "cli"
        assert e1["triggered_by"] == "telegram:999"
        assert e2["triggered_by"] == "slack:U001"
