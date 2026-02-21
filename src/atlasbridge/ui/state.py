"""
UI state types — re-exported from ``atlasbridge.tui.state`` so that the
``ui`` package is self-contained for import purposes.

All state classes are pure Python dataclasses with no Textual dependency.
"""

from atlasbridge.tui.state import (  # noqa: F401
    WIZARD_STEPS,
    WIZARD_TOTAL,
    AppState,
    ChannelStatus,
    ConfigStatus,
    DaemonStatus,
    WizardState,
)

__all__ = [
    "AppState",
    "ChannelStatus",
    "ConfigStatus",
    "DaemonStatus",
    "WIZARD_STEPS",
    "WIZARD_TOTAL",
    "WizardState",
]
