"""Unit tests for cloud disabled mode safety."""

from __future__ import annotations

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
