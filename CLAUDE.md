# CLAUDE.md — Aegis Project Context

This file is read by Claude Code automatically. It provides project context for working on this codebase.

---

## What Aegis is

Aegis is the **universal human-in-the-loop control plane for AI developer agents**.

Aegis sits between you and your AI coding agent. Whenever your agent pauses and requires human input — approval, confirmation, a choice, or clarification — Aegis forwards that prompt to your phone. You respond from your phone, from a channel such as Telegram or Slack. Aegis relays your decision back to the CLI. Execution resumes.

That's the entire product. It is NOT a security tool, firewall, policy engine, or risk classifier.

---

## What Aegis is NOT

- Not a security product
- Not a CLI firewall
- Not an operation risk classifier
- Not a "dangerous command" gatekeeper
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
src/aegis/               ← new source layout (v0.2.0+)
  core/
    prompt/              — detector.py, state.py, models.py
    session/             — models.py, manager.py
    routing/             — router.py
    store/               — database.py (SQLite WAL)
    audit/               — writer.py (hash-chained audit log)
    daemon/              — manager.py (orchestrates everything)
    scheduler/           — TTL sweeper (future)
  os/tty/                — base.py, macos.py, linux.py, windows.py
  adapters/              — base.py, claude_code.py, openai_cli.py
  channels/              — base.py, telegram/channel.py, slack/channel.py
  cli/                   — main.py + _setup/_daemon/_run/_status/etc.
aegis/                   ← legacy root layout (pre-v0.2.0, kept for transition)
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

## Key files (new src/ layout)

| Path | Purpose |
|------|---------|
| `src/aegis/cli/main.py` | All CLI commands (Click group) |
| `src/aegis/core/prompt/detector.py` | Tri-signal prompt detector |
| `src/aegis/core/prompt/models.py` | PromptEvent, Reply, PromptType, Confidence |
| `src/aegis/core/prompt/state.py` | PromptStateMachine, VALID_TRANSITIONS |
| `src/aegis/core/routing/router.py` | PromptRouter (forward + return path) |
| `src/aegis/core/session/manager.py` | SessionManager (in-memory registry) |
| `src/aegis/core/store/database.py` | SQLite WAL store + decide_prompt() guard |
| `src/aegis/core/audit/writer.py` | Hash-chained audit event writer |
| `src/aegis/core/daemon/manager.py` | DaemonManager (top-level orchestrator) |
| `src/aegis/os/tty/base.py` | BaseTTY abstract PTY supervisor |
| `src/aegis/os/tty/macos.py` | MacOSTTY (ptyprocess) |
| `src/aegis/adapters/base.py` | BaseAdapter ABC + AdapterRegistry |
| `src/aegis/adapters/claude_code.py` | ClaudeCodeAdapter |
| `src/aegis/channels/base.py` | BaseChannel ABC |
| `src/aegis/channels/telegram/channel.py` | TelegramChannel (httpx, long-poll) |
| `tests/prompt_lab/simulator.py` | Simulator, TelegramStub, PTYSimulator |

---

## Architecture: data flow

```
aegis run claude
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

# Run all tests (old package)
pytest tests/ -v

# Run a specific test file
pytest tests/unit/test_detector.py -v

# Run Prompt Lab scenarios (via CLI)
aegis lab list
aegis lab run partial-line-prompt
aegis lab run --all

# Run Prompt Lab via pytest (when implemented)
pytest tests/prompt_lab/ -v

# Lint and format
ruff check . && ruff format --check .

# Type check (new src package)
mypy src/aegis/

# Full CI equivalent (local)
ruff check . && ruff format --check . && pytest tests/ --cov=aegis
```

---

## CI pipeline

1. **Security Scan** — bandit on `src/` and `aegis/`
2. **Lint + Type Check** — ruff check, ruff format --check, mypy
3. **Tests** — pytest on Python 3.11 + 3.12, macOS + ubuntu
4. **Build** — twine check
5. **Prompt Lab** — `aegis lab run --all` (gating gate, v0.2.0+)

---

## Branching model

- `main` — always releasable; only tagged releases land here
- `design/v0.1.0-release` — v0.1.0 design release (current)
- `feature/*` — feature development
- `fix/*` — bug fixes
- Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`
- PRs squash-merge to main after CI green

---

## Current scope (v0.1.0 design release)

- Architecture and design documents (all in `docs/`)
- Source code stubs (all in `src/aegis/`)
- Prompt Lab simulator infrastructure
- No working end-to-end relay yet — that's v0.2.0 (macOS MVP)

## Roadmap

| Version | Target | Key deliverable |
|---------|--------|----------------|
| v0.1.0 | Design | Architecture docs + code stubs |
| v0.2.0 | macOS  | Working Telegram relay for Claude Code |
| v0.3.0 | Linux  | Linux PTY (same ptyprocess backend) |
| v0.4.0 | Slack  | Slack channel, multi-channel routing |
| v0.5.0 | Windows | ConPTY experimental |
| v1.0.0 | GA | Stable adapter + channel API |
