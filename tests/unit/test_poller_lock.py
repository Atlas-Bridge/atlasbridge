"""
Tests for PollerLock and TelegramChannel singleton polling.

Covers:
  - Lock acquisition/release lifecycle
  - Second process cannot acquire held lock
  - Stale lock detection and cleanup
  - TelegramChannel starts in send-only mode when lock is held
  - TelegramChannel stops polling on 409 Conflict
  - TelegramConflictError raised by _api on 409
"""

from __future__ import annotations

import asyncio
import os

import pytest

from atlasbridge.core.poller_lock import PollerLock, _token_hash, check_stale_lock

_TOKEN = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi"


# ---------------------------------------------------------------------------
# PollerLock unit tests
# ---------------------------------------------------------------------------


class TestPollerLock:
    def test_token_hash_is_stable(self) -> None:
        h1 = _token_hash(_TOKEN)
        h2 = _token_hash(_TOKEN)
        assert h1 == h2
        assert len(h1) == 16

    def test_different_tokens_different_hashes(self) -> None:
        h1 = _token_hash("token-A")
        h2 = _token_hash("token-B")
        assert h1 != h2

    def test_acquire_and_release(self, tmp_path) -> None:
        lock = PollerLock(_TOKEN, locks_dir=tmp_path)
        assert lock.acquire() is True
        assert lock.acquired is True
        assert lock.holder_pid == os.getpid()
        lock.release()
        assert lock.acquired is False

    def test_second_acquire_fails(self, tmp_path) -> None:
        lock1 = PollerLock(_TOKEN, locks_dir=tmp_path)
        lock2 = PollerLock(_TOKEN, locks_dir=tmp_path)
        assert lock1.acquire() is True
        assert lock2.acquire() is False
        assert lock2.acquired is False
        lock1.release()

    def test_release_allows_reacquire(self, tmp_path) -> None:
        lock1 = PollerLock(_TOKEN, locks_dir=tmp_path)
        assert lock1.acquire() is True
        lock1.release()
        lock2 = PollerLock(_TOKEN, locks_dir=tmp_path)
        assert lock2.acquire() is True
        lock2.release()

    def test_different_tokens_independent(self, tmp_path) -> None:
        lock_a = PollerLock("token-A", locks_dir=tmp_path)
        lock_b = PollerLock("token-B", locks_dir=tmp_path)
        assert lock_a.acquire() is True
        assert lock_b.acquire() is True
        lock_a.release()
        lock_b.release()

    def test_lock_file_contains_pid(self, tmp_path) -> None:
        lock = PollerLock(_TOKEN, locks_dir=tmp_path)
        lock.acquire()
        text = lock.lock_path.read_text().strip()
        assert text == str(os.getpid())
        lock.release()

    def test_lock_file_cleaned_on_release(self, tmp_path) -> None:
        lock = PollerLock(_TOKEN, locks_dir=tmp_path)
        lock.acquire()
        assert lock.lock_path.exists()
        lock.release()
        assert not lock.lock_path.exists()

    def test_holder_pid_returns_none_when_no_file(self, tmp_path) -> None:
        lock = PollerLock(_TOKEN, locks_dir=tmp_path)
        assert lock.holder_pid is None


# ---------------------------------------------------------------------------
# check_stale_lock
# ---------------------------------------------------------------------------


class TestCheckStaleLock:
    def test_no_lock_file(self, tmp_path) -> None:
        result = check_stale_lock(_TOKEN, locks_dir=tmp_path)
        assert result["status"] == "pass"
        assert "no lock file" in result["detail"]

    def test_live_process_lock(self, tmp_path) -> None:
        lock = PollerLock(_TOKEN, locks_dir=tmp_path)
        lock.acquire()
        result = check_stale_lock(_TOKEN, locks_dir=tmp_path)
        assert result["status"] == "pass"
        assert str(os.getpid()) in result["detail"]
        lock.release()

    def test_stale_lock_cleaned(self, tmp_path) -> None:
        # Write a lock file with a dead PID
        lock_path = tmp_path / f"telegram-{_token_hash(_TOKEN)}.lock"
        lock_path.write_text("999999999")  # hopefully not a real PID
        result = check_stale_lock(_TOKEN, locks_dir=tmp_path)
        assert result["status"] == "warn"
        assert "stale" in result["detail"]
        assert not lock_path.exists()  # cleaned up


# ---------------------------------------------------------------------------
# TelegramChannel polling / lock integration
# ---------------------------------------------------------------------------


class TestTelegramChannelPollerLock:
    def test_channel_starts_polling_when_lock_free(self, tmp_path) -> None:
        from atlasbridge.channels.telegram.channel import TelegramChannel

        ch = TelegramChannel(bot_token=_TOKEN, allowed_user_ids=[123], locks_dir=tmp_path)
        asyncio.get_event_loop().run_until_complete(ch.start())
        assert ch._polling is True
        assert ch._poller_lock is not None
        assert ch._poller_lock.acquired is True
        asyncio.get_event_loop().run_until_complete(ch.close())

    def test_channel_send_only_when_lock_held(self, tmp_path) -> None:
        from atlasbridge.channels.telegram.channel import TelegramChannel

        # Another "process" holds the lock
        blocker = PollerLock(_TOKEN, locks_dir=tmp_path)
        assert blocker.acquire() is True

        ch = TelegramChannel(bot_token=_TOKEN, allowed_user_ids=[123], locks_dir=tmp_path)
        asyncio.get_event_loop().run_until_complete(ch.start())
        assert ch._polling is False  # send-only
        assert ch._running is True  # still running (can send messages)
        asyncio.get_event_loop().run_until_complete(ch.close())
        blocker.release()

    def test_healthcheck_shows_polling_status(self, tmp_path) -> None:
        from atlasbridge.channels.telegram.channel import TelegramChannel

        ch = TelegramChannel(bot_token=_TOKEN, allowed_user_ids=[123], locks_dir=tmp_path)
        asyncio.get_event_loop().run_until_complete(ch.start())
        hc = ch.healthcheck()
        assert hc["polling"] is True
        asyncio.get_event_loop().run_until_complete(ch.close())

    def test_close_releases_lock(self, tmp_path) -> None:
        from atlasbridge.channels.telegram.channel import TelegramChannel

        ch = TelegramChannel(bot_token=_TOKEN, allowed_user_ids=[123], locks_dir=tmp_path)
        asyncio.get_event_loop().run_until_complete(ch.start())
        assert ch._poller_lock.acquired is True
        asyncio.get_event_loop().run_until_complete(ch.close())
        assert ch._poller_lock is None

        # A new lock should be acquirable
        lock2 = PollerLock(_TOKEN, locks_dir=tmp_path)
        assert lock2.acquire() is True
        lock2.release()


# ---------------------------------------------------------------------------
# 409 Conflict handling
# ---------------------------------------------------------------------------


class TestTelegram409:
    @pytest.mark.asyncio
    async def test_api_raises_conflict_error(self, tmp_path) -> None:
        from unittest.mock import AsyncMock, MagicMock

        from atlasbridge.channels.telegram.channel import (
            TelegramChannel,
            TelegramConflictError,
        )

        ch = TelegramChannel(bot_token=_TOKEN, allowed_user_ids=[123], locks_dir=tmp_path)
        # Mock the httpx client
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "ok": False,
            "error_code": 409,
            "description": "Conflict: terminated by other getUpdates request; "
            "make sure that only one bot instance is running",
        }
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        ch._client = mock_client

        with pytest.raises(TelegramConflictError):
            await ch._api(
                "getUpdates",
                {"offset": 0, "timeout": 30, "allowed_updates": ["message"]},
            )

    @pytest.mark.asyncio
    async def test_poll_loop_stops_on_409(self, tmp_path) -> None:
        from unittest.mock import AsyncMock, MagicMock

        from atlasbridge.channels.telegram.channel import TelegramChannel

        ch = TelegramChannel(bot_token=_TOKEN, allowed_user_ids=[123], locks_dir=tmp_path)
        await ch.start()
        assert ch._polling is True

        # Replace the client to return 409
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "ok": False,
            "error_code": 409,
            "description": "Conflict: terminated by other getUpdates request; "
            "make sure that only one bot instance is running",
        }
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client.aclose = AsyncMock()

        # Close the real client first
        if ch._client:
            await ch._client.aclose()
        ch._client = mock_client

        # Let the poll loop run and hit the 409
        await asyncio.sleep(0.5)

        # Poll loop should have stopped
        assert ch._polling is False
        await ch.close()

    @pytest.mark.asyncio
    async def test_non_409_error_does_not_raise_conflict(self, tmp_path) -> None:
        from unittest.mock import AsyncMock, MagicMock

        from atlasbridge.channels.telegram.channel import TelegramChannel

        ch = TelegramChannel(bot_token=_TOKEN, allowed_user_ids=[123], locks_dir=tmp_path)
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "ok": False,
            "error_code": 400,
            "description": "Bad Request: some other error",
        }
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        ch._client = mock_client

        # Should not raise, just return None
        result = await ch._api("getUpdates", {"offset": 0})
        assert result is None
