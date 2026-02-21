# CLAUDE.md — AtlasBridge Project Context

This file is read by Claude Code automatically. It provides project context for working on this codebase.

---

## What AtlasBridge is

AtlasBridge is the **universal control plane for autonomous AI developer agents**.

AtlasBridge sits between you and your AI coding agent. It detects every prompt your agent produces and decides what happens next — relay it to your phone, auto-reply per your policy, or deny it. You stay in control from anywhere.

**Two operating modes:**
- **Relay mode** (v0.2.0+) — every prompt forwarded to Telegram/Slack; you reply from your phone
- **Autopilot mode** (v0.6.0+) — a YAML policy defines which prompts to auto-handle, which to escalate, and which to deny; every decision is audited

**Three autonomy levels:** Off (pure relay), Assist (policy suggests, you confirm), Full (policy auto-replies, escalates the rest).

---

## What AtlasBridge is NOT

- Not a security product
- Not a CLI firewall
- Not a cloud service

---

## Core invariants (correctness, not security posture)

These exist to keep the relay working correctly:

1. **No duplicate injection** — nonce idempotency via atomic SQL guard (`decide_prompt()`)
2. **No expired injection** — TTL enforced in the database WHERE clause
3. **No cross-session injection** — prompt_id + session_id binding checked
4. **No unauthorised injection** — allowlisted channel identities only
5. **No echo loops** — 500ms suppression window after every injection
6. **No lost prompts** — daemon restart reloads pending prompts from SQLite
7. **Bounded memory** — rolling 4096-byte buffer, never unbounded growth

Do NOT frame these as "security features" in docs or code comments. They are correctness invariants.

---

## Repository layout

```
src/atlasbridge/         ← installed package (where = ["src"])
  core/
    prompt/              — detector.py, state.py, models.py
    session/             — models.py, manager.py
    routing/             — router.py
    store/               — database.py (SQLite WAL)
    audit/               — writer.py (hash-chained audit log)
    daemon/              — manager.py (orchestrates everything)
    scheduler/           — TTL sweeper (future)
  os/tty/                — base.py, macos.py, linux.py, windows.py
  os/systemd/            — service.py (Linux systemd user service)
  adapters/              — base.py, claude_code.py, openai_cli.py, gemini_cli.py
  channels/              — base.py, multi.py, telegram/channel.py, slack/channel.py
  tui/                   — app.py, state.py, services.py, app.tcss, screens/ (v0.5.x, preserved)
  ui/                    — app.py, state.py, polling.py, css/atlasbridge.tcss
                           components/status_cards.py
                           screens/: welcome, wizard, complete, sessions, logs, doctor
  cli/                   — main.py + _setup/_daemon/_run/_status/etc.
tests/
  unit/                  — pure unit tests (no I/O)
  integration/           — SQLite + mocked HTTP
  e2e/                   — real PTY + mocked Telegram
  prompt_lab/            — deterministic QA simulator
    simulator.py         — Simulator, TelegramStub, PTYSimulator, LabScenario
    scenarios/           — QA-001 through QA-020 implementations
docs/                    — all design documents
```

---

## Key files

| Path | Purpose |
|------|---------|
| `src/atlasbridge/cli/main.py` | All CLI commands (Click group) + TUI launch |
| `src/atlasbridge/ui/app.py` | AtlasBridgeApp (Textual App + `run()` entry) — active TUI |
| `src/atlasbridge/ui/state.py` | Re-exports AppState, WizardState from tui.state |
| `src/atlasbridge/ui/polling.py` | poll_state() → AppState, POLL_INTERVAL_SECONDS=5.0 |
| `src/atlasbridge/ui/components/status_cards.py` | StatusCards widget (4-card row) |
| `src/atlasbridge/ui/css/atlasbridge.tcss` | Global TCSS for all 6 screens |
| `src/atlasbridge/tui/state.py` | AppState, WizardState — pure Python, testable without Textual |
| `src/atlasbridge/tui/services.py` | ConfigService, DoctorService, DaemonService, SessionService, LogsService |
| `src/atlasbridge/core/prompt/detector.py` | Tri-signal prompt detector |
| `src/atlasbridge/core/prompt/models.py` | PromptEvent, Reply, PromptType, Confidence |
| `src/atlasbridge/core/prompt/state.py` | PromptStateMachine, VALID_TRANSITIONS |
| `src/atlasbridge/core/routing/router.py` | PromptRouter (forward + return path) |
| `src/atlasbridge/core/session/manager.py` | SessionManager (in-memory registry) |
| `src/atlasbridge/core/store/database.py` | SQLite WAL store + decide_prompt() guard |
| `src/atlasbridge/core/audit/writer.py` | Hash-chained audit event writer |
| `src/atlasbridge/core/daemon/manager.py` | DaemonManager (top-level orchestrator) |
| `src/atlasbridge/os/tty/base.py` | BaseTTY abstract PTY supervisor |
| `src/atlasbridge/os/tty/macos.py` | MacOSTTY (ptyprocess) |
| `src/atlasbridge/os/systemd/service.py` | Linux systemd user service integration |
| `src/atlasbridge/adapters/base.py` | BaseAdapter ABC + AdapterRegistry |
| `src/atlasbridge/adapters/claude_code.py` | ClaudeCodeAdapter |
| `src/atlasbridge/channels/base.py` | BaseChannel ABC |
| `src/atlasbridge/channels/telegram/channel.py` | TelegramChannel (httpx, long-poll) |
| `src/atlasbridge/channels/slack/channel.py` | SlackChannel (Socket Mode + Block Kit) |
| `src/atlasbridge/channels/multi.py` | MultiChannel fan-out |
| `tests/prompt_lab/simulator.py` | Simulator, TelegramStub, PTYSimulator |

---

## Architecture: data flow

```
atlasbridge run claude
    │
    ▼
DaemonManager                  ← orchestrates all subsystems
    │
    ▼
ClaudeCodeAdapter              ← wraps `claude` in PTY supervisor
    │
    ├── pty_reader             ← reads output, calls PromptDetector.analyse()
    ├── stdin_relay            ← forwards host stdin → child PTY
    ├── stall_watchdog         ← calls PromptDetector.check_silence()
    └── response_consumer      ← dequeues Reply objects, calls inject_reply()
          ▲
          │
    PromptRouter               ← routes events → channel, routes replies → adapter
          │             │
    TelegramChannel    SQLite  ← atomic decide_prompt() idempotency guard
          │
    User's phone (Telegram)
```

**Tri-signal prompt detection:**
1. Signal 1 — Pattern match on ANSI-stripped output → HIGH confidence
2. Signal 2 — TTY blocked-on-read inference → MED confidence
3. Signal 3 — Silence threshold (stall watchdog) → LOW confidence

**Prompt state machine:**
CREATED → ROUTED → AWAITING_REPLY → REPLY_RECEIVED → INJECTED → RESOLVED
                                                              ↓
                                              EXPIRED / CANCELED / FAILED

---

## Dev commands

```bash
# Install
pip install -e ".[dev]"   # or: uv pip install -e ".[dev]"

# Run all tests
pytest tests/ -q

# Run a specific test file
pytest tests/unit/test_prompt_detector.py -v

# Launch TUI
atlasbridge         # (must be a TTY)
atlasbridge ui

# Run Prompt Lab scenarios (via CLI)
atlasbridge lab list
atlasbridge lab run partial-line-prompt
atlasbridge lab run --all

# Lint and format
ruff check . && ruff format --check .

# Type check
mypy src/atlasbridge/

# Full CI equivalent (local)
ruff check . && ruff format --check . && mypy src/atlasbridge/ && pytest tests/ --cov=atlasbridge
```

---

## CI pipeline

1. **CLI Smoke Tests** — verifies all 15 subcommands exist (gates everything)
2. **Security Scan** — bandit on `src/`
3. **Lint + Type Check** — ruff check, ruff format --check, mypy src/atlasbridge/
4. **Tests** — pytest on Python 3.11 + 3.12, macOS + ubuntu
5. **Build** — twine check

---

## Branching model

- `main` — always releasable; only tagged releases land here
- `feature/*` — feature development
- `fix/*` — bug fixes
- Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`
- PRs squash-merge to main after CI green

---

## Config paths

| Platform | Default config directory |
|----------|--------------------------|
| macOS | `~/Library/Application Support/atlasbridge/` |
| Linux | `$XDG_CONFIG_HOME/atlasbridge/` (default `~/.config/atlasbridge/`) |
| Other | `~/.atlasbridge/` |

Override with `ATLASBRIDGE_CONFIG` env var. Legacy `AEGIS_CONFIG` is also honoured.

---

## Roadmap

| Version | Target | Status | Key deliverable |
|---------|--------|--------|----------------|
| v0.1.0 | Design | Released | Architecture docs + code stubs |
| v0.2.0 | macOS  | Released | Working Telegram relay for Claude Code |
| v0.3.0 | Linux  | Released | Linux PTY, systemd integration |
| v0.4.0 | Slack  | Released | Slack channel, multi-channel routing, renamed to AtlasBridge |
| v0.5.0 | TUI    | Released | Interactive Textual TUI — setup wizard, sessions, logs, doctor |
| v0.6.0 | Autopilot | Released | Policy DSL v0, autopilot engine, kill switch, decision trace |
| v0.7.0 | Windows | Planned | ConPTY experimental |
| v1.0.0 | GA | Planned | Stable adapter + channel API |
