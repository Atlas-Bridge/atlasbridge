"""
Daemon manager.

The DaemonManager orchestrates all top-level Aegis components for one
daemon process lifetime:
  - Loads configuration
  - Connects to the database
  - Starts the notification channel
  - Manages sessions and the prompt router
  - Runs the reply consumer loop
  - Handles graceful shutdown on SIGTERM/SIGINT

The daemon is a long-running asyncio process started by `aegis start`
and managed by launchd (macOS) or systemd (Linux).

PID file: ~/.aegis/aegis.pid
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_DEFAULT_DATA_DIR = Path.home() / ".aegis"


class DaemonManager:
    """
    Top-level orchestrator for the Aegis daemon.

    Lifecycle::

        manager = DaemonManager(config)
        await manager.start()    # blocks until shutdown signal
        await manager.stop()
    """

    def __init__(self, config: dict[str, Any]) -> None:
        self._config = config
        self._data_dir = Path(config.get("data_dir", str(_DEFAULT_DATA_DIR)))
        self._db = None
        self._channel = None
        self._session_manager = None
        self._router = None
        self._adapters: dict[str, Any] = {}
        self._running = False
        self._shutdown_event = asyncio.Event()

    async def start(self) -> None:
        """Start all subsystems and run until shutdown."""
        logger.info("Aegis daemon starting")
        self._write_pid_file()

        try:
            await self._init_database()
            await self._reload_pending_prompts()
            await self._init_channel()
            await self._init_session_manager()
            await self._init_router()

            self._running = True
            self._setup_signal_handlers()

            logger.info("Aegis daemon ready")
            await self._run_loop()

        finally:
            await self._cleanup()
            self._remove_pid_file()
            logger.info("Aegis daemon stopped")

    async def stop(self) -> None:
        """Request graceful shutdown."""
        self._shutdown_event.set()

    # ------------------------------------------------------------------
    # Initialisation
    # ------------------------------------------------------------------

    async def _init_database(self) -> None:
        from aegis.core.store.database import Database

        db_path = self._data_dir / "aegis.db"
        self._db = Database(db_path)
        self._db.connect()
        logger.info("Database connected: %s", db_path)

    async def _reload_pending_prompts(self) -> None:
        """On restart, reload pending prompts from the database."""
        if self._db is None:
            return
        pending = self._db.list_pending_prompts()
        if pending:
            logger.info(
                "Daemon restarted with %d pending prompt(s) — will renotify",
                len(pending),
            )
        # TODO: renotify via channel after channel is initialised

    async def _init_channel(self) -> None:
        channel_config = self._config.get("channels", {})
        telegram_cfg = channel_config.get("telegram", {})

        if not telegram_cfg:
            logger.warning("No channel configured — prompts will not be routed")
            return

        from aegis.channels.telegram.channel import TelegramChannel

        self._channel = TelegramChannel(
            bot_token=telegram_cfg["bot_token"],
            allowed_user_ids=telegram_cfg.get("allowed_user_ids", []),
        )
        await self._channel.start()

    async def _init_session_manager(self) -> None:
        from aegis.core.session.manager import SessionManager

        self._session_manager = SessionManager()

    async def _init_router(self) -> None:
        if self._session_manager is None or self._channel is None:
            return
        from aegis.core.routing.router import PromptRouter

        self._router = PromptRouter(
            session_manager=self._session_manager,
            channel=self._channel,
            adapter_map=self._adapters,
            store=self._db,
        )

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    async def _run_loop(self) -> None:
        """Run the reply consumer and TTL sweeper until shutdown."""
        tasks = []
        if self._channel and self._router:
            tasks.append(asyncio.create_task(self._reply_consumer(), name="reply_consumer"))
        tasks.append(asyncio.create_task(self._ttl_sweeper(), name="ttl_sweeper"))

        await self._shutdown_event.wait()

        for t in tasks:
            t.cancel()

    async def _reply_consumer(self) -> None:
        """Consume replies from the channel and hand them to the router."""
        assert self._channel is not None
        assert self._router is not None
        async for reply in self._channel.receive_replies():
            try:
                await self._router.handle_reply(reply)
            except Exception as exc:  # noqa: BLE001
                logger.error("Reply handling error: %s", exc)

    async def _ttl_sweeper(self) -> None:
        """Periodically expire overdue prompts."""
        while self._running:
            await asyncio.sleep(10.0)
            if self._router:
                await self._router.expire_overdue()

    # ------------------------------------------------------------------
    # Signal handling
    # ------------------------------------------------------------------

    def _setup_signal_handlers(self) -> None:
        loop = asyncio.get_event_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, lambda: asyncio.create_task(self.stop()))

    # ------------------------------------------------------------------
    # PID file
    # ------------------------------------------------------------------

    def _write_pid_file(self) -> None:
        pid_file = self._data_dir / "aegis.pid"
        self._data_dir.mkdir(parents=True, exist_ok=True)
        pid_file.write_text(str(os.getpid()))

    def _remove_pid_file(self) -> None:
        pid_file = self._data_dir / "aegis.pid"
        pid_file.unlink(missing_ok=True)

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    async def _cleanup(self) -> None:
        self._running = False
        if self._channel:
            await self._channel.close()
        if self._db:
            self._db.close()
