## Summary

<!-- Describe what this PR does and why. Link to the relevant issue. -->

Closes #<!-- issue number -->

## Type of Change

- [ ] `feat` — New feature
- [ ] `fix` — Bug fix
- [ ] `docs` — Documentation only
- [ ] `refactor` — Code refactor (no feature/fix)
- [ ] `test` — Tests only
- [ ] `chore` — Build, CI, dependencies
- [ ] `security` — Security fix or hardening
- [ ] `perf` — Performance improvement

## Changes Made

<!-- Bullet list of specific changes -->

-
-

## Testing

<!-- How did you test this change? -->

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manually tested with `atlasbridge doctor`
- [ ] CI passes locally (`pytest`, `ruff`, `mypy`)

## Security Considerations

<!-- Did this change affect any security-sensitive areas? -->
<!-- If yes, describe the security impact and mitigations. -->

- [ ] No security impact
- [ ] Security impact assessed (describe below)

## Documentation

- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] Relevant `docs/` files updated
- [ ] Help text / `--help` output updated (if CLI change)

## Governance Gates

- [ ] Invariants confirmed ("Cloud OBSERVES, local EXECUTES" — see `docs/invariants.md`)
- [ ] No auto-merge requested
- [ ] Scope declared: <!-- docs-only / dashboard-only / core / CLI / tests -->
- [ ] All CI checks green before tagging
- [ ] No changes to `core/`, `os/`, `channels/`, `adapters/` unless explicitly required
- [ ] `BaseAdapter` / `BaseChannel` ABCs unchanged (or documented in breaking changes)
- [ ] Policy DSL schema unchanged (or documented in breaking changes)
- [ ] Dashboard default binding remains loopback-only
- [ ] No new production dependencies in core runtime
- [ ] Contract surface freeze respected (update safety tests if changing frozen surfaces)

## Checklist

- [ ] My branch follows the naming convention (`feature/`, `fix/`, `docs/`)
- [ ] My commits follow Conventional Commits format
- [ ] I have not committed any secrets or tokens
- [ ] CI is passing (lint, type check, tests, safety gate)
- [ ] Safety tests pass: `pytest tests/safety/ -v`
- [ ] I have requested a review
