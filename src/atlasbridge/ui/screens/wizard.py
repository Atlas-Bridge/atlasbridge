"""
SetupWizardScreen — simplified setup flow (channels removed).

Widget tree::

    Header
    #wizard-root  (Container)
      #wizard-title       (Label)
      #wizard-step        (Container — confirm step)
      .wizard-nav         (Container — Finish button)
    Footer
"""

from __future__ import annotations

from textual.app import ComposeResult
from textual.binding import Binding
from textual.containers import Container
from textual.screen import Screen
from textual.widgets import (
    Button,
    Footer,
    Header,
    Label,
)

from atlasbridge.ui.state import WizardState


class SetupWizardScreen(Screen):
    """Setup wizard — creates a minimal config."""

    BINDINGS = [
        Binding("enter", "finish", "Finish", show=False),
        Binding("escape", "cancel", "Cancel", show=True),
    ]

    def __init__(self) -> None:
        super().__init__()
        self._wizard = WizardState()

    def compose(self) -> ComposeResult:
        yield Header(show_clock=False)
        with Container(id="wizard-root"):
            yield Label("AtlasBridge Setup", id="wizard-title")
            with Container(id="wizard-step"):
                yield Label(
                    "AtlasBridge will create a configuration file.\n\n"
                    "Press Finish to save and start using AtlasBridge.\n\n"
                    "You can configure LLM providers and other settings later\n"
                    "via the dashboard or by editing the config file directly.",
                    classes="step-title",
                )
            yield Label("", id="wizard-error", classes="wizard-error")
            with Container(classes="wizard-nav"):
                yield Button("Finish", id="btn-finish", variant="success")
        yield Footer()

    async def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "btn-finish":
            self._do_finish()

    def _do_finish(self) -> None:
        try:
            from atlasbridge.ui.services import ConfigService

            ConfigService.save(self._wizard.build_config_data())
            from atlasbridge.ui.screens.complete import SetupCompleteScreen

            self.app.switch_screen(SetupCompleteScreen())
        except Exception as exc:  # noqa: BLE001
            try:
                self.query_one("#wizard-error", Label).update(f"Failed to save: {exc}")
            except Exception:  # noqa: BLE001
                self.notify(f"Failed to save: {exc}", severity="error")

    async def action_finish(self) -> None:
        self._do_finish()

    async def action_cancel(self) -> None:
        self.app.pop_screen()
