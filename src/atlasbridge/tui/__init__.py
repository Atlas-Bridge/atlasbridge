"""DEPRECATED — Shared TUI state and service layer.

.. deprecated:: 0.9.7
    This package is a legacy support layer preserved for backward compatibility.
    The canonical UI module is ``atlasbridge.ui``.

    - ``tui.state`` and ``tui.services`` are re-exported by ``atlasbridge.ui.state``
    - No new code should import directly from ``atlasbridge.tui``
    - This package will be consolidated into ``atlasbridge.ui`` in v1.1.0

This package contains pure-Python state definitions (``state.py``) and
service wrappers (``services.py``) that the production ``ui`` package
depends on.  These modules have no Textual dependency and are testable
without a running terminal.

The UI screens and app entry point live in ``atlasbridge.ui``.
"""
