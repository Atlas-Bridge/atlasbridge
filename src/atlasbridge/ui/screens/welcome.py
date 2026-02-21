"""
WelcomeScreen — the first screen users see.

Widget tree::

    #welcome-root  (Static — outer scroll container)
      #welcome-grid  (Static — two-column grid when configured)
        #brand-header   (Label)
        #brand-tagline  (Label)
        #status-cards   (StatusCards — only when configured)
        #welcome-body   (Static — first-run copy OR configured quick-actions)
      #welcome-footer-tip  (Label)

Keybindings:
  s  — open Setup Wizard
  d  — open Doctor screen
  r  — run a tool (notify if not configured)
  q  — quit
  esc — quit
  ?   — show help
"""

from __future__ import annotations

from textual.app import ComposeResult
from textual.binding import Binding
from textual.screen import Screen
from textual.widgets import Footer, Header, Label, Static


class WelcomeScreen(Screen):  # type: ignore[type-arg]
    """Welcome screen and quick-action hub."""

    BINDINGS = [
        Binding("s", "setup", "Setup", show=True),
        Binding("d", "doctor", "Doctor", show=True),
        Binding("r", "run_tool", "Run tool", show=False),
        Binding("l", "sessions", "Sessions", show=False),
        Binding("q", "app.quit", "Quit", show=True),
        Binding("escape", "app.quit", "Quit", show=False),
        Binding("question_mark", "show_help", "Help", show=False),
    ]

    # ------------------------------------------------------------------
    # Compose
    # ------------------------------------------------------------------

    def compose(self) -> ComposeResult:
        from atlasbridge.tui.services import ConfigService, DaemonService

        self._app_state = ConfigService.load_state()
        self._daemon_status = DaemonService.get_status()

        yield Header(show_clock=True)

        with Static(id="welcome-root"):
            with Static(id="welcome-grid"):
                yield Label("AtlasBridge", id="brand-header")
                yield Label(
                    "Human-in-the-loop control plane for AI developer agents",
                    id="brand-tagline",
                )

                if self._app_state.is_configured:
                    from atlasbridge.ui.components.status_cards import StatusCards

                    yield StatusCards(self._app_state)
                    yield self._configured_body()
                else:
                    yield self._first_run_body()

            yield Label(
                "Prefer the CLI? Run `atlasbridge setup --help` for non-interactive setup.",
                id="welcome-footer-tip",
            )

        yield Footer()

    # ------------------------------------------------------------------
    # Body helpers
    # ------------------------------------------------------------------

    def _first_run_body(self) -> Static:
        text = (
            "You're not set up yet. Let's fix that.\n\n"
            "AtlasBridge keeps your AI CLI sessions moving when they pause for input.\n"
            "When your agent asks a question, AtlasBridge forwards it to your phone\n"
            "(Telegram or Slack). You reply there — AtlasBridge resumes the CLI.\n\n"
            "Setup takes ~2 minutes:\n"
            "  1) Choose a channel (Telegram or Slack)\n"
            "  2) Add your credentials (kept local, never uploaded)\n"
            "  3) Allowlist your user ID(s)\n"
            "  4) Run a quick health check\n\n"
            "  [S] Setup AtlasBridge  (recommended)\n"
            "  [D] Run Doctor         (check environment)\n"
            "  [Q] Quit"
        )
        return Static(text, id="welcome-body")

    def _configured_body(self) -> Static:
        from atlasbridge.tui.state import DaemonStatus

        daemon_line = "Running" if self._daemon_status == DaemonStatus.RUNNING else "Not running"
        channel_line = self._app_state.channel_summary or "none configured"

        text = (
            "AtlasBridge is ready.\n\n"
            f"  Config:           Loaded\n"
            f"  Daemon:           {daemon_line}\n"
            f"  Channel:          {channel_line}\n"
            f"  Sessions:         {self._app_state.session_count}\n"
            f"  Pending prompts:  {self._app_state.pending_prompt_count}\n\n"
            "  [R] Run a tool      [S] Sessions\n"
            "  [L] Logs (tail)     [D] Doctor\n"
            "  [Q] Quit"
        )
        return Static(text, id="welcome-body")

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------

    def action_setup(self) -> None:
        from atlasbridge.ui.screens.wizard import SetupWizardScreen

        self.app.push_screen(SetupWizardScreen())

    def action_doctor(self) -> None:
        from atlasbridge.ui.screens.doctor import DoctorScreen

        self.app.push_screen(DoctorScreen())

    def action_run_tool(self) -> None:
        if not self._app_state.is_configured:
            self.notify("Run `atlasbridge setup` first.", severity="warning")
            return
        self.notify("Use `atlasbridge run claude` in your terminal.", severity="information")

    def action_sessions(self) -> None:
        from atlasbridge.ui.screens.sessions import SessionsScreen

        self.app.push_screen(SessionsScreen())

    def action_show_help(self) -> None:
        self.notify(
            "s=Setup  d=Doctor  r=Run  l=Sessions  q=Quit",
            title="Keyboard shortcuts",
            severity="information",
            timeout=6,
        )
