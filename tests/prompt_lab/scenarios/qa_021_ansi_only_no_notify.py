"""QA-021: ansi-only-no-notify — ANSI-only output produces no prompt event."""

from __future__ import annotations

from tests.prompt_lab.simulator import (
    LabScenario,
    PTYSimulator,
    ScenarioRegistry,
    ScenarioResults,
    TelegramStub,
)


@ScenarioRegistry.register
class AnsiOnlyNoNotifyScenario(LabScenario):
    scenario_id = "QA-021"
    name = "ansi-only-no-notify"

    async def setup(self, pty: PTYSimulator, stub: TelegramStub) -> None:
        # Write only ANSI control sequences (private mode, cursor, SGR)
        # This should NOT trigger any prompt detection
        await pty.write(b"\x1b[?1004l\x1b[?2004l\x1b[?25h")

    def assert_results(self, results: ScenarioResults) -> None:
        assert len(results.prompt_events) == 0, (
            f"ANSI-only output should produce 0 prompt events, got {len(results.prompt_events)}"
        )
