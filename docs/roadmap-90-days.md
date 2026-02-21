# AtlasBridge Roadmap

**Version:** 0.6.2
**Status:** Active
**Last updated:** 2026-02-21

---

## Where We Are

AtlasBridge v0.6.2 is released and available on PyPI. The core autonomous runtime is complete and production-capable on macOS and Linux.

Key capabilities shipped:

- **Policy DSL v0** — deterministic, first-match-wins rule engine with YAML authoring
- **Autopilot Engine** — three autonomy modes (Off / Assist / Full) with instant kill switch
- **PTY supervisor** — macOS and Linux, Claude Code + OpenAI + Gemini adapters
- **Telegram + Slack** — dual-channel notification with inline keyboard responses
- **Interactive TUI** — setup wizard, sessions, logs, doctor
- **Audit infrastructure** — hash-chained audit log + append-only decision trace (JSONL)

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

---

## Upcoming Milestones

### v0.7.0 — Windows (ConPTY, Experimental)

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
- [ ] `CHANGELOG.md` updated; `v0.7.0` tag created

---

### v0.7.1 — Policy Engine Hardening

**Theme:** Make the autonomy engine production-grade for always-on workloads.

**Deliverables:**

- **Per-rule rate limits** — `max_auto_replies: N` cap per session; prevents runaway automation on looping prompts
- **Policy hot-reload** — `SIGHUP` reloads policy without daemon restart; new rules take effect on next prompt
- **Slack kill switch** — `/pause`, `/resume`, `/stop`, `/status` commands in Slack (full parity with Telegram)
- **Multi-session kill switch** — `atlasbridge pause --all` instantly pauses every active session
- **Kill switch history** — `atlasbridge autopilot history` shows state transitions with timestamps and who triggered each change

**Definition of done:**

- [ ] Per-rule `max_auto_replies` enforced in `PolicyEvaluator`; limit documented in `docs/policy-dsl.md`
- [ ] `SIGHUP` triggers `PolicyLoader.reload()` without interrupting in-flight sessions
- [ ] Slack channel `/pause` and `/resume` functional and covered by channel harness tests
- [ ] `atlasbridge pause --all` pauses all active sessions atomically
- [ ] `atlasbridge autopilot history` command functional with `--json` output
- [ ] `CHANGELOG.md` updated; `v0.7.1` tag created

---

### v0.8.0 — Policy DSL v1

**Theme:** A richer, more expressive policy language for complex autonomous workflows.

**DSL v1 additions:**

- **Compound conditions** — `any_of`, `all_of`, `none_of` match operators for multi-field rules
- **Session context matching** — `match.session.cwd`, `match.session.tag`, `match.session.tool`
- **Confidence ranges** — `min_confidence: medium, max_confidence: high` for bounded automation
- **Per-session overrides** — inject session-scoped policy at run time: `atlasbridge run claude --policy override.yaml`
- **Decision trace archival** — configurable rotation of `autopilot_decisions.jsonl` (by size or age)
- **Policy inheritance** — `extends: base-policy.yaml` for composing shared rules with overrides

**Compatibility guarantee:** `policy_version: "0"` policies parse and evaluate identically to v0.6.x. No migration required unless you want v1 features.

**Definition of done:**

- [ ] `policy_version: "0"` and `policy_version: "1"` use separate parsers; no v0 regressions
- [ ] Compound conditions functional in `PolicyEvaluator`
- [ ] Session-context matching functional (`cwd`, `tag`, `tool`)
- [ ] Per-session CLI override (`atlasbridge run claude --policy override.yaml`)
- [ ] Decision trace rotation configurable in `config.toml`
- [ ] `atlasbridge policy migrate` command converts v0 → v1 format
- [ ] `docs/policy-dsl.md` updated with full v1 syntax reference
- [ ] `CHANGELOG.md` updated; `v0.8.0` tag created

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
**Impact:** v0.7.0 ships with unresolved platform bugs

Windows ConPTY has known behavioural differences across Windows builds. Third-party wrappers have historically had version-specific issues.

**Mitigation:**

- Entire Windows adapter ships behind `--experimental` flag — no production-readiness pressure
- WSL2 documented as the recommended path; ConPTY is optional
- Windows CI runner is best-effort (non-blocking on the release)
- QA-020 gates correctness only; performance is a post-GA concern

---

### Risk 2: Policy DSL v1 Breaking v0 Policies

**Likelihood:** Medium
**Impact:** Existing users' policies stop working after v0.8.0

Compound conditions and session-context matching may create parser ambiguity or change evaluation precedence.

**Mitigation:**

- `policy_version: "0"` and `policy_version: "1"` use completely separate parsers
- The v0 parser is frozen at v0.7.1 — no changes after that release
- `atlasbridge policy migrate` command converts v0 → v1 format automatically
- Migration guide published alongside the v0.8.0 release

---

### Risk 3: Event Loop Latency Under High-Volume Output

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
| v0.7.0 | Windows ConPTY (experimental) | Planned |
| v0.7.1 | Policy engine hardening | Planned |
| v0.8.0 | Policy DSL v1 | Planned |
| v1.0.0 | GA — stable, multi-platform, multi-agent | Post-roadmap |

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

The Windows CI runner on `windows-latest` is best-effort through v0.7.0 — failures are reported but do not block releases.
