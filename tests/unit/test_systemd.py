"""
Unit tests for the systemd user service module.

Tests service file generation and directory resolution.
No subprocess calls are made — install/reload/enable functions are not
tested here since they require a live systemd session.
"""

from __future__ import annotations

import os

from aegis.os.systemd.service import (
    generate_unit_file,
    install_service,
    systemd_user_dir,
)


class TestGenerateUnitFile:
    def test_required_sections_present(self) -> None:
        unit = generate_unit_file("/usr/bin/aegis", "/home/user/.aegis/config.toml")
        assert "[Unit]" in unit
        assert "[Service]" in unit
        assert "[Install]" in unit

    def test_exec_path_substituted(self) -> None:
        unit = generate_unit_file("/usr/local/bin/aegis", "/home/user/.aegis/config.toml")
        assert "ExecStart=/usr/local/bin/aegis" in unit

    def test_config_path_in_environment(self) -> None:
        unit = generate_unit_file("/usr/bin/aegis", "/home/bob/.aegis/config.toml")
        assert "AEGIS_CONFIG=/home/bob/.aegis/config.toml" in unit

    def test_no_unresolved_placeholders(self) -> None:
        unit = generate_unit_file("/usr/bin/aegis", "/home/user/.aegis/config.toml")
        assert "{exec_path}" not in unit
        assert "{config_path}" not in unit

    def test_restart_on_failure(self) -> None:
        unit = generate_unit_file("/usr/bin/aegis", "/tmp/config.toml")
        assert "Restart=on-failure" in unit

    def test_wantedby_default_target(self) -> None:
        unit = generate_unit_file("/usr/bin/aegis", "/tmp/config.toml")
        assert "WantedBy=default.target" in unit

    def test_syslog_identifier(self) -> None:
        unit = generate_unit_file("/usr/bin/aegis", "/tmp/config.toml")
        assert "SyslogIdentifier=aegis" in unit

    def test_paths_with_spaces_handled(self) -> None:
        unit = generate_unit_file("/home/my user/bin/aegis", "/home/my user/.aegis/config.toml")
        assert "/home/my user/bin/aegis" in unit
        assert "/home/my user/.aegis/config.toml" in unit


class TestSystemdUserDir:
    def test_default_dir_under_home(self, tmp_path) -> None:
        # Without XDG_CONFIG_HOME set, should default to ~/.config/systemd/user
        env_backup = os.environ.pop("XDG_CONFIG_HOME", None)
        try:
            d = systemd_user_dir()
            assert d.parts[-2:] == ("systemd", "user")
            assert ".config" in str(d)
        finally:
            if env_backup is not None:
                os.environ["XDG_CONFIG_HOME"] = env_backup

    def test_respects_xdg_config_home(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
        d = systemd_user_dir()
        assert d == tmp_path / "systemd" / "user"


class TestInstallService:
    def test_writes_unit_file(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
        unit = generate_unit_file("/usr/bin/aegis", "/tmp/config.toml")
        path = install_service(unit)
        assert path.exists()
        assert path.read_text(encoding="utf-8") == unit

    def test_creates_parent_dirs(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "xdg"))
        unit = generate_unit_file("/usr/bin/aegis", "/tmp/config.toml")
        path = install_service(unit)
        assert path.parent.is_dir()

    def test_file_permissions(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
        unit = generate_unit_file("/usr/bin/aegis", "/tmp/config.toml")
        path = install_service(unit)
        mode = oct(path.stat().st_mode)[-3:]
        assert mode == "644"

    def test_returns_correct_path(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
        unit = generate_unit_file("/usr/bin/aegis", "/tmp/config.toml")
        path = install_service(unit)
        assert path.name == "aegis.service"
        assert path.parent == tmp_path / "systemd" / "user"

    def test_overwrites_existing_file(self, tmp_path, monkeypatch) -> None:
        monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
        unit1 = generate_unit_file("/old/aegis", "/tmp/old.toml")
        install_service(unit1)
        unit2 = generate_unit_file("/new/aegis", "/tmp/new.toml")
        path = install_service(unit2)
        assert "/new/aegis" in path.read_text(encoding="utf-8")
