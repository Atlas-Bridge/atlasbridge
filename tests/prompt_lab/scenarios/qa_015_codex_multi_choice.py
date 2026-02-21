"""QA-015: codex-multi-choice — OpenAI Codex numbered menu prompt detected."""

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
class CodexMultiChoiceScenario(LabScenario):
    scenario_id = "QA-015"
    name = "codex-multi-choice"

    async def setup(self, pty: PTYSimulator, stub: TelegramStub) -> None:
        # Codex-style numbered action menu
        await pty.write(b"Choose an option:\n1) Apply\n2) Skip\n3) Abort\n")

    def assert_results(self, results: ScenarioResults) -> None:
        assert len(results.prompt_events) >= 1, "Expected at least one prompt event"
        event = results.prompt_events[0]
        assert event.prompt_type == PromptType.TYPE_MULTIPLE_CHOICE, (
            f"Expected MULTIPLE_CHOICE for numbered Codex menu, got {event.prompt_type}"
        )
