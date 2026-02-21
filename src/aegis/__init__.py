"""
Aegis — Universal Human-in-the-Loop Control Plane for AI Developer Agents.

Aegis sits between you and your AI coding agent. Whenever your agent pauses
and requires human input — approval, confirmation, a choice, or clarification —
Aegis forwards that prompt to your phone. You respond from your phone. Aegis
relays your decision back to the CLI. Execution resumes.

Package layout (src/aegis/):
  core/       — daemon, scheduler, session, prompt, routing, store, audit
  os/tty/     — PTY/ConPTY supervisor per platform
  adapters/   — CLI tool adapters (Claude Code, OpenAI, ...)
  channels/   — notification channels (Telegram, Slack, ...)
  cli/        — Click CLI entry point
"""

__version__ = "0.3.0-dev"
__all__ = ["__version__"]
