# Autonomy Modes — Design Document

**Project:** AtlasBridge
**Status:** Design (pre-implementation)
**Target version:** v0.6.0
**Date:** 2026-02-21

---

## Overview

AtlasBridge supports three autonomy modes that govern how the `AutopilotEngine` interacts with `PromptEvent` objects. The mode determines whether the engine auto-replies immediately, suggests a reply for human confirmation, or routes every prompt to the human without any policy evaluation.

Modes are a runtime property of the daemon. They can be changed via CLI command or channel command. The change takes effect on the next prompt; any prompt currently in-flight completes in the mode that was active when it entered the engine.

---

## Three modes

### Off (legacy behaviour)

In Off mode the `AutopilotEngine` is not loaded. The daemon behaves identically to v0.5.x: every `PromptEvent` is forwarded directly to `PromptRouter`, which delivers it to Telegram or Slack. The user replies from their phone and the reply is injected into the PTY.

There is no policy evaluation, no decision trace, and no kill switch in Off mode. The `[autopilot]` block in the config is either absent or contains `enabled = false`.

```
PromptDetector → PromptRouter → Telegram/Slack → human reply → PTY
```

Key properties:

- No auto-injection ever occurs.
- No policy file is required or loaded.
- `AutopilotEngine` class is not instantiated; no background tasks are started.
- Transitioning from Off to another mode requires a daemon restart (config change).

Configuration:

```toml
[autopilot]
enabled = false
# or equivalently:
# mode = "off"
```

---

### Assist

In Assist mode the `PolicyEvaluator` runs for every prompt. When a rule matches with action `auto_reply`, the engine does not inject immediately. Instead it sends a **suggestion message** to the channel:

```
AtlasBridge suggests: YES — tap to confirm or override
Session: {session_id[:8]}  |  Rule: {rule_id}  |  Prompt ID: {prompt_id[:8]}

[CONFIRM]  [OVERRIDE]
```

The user has a configurable window (default: 10 seconds) to:

- Tap **CONFIRM**: injection proceeds immediately.
- Tap **OVERRIDE**: the prompt is re-routed to human as a full escalation message.
- Take no action: after the window closes, the engine injects the suggested reply automatically.

For prompts where the matched rule action is `require_human`, or where no rule matches, Assist mode behaves identically to Off mode: the prompt is forwarded to the human with no suggestion.

```
PromptDetector → AutopilotEngine
                      │
                      ├─ policy match, action=auto_reply
                      │       └──► send suggestion → wait 10s → inject (or human override)
                      │
                      └─ no match / require_human
                              └──► PromptRouter → human
```

Key properties:

- Auto-injection only occurs after human confirmation (explicit tap) or expiry of the override window.
- The override window duration is configurable (`assist_override_window`, default: 10 seconds).
- Kill switch (`/pause`, `/resume`, `/stop`) works: a `/pause` during the override window cancels the pending injection and re-routes to human.
- Useful for supervised automation: the human reviews but does not need to type.
- Decision trace is written for every injection (including those confirmed by human tap).

Configuration:

```toml
[autopilot]
enabled = true
mode    = "assist"
assist_override_window = 10   # seconds; 0 = require explicit confirmation (no auto-inject)
```

---

### Full

In Full mode the `PolicyEvaluator` runs for every prompt. When a rule matches with action `auto_reply`, the engine injects the reply immediately without waiting for human input. A non-blocking decision notification is sent to the channel after injection.

```
PromptDetector → AutopilotEngine
                      │
                      ├─ policy match, action=auto_reply
                      │       └──► inject immediately → notify channel
                      │
                      ├─ policy match, action=require_human
                      │       └──► PromptRouter → human
                      │
                      ├─ no policy match (safe default)
                      │       └──► PromptRouter → human
                      │
                      └─ LOW confidence, no explicit low-conf rule
                              └──► PromptRouter → human
```

Key properties:

- Auto-injection is immediate; no human delay for matched `auto_reply` rules.
- `require_human` rules and no-match prompts always escalate to the human.
- `LOW` confidence prompts are routed to the human unless a rule explicitly sets `confidence = "LOW"`.
- Decision notifications are sent to the channel after each auto-injection (non-blocking; send failure does not affect injection).
- Kill switch works: `/pause` stops auto-injection for subsequent prompts.
- Decision trace written for every auto-reply and deny action.

Configuration:

```toml
[autopilot]
enabled = true
mode    = "full"
```

---

## Mode transitions

Mode transitions are managed by the `atlasbridge autopilot mode` subcommand and by the `/mode` channel command (allowlisted identities only).

### CLI transitions

```bash
# Switch from Off to Assist (requires daemon restart if Off was set in config)
atlasbridge autopilot mode assist

# Switch from Off or Assist to Full
atlasbridge autopilot mode full

# Disable autopilot (any → Off)
atlasbridge autopilot mode off
# or:
atlasbridge autopilot disable
```

### Channel transitions

```
/mode assist     → switch to Assist
/mode full       → switch to Full
/mode off        → switch to Off (autopilot disabled; human relay only)
```

### Transition rules

| From | To | Method | Requires restart? | In-flight effect |
|------|----|--------|--------------------|------------------|
| Off | Assist | config change | Yes | n/a (engine not running) |
| Off | Full | config change | Yes | n/a |
| Assist | Full | CLI or channel | No | current prompt completes in Assist |
| Full | Assist | CLI or channel | No | current prompt completes in Full |
| Assist | Off | CLI or channel | No | engine unloads after current prompt |
| Full | Off | CLI or channel | No | engine unloads after current prompt |
| Any | Off | `atlasbridge autopilot disable` | No | engine unloads after current prompt |

When transitioning from Off to any other mode via CLI, the daemon must be restarted because the `AutopilotEngine` is not instantiated in Off mode. The CLI will warn the user:

```
Mode change requires a daemon restart. Run: atlasbridge restart
```

Transitions between Assist and Full (and back) are live: the engine's `mode` attribute is updated atomically and the new mode applies to the next prompt dequeued.

---

## Safety guarantees per mode

### Summary table

| Guarantee | Off | Assist | Full |
|-----------|-----|--------|------|
| No auto-injection ever | Yes | No | No |
| Auto-injection only after human confirmation | n/a | Yes | No |
| Auto-injection per policy, immediate | n/a | No | Yes |
| Kill switch (`/pause`) stops auto-injection | n/a | Yes | Yes |
| No-match prompts always escalate to human | Yes | Yes | Yes |
| LOW confidence always escalates (no explicit rule) | Yes | Yes | Yes |
| Decision trace written | No | Yes | Yes |
| Audit log entries for injections | No | Yes | Yes |
| Policy file required | No | Yes | Yes |

### Off

The Off mode offers the strongest safety guarantee: no auto-injection can occur under any circumstances. The `AutopilotEngine` class is not loaded; there is no code path from `PromptDetector` to PTY write that bypasses the human.

### Assist

Assist mode guarantees that the human has always had the opportunity to confirm or override before injection. The 10-second override window means a human who is watching the channel can always prevent an auto-reply. If `assist_override_window = 0` is set, explicit confirmation is required and no injection can occur without a human tap.

The kill switch works in Assist mode. A `/pause` command during the override window cancels the pending injection and re-routes to human. The kill switch state is persisted; it survives a daemon restart.

### Full

Full mode provides policy-gated automation with several built-in safety constraints:

1. **No-match safety**: if no rule matches, the prompt is always routed to the human. There is no "default auto-reply". The operator must explicitly write a rule for every prompt type they wish to automate.
2. **LOW confidence safety**: prompts detected with `LOW` confidence are routed to the human unless the matching rule explicitly sets `confidence = "LOW"`. The operator must opt in to low-confidence automation.
3. **Kill switch**: the `/pause` command stops all auto-injection immediately (current in-flight completes). The paused state persists across restarts.
4. **Idempotency guard**: the `decide_prompt()` SQL guard prevents double-injection even if the engine processes a prompt twice (e.g., after a crash-restart).
5. **Audit trail**: every auto-injection is written to the hash-chained audit log with `source = "autopilot"` and the matching rule ID.

---

## Behaviour comparison table

| Scenario | Off | Assist | Full |
|----------|-----|--------|------|
| `TYPE_YES_NO`, `HIGH` confidence, rule matches `auto_reply` | Routed to human | Suggestion sent; inject after 10s (or human confirm) | Injected immediately; notification sent |
| `TYPE_YES_NO`, `LOW` confidence, rule matches `auto_reply` with `confidence = "HIGH"` | Routed to human | Routed to human (confidence below rule threshold) | Routed to human (confidence below rule threshold) |
| `TYPE_YES_NO`, `LOW` confidence, rule matches `auto_reply` with `confidence = "LOW"` | Routed to human | Suggestion sent; inject after 10s | Injected immediately |
| `TYPE_FREE_TEXT`, no matching rule | Routed to human | Routed to human | Routed to human (no-match safe default) |
| `TYPE_MULTIPLE_CHOICE`, rule matches `auto_reply`, `reply_value = "1"` | Routed to human | Suggestion sent; inject "1" after 10s | Inject "1" immediately |
| `/pause` kill switch issued | n/a (not running) | Next prompt routed to human; override window cancelled | Next prompt routed to human |
| `/resume` kill switch issued | n/a | Auto-reply resumes on next prompt | Auto-reply resumes on next prompt |
| Daemon restart with pending prompt in SQLite | Prompt reloaded; routed to human | Prompt reloaded; re-evaluated; suggestion sent | Prompt reloaded; re-evaluated; injected (if idempotency key not committed) |
| Rule matches `action = "deny"` | n/a | Synthetic "n" injected (deny is unconditional) | Synthetic "n" injected |
| Rule matches `action = "require_human"` | n/a | Routed to human | Routed to human |

Note on deny in Assist mode: `deny` rules are not subject to the override window. A `deny` action is executed immediately regardless of mode, because it represents a policy prohibition, not a preference. The human is notified after the fact.

---

## Configuration examples

### Off mode (no config block required)

```toml
# ~/.atlasbridge/config.toml

[session]
default_ttl = 300

[channels.telegram]
bot_token   = "..."
allowed_ids = [123456789]

# No [autopilot] block — engine is off by default
```

### Assist mode

```toml
[autopilot]
enabled                = true
mode                   = "assist"
assist_override_window = 10          # seconds; 0 = require explicit tap
trace_file             = "~/.atlasbridge/autopilot_decisions.jsonl"
notify_channel         = "telegram"

[[autopilot.rules]]
id              = "confirm-test-run"
description     = "Suggest auto-confirm for pytest"
prompt_type     = "TYPE_YES_NO"
confidence      = "HIGH"
excerpt_pattern = "Run \\d+ tests\\?"
action          = "auto_reply"
reply_value     = "y"

[[autopilot.rules]]
id              = "deny-force-push"
description     = "Always deny git force-push"
prompt_type     = "TYPE_YES_NO"
confidence      = "MED"
excerpt_pattern = "(?i)force.push"
action          = "deny"
```

### Full mode

```toml
[autopilot]
enabled                = true
mode                   = "full"
trace_file             = "~/.atlasbridge/autopilot_decisions.jsonl"
notify_channel         = "telegram"

# Confirm standard pytest runs (HIGH confidence only)
[[autopilot.rules]]
id              = "confirm-test-run"
description     = "Auto-confirm pytest invocations"
prompt_type     = "TYPE_YES_NO"
confidence      = "HIGH"
excerpt_pattern = "Run \\d+ tests\\?"
action          = "auto_reply"
reply_value     = "y"

# Auto-accept pip install prompts
[[autopilot.rules]]
id              = "pip-install"
description     = "Auto-confirm pip install"
prompt_type     = "TYPE_YES_NO"
confidence      = "HIGH"
excerpt_pattern = "(?i)proceed.*installation"
action          = "auto_reply"
reply_value     = "y"

# Select first option for multiple-choice menus matching known patterns
[[autopilot.rules]]
id              = "mc-first-option"
description     = "Auto-select first option for known menus"
prompt_type     = "TYPE_MULTIPLE_CHOICE"
confidence      = "HIGH"
excerpt_pattern = "(?i)select.*python version"
action          = "auto_reply"
reply_value     = "1"

# Deny any force-push regardless of confidence
[[autopilot.rules]]
id              = "deny-force-push"
description     = "Never auto-approve force-push"
prompt_type     = "TYPE_YES_NO"
confidence      = "LOW"             # matches even LOW confidence detections
excerpt_pattern = "(?i)force.push"
action          = "deny"

# Everything else escalates to human (no catch-all rule needed — safe default)
```

### Transitioning from Assist to Full via CLI

```bash
# Validate policy first
atlasbridge policy test --mode full

# If validation passes, switch mode live
atlasbridge autopilot mode full

# Verify
atlasbridge autopilot status
# Output:
# Mode:        full
# State:       RUNNING
# Queue depth: 0
# Policy:      /Users/ara/.atlasbridge/policy.toml (hash: 7f3a...)
# Trace:       /Users/ara/.atlasbridge/autopilot_decisions.jsonl (1,042 entries)
```

---

## Warning

> **Start in Assist mode. Only upgrade to Full after validating your policy with `atlasbridge policy test`.**
>
> In Full mode, the engine injects replies into your CLI tool without waiting for you. A poorly written policy (overly broad `excerpt_pattern`, missing `confidence` threshold, or an incorrect `reply_value`) can cause the agent to take actions you did not intend — including confirming destructive operations.
>
> The recommended workflow is:
>
> 1. Write your policy rules.
> 2. Run `atlasbridge policy test` against a recorded session or the Prompt Lab (`atlasbridge lab run --all`).
> 3. Deploy in Assist mode and observe suggestions for at least one full working session.
> 4. If all suggestions are correct, switch to Full mode: `atlasbridge autopilot mode full`.
> 5. Monitor the decision trace (`atlasbridge autopilot trace`) and the channel notifications.
>
> The `/pause` kill switch is always available from Telegram or Slack. Keep your phone accessible when running in Full mode for the first time.

---

## CLI reference

### `atlasbridge autopilot`

```
Usage: atlasbridge autopilot [COMMAND]

Commands:
  mode    <off|assist|full>   Set the autonomy mode (live, no restart required
                              unless transitioning from Off)
  enable                      Enable autopilot in the last configured mode
  disable                     Disable autopilot (same as: mode off)
  pause                       Pause auto-injection (same as: /pause in channel)
  resume                      Resume auto-injection (same as: /resume in channel)
  stop                        Stop the engine (relay-only mode until restart)
  status                      Show current mode, state, queue depth, policy hash
  trace   [--tail] [--last N] View the decision trace JSONL file
```

### `atlasbridge policy`

```
Usage: atlasbridge policy [COMMAND]

Commands:
  validate                    Parse and validate policy TOML; report errors
  test    [--mode <mode>]     Dry-run policy against Prompt Lab scenarios
  show                        Print compiled rules with match statistics
  reload                      Signal running daemon to reload policy (SIGHUP)
```

---

## Future work

| Item | Target version |
|------|---------------|
| `atlasbridge policy test` dry-run evaluator against Prompt Lab | v0.6.0 |
| Live mode transitions (Assist ↔ Full) without restart | v0.6.0 |
| Per-rule `max_auto_replies` rate limit in Full mode | v0.7.0 |
| Slack channel for mode commands and kill switch | v0.7.0 |
| Mode history log (who changed mode, when, from channel or CLI) | v0.7.0 |
| `assist_override_window = 0` strict confirmation mode | v0.6.1 |
| Per-session mode override (run one session in Assist while others run Full) | v0.8.0 |
