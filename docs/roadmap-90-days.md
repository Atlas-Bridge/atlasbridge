# Aegis 90-Day Roadmap

**Version:** 0.2.0
**Status:** Planning
**Last updated:** 2026-02-21
**Horizon:** Weeks 1–12 (February 2026 – May 2026)

---

## Summary

This document is the canonical 90-day execution plan for Aegis. It covers six sequential phases, from macOS MVP hardening through Linux parity, adapter abstraction, Slack integration, and experimental Windows support. Each phase has a concrete definition of done, measurable success metrics, and a dependency graph linking it to later phases.

The target audience is the engineering team and any external contributors reviewing the project's near-term priorities.

---

## Phase Summary Table

| Phase | Weeks | Theme | Key Deliverable | Gate Metric |
|-------|-------|-------|-----------------|-------------|
| 1 | 1–3 | macOS MVP + Prompt Lab + Reliability | PTY supervisor, Telegram bot, Claude Code adapter, Prompt Lab | QA-001–QA-019 passing on macOS |
| 2 | 4–6 | Linux parity + CI matrix | LinuxTTY adapter, dual-platform CI | CI green on macOS + Linux (Python 3.11 + 3.12) |
| 3 | 7–8 | Adapter abstraction + OpenAI CLI | `BaseAdapter`, OpenAI adapter, `aegis adapter list` | Two working adapters, interface stable |
| 4 | 9–10 | Slack channel + channel UX parity | `SlackChannel`, slash commands, Slack QA variants | Telegram + Slack parity on all prompt types |
| 5 | 11–12 | Windows ConPTY experimental | ConPTY adapter, QA-020, Windows CI | QA-020 passing |
| 6 | Ongoing | UX polish + observability | `aegis sessions`, `aegis logs --tail`, Web UI stub | Dashboard operational |

---

## Dependency Graph

```
Phase 1 (macOS + Prompt Lab)
    │
    ├──► Phase 2 (Linux)
    │         │
    │         └──► Phase 3 (Adapter abstraction)
    │                   │
    │                   ├──► Phase 4 (Slack)
    │                   │         │
    │                   │         └──► Phase 6 (UX + Observability) ◄──────┐
    │                   │                                                   │
    │                   └──► Phase 5 (Windows) ────────────────────────────┘
    │
    └──► Phase 6 (UX + Observability) [can begin concurrently with Phase 3]
```

Phase 1 is the root. Nothing in phases 2–6 can be started until Phase 1 is complete, because:
- The Prompt Lab infrastructure (created in Phase 1) is the test harness for all future phases.
- The PTY supervisor and `PromptDetector` are the shared foundation that the adapter abstraction in Phase 3 formalises.
- The CI matrix in Phase 2 provides the green baseline against which Phases 3–5 add new checks.

Phase 6 has two entry points: it can begin incrementally alongside Phase 3 once the basic CI infrastructure is stable, or it can start in earnest after Phase 5 wraps up.

---

## Phase 1: macOS MVP + Telegram + Claude Code Adapter + Prompt Lab + Reliability Hardening

**Weeks:** 1–3
**Milestone tag:** `v0.2.0`

### Objective

Deliver a complete, reliable, tested macOS implementation of the Aegis prompt relay. Every component — PTY supervisor, tri-signal detector, Telegram bot, SQLite store, audit log, and Claude Code adapter — must be individually tested and collectively proven via the 19 Prompt Lab scenarios. The release must be shippable to early users.

### Deliverables

**PTY Supervisor (macOS)**
The `PTYSupervisor` class runs the full asyncio event loop with four concurrent tasks: `pty_reader`, `stdin_relay`, `stall_watchdog`, and `response_consumer`. It manages the process lifecycle from spawn to exit, handles SIGINT/SIGTERM correctly, and restores terminal state on exit. The 4096-byte rolling buffer is bounded — it does not grow with output volume.

**Tri-Signal Detector**
`PromptDetector` implements all three detection layers: structured-event passthrough (reserved for future use), regex pattern matching for all four prompt types (YES_NO, CONFIRM_ENTER, MULTIPLE_CHOICE, FREE_TEXT), and the stall watchdog blocking heuristic. ANSI sequences are stripped before matching. Detection confidence is correctly calculated and thresholded at 0.65 by default.

**Telegram Bot with Inline Keyboards**
`TelegramBot` long-polls `getUpdates` with 30-second timeout. On prompt detection, it constructs and sends a typed inline keyboard message using `templates.py`. Callback queries are parsed, validated against the nonce + expiry guard, and dispatched to `decide_prompt()`. Free-text replies use `reply_to_message` routing. All Telegram HTTP calls use `httpx` async with retry on transient errors.

**Claude Code Adapter**
The adapter wires the PTY supervisor to the Claude Code tool invocation pattern. It handles all four prompt types with correct injection bytes (`y\r`, `n\r`, `\r`, `N\r`, free text + `\r`). It correctly suppresses detection for `post_inject_suppress_ms` after each injection. Safe defaults are enforced — `YES_NO` safe default cannot be `y`.

**Prompt Lab Simulator (QA-001 through QA-009)**
The `aegis lab` CLI command and the `tests/prompt_lab/` infrastructure are built in this phase. Scenarios QA-001 through QA-009 cover all core detection and injection failure modes. Each scenario is deterministic, runs without network access or a real Telegram account, and produces a JSON pass/fail report. The Telegram stub supports `auto_reply`, `deliver_callback`, `simulate_outage`, and `get_messages`.

**Test Coverage**
Unit tests cover all `PromptDetector` patterns (minimum 27 test cases), `decide_prompt()` guard, audit chain, Telegram templates, and config validation. Integration tests cover the CLI commands and the end-to-end PTY flow. Coverage target: 85% line coverage measured by `pytest-cov`, enforced in CI.

**CI Foundation**
GitHub Actions workflow runs on `macos-latest` with Python 3.11 and 3.12. The pipeline: `ruff check`, `ruff format --check`, `mypy`, `pytest --cov`, `aegis lab run --all`. A passing CI job on `main` is a hard prerequisite for tagging `v0.2.0`.

### Success Metric

100% of QA-001 through QA-019 must pass on macOS before the `v0.2.0` tag is created. This is a binary gate — partial passage does not count.

### Definition of Done

- [ ] `aegis run claude` works end-to-end on macOS with a real Claude Code binary
- [ ] All four prompt types detected and relayed correctly
- [ ] `aegis lab run --all` reports 19/19 PASS on macOS
- [ ] CI is green (lint + types + tests + lab scenarios) on `macos-latest`
- [ ] `pytest --cov` reports >= 85% line coverage
- [ ] `aegis setup`, `aegis run`, `aegis status`, `aegis doctor` all work without error on a clean macOS machine
- [ ] `CHANGELOG.md` updated for v0.2.0
- [ ] `v0.2.0` git tag created and pushed

---

## Phase 2: Linux Support + CI Matrix + Regression Suite

**Weeks:** 4–6
**Milestone tag:** `v0.3.0`

### Objective

Extend Aegis to Linux without regression on macOS. The `ptyprocess` library used in Phase 1 is POSIX-portable, but there are platform-specific differences in PTY behaviour, terminal settings, and process management (launchd on macOS vs. systemd on Linux). This phase proves Aegis works identically on both platforms by running the full 19-scenario QA suite on both.

### Deliverables

**LinuxTTY Adapter**
A Linux-specific PTY adapter that wraps `ptyprocess.PtyProcess` and handles Linux-specific edge cases: `O_CLOEXEC` semantics, `/proc/<pid>/fd` inspection for PTY detection, and `termios` flag differences between Linux and macOS (particularly around `ONLCR` and `OCRNL` output processing flags). The adapter is tested against the same 19 Prompt Lab scenarios as the macOS adapter.

**Dual-Platform CI Matrix**
The GitHub Actions matrix is expanded to:
```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest]
    python-version: ["3.11", "3.12"]
```
All 4 combinations must be green. The Prompt Lab scenarios run as part of the CI job on both platforms. Platform-specific test marks (`@pytest.mark.macos_only`, `@pytest.mark.linux_only`) are used where necessary.

**QA-001 through QA-019 on Linux**
All 19 Prompt Lab scenarios must pass on `ubuntu-latest`. Any Linux-specific behaviour differences discovered during this phase are either fixed (if they represent bugs) or documented as known platform variations and tested explicitly.

**Regression Suite**
A regression test suite is formalised: the 19 Prompt Lab scenarios are tagged as `regression` markers and always included in the default `pytest` run (not just in `aegis lab run`). This ensures that future changes cannot break any scenario without CI catching it immediately.

**Systemd Service Unit**
A sample `aegis.service` systemd unit file is added to `packaging/linux/` for users who want to run the Aegis daemon as a persistent service on Linux. The unit is not automatically installed — it is documentation and a starting point.

### Success Metric

CI is green on all 4 combinations in the matrix (`ubuntu-latest` + `macos-latest`, Python 3.11 + 3.12). All 19 Prompt Lab scenarios pass on both platforms.

### Definition of Done

- [ ] `aegis run claude` works end-to-end on Ubuntu 22.04 LTS
- [ ] `aegis lab run --all` reports 19/19 PASS on `ubuntu-latest`
- [ ] CI matrix is 4/4 green (2 OS × 2 Python versions)
- [ ] No regressions on macOS from Phase 1
- [ ] `packaging/linux/aegis.service` present
- [ ] `CHANGELOG.md` updated for v0.3.0
- [ ] `v0.3.0` git tag created

---

## Phase 3: Adapter Abstraction + OpenAI CLI Adapter

**Weeks:** 7–8
**Milestone tag:** `v0.3.1` or `v0.4.0-beta`

### Objective

Formalise the adapter interface that Claude Code implicitly relies on, and build a second adapter (OpenAI CLI) to prove the interface is correct. An abstraction built for only one concrete case is not an abstraction — it is a specialisation. Two working, independently tested adapters prove the `BaseAdapter` contract is real and stable.

### Deliverables

**`BaseAdapter` Formalised**
The `BaseAdapter` abstract class is extracted to `src/aegis/adapters/base.py`. It defines the interface that every adapter must implement:
- `name: str` — identifier used in config and CLI output
- `detect_prompt(buffer: bytes) -> Optional[DetectedPrompt]` — called by the PTY supervisor after every buffer update
- `on_inject(prompt: DetectedPrompt, value: str) -> bytes` — returns the raw bytes to write to PTY stdin
- `on_session_start(session: Session) -> None` — hook called when the session begins
- `on_session_end(session: Session, exit_code: int) -> None` — hook called on exit

The interface is documented with precise pre/post-conditions. It is marked stable (breaking changes require a minor version bump).

**OpenAI CLI Adapter**
`src/aegis/adapters/openai_cli.py` implements `BaseAdapter` for the `openai` CLI tool. The OpenAI CLI has different interactive prompt patterns from Claude Code — particularly its use of spinner characters and confirmation patterns around API call execution. The adapter adds OpenAI-specific pattern overrides without changing the shared detector.

**Adapter Test Harness**
`tests/adapters/` contains a generic adapter test harness: a parametrised test suite that runs a common set of injection and detection tests against any registered adapter. New adapters pass the harness to demonstrate basic correctness before being merged.

**`aegis adapter list` Command**
A new CLI subcommand lists all registered adapters, their status (installed / not installed), and the tool binary they expect:

```
$ aegis adapter list
NAME         TOOL        STATUS      VERSION
claude       claude      installed   1.x
openai-cli   openai      missing     —
```

**Config Routing**
`aegis run` reads the `adapter` field from config (or auto-detects from the tool name). This allows users to override the adapter selection when the tool name is ambiguous.

### Success Metric

Two adapters (Claude Code and OpenAI CLI) pass the adapter harness. The `BaseAdapter` interface has no breaking changes after initial publication. `aegis adapter list` works on macOS and Linux.

### Definition of Done

- [ ] `BaseAdapter` ABC in `src/aegis/adapters/base.py` with full docstring
- [ ] `ClaudeAdapter` and `OpenAICLIAdapter` both pass the adapter harness
- [ ] `aegis adapter list` command functional on macOS and Linux
- [ ] Adapter harness added to CI (runs on both platforms)
- [ ] `BaseAdapter` interface documented in `docs/tool-adapter.md`
- [ ] No regressions in Phase 2 CI matrix

---

## Phase 4: Slack Channel Adapter + Channel UX Parity

**Weeks:** 9–10
**Milestone tag:** `v0.4.0`

### Objective

Add Slack as a second notification and reply channel. The `BaseChannel` abstraction was included in the initial architecture (`src/aegis/channels/base.py`) precisely to make this tractable. Phase 4 proves the abstraction holds by implementing Slack without touching the PTY supervisor or detector. The Slack implementation must achieve full UX parity with Telegram — all prompt types, all reply mechanisms, all idempotency guarantees.

### Deliverables

**`SlackChannel` Implementation**
`src/aegis/channels/slack/bot.py` implements `BaseChannel` using the Slack Web API (Block Kit for interactive messages). Slack replaces Telegram's inline keyboards with Block Kit `actions` blocks containing `button` elements. Callback payloads are verified using Slack's signing secret before processing.

Slack-specific considerations:
- Slack's interactive component payload (`payload=...` URL-encoded) differs from Telegram's `callback_query`. The callback handler is Slack-specific but the routing into `decide_prompt()` is shared.
- Slack slash commands (`/aegis approve <id>`, `/aegis deny <id>`) replace Telegram's inline `aegis approvals approve` CLI as the mobile-first interaction model.
- Message threading: Slack threads are used to group all prompts from a single session under a parent message.

**Slash Commands**
The Slack bot registers slash commands `/aegis-approve`, `/aegis-deny`, and `/aegis-status`. These work as an alternative to button taps — useful when the notification arrives in a channel where buttons are not rendered (e.g., email digests).

**Channel Routing Configuration**
Users configure which channel to use in `~/.aegis/config.toml`:
```toml
[channel]
type = "telegram"   # or "slack"

[channel.slack]
bot_token = "xoxb-..."
signing_secret = "..."
channel_id = "C..."
```

**Channel Test Harness**
`tests/channels/` contains a generic channel harness analogous to the adapter harness — parametrised tests that run against any `BaseChannel` implementation. The Telegram stub from Phase 1 and the new Slack stub both implement a common `ChannelStub` interface.

**Slack Variants of QA Channel Scenarios**
QA-010, QA-011, QA-012, QA-013, and QA-014 are re-run with the Slack stub in place of the Telegram stub. The same pass criteria apply. These Slack variants are added to the CI matrix for v0.4.0.

**Channel UX Parity Matrix**

| Prompt Type | Telegram | Slack |
|-------------|----------|-------|
| YES_NO | Inline keyboard (2 buttons) | Block Kit buttons (2 buttons) |
| CONFIRM_ENTER | Inline keyboard (1 button) | Block Kit button (1 button) |
| MULTIPLE_CHOICE | Inline keyboard (N buttons) | Block Kit overflow menu |
| FREE_TEXT | Reply-to-message | Direct message or slash command |
| Expiry notice | Message edit | Message update (Block Kit) |
| Crash notice | Message edit | Message update |

### Success Metric

Telegram and Slack achieve full parity on all prompt types. The Slack variants of QA-010 through QA-014 all pass. The CI matrix includes Slack channel tests on both platforms.

### Definition of Done

- [ ] `SlackChannel` passes all channel harness tests
- [ ] QA-010 through QA-014 pass with Slack stub
- [ ] `/aegis-approve` and `/aegis-deny` slash commands functional
- [ ] Channel selection configurable in `config.toml`
- [ ] `aegis setup` guides user through Slack configuration when `--channel slack` is passed
- [ ] `CHANGELOG.md` updated for v0.4.0
- [ ] `v0.4.0` git tag created

---

## Phase 5: Windows ConPTY Experimental + Stabilisation

**Weeks:** 11–12
**Milestone tag:** `v0.5.0`

### Objective

Deliver an experimental Windows ConPTY adapter behind a feature flag. Windows users are a meaningful portion of the developer population, but the ConPTY API has significant differences from POSIX PTYs (CRLF line endings, Unicode handling via the Windows Console API, different signal semantics). The experimental flag lets adventurous users test the adapter without it becoming a support obligation.

### Deliverables

**ConPTY Adapter**
`src/aegis/adapters/conpty.py` wraps the Windows ConPTY API (via `pywinpty` or direct `ctypes` calls to `CreatePseudoConsole`). Key differences from the POSIX adapter:
- Line endings are CRLF; the adapter normalises to LF before passing to `PromptDetector`.
- Injection bytes use CRLF (`\r\n`) by default, configurable as `windows_crlf_inject`.
- Unicode output is decoded with `errors='replace'` to handle Windows-1252 fallback scenarios.
- SIGINT equivalent on Windows is `CTRL_C_EVENT` sent via `GenerateConsoleCtrlEvent`.

**`--experimental` Flag on `aegis version`**
`aegis version --experimental` lists active experimental features:
```
$ aegis version --experimental
aegis 0.5.0
Python 3.11.9
Platform: win32 AMD64

Experimental features:
  windows_conpty    enabled
  web_ui_stub       disabled
```

**QA-020 Test Pass**
All four CRLF prompt variants must be detected and classified correctly by `PromptDetector` after CRLF normalisation. No `UnicodeDecodeError` on Unicode ConPTY output. Injection bytes are CRLF-terminated on Windows.

**Windows CI Runner (Best-Effort)**
A `windows-latest` GitHub Actions runner is added to the CI matrix with `best-effort` status — failures are reported but do not block the release. The intent is to surface failures early, not to gate on them before the adapter reaches beta.

**WSL2 Documentation**
A guide is added to `docs/setup-flow.md` for WSL2 users — the recommended path for Windows users who want a production-grade experience before ConPTY matures. Under WSL2, the macOS/Linux PTY adapter works without modification.

### Success Metric

QA-020 passes. `aegis run claude` works on a bare Windows 11 machine with the `--experimental` flag. The Windows CI runner produces a result (pass or fail) on every pull request.

### Definition of Done

- [ ] `ConPTYAdapter` in `src/aegis/adapters/conpty.py`
- [ ] QA-020 passes with ConPTY adapter active
- [ ] `aegis version --experimental` reports `windows_conpty: enabled`
- [ ] Windows CI runner added (best-effort)
- [ ] WSL2 guide in `docs/setup-flow.md`
- [ ] `CHANGELOG.md` updated for v0.5.0
- [ ] `v0.5.0` git tag created

---

## Phase 6: UX Polish + Observability (Ongoing)

**Start:** Week 7 (concurrent with Phase 3 where capacity allows)
**Status:** No hard deadline; continuous improvement

### Objective

Make Aegis easier to observe, debug, and operate at scale. The core relay correctness is proven by phases 1–5; Phase 6 is about making it transparent — users and operators can see what is happening in real time, diagnose issues without reading raw logs, and access prompt history without writing SQL.

### Deliverables

**`aegis sessions` Command**
A new CLI command lists all sessions with their status, duration, prompt counts, and outcome:

```
$ aegis sessions
ID          TOOL     STARTED   DURATION  PROMPTS  STATUS
sess-abc    claude   19:04:01  1h 22m    14       active
sess-def    claude   17:10:44  32m       3        completed (exit 0)
sess-ghi    claude   16:00:00  5m        1        crashed
```

With `--json` and `--follow` flags.

**`aegis logs --tail` Improvement**
`aegis logs --tail` streams structured JSON events from the audit log in real time. The output is colourised by event type when writing to a TTY, and plain JSON Lines when piped. Filtering by session ID (`--session <id>`) and event type (`--event prompt_detected`) is supported.

**`aegis debug bundle`**
`aegis debug bundle` creates a compressed archive at `~/.aegis/debug-<timestamp>.tar.gz` containing:
- `config.toml` (with secrets redacted)
- Last 500 lines of `audit.log`
- `aegis doctor --json` output
- `aegis version --json` output
- `aegis sessions --json` output (last 10 sessions)
- Current DB schema version

The bundle can be attached to GitHub issues without exposing credentials.

**Prompt Lab Integrated into `aegis doctor --fix`**
`aegis doctor --fix` gains a `--lab` flag that runs all Prompt Lab scenarios as part of the diagnostic. Scenarios that fail are reported as `FAIL` items in the doctor output with a suggestion to run `aegis lab run <scenario> --verbose` for details.

**Web UI Stub**
A minimal read-only web dashboard is served by the Aegis daemon at `http://localhost:39001/` (opt-in, disabled by default). The initial version shows:
- Session list with live status
- Active prompt queue
- Audit log tail (last 50 events)
- System health indicators

The web UI is a stub — it renders correctly but does not yet support approving or denying prompts through the browser. Full interactive support is a post-v0.x milestone.

**Dashboard for Prompt History**
`aegis sessions <id>` shows a per-session prompt history table:

```
Prompt History for sess-abc (claude, 1h 22m)
─────────────────────────────────────────────────────────────
#    TYPE            TEXT (excerpt)              STATUS    ELAPSED
1    TYPE_YES_NO     "Delete existing file?"     approved  18s
2    TYPE_CONFIRM    "Press Enter to continue"   auto      2s (TTL)
3    TYPE_FREE_TEXT  "Enter commit message:"     answered  44s
```

### Definition of Done (Phase 6, per deliverable)

- [ ] `aegis sessions` command functional with `--json` and `--follow`
- [ ] `aegis logs --tail` streams real-time structured events with filtering
- [ ] `aegis debug bundle` creates a complete, secrets-redacted archive
- [ ] `aegis doctor --fix --lab` runs Prompt Lab scenarios as diagnostic checks
- [ ] Web UI stub served at `localhost:39001` (opt-in)
- [ ] `aegis sessions <id>` shows per-session prompt history

---

## Risk Register

The following five risks are the most likely to cause phase slippage or quality regression. Each has a mitigation strategy and an owner action.

### Risk 1: ConPTY API Instability on Windows

**Likelihood:** High
**Impact:** Phase 5 slips or ships with unresolved bugs

**Description:** The Windows ConPTY API (available since Windows 10 1809) has known behavioural differences between Windows builds, and third-party wrappers (`pywinpty`) have historically had version-specific bugs. Unicode handling under ConPTY is inconsistent with the documented specification in some terminal scenarios. The QA-020 scenario may be harder to pass than anticipated.

**Mitigation:**
- Phase 5 ships behind `--experimental` flag — no pressure to declare it production-ready
- WSL2 is documented as the recommended Windows path, reducing the blast radius of ConPTY bugs
- `pywinpty` version is pinned in `pyproject.toml` and tested against a specific Windows build
- QA-020 runs as `best-effort` in CI; it does not block any non-Windows release

---

### Risk 2: Telegram API Rate Limits Breaking the Prompt Lab

**Likelihood:** Medium
**Impact:** CI becomes flaky; false negatives on QA scenarios

**Description:** If any Prompt Lab scenarios inadvertently use the real Telegram API (rather than the stub), they will be subject to Telegram's rate limits (30 messages/second globally, 1 message/second per chat). Under CI load with multiple concurrent workers, rate-limited responses may cause flaky test failures that are hard to diagnose.

**Mitigation:**
- All Prompt Lab scenarios use `TelegramStub` by default; the real Telegram API is never called from CI
- `TelegramStub` is enforced via a fixture that raises `RealTelegramAPICallError` if a real HTTP call is attempted
- Integration tests that use the real Telegram API are in a separate `tests/manual/` directory and are never run in CI

---

### Risk 3: PTY Behaviour Differences Between macOS Versions

**Likelihood:** Medium
**Impact:** Phase 1 scenarios pass on the development machine but fail on CI (macOS 14 vs. macOS 15)

**Description:** PTY terminal settings, echo behaviour, and `select()` timing vary between macOS versions. A scenario that relies on precise timing of the stall watchdog (e.g., QA-001, QA-004) may be flaky if the CI runner's macOS version has different PTY echo latency.

**Mitigation:**
- Stall watchdog timing is parameterised and configured conservatively (3× the minimum observable latency)
- Prompt Lab scenarios use explicit `asyncio.sleep` calls to create reliable state rather than relying on real-time timing
- CI runs on `macos-latest` plus a pinned older version (`macos-13`) to catch version regressions early
- Flaky tests are automatically retried once before failing (`pytest-rerunfailures`)

---

### Risk 4: Slack API Changes Breaking the Channel Adapter

**Likelihood:** Low
**Impact:** Phase 4 integration becomes unstable post-release

**Description:** Slack has a history of deprecating API features (the legacy RTM API was deprecated in 2021, Block Kit has had breaking changes in button structure). If Slack deprecates a feature used by the `SlackChannel` adapter between Phase 4 ship and the following release cycle, the Slack adapter may silently break.

**Mitigation:**
- Slack SDK version is pinned and tested against a specific API surface
- The `SlackChannel` adapter uses only stable, non-deprecated Block Kit components (documented in the adapter's module docstring with the date verified)
- A `SlackStub` integration test verifies the exact API call shape on every CI run, catching drift before it reaches production users
- The adapter version is surfaced in `aegis adapter list` output so users know which Slack API version is targeted

---

### Risk 5: SQLite WAL Mode Performance Under Output Flood (QA-018)

**Likelihood:** Low
**Impact:** QA-018 fails; production users with high-volume CLIs experience latency spikes

**Description:** Under QA-018's 100,000-line output flood, the `pty_reader` loop calls `PromptDetector.detect()` after every chunk. If the detector's regex engine is slow on the 4096-byte buffer (e.g., catastrophic backtracking on a malformed pattern), the `pty_reader` task will block the asyncio event loop long enough to interfere with Telegram long-poll timing. The `stall_watchdog` may fire prematurely because `pty_reader` is monopolising the event loop.

**Mitigation:**
- All regex patterns are pre-compiled at module load time (not inside the hot path)
- Pattern correctness is verified with `re.DEBUG` output in the test suite to check for catastrophic backtracking
- `PromptDetector.detect()` has a `max_time_ms` guard (default: 5 ms) — if the regex pass takes longer, it logs a warning and skips the regex layer (falling through to the stall watchdog)
- QA-018 measures not only memory but also event-loop latency (asyncio event loop lag metric) to catch this class of regression

---

## Appendix: Version Naming Convention

| Version | Theme | Status |
|---------|-------|--------|
| v0.2.0 | macOS MVP | Phase 1 gate |
| v0.3.0 | Linux parity | Phase 2 gate |
| v0.3.1 | Adapter abstraction (if minor) | Phase 3 gate (may become v0.4.0-beta) |
| v0.4.0 | Slack + adapter interface stable | Phase 3+4 gate |
| v0.5.0 | Windows experimental | Phase 5 gate |
| v0.6.0 | UX polish + Web UI | Phase 6 milestone |
| v1.0.0 | Stable API, all platforms, multi-channel | Post-roadmap |

Versions follow semantic versioning (SemVer). The `BaseAdapter` and `BaseChannel` interfaces are considered stable from v0.4.0 — breaking changes to these interfaces require a minor version bump even in the v0.x series.

---

## Appendix: Definition of "CI Green"

A CI job is considered "green" (passing) when all of the following are true:

1. `ruff check .` — zero lint violations
2. `ruff format --check .` — zero formatting violations
3. `mypy aegis/` — zero type errors
4. `pytest tests/ --cov=aegis --cov-report=term-missing` — zero test failures, coverage >= 85%
5. `aegis lab run --all --json` — all scenarios for the current release gate are `"status": "pass"`

A CI job is "green with best-effort" (for Phase 5 Windows runner) when items 1–5 pass on macOS and Linux, and the Windows runner produces a result (even a failure) without timing out.
