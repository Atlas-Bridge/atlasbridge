"""
AtlasBridge UI — Textual application shell.

Launched by ``atlasbridge`` (no args, TTY) or ``atlasbridge ui``.
"""

from __future__ import annotations

from pathlib import Path

from textual.app import App, ComposeResult
from textual.binding import Binding

from atlasbridge import __version__


class AtlasBridgeApp(App):  # type: ignore[type-arg]
    """AtlasBridge interactive terminal UI."""

    TITLE = f"AtlasBridge {__version__}"
    CSS_PATH = str(Path(__file__).parent / "css" / "atlasbridge.tcss")

    BINDINGS = [
        Binding("ctrl+c", "app.quit", "Quit", show=False, priority=True),
        Binding("q", "app.quit", "Quit", show=False),
    ]

    def compose(self) -> ComposeResult:
        # The welcome screen is pushed in on_mount; compose yields nothing here.
        return iter([])

    def on_mount(self) -> None:
        from atlasbridge.ui.screens.welcome import WelcomeScreen

        self.push_screen(WelcomeScreen())


def run() -> None:
    """Entry point called from the CLI."""
    AtlasBridgeApp().run()
