"""Unit tests for atlasbridge.core.prompt.sanitize — ANSI sanitization + choice extraction."""

from __future__ import annotations

from atlasbridge.core.prompt.sanitize import (
    extract_choices,
    is_meaningful,
    sanitize_terminal_output,
    strip_ansi,
)

# ---------------------------------------------------------------------------
# strip_ansi
# ---------------------------------------------------------------------------


class TestStripAnsi:
    def test_standard_sgr_codes(self) -> None:
        assert strip_ansi("\x1b[31mred\x1b[0m") == "red"

    def test_bold_and_reset(self) -> None:
        assert strip_ansi("\x1b[1mbold\x1b[0m") == "bold"

    def test_private_mode_csi(self) -> None:
        """Root cause fix: \x1b[?1004l was not stripped by old regex."""
        assert strip_ansi("\x1b[?1004l") == ""

    def test_multiple_private_mode(self) -> None:
        assert strip_ansi("\x1b[?1004l\x1b[?2004l") == ""

    def test_private_mode_enable(self) -> None:
        assert strip_ansi("\x1b[?2004h") == ""

    def test_osc_bel_terminated(self) -> None:
        assert strip_ansi("\x1b]0;Window Title\x07") == ""

    def test_osc_st_terminated(self) -> None:
        assert strip_ansi("\x1b]0;Title\x1b\\") == ""

    def test_charset_designator(self) -> None:
        assert strip_ansi("\x1b(B") == ""

    def test_carriage_return_stripped(self) -> None:
        assert strip_ansi("hello\rworld") == "helloworld"

    def test_mixed_ansi_and_text(self) -> None:
        raw = "\x1b[?1004l\x1b[?2004l\x1b[32mContinue? [y/n]\x1b[0m"
        result = strip_ansi(raw)
        assert result == "Continue? [y/n]"

    def test_cursor_movement(self) -> None:
        assert strip_ansi("\x1b[10;20H") == ""

    def test_erase_line(self) -> None:
        assert strip_ansi("\x1b[2K") == ""

    def test_plain_text_unchanged(self) -> None:
        text = "Hello, world! This is a normal string."
        assert strip_ansi(text) == text


# ---------------------------------------------------------------------------
# is_meaningful
# ---------------------------------------------------------------------------


class TestIsMeaningful:
    def test_real_prompt_is_meaningful(self) -> None:
        assert is_meaningful("Continue? [y/n]") is True

    def test_ansi_junk_remnants_not_meaningful(self) -> None:
        """After stripping \x1b[?1004l, remnants like '?1004l' had ≥3 chars."""
        assert is_meaningful("") is False

    def test_pure_symbols_not_meaningful(self) -> None:
        assert is_meaningful("???") is False

    def test_short_text_not_meaningful(self) -> None:
        assert is_meaningful("ab") is False

    def test_whitespace_only_not_meaningful(self) -> None:
        assert is_meaningful("   \n\t  ") is False

    def test_three_alphanumeric_chars_meaningful(self) -> None:
        assert is_meaningful("abc") is True

    def test_numbers_meaningful(self) -> None:
        assert is_meaningful("123") is True

    def test_mixed_symbols_with_alpha_meaningful(self) -> None:
        assert is_meaningful(">> ok") is True

    def test_ansi_wrapped_text_meaningful(self) -> None:
        assert is_meaningful("\x1b[32mGreen text\x1b[0m") is True

    def test_only_private_mode_csi_not_meaningful(self) -> None:
        assert is_meaningful("\x1b[?1004l\x1b[?2004l") is False


# ---------------------------------------------------------------------------
# sanitize_terminal_output
# ---------------------------------------------------------------------------


class TestSanitizeTerminalOutput:
    def test_cr_line_overwrite(self) -> None:
        result = sanitize_terminal_output("old text\rnew text")
        assert result == "new text"

    def test_ansi_plus_cr(self) -> None:
        result = sanitize_terminal_output("\x1b[32mold\x1b[0m\rnew")
        assert result == "new"

    def test_multiline_with_cr(self) -> None:
        result = sanitize_terminal_output("line1\rL1\nline2\rL2")
        assert result == "L1\nL2"

    def test_plain_text_passthrough(self) -> None:
        result = sanitize_terminal_output("hello world")
        assert result == "hello world"


# ---------------------------------------------------------------------------
# extract_choices
# ---------------------------------------------------------------------------


class TestExtractChoices:
    def test_numbered_with_paren(self) -> None:
        text = "Pick a strategy:\n  1) Fast\n  2) Balanced\n  3) Thorough"
        choices = extract_choices(text)
        assert choices == ["Fast", "Balanced", "Thorough"]

    def test_numbered_with_dot(self) -> None:
        text = "Choose:\n1. Alpha\n2. Bravo\n3. Charlie"
        choices = extract_choices(text)
        assert choices == ["Alpha", "Bravo", "Charlie"]

    def test_numbered_with_colon(self) -> None:
        text = "Options:\n1: First\n2: Second"
        choices = extract_choices(text)
        assert choices == ["First", "Second"]

    def test_lettered_with_paren(self) -> None:
        text = "Choose:\na) Apple\nb) Banana\nc) Cherry"
        choices = extract_choices(text)
        assert choices == ["Apple", "Banana", "Cherry"]

    def test_lettered_uppercase(self) -> None:
        text = "Options:\nA. Install\nB. Update"
        choices = extract_choices(text)
        assert choices == ["Install", "Update"]

    def test_inline_bracket_three_options(self) -> None:
        text = "Mode: [fast/balanced/thorough]"
        choices = extract_choices(text)
        assert choices == ["fast", "balanced", "thorough"]

    def test_inline_paren_options(self) -> None:
        text = "Strategy (quick/normal/careful):"
        choices = extract_choices(text)
        assert choices == ["quick", "normal", "careful"]

    def test_yn_bracket_excluded(self) -> None:
        """Simple [Y/n] is TYPE_YES_NO territory — extract_choices should return []."""
        text = "Continue? [Y/n]"
        choices = extract_choices(text)
        assert choices == []

    def test_yn_paren_excluded(self) -> None:
        text = "Proceed? (y/N)"
        choices = extract_choices(text)
        assert choices == []

    def test_no_choices_plain_text(self) -> None:
        text = "Processing 100 items..."
        choices = extract_choices(text)
        assert choices == []

    def test_non_consecutive_numbers_rejected(self) -> None:
        """Numbering must start at 1 and be consecutive."""
        text = "Options:\n2) Second\n4) Fourth"
        choices = extract_choices(text)
        assert choices == []

    def test_single_item_not_a_choice(self) -> None:
        text = "1) Only option"
        choices = extract_choices(text)
        assert choices == []

    def test_ansi_in_choices_stripped(self) -> None:
        text = "\x1b[32m1) Green\x1b[0m\n\x1b[31m2) Red\x1b[0m"
        choices = extract_choices(text)
        assert choices == ["Green", "Red"]
