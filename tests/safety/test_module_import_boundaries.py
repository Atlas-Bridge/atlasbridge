"""Safety tests: module import boundary enforcement.

Prevents import sprawl of the deprecated ``atlasbridge.tui`` package
into modules that should only use the canonical ``atlasbridge.ui``.

Part of issue #96 acceptance criteria.
"""

from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src" / "atlasbridge"


def _collect_imports(filepath: Path) -> list[str]:
    """Return all import source strings from a Python file."""
    try:
        tree = ast.parse(filepath.read_text(), filename=str(filepath))
    except SyntaxError:
        return []

    imports: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            imports.append(node.module)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imports.append(alias.name)
    return imports


def test_tui_not_imported_by_cli() -> None:
    """cli/ must not import from atlasbridge.tui — use atlasbridge.ui instead."""
    violations: list[str] = []
    cli_dir = SRC / "cli"
    for pyfile in cli_dir.rglob("*.py"):
        for imp in _collect_imports(pyfile):
            if imp.startswith("atlasbridge.tui"):
                violations.append(f"{pyfile.relative_to(ROOT)}: {imp}")

    assert not violations, "cli/ must not import from atlasbridge.tui (deprecated):\n" + "\n".join(
        f"  - {v}" for v in violations
    )


def test_tui_not_imported_by_core() -> None:
    """core/ must not import from atlasbridge.tui."""
    violations: list[str] = []
    core_dir = SRC / "core"
    for pyfile in core_dir.rglob("*.py"):
        for imp in _collect_imports(pyfile):
            if imp.startswith("atlasbridge.tui"):
                violations.append(f"{pyfile.relative_to(ROOT)}: {imp}")

    assert not violations, "core/ must not import from atlasbridge.tui (deprecated):\n" + "\n".join(
        f"  - {v}" for v in violations
    )


def test_tui_not_imported_by_adapters() -> None:
    """adapters/ must not import from atlasbridge.tui."""
    violations: list[str] = []
    adapters_dir = SRC / "adapters"
    for pyfile in adapters_dir.rglob("*.py"):
        for imp in _collect_imports(pyfile):
            if imp.startswith("atlasbridge.tui"):
                violations.append(f"{pyfile.relative_to(ROOT)}: {imp}")

    assert not violations, (
        "adapters/ must not import from atlasbridge.tui (deprecated):\n"
        + "\n".join(f"  - {v}" for v in violations)
    )


def test_tui_not_imported_by_channels() -> None:
    """channels/ must not import from atlasbridge.tui."""
    violations: list[str] = []
    channels_dir = SRC / "channels"
    for pyfile in channels_dir.rglob("*.py"):
        for imp in _collect_imports(pyfile):
            if imp.startswith("atlasbridge.tui"):
                violations.append(f"{pyfile.relative_to(ROOT)}: {imp}")

    assert not violations, (
        "channels/ must not import from atlasbridge.tui (deprecated):\n"
        + "\n".join(f"  - {v}" for v in violations)
    )


def test_only_ui_and_console_import_tui() -> None:
    """Only ui/ and console/ may import from atlasbridge.tui (shared service layer)."""
    allowed_dirs = {SRC / "ui", SRC / "tui", SRC / "console"}
    violations: list[str] = []

    for pyfile in SRC.rglob("*.py"):
        # Skip files inside ui/ and tui/ themselves
        if any(pyfile.is_relative_to(d) for d in allowed_dirs):
            continue
        for imp in _collect_imports(pyfile):
            if imp.startswith("atlasbridge.tui"):
                violations.append(f"{pyfile.relative_to(ROOT)}: {imp}")

    assert not violations, "Only ui/ may import from atlasbridge.tui (deprecated):\n" + "\n".join(
        f"  - {v}" for v in violations
    )


def test_claude_md_documents_canonical_ui_module() -> None:
    """CLAUDE.md must document which UI module is canonical."""
    claude_md = (ROOT / "CLAUDE.md").read_text()
    assert "ui module architecture" in claude_md.lower() or "canonical" in claude_md.lower(), (
        "CLAUDE.md must document which UI module is canonical"
    )
    assert "tui/" in claude_md, "CLAUDE.md must mention tui/ (legacy)"
    assert "ui/" in claude_md, "CLAUDE.md must mention ui/ (canonical)"
