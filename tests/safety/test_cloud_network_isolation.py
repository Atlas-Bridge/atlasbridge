"""
Safety test: Cloud module network isolation.

The cloud module (src/atlasbridge/cloud/) contains INTERFACE DEFINITIONS ONLY.
No network-capable libraries may be imported.  This AST-based scanner walks
every .py file in the module and fails if any banned import is found.

Banned modules: requests, httpx, aiohttp, urllib3, socket, websockets,
                urllib.request, http.client, grpc
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

CLOUD_DIR = Path(__file__).resolve().parents[2] / "src" / "atlasbridge" / "cloud"

BANNED_MODULES: frozenset[str] = frozenset(
    {
        "requests",
        "httpx",
        "aiohttp",
        "urllib3",
        "socket",
        "websockets",
        "urllib.request",
        "http.client",
        "grpc",
    }
)

BANNED_TOP_LEVEL: frozenset[str] = frozenset({m.split(".")[0] for m in BANNED_MODULES})


def _get_cloud_py_files() -> list[Path]:
    """Return all .py files under the cloud module directory."""
    assert CLOUD_DIR.is_dir(), f"Cloud module not found at {CLOUD_DIR}"
    return sorted(CLOUD_DIR.glob("**/*.py"))


def _extract_imports(source: str) -> list[str]:
    """Extract all imported module names from Python source using AST."""
    tree = ast.parse(source)
    modules: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                modules.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                modules.append(node.module)
    return modules


class TestCloudNetworkIsolation:
    """AST-based static analysis: no network imports in cloud module."""

    def test_cloud_dir_exists(self) -> None:
        assert CLOUD_DIR.is_dir(), f"Cloud module not found at {CLOUD_DIR}"

    def test_cloud_module_has_python_files(self) -> None:
        files = _get_cloud_py_files()
        assert len(files) > 0, "Cloud module should contain at least one .py file"

    def test_no_banned_imports_in_cloud_module(self) -> None:
        """Scan every .py file under cloud/ for banned network imports."""
        violations: list[str] = []
        for py_file in _get_cloud_py_files():
            source = py_file.read_text(encoding="utf-8")
            imports = _extract_imports(source)
            for imp in imports:
                top_level = imp.split(".")[0]
                if top_level in BANNED_TOP_LEVEL or imp in BANNED_MODULES:
                    violations.append(f"{py_file.name}: imports {imp!r}")

        assert not violations, (
            "Cloud module must not import network libraries.\n"
            "Violations:\n" + "\n".join(f"  - {v}" for v in violations)
        )

    @pytest.mark.parametrize(
        "filename",
        [
            "__init__.py",
            "auth.py",
            "client.py",
            "transport.py",
            "protocol.py",
            "registry.py",
            "audit_stream.py",
        ],
    )
    def test_individual_file_no_network_imports(self, filename: str) -> None:
        """Per-file check: each cloud module file has zero network imports."""
        path = CLOUD_DIR / filename
        if not path.exists():
            pytest.skip(f"{filename} does not exist yet")
        source = path.read_text(encoding="utf-8")
        imports = _extract_imports(source)
        for imp in imports:
            top_level = imp.split(".")[0]
            assert top_level not in BANNED_TOP_LEVEL and imp not in BANNED_MODULES, (
                f"{filename} imports banned module {imp!r}"
            )

    def test_no_subprocess_calls_in_cloud_module(self) -> None:
        """Ensure no subprocess usage (potential remote exec vector)."""
        for py_file in _get_cloud_py_files():
            source = py_file.read_text(encoding="utf-8")
            tree = ast.parse(source)
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module == "subprocess":
                    pytest.fail(f"{py_file.name}: imports subprocess")
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name == "subprocess":
                            pytest.fail(f"{py_file.name}: imports subprocess")
