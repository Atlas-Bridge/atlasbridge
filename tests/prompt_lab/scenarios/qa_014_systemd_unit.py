"""QA-014: systemd-unit — Generated unit file contains required sections."""

from __future__ import annotations

from tests.prompt_lab.simulator import (
    LabScenario,
    PTYSimulator,
    ScenarioRegistry,
    ScenarioResults,
    TelegramStub,
)
from aegis.os.systemd.service import generate_unit_file


@ScenarioRegistry.register
class SystemdUnitScenario(LabScenario):
    scenario_id = "QA-014"
    name = "systemd-unit"

    async def setup(self, pty: PTYSimulator, stub: TelegramStub) -> None:
        unit = generate_unit_file(
            exec_path="/usr/local/bin/aegis",
            config_path="/home/user/.aegis/config.toml",
        )

        # Required sections
        assert "[Unit]" in unit, "Missing [Unit] section"
        assert "[Service]" in unit, "Missing [Service] section"
        assert "[Install]" in unit, "Missing [Install] section"

        # Required directives
        assert "ExecStart=/usr/local/bin/aegis" in unit, "ExecStart must reference exec_path"
        assert "AEGIS_CONFIG=/home/user/.aegis/config.toml" in unit, (
            "Environment must set AEGIS_CONFIG"
        )
        assert "Restart=on-failure" in unit, "Service must restart on failure"
        assert "WantedBy=default.target" in unit, "Service must be enabled for user sessions"

        # Must not contain unresolved template placeholders
        assert "{exec_path}" not in unit, "Template placeholder {exec_path} not substituted"
        assert "{config_path}" not in unit, "Template placeholder {config_path} not substituted"

    def assert_results(self, results: ScenarioResults) -> None:
        assert results.error == "", f"Scenario error: {results.error}"
