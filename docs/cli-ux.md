# Aegis CLI UX Specification

**Version:** 0.2.0
**Status:** Design
**Last updated:** 2026-02-21

---

## 1. Design Principles

Aegis is a CLI-first tool. Every interaction must feel fast, clear, and recoverable. The following principles govern all command design decisions.

### Simple

The default invocation of every command does the right thing without flags. A new user who has just run `aegis setup` should be able to run `aegis start` and `aegis run claude` without reading documentation.

Advanced control (dry runs, custom session names, JSON output) is available through flags, but flags are never required for normal use.

### Discoverable

`aegis --help` shows every command. `aegis <command> --help` shows every flag for that command. The help text is the spec — if the help text says something works, it works. If a command is experimental or platform-limited, the help text says so.

`aegis doctor` is always the answer when something is wrong. The user should never have to guess what to check. Every error message ends with a suggested next step, usually `Run aegis doctor to diagnose.`

### Self-healing (`doctor --fix`)

`aegis doctor --fix` attempts to automatically repair common configuration problems: wrong file permissions, missing directories, stale lock files, expired tokens in the environment. It is safe to run at any time. It never makes destructive changes without confirmation.

### No hidden state

Aegis does not have hidden global state beyond the files in `~/.aegis/`. The location of every relevant file is shown by `aegis status` and `aegis doctor`. There are no undocumented environment variables. There are no magic fallback behaviors that only activate under specific conditions.

### Additional principles

- **Fail loudly**: errors produce clear messages to stderr with a suggested fix.
- **Recoverable**: every command can be re-run safely.
- **No surprises**: destructive or side-effecting actions require confirmation (unless `--yes` is passed).
- **Quiet mode**: scripts can suppress all non-error output with `--quiet`.
- **Debug mode**: `--debug` shows full stack traces and internal state.
- **JSON everywhere**: `--json` is available on every command that produces structured output.

---

## 2. Command Reference

### Global Flags

Available on every command:

| Flag | Short | Description |
|---|---|---|
| `--help` | `-h` | Show help and exit |
| `--version` | `-V` | Show version and exit |
| `--json` | | Output as JSON (machine-readable) |
| `--quiet` | `-q` | Suppress non-error output |
| `--debug` | | Show debug output and full stack traces |
| `--config PATH` | | Override config file path |
| `--no-color` | | Disable colored output |
| `--yes` | `-y` | Skip confirmation prompts; assume yes |

---

### `aegis setup`

**Purpose:** Interactive first-run wizard. Configures Aegis from scratch.

**Usage:**
```
aegis setup [OPTIONS]
```

**Flags:**

| Flag | Description |
|---|---|
| `--token TOKEN` | Telegram bot token (skips Step 1 prompt) |
| `--users IDS` | Comma-separated Telegram user IDs (skips Step 2 prompt) |
| `--channel TYPE` | Channel to configure: `telegram` (default), `slack` |
| `--non-interactive` | Skip all prompts; require `--token` and `--users` |
| `--force` | Re-run setup even if already configured |
| `--config-path PATH` | Custom config directory (default: `~/.aegis/`) |
| `--json` | Output result as JSON |

**Interactive flow:**

```
Welcome to Aegis Setup

Aegis is a remote interactive prompt relay for AI developer agents.
When your AI agent pauses and waits for your input, Aegis forwards
the prompt to your phone via Telegram and injects your reply.

Let's get you set up. This takes about 2 minutes.

Step 1/5: Telegram Bot Token
──────────────────────────────
You need a Telegram bot. If you don't have one:
  1. Open Telegram and search for @BotFather
  2. Send /newbot and follow the prompts
  3. Copy the token BotFather gives you

Enter your Telegram bot token: _

Step 2/5: Allowed Telegram Users
──────────────────────────────────
Only these Telegram user IDs can send replies to your agent.
To find your ID: open Telegram, search @userinfobot, send /start.

Enter your Telegram user ID(s) [comma-separated]: _

Step 3/5: Testing Telegram Connectivity
──────────────────────────────────────────
  Connecting to Telegram API...
  Bot token valid — bot name: @YourAegisBot
  Sending test message to user 123456789...
  Test message delivered

Check Telegram — you should see a message from your bot.
Did you receive the test message? [Y/n]: _

Step 4/5: Channel
──────────────────
  1. Telegram (configured)
  2. Add Slack (optional)
  3. Skip

Select [1]: _

Step 5/5: Summary
──────────────────
  Config:   ~/.aegis/config.toml    OK
  Database: ~/.aegis/aegis.db       OK
  Telegram: @YourAegisBot           OK
  Users:    [123456789]             OK

Aegis is ready. Start it with:
  aegis start

Then wrap your AI tool:
  aegis run claude

Setup complete.
```

**Non-interactive mode:**
```bash
aegis setup \
  --non-interactive \
  --token "$AEGIS_TELEGRAM_BOT_TOKEN" \
  --users "123456789"
```

**JSON output (`--json`):**
```json
{
  "status": "success",
  "config_path": "/Users/ara/.aegis/config.toml",
  "db_path": "/Users/ara/.aegis/aegis.db",
  "telegram_bot": "@YourAegisBot",
  "allowed_users": [123456789]
}
```

**Error cases:**
- Invalid token: exit 2. `Error: Invalid Telegram bot token. Verify the token from @BotFather.`
- Network failure: exit 4. `Error: Cannot reach Telegram API. Check your internet connection.`
- Already configured: prompt to confirm overwrite, or use `--force`.

---

### `aegis start`

**Purpose:** Start the Aegis background daemon.

**Usage:**
```
aegis start [OPTIONS]
```

**Flags:**

| Flag | Description |
|---|---|
| `--foreground` | Run in foreground; do not daemonize. Useful for debugging. |
| `--port PORT` | Override daemon port (default: 39000) |
| `--log-level LEVEL` | Set log level: DEBUG, INFO, WARNING, ERROR (default: INFO) |
| `--json` | Output start result as JSON |

**Output:**
```
Starting Aegis daemon...
  Config loaded
  Database initialized
  Telegram bot connected (@YourAegisBot)
  Daemon started (PID 12345)

Aegis is running. To stop it:
  aegis stop
```

**Already running:**
```
Aegis daemon is already running (PID 12345).
Use 'aegis stop' to stop it first.
```

---

### `aegis stop`

**Purpose:** Stop the Aegis daemon.

**Usage:**
```
aegis stop [OPTIONS]
```

**Flags:**

| Flag | Description |
|---|---|
| `--force` | Send SIGKILL instead of SIGTERM |
| `--timeout SECONDS` | Wait this long for graceful shutdown (default: 10) |
| `--json` | Output result as JSON |

**Output:**
```
Stopping Aegis daemon (PID 12345)...
  Daemon stopped
```

**If sessions are active:**
```
Warning: 1 active session will be terminated (claude, PID 9876).
Continue? [y/N]: _
```

**Not running:** Exit 0 (idempotent). Output: `Aegis daemon is not running.`

---

### `aegis status`

**Purpose:** Show daemon status and session overview.

**Usage:**
```
aegis status [OPTIONS]
```

**Flags:**

| Flag | Description |
|---|---|
| `--json` | Output as JSON |
| `--watch` | Refresh every 2 seconds |

**Output:**
```
Aegis Status
────────────────────────────────────────────
Daemon:      Running (PID 12345)
Uptime:      2h 14m
Telegram:    Connected (@YourAegisBot)

Sessions:
  Active:    1   (claude, PID 9876)
  Today:     3

Prompts today:
  Forwarded:  8
  Answered:   8
  Pending:    0

Database:    ~/.aegis/aegis.db (2.1 MB)
Version:     0.2.0
```

**JSON output:**
```json
{
  "daemon": { "running": true, "pid": 12345, "uptime_seconds": 8040 },
  "telegram": { "connected": true, "bot_name": "@YourAegisBot" },
  "sessions": { "active": 1, "today": 3 },
  "prompts": { "forwarded_today": 8, "answered_today": 8, "pending": 0 },
  "version": "0.2.0"
}
```

---

### `aegis run <tool> [args...]`

**Purpose:** Run an AI CLI tool under Aegis supervision. This is the primary command users invoke on every session.

**Usage:**
```
aegis run <tool> [tool-args...] [OPTIONS]
```

**Flags:**

| Flag | Description |
|---|---|
| `--session-name NAME` | Label for this session in logs and Telegram messages |
| `--dry-run` | Show what would happen; do not start the process |
| `--no-inject` | Detect and forward prompts but do not inject replies (monitor-only mode) |
| `--timeout SECONDS` | Override prompt reply timeout for this session |
| `--policy PATH` | Override policy file for this session |

**Examples:**
```bash
aegis run claude
aegis run claude --model claude-opus-4-6
aegis run python my_agent.py
aegis run claude --session-name "auth-feature-sprint"
aegis run claude --dry-run
```

**Behavior:**
- Requires the daemon to be running. If not running, suggests `aegis start`.
- Launches the tool in a PTY (full interactive terminal, colors preserved).
- Forwards all output to the host terminal.
- On prompt detection, sends the prompt to Telegram and waits for the reply.
- Injects the reply into the tool's stdin. The tool resumes.

**Dry-run output:**
```
DRY RUN — process will not be started

Would run: claude
PTY: enabled
Session name: (auto)
Prompt detection: tri-signal (pattern + stall + time)
On detection: forward to Telegram user 123456789

No process started.
```

**Not-running warning:**
```
Error: Aegis daemon is not running.

Start it with:
  aegis start

Then retry:
  aegis run claude

Exit code: 1
```

---

### `aegis sessions`

**Purpose:** List active and recent sessions with their IDs, tool names, status, and prompt counts.

**Usage:**
```
aegis sessions [OPTIONS]
```

**Flags:**

| Flag | Description |
|---|---|
| `--all` | Show all sessions, not just today's |
| `--json` | Output as JSON |

**Output:**
```
Sessions
────────────────────────────────────────────────────────────────
 ID        Tool     Status    Started    Prompts  Session Name
────────────────────────────────────────────────────────────────
 s-a1b2c3  claude   ACTIVE    19:10:05   8        auth-feature
 s-d4e5f6  claude   ENDED     17:30:11   3        (none)
────────────────────────────────────────────────────────────────

To attach logs for a session:
  aegis logs --session s-a1b2c3
```

---

### `aegis logs`

**Purpose:** View Aegis daemon and session logs.

**Usage:**
```
aegis logs [OPTIONS]
```

**Flags:**

| Flag | Description |
|---|---|
| `--tail` | Stream new log lines continuously (like `tail -f`) |
| `-n N` | Show last N lines (default: 50) |
| `--session ID` | Filter to a specific session ID |
| `--level LEVEL` | Filter by log level: DEBUG, INFO, WARNING, ERROR |
| `--json` | Output as JSON Lines |
| `--since DATETIME` | Show logs after this timestamp (ISO 8601) |

**Output:**
```
[2026-02-21 19:10:05] INFO  Session started: claude (PID 9876, session s-a1b2c3)
[2026-02-21 19:14:32] INFO  Prompt detected: YES_NO (confidence 0.90, pattern match)
[2026-02-21 19:14:32] INFO  Prompt forwarded to Telegram: prompt-p1q2r3
[2026-02-21 19:14:55] INFO  Reply received from user 123456789: "y"
[2026-02-21 19:14:55] INFO  Reply injected into stdin (23ms)
```

**JSON Lines output (`--json`):**
```json
{"ts": "2026-02-21T19:14:32Z", "level": "INFO", "event": "prompt_detected", "type": "YES_NO", "confidence": 0.90}
{"ts": "2026-02-21T19:14:55Z", "level": "INFO", "event": "reply_injected", "latency_ms": 23, "user_id": 123456789}
```

---

### `aegis doctor`

**Purpose:** Run comprehensive health diagnostics. Always the first thing to run when something is wrong.

**Usage:**
```
aegis doctor [OPTIONS]
```

**Flags:**

| Flag | Description |
|---|---|
| `--fix` | Attempt safe automatic repairs |
| `--json` | Output as JSON |
| `--verbose` | Show details for PASS checks too |

**Output:**
```
Aegis Doctor — System Diagnostics
════════════════════════════════════════

Environment
──────────────────────────────────────
  PASS  Python 3.11.8 (required: 3.11+)
  PASS  Dependencies installed (aegis-cli 0.2.0)
  PASS  SQLite 3.45.1 accessible
  PASS  Config file exists: ~/.aegis/config.toml
  PASS  Config file valid
  PASS  Telegram token format valid
  PASS  Telegram API reachable
  PASS  Bot responds: @YourAegisBot
  PASS  claude found on PATH: /usr/local/bin/claude

Security
──────────────────────────────────────
  PASS  Config file permissions: 0600 (owner-only)
  PASS  Audit log integrity: OK

Runtime
──────────────────────────────────────
  PASS  Daemon running (PID 12345)
  PASS  No stuck sessions
  PASS  Database schema: current

════════════════════════════════════════
Summary: 13 PASS, 0 WARN, 0 FAIL
```

**With `--fix`:**
```
  FAIL  Config file permissions: 0644 (should be 0600)
        Auto-fixing: chmod 0600 ~/.aegis/config.toml
        Fixed
```

**Exit codes for `doctor`:**
- `0`: all checks pass (warnings are OK)
- `3`: environment check failed
- `5`: permission check failed
- `8`: state corruption detected

---

### `aegis doctor --fix`

The `--fix` flag enables automatic repair of the following issues:

| Issue | Auto-fix |
|---|---|
| Config file permissions not 0600 | `chmod 0600 ~/.aegis/config.toml` |
| PID file orphaned (process not running) | Remove stale `~/.aegis/aegis.pid` |
| Database WAL file stuck | `PRAGMA wal_checkpoint(TRUNCATE)` |
| `~/.aegis/` directory missing | `mkdir -p ~/.aegis` with 0700 |

Fixes that would destroy data (e.g., a corrupted database) are never applied automatically. The doctor reports them and tells the user what to do manually.

---

### `aegis debug bundle`

**Purpose:** Package logs and configuration into a redacted archive for support.

**Usage:**
```
aegis debug bundle [OPTIONS]
```

**Flags:**

| Flag | Description |
|---|---|
| `--output PATH` | Output path for the bundle (default: `./aegis-debug-<timestamp>.zip`) |
| `--include-logs N` | Include last N lines of logs (default: 500) |
| `--no-redact` | Include secrets unredacted (use with care) |

**What is included (redacted by default):**
- `~/.aegis/config.toml` with `bot_token` replaced by `***REDACTED***`
- Last 500 lines of `~/.aegis/aegis.log`
- `aegis doctor --json` output
- `aegis version --json` output
- Python version and platform info
- OS version

**Output:**
```
Creating debug bundle...
  Collecting config (redacted)...       done
  Collecting logs (last 500 lines)...   done
  Running doctor...                     done
  Collecting version info...            done

Bundle saved to: ./aegis-debug-20260221-191055.zip (12 KB)

Share this file with the Aegis team. It does not contain your bot token or user IDs.
```

---

### `aegis channel add telegram|slack`

**Purpose:** Add or reconfigure a notification channel.

**Usage:**
```
aegis channel add <type> [OPTIONS]
```

Supported types: `telegram`, `slack`

**Flags (telegram):**

| Flag | Description |
|---|---|
| `--token TOKEN` | Bot token |
| `--users IDS` | Comma-separated user IDs |

**Flags (slack):**

| Flag | Description |
|---|---|
| `--token TOKEN` | Slack bot OAuth token |
| `--channel CHANNEL` | Slack channel to post to (e.g., `#aegis-approvals`) |
| `--users IDS` | Comma-separated Slack user IDs allowed to reply |

**Output:**
```
Adding Slack channel...

Step 1/3: Slack Bot Token
──────────────────────────
Install the Aegis Slack app at your workspace, then enter the bot token:
Enter Slack bot token: _

Step 2/3: Slack Channel
────────────────────────
Enter the Slack channel (e.g. #aegis-approvals): _

Step 3/3: Testing
──────────────────
  Connecting to Slack API...    OK
  Sending test message...       OK

Slack channel configured.
```

---

### `aegis adapter list`

**Purpose:** Show available tool adapters and their compatibility status.

**Usage:**
```
aegis adapter list [--json]
```

**Output:**
```
Available Adapters

 Adapter    Status        Tested With
 claude     Supported     claude 0.2.x (Claude Code)
 openai     Supported     openai-cli 1.x
 gemini     Experimental  gemini-cli 0.1.x
 custom     Any           Any interactive CLI

Use: aegis run <tool>
```

---

### `aegis version`

**Purpose:** Show version information and active feature flags.

**Usage:**
```
aegis version [--json]
```

**Output:**
```
aegis 0.2.0
Python 3.11.8
Platform: darwin arm64

Feature flags:
  conpty_backend    disabled  (v0.5.0)
  slack_channel     disabled  (v0.4.0)
  whatsapp_channel  disabled  (future)
```

**JSON:**
```json
{
  "aegis": "0.2.0",
  "python": "3.11.8",
  "platform": "darwin",
  "arch": "arm64",
  "feature_flags": {
    "conpty_backend": false,
    "slack_channel": false,
    "whatsapp_channel": false
  }
}
```

---

### `aegis lab run <scenario>` / `aegis lab list`

**Purpose:** Prompt Lab — developer and QA tool for running PTY/detection scenarios. Not intended for end users.

**Usage:**
```
aegis lab run <scenario>     Run a single scenario by QA ID or name
aegis lab run --all          Run all registered scenarios
aegis lab list               List all registered scenarios
```

**`aegis lab list` output:**
```
Aegis Prompt Lab — Registered Scenarios

QA ID    Name                         Platform           Status
QA-001   PartialLinePromptScenario    macos, linux       registered
QA-002   ANSIRedrawScenario           macos, linux       registered
QA-003   OverwrittenPromptScenario    macos, linux       registered
QA-004   SilentBlockScenario          macos, linux       registered
QA-005   NestedPromptsScenario        macos, linux       registered
QA-006   MultipleChoiceScenario       macos, linux       registered
QA-007   YesNoVariantsScenario        macos, linux       registered
QA-008   PressEnterScenario           macos, linux       registered
QA-009   FreeTextConstraintScenario   macos, linux       registered
QA-018   OutputFloodScenario          macos, linux       registered
QA-019   EchoLoopScenario             macos, linux       registered

11 scenarios registered.
```

**`aegis lab run --all` output:**
```
Running all Prompt Lab scenarios...

  QA-001   PartialLinePromptScenario     PASS  (42ms)
  QA-002   ANSIRedrawScenario            PASS  (38ms)
  QA-003   OverwrittenPromptScenario     PASS  (61ms)
  QA-004   SilentBlockScenario           PASS  (2104ms)
  QA-005   NestedPromptsScenario         PASS  (88ms)
  QA-006   MultipleChoiceScenario        PASS  (45ms)
  QA-007   YesNoVariantsScenario         PASS  (39ms)
  QA-008   PressEnterScenario            PASS  (41ms)
  QA-009   FreeTextConstraintScenario    PASS  (44ms)
  QA-018   OutputFloodScenario           PASS  (5231ms)
  QA-019   EchoLoopScenario              PASS  (97ms)

11/11 passed. All scenarios green.
```

---

## 3. Output Formatting

### When to use Rich tables

Use Rich tables for multi-row structured output: `aegis sessions`, `aegis adapter list`, `aegis lab list`. Rich tables are rendered only when stdout is a TTY. When stdout is piped or redirected, fall back to plain tab-separated values.

### When to use plain text

Use plain text for single-value output (`aegis config get <key>`), status lines that scripts may parse, and all output in `--quiet` mode. Plain text is the default for error messages to stderr.

### When to use JSON (`--json`)

All commands that produce structured output support `--json`. JSON output:
- Always goes to stdout.
- Always includes a `"status"` field: `"success"` or `"error"`.
- Is valid JSON (not JSON Lines), except `aegis logs --json` which uses JSON Lines (one object per line).
- Is produced even when stdout is not a TTY.

JSON is the recommended format for use in scripts, CI pipelines, and any context where the output will be parsed.

### Spinners and progress

Spinners (via Rich) are shown during operations that take more than 500ms: Telegram connectivity test, daemon startup, debug bundle creation. Spinners are suppressed in `--quiet` mode and when stdout is not a TTY.

---

## 4. Error Messages

### Tone and format

Error messages are direct, non-blaming, and always end with a suggested next step. The user is never left wondering what to do.

Format:
```
Error: <short description of what went wrong>

  <one or two sentences of detail>

  <suggested next step>

Exit code: <N>
```

Example:
```
Error: Telegram API unreachable

  Could not connect to api.telegram.org after 3 attempts.
  Last error: Connection timed out (10s)

  Check your internet connection, then run:
    aegis doctor --fix

Exit code: 4
```

### Actionable by default

Every error message includes at least one concrete action the user can take. Acceptable actions:
- A specific `aegis` command to run
- A file to check
- A URL to visit

Unacceptable:
- "An unknown error occurred."
- "Please try again."
- "Contact support." (without a link or command)

### Common error templates

| Situation | Message |
|---|---|
| Setup not complete | `Run 'aegis setup' to configure Aegis first.` |
| Daemon not running | `Run 'aegis start' to start the daemon.` |
| Config invalid | `Run 'aegis doctor' to diagnose configuration issues.` |
| Permission denied | `Run 'aegis doctor --fix' to auto-repair file permissions.` |
| Network failure | `Check your internet connection. Run 'aegis doctor' for details.` |
| Unknown error | `Run 'aegis debug bundle' and share the output with the Aegis team.` |

---

## 5. Exit Codes

| Code | Name | Meaning |
|---|---|---|
| `0` | `SUCCESS` | Command completed successfully |
| `1` | `ERROR` | General or unhandled error |
| `2` | `CONFIG_ERROR` | Configuration invalid, missing, or incomplete |
| `3` | `ENV_ERROR` | Python version wrong, dependency missing, OS not supported |
| `4` | `NETWORK_ERROR` | Network failure (Telegram or Slack unreachable) |
| `5` | `PERMISSION_ERROR` | File permissions or access denied |
| `8` | `STATE_CORRUPTION` | Database, lock file, or audit log corrupted |
| `130` | `INTERRUPTED` | Interrupted by Ctrl+C (SIGINT) |

All error output goes to stderr. Exit codes are consistent and documented. Scripts can rely on them.

### Ctrl+C (SIGINT) handling

When the user presses Ctrl+C during an interactive command:

```
^C
Interrupted. Cleaning up...
  No active sessions affected
  Daemon still running

Run 'aegis status' to check daemon state.
Exit code: 130
```

If a session is active:
```
^C
Interrupted.
  Session s-a1b2c3 (claude) is still running in the background.
  A pending prompt will continue waiting for your Telegram reply.
  Daemon still running.

To monitor the session:
  aegis logs --session s-a1b2c3 --tail
Exit code: 130
```

---

## 6. Shell Completion

Aegis generates shell completion scripts for bash, zsh, and fish via Click's built-in completion system.

### Bash

Add to `~/.bashrc`:
```bash
eval "$(_AEGIS_COMPLETE=bash_source aegis)"
```

Or generate and source a file:
```bash
_AEGIS_COMPLETE=bash_source aegis > ~/.aegis-complete.bash
echo "source ~/.aegis-complete.bash" >> ~/.bashrc
```

### Zsh

Add to `~/.zshrc`:
```zsh
eval "$(_AEGIS_COMPLETE=zsh_source aegis)"
```

### Fish

```fish
_AEGIS_COMPLETE=fish_source aegis > ~/.config/fish/completions/aegis.fish
```

### What is completed

- All commands and subcommands
- All flags and their arguments
- `aegis run <TAB>`: completes tool names found on PATH
- `aegis lab run <TAB>`: completes registered QA scenario IDs
- `aegis logs --session <TAB>`: completes active session IDs
- `aegis channel add <TAB>`: completes `telegram slack`

---

## 7. Telegram Bot Commands

The Aegis Telegram bot supports the following slash commands. These commands are sent directly to the bot in Telegram and control the active session.

### `/start`

Sent automatically when a user opens a conversation with the bot. Responds with a welcome message and the current connection status.

```
Aegis bot connected.
Daemon status: Running
Active sessions: 1 (claude, started 19:10)

When your AI agent asks a question, I'll send it here.
Use /help to see available commands.
```

### `/sessions`

Lists all active and recent sessions.

```
Active Sessions

  s-a1b2c3  claude  started 19:10  8 prompts  auth-feature
  s-d4e5f6  claude  ended 17:30    3 prompts   (none)

Tap a session name to see its last output.
```

### `/switch <session-id>`

Switches the active session context. When multiple sessions are running, replies go to the session set by `/switch`. If only one session is active, `/switch` is not needed.

```
/switch s-a1b2c3

Now routing replies to: claude (s-a1b2c3, auth-feature)
```

### `/status`

Shows daemon and session status inline in Telegram.

```
Aegis Status

  Daemon: Running (PID 12345)
  Telegram: Connected
  Active sessions: 1
  Pending prompts: 0

Last prompt: "Do you want to apply this change? (y/n)" — answered 2m ago
```

### `/cancel`

Cancels the most recent pending prompt without sending a reply. The agent will receive a timeout or a neutral response depending on the prompt type.

```
/cancel

Cancelled prompt: "Do you want to apply this change?" (s-a1b2c3)
The agent will receive a timeout response.
```

### `/help`

Shows all available bot commands with brief descriptions.

```
Aegis Bot Commands

  /start    Show connection status
  /sessions List active sessions
  /switch   Switch active session: /switch <session-id>
  /status   Show daemon status
  /cancel   Cancel the pending prompt
  /help     Show this message

To answer a prompt, tap an inline button or reply to the message directly.
```

### Inline prompt messages

When a prompt is detected, the bot sends a message with an inline keyboard. The message format:

```
claude (auth-feature) is waiting for your input:

  "Do you want to continue with the database migration?
   This will modify 3 tables. (y/n)"

Prompt type: YES_NO
Detected: pattern match (confidence 0.90)
```

Keyboard buttons for `YES_NO`: `Yes`  `No`

Keyboard buttons for `CONFIRM_ENTER`: `Send Enter`  `Cancel`

Keyboard buttons for `MULTIPLE_CHOICE`: one button per option, labeled `1`, `2`, `3`, etc.

For `FREE_TEXT` prompts, there are no inline buttons. The message instructs the user to reply directly to the message, and the bot routes the reply text to the session.
