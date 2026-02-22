"""Safety guard: safety-critical default values must not drift."""

from __future__ import annotations


def test_default_timeout_seconds():
    """DEFAULT_TIMEOUT_SECONDS must be 300 (5 minutes)."""
    from atlasbridge.core.constants import DEFAULT_TIMEOUT_SECONDS

    assert DEFAULT_TIMEOUT_SECONDS == 300, (
        f"SAFETY: DEFAULT_TIMEOUT_SECONDS changed from 300 to {DEFAULT_TIMEOUT_SECONDS}"
    )


def test_max_buffer_bytes():
    """MAX_BUFFER_BYTES must be 4096."""
    from atlasbridge.core.constants import MAX_BUFFER_BYTES

    assert MAX_BUFFER_BYTES == 4096, (
        f"SAFETY: MAX_BUFFER_BYTES changed from 4096 to {MAX_BUFFER_BYTES}"
    )


def test_echo_suppress_ms():
    """ECHO_SUPPRESS_MS must be 500."""
    from atlasbridge.core.constants import ECHO_SUPPRESS_MS

    assert ECHO_SUPPRESS_MS == 500, (
        f"SAFETY: ECHO_SUPPRESS_MS changed from 500 to {ECHO_SUPPRESS_MS}"
    )


def test_policy_defaults_no_match():
    """PolicyDefaults().no_match must be 'require_human'."""
    from atlasbridge.core.policy.model import PolicyDefaults

    assert PolicyDefaults().no_match == "require_human"


def test_policy_defaults_low_confidence():
    """PolicyDefaults().low_confidence must be 'require_human'."""
    from atlasbridge.core.policy.model import PolicyDefaults

    assert PolicyDefaults().low_confidence == "require_human"


def test_decision_trace_max_bytes():
    """DecisionTrace.MAX_BYTES_DEFAULT must be 10 MB."""
    from atlasbridge.core.autopilot.trace import DecisionTrace

    assert DecisionTrace.MAX_BYTES_DEFAULT == 10 * 1024 * 1024, (
        f"SAFETY: DecisionTrace.MAX_BYTES_DEFAULT changed to {DecisionTrace.MAX_BYTES_DEFAULT}"
    )


def test_decision_trace_max_archives():
    """DecisionTrace.MAX_ARCHIVES must be 3."""
    from atlasbridge.core.autopilot.trace import DecisionTrace

    assert DecisionTrace.MAX_ARCHIVES == 3, (
        f"SAFETY: DecisionTrace.MAX_ARCHIVES changed to {DecisionTrace.MAX_ARCHIVES}"
    )


def test_yes_no_safe_default():
    """PromptsConfig.yes_no_safe_default must be 'n'."""
    from atlasbridge.core.config import PromptsConfig

    assert PromptsConfig().yes_no_safe_default == "n"
