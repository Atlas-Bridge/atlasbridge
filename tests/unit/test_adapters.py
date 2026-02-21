"""
Unit tests for adapter-specific prompt detector patterns.

Tests that OpenAI and Gemini CLI adapters correctly detect their tool-specific
prompt patterns using the extended detector classes.
"""

from __future__ import annotations

from aegis.adapters.gemini_cli import GeminiPromptDetector
from aegis.adapters.openai_cli import OpenAIPromptDetector
from aegis.core.prompt.models import PromptType

# ---------------------------------------------------------------------------
# OpenAI (Codex) adapter patterns
# ---------------------------------------------------------------------------


class TestOpenAIDetector:
    def _detector(self) -> OpenAIPromptDetector:
        return OpenAIPromptDetector(session_id="test-openai")

    # --- Yes/No ---

    def test_apply_changes_yes_no(self) -> None:
        d = self._detector()
        event = d.analyse(b"Apply changes? [y/n] ")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_YES_NO

    def test_run_command_yes_no(self) -> None:
        d = self._detector()
        event = d.analyse(b"Run command? [y/n] ")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_YES_NO

    def test_approve_action_yes_no(self) -> None:
        d = self._detector()
        event = d.analyse(b"Approve this action? (yes/no) ")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_YES_NO

    def test_allow_codex_yes_no(self) -> None:
        d = self._detector()
        event = d.analyse(b"Allow Codex to modify files? [y/n] ")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_YES_NO

    # --- Multiple choice ---

    def test_select_action_menu(self) -> None:
        d = self._detector()
        event = d.analyse(b"Select action:\n  1. Apply\n  2. Skip\n  3. Abort\n")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_MULTIPLE_CHOICE

    def test_choose_model(self) -> None:
        d = self._detector()
        event = d.analyse(b"Choose model: [1] gpt-4o  [2] gpt-4-turbo\n")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_MULTIPLE_CHOICE

    # --- Free text ---

    def test_enter_description(self) -> None:
        d = self._detector()
        event = d.analyse(b"Enter a description:")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_FREE_TEXT

    def test_provide_context(self) -> None:
        d = self._detector()
        event = d.analyse(b"Provide context:")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_FREE_TEXT

    # --- Generic patterns still work ---

    def test_generic_yes_no_still_detected(self) -> None:
        d = self._detector()
        event = d.analyse(b"Delete all files? [y/N]")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_YES_NO

    def test_no_false_positive_on_output(self) -> None:
        d = self._detector()
        event = d.analyse(b"Processing 3 files...\nDone.\n")
        assert event is None

    # --- Echo suppression ---

    def test_echo_suppression_after_injection(self) -> None:
        d = self._detector()
        d.mark_injected()
        # Immediately after injection, even a clear yes/no must be suppressed
        event = d.analyse(b"Apply changes? [y/n] ")
        assert event is None


# ---------------------------------------------------------------------------
# Gemini adapter patterns
# ---------------------------------------------------------------------------


class TestGeminiDetector:
    def _detector(self) -> GeminiPromptDetector:
        return GeminiPromptDetector(session_id="test-gemini")

    # --- Yes/No ---

    def test_do_you_want_to_continue(self) -> None:
        d = self._detector()
        event = d.analyse(b"Do you want to continue? (y/n) ")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_YES_NO

    def test_allow_gemini_to_execute(self) -> None:
        d = self._detector()
        event = d.analyse(b"Allow Gemini to execute this? [Yes/No] ")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_YES_NO

    def test_confirm_action(self) -> None:
        d = self._detector()
        event = d.analyse(b"Confirm action? [y/n] ")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_YES_NO

    def test_execute_this_code(self) -> None:
        d = self._detector()
        event = d.analyse(b"Execute this code? (yes/no) ")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_YES_NO

    # --- Multiple choice ---

    def test_select_option_menu(self) -> None:
        d = self._detector()
        event = d.analyse(b"Select an option:\n  1) Generate code\n  2) Explain code\n")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_MULTIPLE_CHOICE

    def test_choose_a_model(self) -> None:
        d = self._detector()
        event = d.analyse(b"Choose a model:\n  [1] gemini-1.5-pro\n  [2] gemini-1.5-flash\n")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_MULTIPLE_CHOICE

    # --- Free text ---

    def test_enter_your_prompt(self) -> None:
        d = self._detector()
        event = d.analyse(b"Enter your prompt:")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_FREE_TEXT

    def test_gemini_repl_prompt(self) -> None:
        d = self._detector()
        event = d.analyse(b"Gemini> ")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_FREE_TEXT

    def test_describe_the_task(self) -> None:
        d = self._detector()
        event = d.analyse(b"Describe the task:")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_FREE_TEXT

    # --- Generic patterns still work ---

    def test_generic_yes_no_still_detected(self) -> None:
        d = self._detector()
        event = d.analyse(b"Do you want to proceed? [y/N]")
        assert event is not None
        assert event.prompt_type == PromptType.TYPE_YES_NO

    def test_no_false_positive_on_output(self) -> None:
        d = self._detector()
        event = d.analyse(b"Generating response...\nDone in 2.3s\n")
        assert event is None

    # --- Echo suppression ---

    def test_echo_suppression_after_injection(self) -> None:
        d = self._detector()
        d.mark_injected()
        event = d.analyse(b"Do you want to continue? (y/n) ")
        assert event is None


# ---------------------------------------------------------------------------
# make_detector factory
# ---------------------------------------------------------------------------


class TestMakeDetector:
    def test_claude_adapter_uses_base_detector(self) -> None:
        from aegis.adapters.claude_code import ClaudeCodeAdapter
        from aegis.core.prompt.detector import PromptDetector

        adapter = ClaudeCodeAdapter()
        detector = adapter._make_detector("sess-1")
        assert type(detector) is PromptDetector

    def test_openai_adapter_uses_openai_detector(self) -> None:
        from aegis.adapters.openai_cli import OpenAIAdapter

        adapter = OpenAIAdapter()
        detector = adapter._make_detector("sess-2")
        assert isinstance(detector, OpenAIPromptDetector)

    def test_gemini_adapter_uses_gemini_detector(self) -> None:
        from aegis.adapters.gemini_cli import GeminiAdapter

        adapter = GeminiAdapter()
        detector = adapter._make_detector("sess-3")
        assert isinstance(detector, GeminiPromptDetector)
