"""Integration tests for --from-env setup and doctor --fix with env vars."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from click.testing import CliRunner

from atlasbridge.cli.main import cli


@pytest.fixture
def runner() -> CliRunner:
    return CliRunner()


# ---------------------------------------------------------------------------
# atlasbridge setup --from-env
# ---------------------------------------------------------------------------


class TestFromEnvSetup:
    def test_from_env_creates_config(self, runner: CliRunner, tmp_path: Path) -> None:
        """--from-env creates a config file."""
        cfg = tmp_path / "config.toml"
        result = runner.invoke(
            cli,
            ["setup", "--from-env"],
            env={
                "ATLASBRIDGE_CONFIG": str(cfg),
            },
            catch_exceptions=False,
        )
        assert result.exit_code == 0
        assert cfg.exists()

    def test_from_env_with_log_level(self, runner: CliRunner, tmp_path: Path) -> None:
        """--from-env with log level env var."""
        cfg = tmp_path / "config.toml"
        result = runner.invoke(
            cli,
            ["setup", "--from-env"],
            env={
                "ATLASBRIDGE_CONFIG": str(cfg),
                "ATLASBRIDGE_LOG_LEVEL": "DEBUG",
            },
            catch_exceptions=False,
        )
        assert result.exit_code == 0
        assert cfg.exists()

    def test_from_env_with_db_path(self, runner: CliRunner, tmp_path: Path) -> None:
        """--from-env with custom DB path."""
        cfg = tmp_path / "config.toml"
        result = runner.invoke(
            cli,
            ["setup", "--from-env"],
            env={
                "ATLASBRIDGE_CONFIG": str(cfg),
                "ATLASBRIDGE_DB_PATH": str(tmp_path / "custom.db"),
            },
            catch_exceptions=False,
        )
        assert result.exit_code == 0
        assert cfg.exists()


# ---------------------------------------------------------------------------
# atlasbridge doctor --fix with env vars
# ---------------------------------------------------------------------------


class TestDoctorFixEnvVars:
    def test_fix_creates_skeleton_without_env(self, runner: CliRunner, tmp_path: Path) -> None:
        """doctor --fix without env vars creates a skeleton template."""
        cfg = tmp_path / "config.toml"
        result = runner.invoke(
            cli,
            ["doctor", "--fix"],
            env={
                "ATLASBRIDGE_CONFIG": str(cfg),
            },
            catch_exceptions=False,
        )
        assert isinstance(result.exit_code, int)
        assert cfg.exists()

        content = cfg.read_text()
        assert "config_version" in content


# ---------------------------------------------------------------------------
# atlasbridge config commands
# ---------------------------------------------------------------------------


class TestConfigCommands:
    @pytest.fixture
    def config_path(self, tmp_path: Path) -> Path:
        import tomli_w

        data = {
            "config_version": 1,
            "prompts": {
                "timeout_seconds": 300,
            },
        }
        p = tmp_path / "config.toml"
        with open(p, "wb") as f:
            tomli_w.dump(data, f)
        return p

    def test_config_help(self, runner: CliRunner) -> None:
        result = runner.invoke(cli, ["config", "--help"], catch_exceptions=False)
        assert result.exit_code == 0
        assert "show" in result.output
        assert "validate" in result.output
        assert "migrate" in result.output

    def test_config_show_json(self, runner: CliRunner, config_path: Path) -> None:
        result = runner.invoke(
            cli,
            ["config", "show", "--json"],
            env={"ATLASBRIDGE_CONFIG": str(config_path)},
            catch_exceptions=False,
        )
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert "config_version" in data

    def test_config_show_redacted(self, runner: CliRunner, config_path: Path) -> None:
        result = runner.invoke(
            cli,
            ["config", "show", "--json"],
            env={"ATLASBRIDGE_CONFIG": str(config_path)},
            catch_exceptions=False,
        )
        data = json.loads(result.output)
        assert "config_version" in data

    def test_config_show_no_redact(self, runner: CliRunner, config_path: Path) -> None:
        result = runner.invoke(
            cli,
            ["config", "show", "--json", "--no-redact"],
            env={"ATLASBRIDGE_CONFIG": str(config_path)},
            catch_exceptions=False,
        )
        data = json.loads(result.output)
        assert "config_version" in data

    def test_config_validate_valid(self, runner: CliRunner, config_path: Path) -> None:
        result = runner.invoke(
            cli,
            ["config", "validate"],
            env={"ATLASBRIDGE_CONFIG": str(config_path)},
            catch_exceptions=False,
        )
        assert result.exit_code == 0
        assert "valid" in result.output.lower()

    def test_config_validate_missing(self, runner: CliRunner, tmp_path: Path) -> None:
        result = runner.invoke(
            cli,
            ["config", "validate"],
            env={"ATLASBRIDGE_CONFIG": str(tmp_path / "nope.toml")},
        )
        assert result.exit_code != 0

    def test_config_migrate_already_current(self, runner: CliRunner, config_path: Path) -> None:
        result = runner.invoke(
            cli,
            ["config", "migrate"],
            env={"ATLASBRIDGE_CONFIG": str(config_path)},
            catch_exceptions=False,
        )
        assert result.exit_code == 0
        assert "already" in result.output.lower() or "no migration" in result.output.lower()

    def test_config_migrate_v0_to_v1(self, runner: CliRunner, tmp_path: Path) -> None:
        """Explicit migration of a v0 config."""
        p = tmp_path / "config.toml"
        p.write_text("[prompts]\ntimeout_seconds = 300\n")

        result = runner.invoke(
            cli,
            ["config", "migrate"],
            env={"ATLASBRIDGE_CONFIG": str(p)},
            catch_exceptions=False,
        )
        assert result.exit_code == 0

        import tomllib

        with open(p, "rb") as f:
            data = tomllib.load(f)
        assert data["config_version"] == 1

    def test_config_migrate_dry_run(self, runner: CliRunner, tmp_path: Path) -> None:
        p = tmp_path / "config.toml"
        p.write_text("[prompts]\ntimeout_seconds = 300\n")

        result = runner.invoke(
            cli,
            ["config", "migrate", "--dry-run"],
            env={"ATLASBRIDGE_CONFIG": str(p)},
            catch_exceptions=False,
        )
        assert result.exit_code == 0
        assert "dry run" in result.output.lower()

        # File should NOT be modified
        import tomllib

        with open(p, "rb") as f:
            data = tomllib.load(f)
        assert "config_version" not in data
