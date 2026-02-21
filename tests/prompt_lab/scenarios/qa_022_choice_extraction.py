"""QA-022: choice-extraction — Numbered choice prompt populates event.choices."""

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
class ChoiceExtractionScenario(LabScenario):
    scenario_id = "QA-022"
    name = "choice-extraction"

    async def setup(self, pty: PTYSimulator, stub: TelegramStub) -> None:
        await pty.write(
            b"Select a deployment target:\n"
            b"1) Staging\n"
            b"2) Production\n"
            b"3) Development\n"
            b"Enter choice: "
        )

    def assert_results(self, results: ScenarioResults) -> None:
        assert len(results.prompt_events) >= 1, "Expected at least one prompt event"
        event = results.prompt_events[0]
        assert event.prompt_type == PromptType.TYPE_MULTIPLE_CHOICE, (
            f"Expected MULTIPLE_CHOICE, got {event.prompt_type}"
        )
        assert event.choices == ["Staging", "Production", "Development"], (
            f"Expected extracted choices, got {event.choices}"
        )
