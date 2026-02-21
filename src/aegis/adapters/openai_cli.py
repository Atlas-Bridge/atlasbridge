"""
OpenAI CLI adapter stub.

Wraps the OpenAI CLI tool (openai-cli) in a PTY supervisor.
Inherits from ClaudeCodeAdapter — the prompt detection and injection
logic is identical; only the tool_name and description differ.

Stub status: The OpenAI CLI prompt patterns are not yet fully characterised.
The adapter works but uses the generic pattern library from detector.py.
Tool-specific patterns will be added in v0.3.0.

Registration key: "openai"
"""

from __future__ import annotations

from aegis.adapters.base import AdapterRegistry
from aegis.adapters.claude_code import ClaudeCodeAdapter


@AdapterRegistry.register("openai")
class OpenAIAdapter(ClaudeCodeAdapter):
    """
    Adapter for the OpenAI CLI tool.

    Inherits all PTY/detection logic from ClaudeCodeAdapter.
    OpenAI-specific prompt patterns will be characterised and added in v0.3.0.
    """

    tool_name = "openai"
    description = "OpenAI CLI (openai-cli)"
    min_tool_version = "1.0.0"


@AdapterRegistry.register("custom")
class CustomCLIAdapter(ClaudeCodeAdapter):
    """
    Generic adapter for any interactive CLI tool.

    Uses the generic tri-signal detector. No tool-specific pattern tuning.
    Suitable for: any interactive CLI that produces text prompts.
    """

    tool_name = "custom"
    description = "Generic interactive CLI (any tool)"
    min_tool_version = ""
