# AtlasBridge Roadmap

**Version:** 0.8.1
**Status:** Active
**Last updated:** 2026-02-21

---

## Where We Are

AtlasBridge v0.8.1 is released and available on PyPI. The core autonomous runtime is production-capable on macOS and Linux with a mature policy engine and zero-touch setup experience.

Key capabilities shipped:

- **Policy DSL v1** — compound conditions (`any_of`/`none_of`), session scoping (`session_tag`), confidence bounds (`max_confidence`), policy inheritance (`extends`), trace rotation
- **Zero-touch setup** — config migration from legacy paths, `--from-env` bootstrap, keyring integration, `atlasbridge config` CLI
- **Autopilot Engine** — three autonomy modes (Off / Assist / Full) with instant kill switch, per-rule rate limits, policy hot-reload
- **PTY supervisor** — macOS and Linux, Claude Code + OpenAI + Gemini adapters with auto-registration
- **Telegram + Slack** — dual-channel notification with inline keyboard responses, Slack kill switch parity
- **Interactive TUI** — setup wizard, sessions, logs, doctor, dynamic guidance panel
- **Audit infrastructure** — hash-chained audit log + append-only decision trace (JSONL) with configurable rotation

The positioning is settled: **policy-driven autonomous runtime for AI CLI agents**. Autonomy first. Human override when required.

---

## Shipped Milestones

| Version | Theme | Status |
|---------|-------|--------|
| v0.2.0 | macOS MVP — working Telegram relay for Claude Code | Released |
| v0.3.0 | Linux support, systemd integration | Released |
| v0.4.0 | Slack, MultiChannel fan-out, renamed to AtlasBridge | Released |
| v0.5.0 | Interactive TUI — setup wizard, sessions, logs, doctor | Released |
| v0.5.2 | Production UI skeleton — 6 screens, StatusCards, polling, TCSS | Released |
| v0.5.3 | CSS packaging hotfix — `.tcss` via `importlib.resources` | Released |
| v0.6.0 | Autonomous Agent Runtime — Policy DSL v0, autopilot, kill switch | Released |
| v0.6.1 | Policy authoring guide + 5 ready-to-use presets | Released |
| v0.6.2 | Product positioning — pyproject.toml, keywords, tagline | Released |
| v0.7.1 | Policy engine hardening — per-rule rate limits, hot-reload, Slack kill switch | Released |
| v0.7.2 | Doctor + polling path fixes, config path normalization | Released |
| v0.7.3 | Adapter auto-registration, `run claude-code` alias | Released |
| v0.7.4 | Telegram singleton poller (no 409 conflicts) | Released |
| v0.7.5 | Dynamic guidance panel on welcome screen | Released |
| v0.8.0 | Zero-touch setup — config migration, env bootstrap, keyring, config CLI | Released |
| v0.8.1 | Policy DSL v1 — any_of/none_of, session_tag, max_confidence, extends, trace rotation | Released |

### v0.7.1 — Policy Engine Hardening (Released)

**Theme:** Make the autonomy engine production-grade for always-on workloads.

**Delivered:**

- **Per-rule rate limits** — `max_auto_replies: N` cap per session; prevents runaway automation on looping prompts
- **Policy hot-reload** — `SIGHUP` reloads policy without daemon restart; new rules take effect on next prompt
- **Slack kill switch** — `/pause`, `/resume`, `/stop`, `/status` commands in Slack (full parity with Telegram)
- **Multi-session kill switch** — `atlasbridge pause --all` instantly pauses every active session
- **Kill switch history** — `atlasbridge autopilot history` shows state transitions with timestamps and who triggered each change

### v0.8.0 — Zero-Touch Setup (Released)

**Theme:** First-run experience that just works.

**Delivered:**

- **Config migration** — automatic detection and migration from legacy `~/.aegis/` paths
- **Environment bootstrap** — `atlasbridge setup --from-env` for headless / CI deployments
- **Keyring integration** — channel tokens stored in the OS keyring instead of plain-text config
- **Config CLI** — `atlasbridge config` subcommands for viewing and modifying configuration

### v0.8.1 — Policy DSL v1 (Released)

**Theme:** A richer, more expressive policy language for complex autonomous workflows.

**Delivered:**

- **Compound conditions** — `any_of`, `none_of` match operators for multi-field rules
- **Session context matching** — `match.session.tag` for session-scoped policy rules
- **Confidence bounds** — `max_confidence` for bounded automation windows
- **Policy inheritance** — `extends: base-policy.yaml` for composing shared rules with overrides
- **Decision trace rotation** — configurable rotation of `autopilot_decisions.jsonl` by size or age
- **Backward compatibility** — `policy_version: "0"` policies parse and evaluate identically to v0.6.x

---

## Upcoming Milestones

### v0.9.0 — Windows (ConPTY, Experimental)

**Theme:** Run AtlasBridge wherever AI agents run.

**Deliverables:**

- ConPTY adapter (`src/atlasbridge/os/tty/windows.py`) wrapping the Windows ConPTY API
- CRLF normalisation before `PromptDetector` (all four prompt types work correctly)
- QA-020 scenario (CRLF variants — all passing)
- `atlasbridge version --experimental` reports `windows_conpty: enabled`
- Windows CI runner on `windows-latest` (best-effort, non-blocking)
- WSL2 setup guide in `docs/` (recommended path for Windows users)

**Definition of done:**

- [ ] `atlasbridge run claude` works on Windows 11 with `--experimental` flag
- [ ] QA-020 passes — all CRLF prompt variants detected and classified correctly
- [ ] No `UnicodeDecodeError` on Unicode ConPTY output
- [ ] Windows CI runner produces a result on every PR (pass or fail, not timeout)
- [ ] `CHANGELOG.md` updated; `v0.9.0` tag created

---

### v1.0.0 — GA

**Theme:** Stable, production-grade, multi-platform autonomous runtime. Safe to run unattended on mission-critical workflows.

**GA criteria:**

- Stable `BaseAdapter` + `BaseChannel` APIs (breaking changes require a major version bump from this point)
- Policy DSL v1 stable and fully documented
- All platforms: macOS, Linux, Windows ConPTY
- Both channels: Telegram + Slack with full feature parity across all prompt types
- At least 3 first-party adapters: Claude Code, OpenAI CLI, Gemini CLI
- 20 Prompt Lab scenarios all passing on macOS and Linux
- `atlasbridge doctor --fix` handles all known failure modes on a clean install
- Performance: zero event-loop latency spikes under 100k-line output flood (QA-018)
- CI matrix: macOS + Linux, Python 3.11 + 3.12 — 4/4 green

**Definition of done:**

- [ ] All 20 Prompt Lab scenarios pass on `macos-latest` and `ubuntu-latest`
- [ ] `BaseAdapter` interface documented and versioned in `docs/adapters.md`
- [ ] `BaseChannel` interface documented and versioned in `docs/channels.md`
- [ ] Policy DSL v1 spec complete in `docs/policy-dsl.md`
- [ ] `atlasbridge doctor --fix` passes on clean macOS 14+ and Ubuntu 22.04 LTS
- [ ] CI: 4/4 matrix green (2 OS × 2 Python)
- [ ] `v1.0.0` git tag created; release notes published

---

## Ongoing Work

These items are continuously improved across releases with no fixed version target:

### Observability

| Item | Description |
|------|-------------|
| `atlasbridge sessions` | Live session list with prompt counts, duration, and outcome |
| `atlasbridge logs --tail` | Structured real-time audit event stream with session and event-type filtering |
| `atlasbridge debug bundle` | Redacted diagnostic archive (`config.toml` + last 500 audit lines + doctor output) |
| `atlasbridge autopilot trace` | Tail `autopilot_decisions.jsonl` with structured, colourised output |

### Prompt Lab

- QA-001 through QA-020 form the core regression suite — run on every PR
- New scenarios added whenever a detection or injection bug is found and fixed
- Scenarios run as `pytest` markers in CI, not just via `atlasbridge lab run`

### Documentation

- Getting started guides per agent (Claude Code, OpenAI, Gemini)
- Platform-specific setup guides (macOS, Linux, WSL2, Windows)
- Policy cookbook — real-world examples for common autonomous workflows
- Troubleshooting guide linked from `atlasbridge doctor` output

---

## Risk Register

### Risk 1: ConPTY API Instability on Windows

**Likelihood:** High
**Impact:** v0.9.0 ships with unresolved platform bugs

Windows ConPTY has known behavioural differences across Windows builds. Third-party wrappers have historically had version-specific issues.

**Mitigation:**

- Entire Windows adapter ships behind `--experimental` flag — no production-readiness pressure
- WSL2 documented as the recommended path; ConPTY is optional
- Windows CI runner is best-effort (non-blocking on the release)
- QA-020 gates correctness only; performance is a post-GA concern

---

### Risk 2: Event Loop Latency Under High-Volume Output

**Likelihood:** Low
**Impact:** QA-018 fails; real Claude Code workloads see latency spikes

Under high-volume output (100k+ lines/session), `PromptDetector.detect()` could block the asyncio event loop and delay Telegram long-poll responses.

**Mitigation:**

- All regex patterns pre-compiled at module load time (not in the hot path)
- `detect()` has a 5 ms max-time guard: if exceeded, log a warning and fall through to the stall watchdog
- QA-018 measures event-loop lag directly, not just detection accuracy

---

## Version Naming

| Version | Theme | Status |
|---------|-------|--------|
| v0.7.1 | Policy engine hardening | Released |
| v0.7.2 | Doctor + polling bugfixes | Released |
| v0.7.3 | Adapter auto-registration | Released |
| v0.7.4 | Telegram singleton poller | Released |
| v0.7.5 | Dynamic guidance panel | Released |
| v0.8.0 | Zero-touch setup | Released |
| v0.8.1 | Policy DSL v1 | Released |
| v0.9.0 | Windows ConPTY (experimental) | Planned |
| v1.0.0 | GA — stable, multi-platform, multi-agent | Planned |

Versions follow SemVer. Breaking changes to `BaseAdapter` or `BaseChannel` require a minor version bump in v0.x and a major bump at v1.0+.

---

## Definition of "CI Green"

A CI job is considered green when all of the following pass:

1. `ruff check .` — zero lint violations
2. `ruff format --check .` — zero formatting violations
3. `mypy src/atlasbridge/` — zero type errors (with configured `ignore_errors` overrides)
4. `pytest tests/ --cov=atlasbridge` — zero failures, coverage ≥ 50%
5. `atlasbridge version` — exits 0 without error
6. `atlasbridge doctor` — exits 0 on a configured install

Platform parity: all jobs pass on `macos-latest` and `ubuntu-latest`, Python 3.11 and 3.12.

The Windows CI runner on `windows-latest` is best-effort through v0.9.0 — failures are reported but do not block releases.
