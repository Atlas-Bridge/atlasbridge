# Aegis (AegisCLI)

> **Universal human-in-the-loop control plane for AI developer agents.**

[![CI](https://github.com/abdulraoufatia/aegis-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/abdulraoufatia/aegis-cli/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue.svg)](https://www.python.org/)
[![Version](https://img.shields.io/badge/version-0.2.0--dev-green.svg)](CHANGELOG.md)

---

Aegis sits between you and your AI coding agent. Whenever your agent pauses and requires human input — approval, confirmation, a choice, or clarification — Aegis forwards that prompt to your phone.

You respond from your phone, from a channel such as Telegram or WhatsApp, Slack or others. Aegis relays your decision back to the CLI. Execution resumes.

No walking back to your desk. No missed prompts. You stay in control.

```
┌──────────────┐        ┌───────────────┐        ┌─────────────────┐
│  AI Agent    │──────► │     Aegis     │──────► │   Your Phone    │
│ (Claude CLI) │        │  Prompt Relay │        │   (Telegram)    │
│              │◄────── │               │◄────── │                 │
└──────────────┘        └───────────────┘        └─────────────────┘
   paused waiting           detects &                you reply
   for input                forwards prompt          from anywhere
```

---

## How it works

1. `aegis run claude` — wraps your AI CLI in a PTY supervisor
2. The **tri-signal prompt detector** watches the output stream
3. When a prompt is detected, Aegis sends it to your Telegram (or Slack)
4. You tap a button or send a reply on your phone
5. Aegis injects your answer into the CLI's stdin
6. The agent continues

That's it. Aegis is a relay, not a firewall. It does not interpret commands, score risks, or block actions. It asks you — and only you — at the exact moment the agent needs human input.

---

## Status

| Version | Status | Description |
|---------|--------|-------------|
| **v0.1.0** | Design release | Architecture, docs, and code stubs |
| **v0.2.0** | In progress | macOS MVP — working Telegram relay |
| v0.3.0 | Planned | Linux support |
| v0.4.0 | Planned | Slack channel |
| v0.5.0 | Planned | Windows (ConPTY, experimental) |

---

## Quick start (v0.2.0 target)

```bash
pip install aegis-cli

# First-time setup (creates ~/.aegis/config.toml)
aegis setup

# Wrap Claude Code
aegis run claude

# In another terminal, check status
aegis status
```

When Claude Code asks you a question, your Telegram bot will send you a message with buttons. Tap Yes or No. Claude Code answers and continues.

---

## Design

See the `docs/` directory:

| Document | What it covers |
|----------|---------------|
| [architecture.md](docs/architecture.md) | System diagram, component overview, sequence diagrams |
| [reliability.md](docs/reliability.md) | PTY supervisor, tri-signal detector, Prompt Lab |
| [adapters.md](docs/adapters.md) | BaseAdapter interface, Claude Code adapter |
| [channels.md](docs/channels.md) | BaseChannel interface, Telegram implementation |
| [cli-ux.md](docs/cli-ux.md) | All CLI commands, output formats, exit codes |
| [roadmap-90-days.md](docs/roadmap-90-days.md) | 6-phase roadmap, v0.2.0–v0.5.0 |
| [qa-top-20-failure-scenarios.md](docs/qa-top-20-failure-scenarios.md) | 20 mandatory QA scenarios |
| [dev-workflow-multi-agent.md](docs/dev-workflow-multi-agent.md) | Branch model, agent roles, CI pipeline |

---

## Repository structure

```
src/aegis/
  core/
    prompt/     — detector, state machine, models
    session/    — session manager and lifecycle
    routing/    — prompt router (events → channel, replies → PTY)
    store/      — SQLite database
    audit/      — append-only audit log with hash chaining
    daemon/     — daemon manager (orchestrates all subsystems)
    scheduler/  — TTL sweeper and periodic tasks
  os/tty/       — PTY supervisors (macOS, Linux, Windows stub)
  adapters/     — CLI tool adapters (Claude Code, OpenAI CLI, custom)
  channels/     — notification channels (Telegram, Slack stub)
  cli/          — Click CLI entry point and subcommands
tests/
  unit/         — pure unit tests (no I/O)
  integration/  — SQLite + mocked HTTP
  e2e/          — real PTY + mocked Telegram
  prompt_lab/   — deterministic QA scenario runner
    scenarios/  — QA-001 through QA-020 scenario implementations
docs/           — design documents (see table above)
```

---

## Core invariants

Aegis guarantees the following regardless of channel, adapter, or concurrency:

1. **No duplicate injection** — nonce idempotency via atomic SQL guard
2. **No expired injection** — TTL enforced in the database WHERE clause
3. **No cross-session injection** — prompt_id + session_id binding checked
4. **No unauthorised injection** — allowlisted identities only
5. **No echo loops** — 500ms suppression window after every injection
6. **No lost prompts** — daemon restart reloads pending prompts from SQLite
7. **Bounded memory** — rolling 4096-byte buffer, never unbounded growth

---

## Development

```bash
# Install in editable mode with dev dependencies
pip install -e ".[dev]"

# Run tests
pytest tests/

# Run a Prompt Lab scenario
aegis lab run partial-line-prompt

# Lint and format
ruff check . && ruff format --check .

# Type check
mypy src/aegis/

# Full CI equivalent (local)
ruff check . && ruff format --check . && mypy src/aegis/ && pytest tests/ --cov=aegis
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributions require:
- Existing tests to remain green
- New code to have unit tests
- Prompt Lab scenarios for any PTY/detection changes

---

## License

MIT — see [LICENSE](LICENSE).
