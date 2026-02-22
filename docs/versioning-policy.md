# Versioning Policy

## SemVer Commitment

AtlasBridge follows [Semantic Versioning 2.0.0](https://semver.org/):

- **Major version** (X.0.0) — contains breaking changes to frozen contract surfaces
- **Minor version** (0.X.0) — adds features in a backwards-compatible manner
- **Patch version** (0.0.X) — bug fixes, documentation updates, CI changes

Version strings must match in all three locations:
- `pyproject.toml` → `[project].version`
- `src/atlasbridge/__init__.py` → `__version__`
- Git tag → `vX.Y.Z`

The publish workflow enforces this automatically.

---

## Deprecation Policy

Features are deprecated for a minimum of **one minor version cycle** before removal.

### Process

1. Add a `DeprecationWarning` to the feature with a message explaining the replacement.
2. Document the deprecation in the CHANGELOG under the version that introduces the warning.
3. The feature continues to work normally during the deprecation period.
4. Remove the feature in the next major version (or after at least one minor release).

### Current Deprecations

| Feature | Warning Since | Removal Target |
|---------|--------------|----------------|
| `AegisConfig` alias | v0.9.0 | v1.0 |
| `AegisError` alias | v0.9.0 | v1.0 |

---

## Breaking Change Protocol

A change is breaking if it modifies any frozen contract surface:

1. BaseAdapter ABC — abstract method set, method signatures
2. BaseChannel ABC — abstract method set, method signatures
3. Policy DSL schema — field names, enum values, default values
4. CLI command tree — command names, required options
5. Dashboard routes — route paths, HTTP methods
6. Console surface — command options, default values
7. Audit schema — table names, column names
8. Config schema — field names, environment variables

### To make a breaking change:

1. Update the corresponding safety test in `tests/safety/`.
2. Document the change in CHANGELOG as a breaking change.
3. Increment the major version.
4. Update `docs/contract-surfaces.md` with the new surface definition.
5. Ensure all existing tests still pass.

---

## Contract Freeze Rules

- Frozen surfaces are defined in `docs/contract-surfaces.md`.
- Each frozen surface has a corresponding safety test in `tests/safety/`.
- CI fails if any safety test detects drift from the frozen definition.
- Adding to a frozen surface (new methods, new routes) is allowed in minor versions.
- Removing from or renaming within a frozen surface requires a major version.

---

## Tag-Only Release Policy

- Releases are published to PyPI only on git tag push (`v*.*.*`).
- Push to `main` never triggers a publish.
- RC tags (`v*.*.*-rc*`) publish to TestPyPI, not PyPI.
- Manual `workflow_dispatch` is available for re-publishing.

### Release Process

1. All CI checks must be green on `main`.
2. Bump version in `pyproject.toml` and `__init__.py`.
3. Update CHANGELOG.md.
4. Commit and push to `main`.
5. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
6. Publish workflow runs automatically.

### Pre-Publish Gates

The publish workflow runs these checks before publishing:

- `ruff check .`
- `ruff format --check .`
- `mypy src/atlasbridge/`
- `pytest tests/ -q`
- `python -m build`
- `twine check dist/*`

If any gate fails, the publish is aborted.

---

## CI Requirements

All CI checks must be green before tagging a release:

- CLI Smoke Tests
- Lint & Type Check
- Test matrix (ubuntu 3.11, ubuntu 3.12, macOS 3.11)
- Security Scan
- Ethics & Safety Gate
- Build Distribution
- Packaging Smoke Test
