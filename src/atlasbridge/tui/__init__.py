"""Shared TUI state and service layer — used by ``atlasbridge.ui``.

This package contains pure-Python state definitions (``state.py``) and
service wrappers (``services.py``) that the production ``ui`` package
depends on.  These modules have no Textual dependency and are testable
without a running terminal.

The UI screens and app entry point live in ``atlasbridge.ui``.
"""
