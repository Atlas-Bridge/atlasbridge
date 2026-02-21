"""QA-023: ansi-plus-choices — ANSI junk followed by real choice prompt."""

from __future__ import annotations

from tests.prompt_lab.simulator import (
    LabScenario,
    PTYSimulator,
    ScenarioRegistry,
    ScenarioResults,
    TelegramStub,
)
from atlasbridge.core.prompt.models import PromptType


@ScenarioRegistry.register
class AnsiPlusChoicesScenario(LabScenario):
    scenario_id = "QA-023"
    name = "ansi-plus-choices"

    async def setup(self, pty: PTYSimulator, stub: TelegramStub) -> None:
        # First chunk: ANSI junk only (should be ignored)
        await pty.write(b"\x1b[?1004l\x1b[?2004l\x1b[?25h")
        # Second chunk: real prompt with choices
        await pty.write(
            b"\x1b[1mChoose mode:\x1b[0m\n1) Fast\n2) Balanced\n3) Thorough\nEnter choice: "
        )

    def assert_results(self, results: ScenarioResults) -> None:
        # Only the real prompt should generate an event, not the ANSI junk
        mc_events = [
            e for e in results.prompt_events if e.prompt_type == PromptType.TYPE_MULTIPLE_CHOICE
        ]
        assert len(mc_events) >= 1, (
            f"Expected at least 1 MULTIPLE_CHOICE event, got {len(mc_events)}"
        )
        event = mc_events[0]
        assert event.choices == ["Fast", "Balanced", "Thorough"], (
            f"Expected extracted choices, got {event.choices}"
        )
