# Chat Session Mode

AtlasBridge v0.10.0 introduces a full conversational agent mode where users can interact with AI CLI agents naturally through Telegram or Slack.

## Session States

Each conversation binding tracks its state via the `ConversationState` enum:

```
IDLE ──► RUNNING ──► STREAMING ──► RUNNING (cycle)
              │           │              │
              ▼           ▼              ▼
         AWAITING_INPUT   │         AWAITING_INPUT
              │           │              │
              ▼           ▼              ▼
           STOPPED     STOPPED        STOPPED
```

| State | Description | User messages |
|-------|-------------|---------------|
| `IDLE` | Bound but session not yet started | Dropped |
| `RUNNING` | Agent active, accepting input | Routed to chat mode (injected into PTY) |
| `STREAMING` | Agent producing output | Rejected by gate with feedback |
| `AWAITING_INPUT` | Prompt detected, waiting on user | Resolved to active prompt |
| `STOPPED` | Session ended | Rejected by gate |

## State-Driven Routing

When a user sends a message (not a button response), the router first evaluates the **ChannelMessageGate**. The gate reads a frozen context snapshot (session state, identity, active prompt) and returns an immediate accept/reject decision. No messages are ever queued.

1. **STREAMING** -- The gate rejects the message. The user sees feedback: "Agent is working. Wait for the current operation to finish."

2. **RUNNING / IDLE** -- If accepted by the gate, the message goes to the chat mode handler, which injects it into the agent's PTY stdin via `execute_chat_input()`.

3. **AWAITING_INPUT** -- If there's an active prompt, the message resolves to that prompt. Otherwise, falls through to chat mode.

## Channel Message Gate

Every incoming channel message is evaluated by the gate before any state mutation or injection. The gate is a pure, deterministic function that reads a `GateContext` snapshot and returns a `GateDecision`:

- **Accept** — message proceeds to routing (chat mode or prompt resolution)
- **Reject** — message is dropped and the user gets feedback with a reason and next-action hint

Rejection reasons include: busy (streaming/running), no active session, identity not allowlisted, TTL expired, unsafe input type (password), policy deny.

## Conversation Registry

The `ConversationRegistry` maps `(channel_name, thread_id)` to `session_id`, enabling:

- **Deterministic routing**: Messages in a thread always reach the correct session
- **State tracking**: Each binding has its own `ConversationState`
- **TTL expiry**: Bindings expire after 4 hours of inactivity
- **Multi-channel**: A session can have bindings across Telegram and Slack simultaneously

## Validated Transitions

State transitions are validated against `VALID_CONVERSATION_TRANSITIONS`. Invalid transitions are rejected and logged. This prevents impossible state combinations (e.g., a STOPPED session transitioning to RUNNING).
