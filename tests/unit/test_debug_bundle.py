"""Tests for atlasbridge debug bundle CLI command."""

from __future__ import annotations

import json
import tarfile
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from rich.console import Console


def _make_console():
    buf = StringIO()
    return Console(file=buf, force_terminal=False), buf


class TestDebugBundle:
    def test_creates_tarball(self, tmp_path):
        from atlasbridge.cli._debug import cmd_debug_bundle
        from atlasbridge.core.exceptions import ConfigNotFoundError

        console, buf = _make_console()
        output = str(tmp_path / "test-bundle.tar.gz")

        with patch("atlasbridge.core.config.load_config") as mock_cfg:
            mock_cfg.side_effect = ConfigNotFoundError("no config")
            cmd_debug_bundle(output=output, include_logs=10, redact=True, console=console)

        assert Path(output).exists()
        with tarfile.open(output, "r:gz") as tar:
            names = tar.getnames()
            assert "version.json" in names
            assert "platform.json" in names
            assert "doctor.json" in names

    def test_bundle_contains_version(self, tmp_path):
        from atlasbridge.cli._debug import cmd_debug_bundle
        from atlasbridge.core.exceptions import ConfigNotFoundError

        console, _ = _make_console()
        output = str(tmp_path / "test-bundle.tar.gz")

        with patch("atlasbridge.core.config.load_config") as mock_cfg:
            mock_cfg.side_effect = ConfigNotFoundError("no config")
            cmd_debug_bundle(output=output, include_logs=10, redact=True, console=console)

        with tarfile.open(output, "r:gz") as tar:
            member = tar.getmember("version.json")
            f = tar.extractfile(member)
            data = json.loads(f.read())
            assert "atlasbridge_version" in data
            assert "python_version" in data

    def test_redaction(self):
        from atlasbridge.cli._debug import _redact_text

        text = "bot_token = 1234567890:ABCDEFghijklmnopqrstuvwxyz0123456789a"
        result = _redact_text(text)
        assert "<REDACTED>" in result
        assert "ABCDEFghijklmnopqrstuvwxyz" not in result

    def test_redact_dict(self):
        from atlasbridge.cli._debug import _redact_dict

        d = {
            "bot_token": "1234567890:ABCDEFghijklmnopqrstuvwxyz0123456789a",
            "name": "test",
            "nested": {"api_key": "sk-secret123"},
        }
        result = _redact_dict(d)
        assert result["bot_token"] == "<REDACTED>"
        assert result["name"] == "test"
        assert result["nested"]["api_key"] == "<REDACTED>"

    def test_no_redact_preserves_tokens(self):
        from atlasbridge.cli._debug import _redact_dict

        d = {"name": "my-bot", "value": "safe-text"}
        result = _redact_dict(d)
        assert result["name"] == "my-bot"
        assert result["value"] == "safe-text"

    def test_default_output_path(self, tmp_path, monkeypatch):
        from atlasbridge.cli._debug import cmd_debug_bundle
        from atlasbridge.core.exceptions import ConfigNotFoundError

        console, buf = _make_console()
        monkeypatch.chdir(tmp_path)

        with patch("atlasbridge.core.config.load_config") as mock_cfg:
            mock_cfg.side_effect = ConfigNotFoundError("no config")
            cmd_debug_bundle(output="", include_logs=10, redact=True, console=console)

        output = buf.getvalue()
        assert "atlasbridge-debug-" in output
        bundles = list(tmp_path.glob("atlasbridge-debug-*.tar.gz"))
        assert len(bundles) == 1

    def test_output_message_redacted(self, tmp_path):
        from atlasbridge.cli._debug import cmd_debug_bundle
        from atlasbridge.core.exceptions import ConfigNotFoundError

        console, buf = _make_console()
        output = str(tmp_path / "test-bundle.tar.gz")

        with patch("atlasbridge.core.config.load_config") as mock_cfg:
            mock_cfg.side_effect = ConfigNotFoundError("no config")
            cmd_debug_bundle(output=output, include_logs=10, redact=True, console=console)

        text = buf.getvalue()
        assert "redacted" in text

    def test_output_message_no_redact(self, tmp_path):
        from atlasbridge.cli._debug import cmd_debug_bundle
        from atlasbridge.core.exceptions import ConfigNotFoundError

        console, buf = _make_console()
        output = str(tmp_path / "test-bundle.tar.gz")

        with patch("atlasbridge.core.config.load_config") as mock_cfg:
            mock_cfg.side_effect = ConfigNotFoundError("no config")
            cmd_debug_bundle(output=output, include_logs=10, redact=False, console=console)

        text = buf.getvalue()
        assert "NOT redacted" in text
