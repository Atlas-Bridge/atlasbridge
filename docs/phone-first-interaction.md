# Phone-First Interaction Model

**Status:** Enforced since v0.10.0
**Part of:** Epic #145 — Local-Only Execution Boundary

---

## Principle

AtlasBridge operators interact with their sessions primarily from phones via Telegram or Slack. All interactive flows must be operable via **plain text replies**. No taps, buttons, or structured UI elements are required.

Buttons and quick-action keyboards may exist as **optional accelerators** where the channel supports them, but the primary interaction path is always reply-based.

---

## How to Operate from Your Phone

### Replying to Prompts

When AtlasBridge detects a prompt in your CLI agent session, it sends you a message showing the prompt text and available options. Reply with plain text:

| Prompt type | What to reply | Examples |
|-------------|---------------|----------|
| Yes/No | The option number, or a synonym | `1`, `y`, `yes`, `allow`, `trust` |
| Confirm (Enter) | Empty message, `enter`, or option number | ` `, `enter`, `1` |
| Numbered choice | The option number | `1`, `2`, `3` |
| Free text | Your text directly | `main`, `/path/to/file` |
| Chat mode | Any message (no active prompt) | `check the logs`, `what happened?` |

### Synonym Support

AtlasBridge normalizes common synonyms deterministically:

**Yes-like:** `y`, `yes`, `ok`, `allow`, `accept`, `confirm`, `trust`, `continue`, `approve`, `proceed`

**No-like:** `n`, `no`, `deny`, `reject`, `cancel`, `exit`, `abort`, `decline`, `refuse`, `stop`

Case does not matter. Leading/trailing whitespace is stripped.

### What Happens After You Reply

1. Your reply is normalized to the correct option key
2. The option key + carriage return (`\r`) is injected into the PTY
3. The CLI agent receives your input as if typed at the terminal
4. You get a confirmation message with the result

### Password Prompts

When the CLI agent asks for a password or credential, AtlasBridge detects the prompt type and:

- Sends you a message asking for the value
- Injects your reply into the PTY
- **Redacts** the value in all logs, audit trail, and feedback messages

Your password is never stored in plaintext anywhere in AtlasBridge.

---

## Boundary Messages

If you send a message when no session is active, or when the agent is busy, AtlasBridge replies with a short, actionable explanation:

| Situation | Message |
|-----------|---------|
| No active session | "No active session. Start a session first: `atlasbridge run claude`" |
| Agent is busy | "Agent is working. Wait for the current operation to finish." |
| Agent is not waiting for input | "Agent is not waiting for input. Wait for a prompt to appear." |
| Prompt expired | "This prompt has expired. A new prompt will appear if the agent needs input." |
| Rate limited | "Too many messages. Try again in a few seconds." |

These messages never contain session IDs, prompt IDs, tokens, or other internal identifiers.

---

## Enter/Newline Semantics

When you reply with a value, AtlasBridge appends a carriage return (`\r`) before injecting into the PTY. This simulates pressing Enter at the terminal.

- Reply `1` → injects `1\r`
- Reply `yes` → normalizes to `y`, injects `y\r`
- Reply (empty) for confirm-enter → injects `\r`

The one exception is `RAW_TERMINAL` prompts — unparsable interactive prompts that cannot be operated remotely. These are escalated with a message explaining that local terminal input is required.

---

## Design Invariants

1. **No required taps** — every flow has a text-only equivalent
2. **Deterministic parsing** — same input always produces same output; no fuzzy matching
3. **No echo loops** — 500ms suppression window after every injection
4. **Bounded messages** — all boundary messages are under 200 characters
5. **No secret leakage** — boundary messages never contain tokens or internal IDs
