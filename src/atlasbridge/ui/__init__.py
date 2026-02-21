"""
AtlasBridge interactive terminal UI — ``src/atlasbridge/ui/``.

This package provides the production Textual UI skeleton.  It is a pure
orchestration layer: no PTY imports, no I/O of its own.  All data comes
from the service / polling layer which delegates to the existing CLI helpers.

Entry point::

    from atlasbridge.ui.app import run
    run()
"""
