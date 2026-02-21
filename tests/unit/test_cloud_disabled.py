"""Unit tests for cloud disabled mode safety.

Tests that verify:
- Cloud module defaults to disabled (no network calls)
- All disabled stubs return safe no-op values
- No HTTP libraries are imported in the cloud module
- Protocol spec constants are correct
"""

from __future__ import annotations

import ast
import importlib
from pathlib import Path

import pytest

from atlasbridge.cloud import CloudConfig, is_cloud_enabled
from atlasbridge.cloud.audit_stream import DisabledAuditStream
from atlasbridge.cloud.auth import DisabledAuthProvider
from atlasbridge.cloud.registry import DisabledPolicyRegistry
from atlasbridge.cloud.transport import DisabledTransport


class TestCloudConfig:
    def test_disabled_by_default(self) -> None:
        config = CloudConfig()
        assert config.enabled is False
        assert config.endpoint == ""
        assert config.control_channel == "disabled"
        assert config.stream_audit is False

    def test_is_cloud_enabled_false_when_none(self) -> None:
        assert is_cloud_enabled(None) is False

    def test_is_cloud_enabled_false_when_disabled(self) -> None:
        config = CloudConfig(enabled=False)
        assert is_cloud_enabled(config) is False

    def test_is_cloud_enabled_false_when_no_endpoint(self) -> None:
        config = CloudConfig(enabled=True, endpoint="")
        assert is_cloud_enabled(config) is False

    def test_is_cloud_enabled_true_when_configured(self) -> None:
        config = CloudConfig(enabled=True, endpoint="https://api.example.com")
        assert is_cloud_enabled(config) is True


class TestDisabledPolicyRegistry:
    @pytest.mark.asyncio
    async def test_pull_returns_none(self) -> None:
        reg = DisabledPolicyRegistry()
        result = await reg.pull_policy("org-1", "policy-1")
        assert result is None

    @pytest.mark.asyncio
    async def test_push_returns_false(self) -> None:
        reg = DisabledPolicyRegistry()
        result = await reg.push_policy("org-1", "policy-1", "yaml: content")
        assert result is False

    @pytest.mark.asyncio
    async def test_verify_returns_false(self) -> None:
        reg = DisabledPolicyRegistry()
        result = await reg.verify_signature({"data": "test"})
        assert result is False


class TestDisabledAuditStream:
    @pytest.mark.asyncio
    async def test_stream_returns_false(self) -> None:
        stream = DisabledAuditStream()
        result = await stream.stream_entry({"key": "value"})
        assert result is False

    @pytest.mark.asyncio
    async def test_flush_returns_zero(self) -> None:
        stream = DisabledAuditStream()
        result = await stream.flush()
        assert result == 0

    @pytest.mark.asyncio
    async def test_close_succeeds(self) -> None:
        stream = DisabledAuditStream()
        await stream.close()  # Should not raise


class TestDisabledAuthProvider:
    def test_runtime_id_empty(self) -> None:
        auth = DisabledAuthProvider()
        assert auth.get_runtime_id() == ""

    def test_sign_returns_empty(self) -> None:
        auth = DisabledAuthProvider()
        assert auth.sign(b"test") == b""

    def test_verify_returns_false(self) -> None:
        auth = DisabledAuthProvider()
        assert auth.verify(b"msg", b"sig", b"key") is False

    def test_api_token_empty(self) -> None:
        auth = DisabledAuthProvider()
        assert auth.get_api_token() == ""


class TestDisabledTransport:
    @pytest.mark.asyncio
    async def test_connect_returns_false(self) -> None:
        transport = DisabledTransport()
        result = await transport.connect("wss://example.com", "runtime-1")
        assert result is False

    @pytest.mark.asyncio
    async def test_send_returns_false(self) -> None:
        transport = DisabledTransport()
        result = await transport.send({"type": "heartbeat"})
        assert result is False

    @pytest.mark.asyncio
    async def test_receive_returns_none(self) -> None:
        transport = DisabledTransport()
        result = await transport.receive()
        assert result is None

    def test_is_connected_false(self) -> None:
        transport = DisabledTransport()
        assert transport.is_connected() is False

    @pytest.mark.asyncio
    async def test_disconnect_succeeds(self) -> None:
        transport = DisabledTransport()
        await transport.disconnect()  # Should not raise


# ---------------------------------------------------------------------------
# Network isolation guard — ensures cloud module has zero HTTP dependencies
# ---------------------------------------------------------------------------

_BANNED_MODULES = {"httpx", "requests", "aiohttp", "urllib3"}


class TestCloudNetworkIsolation:
    """Guard tests that the cloud module never imports HTTP libraries."""

    def _get_cloud_source_files(self) -> list[Path]:
        cloud_pkg = importlib.import_module("atlasbridge.cloud")
        cloud_dir = Path(cloud_pkg.__file__).parent
        return list(cloud_dir.glob("*.py"))

    def test_no_http_imports_in_cloud_module(self) -> None:
        """Scan all cloud/*.py files for banned HTTP library imports."""
        for py_file in self._get_cloud_source_files():
            source = py_file.read_text()
            tree = ast.parse(source, filename=str(py_file))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        root = alias.name.split(".")[0]
                        assert root not in _BANNED_MODULES, (
                            f"{py_file.name} imports banned module '{alias.name}'"
                        )
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        root = node.module.split(".")[0]
                        assert root not in _BANNED_MODULES, (
                            f"{py_file.name} imports from banned module '{node.module}'"
                        )

    def test_cloud_module_files_exist(self) -> None:
        """Verify all expected cloud module files are present."""
        files = {f.name for f in self._get_cloud_source_files()}
        expected = {
            "__init__.py",
            "auth.py",
            "transport.py",
            "client.py",
            "protocol.py",
            "registry.py",
            "audit_stream.py",
        }
        assert expected.issubset(files), f"Missing cloud files: {expected - files}"


class TestProtocolSpec:
    """Verify protocol specification constants are sensible."""

    def test_protocol_version(self) -> None:
        from atlasbridge.cloud.protocol import ProtocolSpec

        spec = ProtocolSpec()
        assert spec.version == "1.0"
        assert spec.transport == "wss"
        assert spec.encoding == "json"
        assert spec.signature_algorithm == "Ed25519"

    def test_message_types_exist(self) -> None:
        from atlasbridge.cloud.protocol import MessageType

        # Runtime → Cloud
        assert MessageType.HEARTBEAT == "heartbeat"
        assert MessageType.SESSION_STARTED == "session_started"
        assert MessageType.DECISION_MADE == "decision_made"
        # Cloud → Runtime (advisory)
        assert MessageType.POLICY_UPDATE_AVAILABLE == "policy_update_available"
        assert MessageType.KILL_SWITCH == "kill_switch"

    def test_control_message_fields(self) -> None:
        from atlasbridge.cloud.protocol import ControlMessage, MessageType

        msg = ControlMessage(
            message_id="test-1",
            message_type=MessageType.HEARTBEAT,
            timestamp="2026-01-01T00:00:00Z",
            org_id="org-1",
            runtime_id="rt-1",
            sequence=1,
        )
        assert msg.payload == {}
        assert msg.signature == ""
