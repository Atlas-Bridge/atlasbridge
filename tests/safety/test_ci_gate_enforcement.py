"""
Safety test: CI gate enforcement.

Verifies structural properties of .github/workflows/ci.yml:
  - Required jobs exist (smoke, lint, test, security-scan, build)
  - Build depends on lint, test, AND ethics-safety-gate
  - Ethics-safety-gate job exists and runs safety tests
"""

from __future__ import annotations

from pathlib import Path

import yaml

CI_YAML = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ci.yml"


def _load_ci_config() -> dict:
    """Load and parse the CI workflow YAML."""
    assert CI_YAML.exists(), f"CI config not found at {CI_YAML}"
    return yaml.safe_load(CI_YAML.read_text(encoding="utf-8"))


class TestCIJobsExist:
    """Required CI jobs must be defined."""

    def test_smoke_job_exists(self) -> None:
        config = _load_ci_config()
        assert "smoke" in config["jobs"], "Missing 'smoke' job"

    def test_lint_job_exists(self) -> None:
        config = _load_ci_config()
        assert "lint" in config["jobs"], "Missing 'lint' job"

    def test_test_job_exists(self) -> None:
        config = _load_ci_config()
        assert "test" in config["jobs"], "Missing 'test' job"

    def test_security_scan_job_exists(self) -> None:
        config = _load_ci_config()
        assert "security-scan" in config["jobs"], "Missing 'security-scan' job"

    def test_build_job_exists(self) -> None:
        config = _load_ci_config()
        assert "build" in config["jobs"], "Missing 'build' job"

    def test_ethics_safety_gate_job_exists(self) -> None:
        config = _load_ci_config()
        assert "ethics-safety-gate" in config["jobs"], "Missing 'ethics-safety-gate' job"


class TestBuildDependencies:
    """Build must depend on safety-critical jobs."""

    def test_build_depends_on_lint(self) -> None:
        config = _load_ci_config()
        needs = config["jobs"]["build"]["needs"]
        assert "lint" in needs, "Build must depend on lint"

    def test_build_depends_on_test(self) -> None:
        config = _load_ci_config()
        needs = config["jobs"]["build"]["needs"]
        assert "test" in needs, "Build must depend on test"

    def test_build_depends_on_ethics_safety_gate(self) -> None:
        config = _load_ci_config()
        needs = config["jobs"]["build"]["needs"]
        assert "ethics-safety-gate" in needs, "Build must depend on ethics-safety-gate"


class TestSafetyGateStructure:
    """The ethics-safety-gate job must run safety tests."""

    def test_safety_gate_runs_safety_tests(self) -> None:
        config = _load_ci_config()
        job = config["jobs"]["ethics-safety-gate"]
        steps = job["steps"]
        # Find the step that runs pytest on tests/safety/
        run_steps = [s.get("run", "") for s in steps if "run" in s]
        safety_test_commands = [r for r in run_steps if "tests/safety" in r]
        assert len(safety_test_commands) >= 1, (
            "ethics-safety-gate must include a step running 'pytest tests/safety/'"
        )

    def test_safety_gate_depends_on_smoke(self) -> None:
        config = _load_ci_config()
        job = config["jobs"]["ethics-safety-gate"]
        needs = job.get("needs", [])
        assert "smoke" in needs, "ethics-safety-gate should depend on smoke"
