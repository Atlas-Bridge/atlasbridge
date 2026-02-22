# GA Readiness Checklist

Assessment date: 2026-02-22

---

## Contract Freeze Status

| Surface | Frozen | Safety Test | Status |
|---------|--------|-------------|--------|
| Adapter API | Yes | `test_adapter_api_stability.py` | PASS |
| Channel API | Yes | `test_channel_api_stability.py` | PASS |
| Policy DSL | Yes | `test_policy_schema_stability.py` | PASS |
| CLI commands | Yes | `test_cli_surface_stability.py` | PASS |
| Dashboard routes | Yes | `test_dashboard_route_freeze.py` | PASS |
| Console surface | Yes | `test_console_surface_freeze.py` | PASS |
| Audit schema | Yes | `test_audit_schema_stability.py` | PASS |
| Config schema | Yes | `test_config_schema_stability.py` | PASS |

All 8 contract surfaces are frozen and enforced by CI.

---

## API Stability Commitment

- Stability levels defined in `docs/api-stability-policy.md`
- Deprecation policy: minimum 1 minor version cycle before removal
- Breaking change protocol: requires major version bump + safety test update
- Contract surfaces documented in `docs/contract-surfaces.md`

**Status:** PASS

---

## Coverage Metrics

| Metric | Value | Floor |
|--------|-------|-------|
| Global coverage | 85.92% | 80% |
| Core coverage | ~89% | 85% |
| Total tests | 1336 | — |
| Safety tests | 185 | — |
| Safety test files | 22 | 22 |

**Status:** PASS

---

## Threat Model Summary (Local-Only Attack Surface)

AtlasBridge v1.0 is local-only. The attack surface is:

| Boundary | Exposure | Mitigation |
|----------|----------|------------|
| Dashboard HTTP | Localhost only (127.0.0.1) | Loopback enforcement; `--i-understand-risk` for non-loopback |
| SQLite database | Local filesystem | Read-only dashboard access (`?mode=ro`) |
| Telegram/Slack tokens | Local config file | Token redaction in dashboard, logs, exports |
| PTY stdin injection | Local process | Nonce idempotency, TTL enforcement, session binding |
| Policy files | Local filesystem | Schema validation, `policy_version` field |

No network-facing services. No authentication required (network isolation is the boundary). No remote code execution path.

Full threat model: `docs/threat-model.md`

**Status:** PASS

---

## Backwards Compatibility

- Config migration from Aegis (`~/.aegis/`) is automatic
- Policy DSL v0 and v1 are both supported
- `AegisConfig` and `AegisError` aliases emit `DeprecationWarning`
- No breaking changes to frozen contract surfaces since v0.9.0

**Status:** PASS

---

## Release Reproducibility

- Build system: setuptools with `pyproject.toml`
- Publish: OIDC trusted publishing via GitHub Actions (tag-triggered)
- Version validation: tag must match `pyproject.toml` and `__init__.py`
- Pre-publish gates: lint, type check, test suite, twine check
- Artifacts: sdist + wheel, `.tcss` asset verification

**Status:** PASS

---

## CI Matrix Coverage

| Job | Trigger | Platforms |
|-----|---------|-----------|
| CLI Smoke Tests | push/PR | ubuntu |
| Lint & Type Check | push/PR | ubuntu |
| Tests | push/PR | ubuntu 3.11, ubuntu 3.12, macOS 3.11 |
| Security Scan (bandit) | push/PR | ubuntu |
| Ethics & Safety Gate | push/PR | ubuntu |
| Build Distribution | push/PR | ubuntu |
| Packaging Smoke Test | push/PR | ubuntu (3.12) |
| Secret Scan | PR + weekly | ubuntu |
| Dependency Audit | PR + weekly | ubuntu |

**Status:** PASS

---

## Verdict

### CONDITIONAL — requires freeze window

**Rationale:**

All technical gates pass. Contract surfaces are frozen. Coverage exceeds floors. CI matrix is comprehensive. Threat model is well-defined for local-only scope.

However, GA release requires:

1. **Classifier update** — `Development Status :: 2 - Pre-Alpha` must change to `4 - Beta` or `5 - Production/Stable` (safety test currently blocks `Production/Stable` for pre-1.0; update the test when tagging v1.0)
2. **README status table** — still shows `v0.9.0 | Planned` for Windows; update to reflect actual state
3. **Soak period** — recommend 2-week freeze window with no feature changes to validate stability
4. **Version string sync** — verify `pyproject.toml`, `__init__.py`, and CLAUDE.md all agree on version at tag time

**Top 5 Risk Areas:**

1. **Windows support** — PTY supervisor is stub-only; `ConPTY` not implemented. Document as unsupported in v1.0.
2. **Core coverage gap** — `keyring_store.py` at 58%, `session/manager.py` at 76%. Not blocking but should be addressed.
3. **Dashboard authentication** — no auth; relies entirely on localhost binding. Document clearly.
4. **Telegram polling singleton** — fixed but historically fragile under concurrent instances.
5. **Policy hot-reload** — file watcher reliability under heavy load not stress-tested.

**Recommendation:** Declare a 2-week freeze window. If no regressions surface, tag v1.0.0.
