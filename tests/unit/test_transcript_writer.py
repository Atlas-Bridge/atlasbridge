"""Unit tests for TranscriptWriter."""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest

from atlasbridge.core.store.transcript import TranscriptWriter


@pytest.fixture()
def mock_db():
    db = MagicMock()
    db.save_transcript_chunk = MagicMock()
    return db


@pytest.fixture()
def writer(mock_db):
    return TranscriptWriter(mock_db, session_id="sess-001", flush_interval=0.1)


class TestFeed:
    def test_feed_plain_text(self, writer, mock_db):
        writer.feed(b"Hello, world!")
        assert len(writer._buffer) == 1

    def test_feed_empty_ignored(self, writer):
        writer.feed(b"")
        assert len(writer._buffer) == 0

    def test_feed_whitespace_only_ignored(self, writer):
        writer.feed(b"   \n  ")
        assert len(writer._buffer) == 0

    def test_feed_strips_ansi(self, writer):
        writer.feed(b"\x1b[32mGreen text\x1b[0m")
        assert len(writer._buffer) == 1
        assert "\x1b" not in writer._buffer[0]


class TestRecordInput:
    def test_record_input_saves_immediately(self, writer, mock_db):
        writer.record_input("yes", prompt_id="p-001")
        mock_db.save_transcript_chunk.assert_called_once()
        call_kwargs = mock_db.save_transcript_chunk.call_args
        assert call_kwargs[1]["role"] == "user"
        assert call_kwargs[1]["content"] == "yes"
        assert call_kwargs[1]["prompt_id"] == "p-001"
        assert call_kwargs[1]["session_id"] == "sess-001"

    def test_record_input_increments_seq(self, writer, mock_db):
        writer.record_input("first")
        writer.record_input("second")
        calls = mock_db.save_transcript_chunk.call_args_list
        assert calls[0][1]["seq"] == 1
        assert calls[1][1]["seq"] == 2


class TestFlush:
    @pytest.mark.asyncio()
    async def test_flush_writes_merged_buffer(self, writer, mock_db):
        writer.feed(b"Hello ")
        writer.feed(b"world")
        await writer._flush()
        mock_db.save_transcript_chunk.assert_called_once()
        call_kwargs = mock_db.save_transcript_chunk.call_args
        assert "Hello" in call_kwargs[1]["content"]
        assert "world" in call_kwargs[1]["content"]
        assert call_kwargs[1]["role"] == "agent"

    @pytest.mark.asyncio()
    async def test_flush_empty_noop(self, writer, mock_db):
        await writer._flush()
        mock_db.save_transcript_chunk.assert_not_called()

    @pytest.mark.asyncio()
    async def test_flush_clears_buffer(self, writer, mock_db):
        writer.feed(b"data")
        await writer._flush()
        assert len(writer._buffer) == 0
        assert writer._buffer_chars == 0

    @pytest.mark.asyncio()
    async def test_flush_truncates_large_content(self, writer, mock_db):
        writer.feed(b"x" * 10_000)
        await writer._flush()
        call_kwargs = mock_db.save_transcript_chunk.call_args
        content = call_kwargs[1]["content"]
        assert len(content) <= 8_020  # 8000 + truncation marker


class TestFlushLoop:
    @pytest.mark.asyncio()
    async def test_flush_loop_cancellation(self, writer, mock_db):
        writer.feed(b"pending data")
        task = asyncio.create_task(writer.flush_loop())
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        # Final flush on cancellation should write the pending data
        assert mock_db.save_transcript_chunk.called


class TestBufferCap:
    def test_buffer_compaction(self, writer):
        # Feed more than 16KB
        for _ in range(200):
            writer.feed(b"x" * 100)
        assert writer._buffer_chars <= 16_384 + 100  # within cap + one chunk tolerance
