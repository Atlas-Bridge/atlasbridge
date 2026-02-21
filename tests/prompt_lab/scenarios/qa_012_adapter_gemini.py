"""QA-012: adapter-gemini — Gemini CLI-specific patterns detected."""

from __future__ import annotations

from tests.prompt_lab.simulator import (
    LabScenario,
    PTYSimulator,
    ScenarioRegistry,
    ScenarioResults,
    TelegramStub,
)
from aegis.core.prompt.models import PromptType


@ScenarioRegistry.register
class AdapterGeminiScenario(LabScenario):
    scenario_id = "QA-012"
    name = "adapter-gemini"

    async def setup(self, pty: PTYSimulator, stub: TelegramStub) -> None:
        # Gemini CLI yes/no pattern
        await pty.write(b"Do you want to continue? (y/n) ")

    def assert_results(self, results: ScenarioResults) -> None:
        assert len(results.prompt_events) >= 1, "Expected at least one prompt event"
        event = results.prompt_events[0]
        assert event.prompt_type == PromptType.TYPE_YES_NO, (
            f"Expected YES_NO for Gemini 'Do you want to continue? (y/n)', got {event.prompt_type}"
        )
