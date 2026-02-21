"""
Safety test: Prompt state machine transition safety.

Verifies that:
  1. Terminal states have no outgoing transitions
  2. Invalid transitions raise ValueError
  3. RESOLVED/EXPIRED/CANCELED/FAILED are all terminal
  4. State machine history is append-only
  5. All PromptStatus values have entries in VALID_TRANSITIONS
"""

from __future__ import annotations

import pytest

from atlasbridge.core.prompt.models import Confidence, PromptEvent, PromptStatus, PromptType
from atlasbridge.core.prompt.state import (
    TERMINAL_STATES,
    VALID_TRANSITIONS,
    PromptStateMachine,
)


def _make_event() -> PromptEvent:
    """Create a minimal PromptEvent for testing."""
    return PromptEvent(
        prompt_id="test-prompt-001",
        session_id="test-session-001",
        prompt_type=PromptType.TYPE_YES_NO,
        confidence=Confidence.HIGH,
        excerpt="Continue? [y/N]",
    )


class TestTerminalStates:
    """Terminal states must have no outgoing transitions."""

    @pytest.mark.parametrize(
        "state",
        [PromptStatus.RESOLVED, PromptStatus.EXPIRED, PromptStatus.CANCELED, PromptStatus.FAILED],
    )
    def test_terminal_state_has_empty_transition_set(self, state: PromptStatus) -> None:
        assert VALID_TRANSITIONS[state] == set(), (
            f"Terminal state {state} must have no outgoing transitions"
        )

    def test_all_terminal_states_enumerated(self) -> None:
        """TERMINAL_STATES must contain exactly 4 states."""
        expected = {
            PromptStatus.RESOLVED,
            PromptStatus.EXPIRED,
            PromptStatus.CANCELED,
            PromptStatus.FAILED,
        }
        assert TERMINAL_STATES == expected

    @pytest.mark.parametrize(
        "state",
        [PromptStatus.RESOLVED, PromptStatus.EXPIRED, PromptStatus.CANCELED, PromptStatus.FAILED],
    )
    def test_cannot_transition_from_terminal(self, state: PromptStatus) -> None:
        """Attempting any transition from a terminal state raises ValueError."""
        sm = _make_event()
        machine = PromptStateMachine(event=sm)
        machine.status = state  # Force to terminal
        with pytest.raises(ValueError, match="Invalid transition"):
            machine.transition(PromptStatus.CREATED)


class TestValidTransitions:
    """Valid transitions must succeed; invalid must raise."""

    def test_full_happy_path(self) -> None:
        """CREATED → ROUTED → AWAITING_REPLY → REPLY_RECEIVED → INJECTED → RESOLVED"""
        machine = PromptStateMachine(event=_make_event())
        assert machine.status == PromptStatus.CREATED

        machine.transition(PromptStatus.ROUTED)
        assert machine.status == PromptStatus.ROUTED

        machine.transition(PromptStatus.AWAITING_REPLY)
        assert machine.status == PromptStatus.AWAITING_REPLY

        machine.transition(PromptStatus.REPLY_RECEIVED)
        assert machine.status == PromptStatus.REPLY_RECEIVED

        machine.transition(PromptStatus.INJECTED)
        assert machine.status == PromptStatus.INJECTED

        machine.transition(PromptStatus.RESOLVED)
        assert machine.status == PromptStatus.RESOLVED
        assert machine.is_terminal

    def test_invalid_transition_raises_value_error(self) -> None:
        """CREATED → RESOLVED is not a valid transition."""
        machine = PromptStateMachine(event=_make_event())
        with pytest.raises(ValueError, match="Invalid transition"):
            machine.transition(PromptStatus.RESOLVED)

    def test_created_to_failed_is_valid(self) -> None:
        """CREATED → FAILED is valid (early failure)."""
        machine = PromptStateMachine(event=_make_event())
        machine.transition(PromptStatus.FAILED)
        assert machine.is_terminal

    def test_awaiting_reply_to_expired_is_valid(self) -> None:
        """AWAITING_REPLY → EXPIRED is valid (TTL timeout)."""
        machine = PromptStateMachine(event=_make_event())
        machine.transition(PromptStatus.ROUTED)
        machine.transition(PromptStatus.AWAITING_REPLY)
        machine.transition(PromptStatus.EXPIRED)
        assert machine.is_terminal


class TestHistoryAppendOnly:
    """State machine history must be append-only."""

    def test_history_grows_with_transitions(self) -> None:
        machine = PromptStateMachine(event=_make_event())
        assert len(machine.history) == 0

        machine.transition(PromptStatus.ROUTED)
        assert len(machine.history) == 1

        machine.transition(PromptStatus.AWAITING_REPLY)
        assert len(machine.history) == 2

        machine.transition(PromptStatus.REPLY_RECEIVED)
        assert len(machine.history) == 3

    def test_history_records_new_status(self) -> None:
        machine = PromptStateMachine(event=_make_event())
        machine.transition(PromptStatus.ROUTED, "initial routing")
        assert machine.history[0][0] == PromptStatus.ROUTED


class TestTransitionCoverage:
    """Every PromptStatus value must have an entry in VALID_TRANSITIONS."""

    def test_all_statuses_have_transition_entries(self) -> None:
        for status in PromptStatus:
            assert status in VALID_TRANSITIONS, (
                f"PromptStatus.{status} has no entry in VALID_TRANSITIONS"
            )
