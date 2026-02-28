"""
SetupCompleteScreen — shown after the wizard saves config successfully.

Widget tree::

    Header
    #complete-root  (Static)
      #complete-body  (Static — success copy with channel / user count / config path)
    Footer

Keybindings:
  q / escape — return to welcome screen
"""

from __future__ import annotations

from textual.app import ComposeResult
from textual.binding import Binding
from textual.screen import Screen
from textual.widgets import Footer, Header, Static


class SetupCompleteScreen(Screen):
    """Confirmation screen shown after a successful wizard run."""

    BINDINGS = [
        Binding("q", "app.pop_screen", "Done", show=True),
        Binding("escape", "app.pop_screen", "Done", show=False),
    ]

    def __init__(self, channel: str = "", user_count: int = 0) -> None:
        super().__init__()
        self._channel = channel
        self._user_count = user_count

    def compose(self) -> ComposeResult:
        cfg_path = ""
        try:
            from atlasbridge.core.config import atlasbridge_dir

            cfg_path = str(atlasbridge_dir() / "config.toml")
        except Exception:  # noqa: BLE001
            pass

        text = (
            "✓  Setup complete!\n\n"
            f"  Config path:       {cfg_path or '~/.atlasbridge/config.toml'}\n\n"
            "Next steps:\n"
            "  • Run `atlasbridge run claude` to supervise Claude Code\n"
            "  • Run `atlasbridge doctor` to verify your environment\n\n"
            "  [Q] Done"
        )

        yield Header(show_clock=False)
        with Static(id="complete-root"):
            yield Static(text, id="complete-body")
        yield Footer()
