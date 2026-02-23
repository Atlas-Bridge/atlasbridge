"""Integration tests for conversation flow with ConversationRegistry."""

from __future__ import annotations

from atlasbridge.core.conversation.session_binding import (
    ConversationRegistry,
    ConversationState,
)


class TestConversationBindingFlow:
    """Thread→session binding lifecycle during conversation."""

    def test_bind_and_resolve(self) -> None:
        """Binding a thread to a session allows resolution."""
        registry = ConversationRegistry()
        registry.bind("telegram", "12345", "sess-001")

        assert registry.resolve("telegram", "12345") == "sess-001"

    def test_two_threads_two_sessions(self) -> None:
        """Messages route to correct sessions via thread binding."""
        registry = ConversationRegistry()
        registry.bind("telegram", "chat-100", "sess-001")
        registry.bind("telegram", "chat-200", "sess-002")

        assert registry.resolve("telegram", "chat-100") == "sess-001"
        assert registry.resolve("telegram", "chat-200") == "sess-002"

    def test_state_transitions_during_flow(self) -> None:
        """State transitions reflect conversation lifecycle."""
        registry = ConversationRegistry()
        binding = registry.bind("telegram", "chat-100", "sess-001")
        assert binding.state == ConversationState.RUNNING

        registry.update_state("telegram", "chat-100", ConversationState.AWAITING_INPUT)
        b = registry.get_binding("telegram", "chat-100")
        assert b is not None
        assert b.state == ConversationState.AWAITING_INPUT

    def test_unbind_on_session_end(self) -> None:
        """Unbinding a session removes all its thread bindings."""
        registry = ConversationRegistry()
        registry.bind("telegram", "chat-100", "sess-001")
        registry.bind("slack", "C123:ts", "sess-001")

        count = registry.unbind("sess-001")
        assert count == 2
        assert registry.resolve("telegram", "chat-100") is None
        assert registry.resolve("slack", "C123:ts") is None

    def test_expired_binding_falls_through(self) -> None:
        """Expired binding returns None, allowing legacy first-match."""
        registry = ConversationRegistry(ttl_seconds=0.0)
        registry.bind("telegram", "chat-100", "sess-001")

        # Immediately expired
        assert registry.resolve("telegram", "chat-100") is None

    def test_multi_channel_same_session(self) -> None:
        """A session can be bound to threads on multiple channels."""
        registry = ConversationRegistry()
        registry.bind("telegram", "chat-100", "sess-001")
        registry.bind("slack", "C123:ts", "sess-001")

        bindings = registry.bindings_for_session("sess-001")
        assert len(bindings) == 2
        channels = {b.channel_name for b in bindings}
        assert channels == {"telegram", "slack"}


class TestConversationRegistryIsolation:
    """Ensure sessions don't leak across threads."""

    def test_different_channel_same_thread_id(self) -> None:
        """Same thread_id on different channels doesn't collide."""
        registry = ConversationRegistry()
        registry.bind("telegram", "12345", "sess-001")
        registry.bind("slack", "12345", "sess-002")

        assert registry.resolve("telegram", "12345") == "sess-001"
        assert registry.resolve("slack", "12345") == "sess-002"

    def test_rebind_replaces_session(self) -> None:
        """Rebinding a thread overwrites the previous session."""
        registry = ConversationRegistry()
        registry.bind("telegram", "chat-100", "sess-001")
        registry.bind("telegram", "chat-100", "sess-002")

        assert registry.resolve("telegram", "chat-100") == "sess-002"
