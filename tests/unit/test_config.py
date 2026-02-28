"""Unit tests for atlasbridge.core.config — AtlasBridgeConfig loading and validation."""

from __future__ import annotations

import stat
from pathlib import Path

import pytest

from atlasbridge.core.config import load_config, save_config
from atlasbridge.core.exceptions import ConfigError, ConfigNotFoundError

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_config(tmp_path: Path, content: str) -> Path:
    p = tmp_path / "config.toml"
    p.write_text(content)
    return p


MINIMAL_TOML = """
config_version = 1

[prompts]
timeout_seconds = 300
"""


# ---------------------------------------------------------------------------
# Load config
# ---------------------------------------------------------------------------


class TestLoadConfig:
    def test_minimal_valid(self, tmp_path: Path) -> None:
        p = _write_config(tmp_path, MINIMAL_TOML)
        cfg = load_config(p)
        assert cfg.config_version == 1
        assert cfg.prompts.timeout_seconds == 300

    def test_missing_file_raises(self, tmp_path: Path) -> None:
        with pytest.raises(ConfigNotFoundError):
            load_config(tmp_path / "nonexistent.toml")

    def test_invalid_toml_raises(self, tmp_path: Path) -> None:
        p = _write_config(tmp_path, "this is not valid toml %%% [[[")
        with pytest.raises(ConfigError):
            load_config(p)

    def test_auto_approve_rejected(self, tmp_path: Path) -> None:
        bad = """
config_version = 1

[prompts]
timeout_seconds = 300
yes_no_safe_default = "y"
"""
        p = _write_config(tmp_path, bad)
        with pytest.raises(ConfigError, match="[Aa]uto-approv"):
            load_config(p)

    def test_timeout_bounds(self, tmp_path: Path) -> None:
        bad = """
config_version = 1

[prompts]
timeout_seconds = 10
"""
        p = _write_config(tmp_path, bad)
        with pytest.raises(ConfigError):
            load_config(p)

    def test_env_override_log_level(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ATLASBRIDGE_LOG_LEVEL", "DEBUG")
        p = _write_config(tmp_path, MINIMAL_TOML)
        cfg = load_config(p)
        assert cfg.logging.level == "DEBUG"

    def test_env_override_db_path(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("ATLASBRIDGE_DB_PATH", str(tmp_path / "custom.db"))
        p = _write_config(tmp_path, MINIMAL_TOML)
        cfg = load_config(p)
        assert cfg.database.path == str(tmp_path / "custom.db")


# ---------------------------------------------------------------------------
# Save config
# ---------------------------------------------------------------------------


class TestSaveConfig:
    def test_saves_and_loads(self, tmp_path: Path) -> None:
        data = {
            "prompts": {
                "timeout_seconds": 300,
            }
        }
        path = save_config(data, tmp_path / "config.toml")
        cfg = load_config(path)
        assert cfg.prompts.timeout_seconds == 300

    def test_secure_permissions(self, tmp_path: Path) -> None:
        data = {
            "prompts": {
                "timeout_seconds": 300,
            }
        }
        path = save_config(data, tmp_path / "config.toml")
        mode = stat.S_IMODE(path.stat().st_mode)
        assert mode == 0o600, f"Expected 0600, got {oct(mode)}"


# ---------------------------------------------------------------------------
# db_path / audit_path derivation
# ---------------------------------------------------------------------------


class TestPaths:
    def test_default_db_path(self, tmp_path: Path) -> None:
        p = _write_config(tmp_path, MINIMAL_TOML)
        cfg = load_config(p)
        assert cfg.db_path.name == "atlasbridge.db"

    def test_custom_db_path(self, tmp_path: Path) -> None:
        toml = MINIMAL_TOML + f'\n[database]\npath = "{tmp_path}/custom.db"\n'
        p = _write_config(tmp_path, toml)
        cfg = load_config(p)
        assert cfg.db_path == tmp_path / "custom.db"


# ---------------------------------------------------------------------------
# No-channel config
# ---------------------------------------------------------------------------


class TestNoChannelConfig:
    def test_empty_config_valid(self, tmp_path: Path) -> None:
        """Config with no channel section is valid."""
        empty = """
config_version = 1

[prompts]
timeout_seconds = 300
"""
        p = _write_config(tmp_path, empty)
        cfg = load_config(p)
        assert cfg.config_version == 1
