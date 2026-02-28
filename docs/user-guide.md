# AtlasBridge User Guide

> **Audience:** New and existing users
> **Status:** Current
> **When to read:** After installing AtlasBridge, or whenever you need help using any feature

This guide walks you through everything you need to know to use AtlasBridge, from installation to daily operation. No terminal expertise required.

---

## What is AtlasBridge?

AtlasBridge watches your AI coding agents (Claude Code, OpenAI Codex, Gemini CLI) and controls what they can do automatically. You write simple rules that say "auto-approve this" or "ask me first." When something needs your attention, AtlasBridge sends it to your phone via Telegram or Slack. You reply, and the AI continues.

Think of it as a remote control for your AI agents. You set the boundaries, AtlasBridge enforces them.

---

## 1. Install

```bash
pip install atlasbridge
```

Verify it worked:

```bash
atlasbridge version
```

You should see the version number and install path. If you get "command not found," see [Troubleshooting](#troubleshooting) below.

**Optional:** For Slack support, install the Slack extra:

```bash
pip install "atlasbridge[slack]"
```

---

## 2. First-Time Setup

AtlasBridge forwards AI prompts to your phone so you can respond from anywhere. You need a messaging channel — either Telegram or Slack.

### Option A: Telegram (recommended)

```bash
atlasbridge setup --channel telegram
```

You'll be asked for two things:

1. **Bot token** — Create a bot at [@BotFather](https://t.me/BotFather) on Telegram. It gives you a token like `123456:ABC-DEF...`
2. **Your user ID** — Message [@userinfobot](https://t.me/userinfobot) on Telegram. It replies with your numeric ID.

After setup, **open your bot's chat in Telegram and send `/start`**. This is required — Telegram bots cannot message you until you initiate the conversation.

### Option B: Slack

```bash
pip install "atlasbridge[slack]"
atlasbridge setup --channel slack
```

You'll need a Slack App with Socket Mode enabled, a bot token (`xoxb-...`), and an app-level token (`xapp-...`). See [Channel Token Setup](channel-token-setup.md) for step-by-step instructions.

### Verify setup

```bash
atlasbridge doctor
```

This checks your configuration, channel connectivity, and system health. Everything should show green checkmarks.

---

## 3. Start the Dashboard

The dashboard is a web interface that lets you manage everything from your browser.

```bash
atlasbridge dashboard start
```

Open your browser to **http://localhost:41520** (the port is shown in the terminal output).

The dashboard is the easiest way to manage AtlasBridge. Everything you can do from the terminal, you can do from the dashboard — plus visual monitoring, one-click policy management, and evidence export.

---

## 4. Dashboard Walkthrough

The dashboard has a navigation bar at the top with all available pages. Here's what each one does.

### Overview

Your home screen. Shows the current state of everything at a glance:

- **Stat cards** — Active sessions, safety score, policy score, high-risk events, system health, integrity status. Click any card to expand its details.
- **Recent Activity** — The last 10 events with risk level and timestamps.
- **AI Activity Feed** — Shows conversations currently being monitored across all AI providers.
- **Operator Panel** — Change the autonomy mode (Off / Assist / Full) with one click.

### Sessions

Where you start and monitor AI agent sessions.

**Managed tab:**
- Click **Start Session** to launch an AI agent. Pick your adapter (Claude Code, OpenAI, Gemini, or Custom), choose an autonomy mode, set a workspace path, and optionally add a label.
- The session table shows all active and recent sessions with their status, risk level, escalation count, and CI status.
- Click a session to see its full transcript.
- Use the **Pause**, **Resume**, and **Stop** buttons to control running sessions.

**Monitored tab:**
- Passively observe AI conversations running in other apps (Claude Desktop, ChatGPT, VS Code).
- Start/stop monitoring for desktop apps, VS Code, or browser extensions.
- Click a monitored session to see its captured conversation transcript.

### Chat

A real-time conversation view for managed sessions.

- Select a running session from the dropdown (or navigate here from the Sessions page).
- See the full conversation between you and the AI agent — user messages, agent responses, and operator escalations are color-coded.
- When the AI is waiting for your input, a text box appears at the bottom. Type your response and click Send.
- This is the browser-based alternative to replying via Telegram/Slack.

### Prompts

History of every decision prompt the AI has generated.

- Search by prompt ID or content text.
- Filter by **type** (Yes/No, Confirm Enter, Free Text, Multiple Choice) and **decision** (Auto, Human, Escalated).
- See exactly what the AI asked, how it was classified, and what action was taken.

### Traces

The audit trail — a tamper-evident log of every decision.

- Each trace entry has a sequence number, timestamp, decision, risk level, and hash verification status.
- Filter by risk level (Low / Medium / High / Critical).
- The hash chain means entries cannot be altered after the fact.

### Audit

A combined view of Prompts, Traces, and Audit entries in one place.

- Three tabs: **All** (audit entries), **Prompts**, and **Traces**.
- Search and filter across all audit data.
- **Export** your audit data as JSON or CSV using the export buttons.

### Repositories

Connect your code repositories and scan them for issues.

- Click **Connect** to add a repository from GitHub, GitLab, Bitbucket, or Azure DevOps.
- Once connected, click **Scan** to run a quality analysis.
- **Local Scan** lets you scan a local codebase with different profiles (Quick, Safety, Deep).
- **Container Scan** analyzes Docker/OCI images.
- **Infrastructure Scan** checks Terraform and CloudFormation files.
- Results show category scores (Security, Dependencies, Secrets, Architecture), risk tags, and suggestions.

### Evidence

Governance and compliance evidence for your AI operations.

- **Governance Score** — An overall score (0-100) based on autonomous rate, escalation rate, blocked events, and policy coverage.
- **Policy Packs** — Browse and activate pre-built policy templates. Click **Activate** to apply one immediately.
- **Export** — Download decision evidence as JSON, CSV, or a verified ZIP bundle.
- **Generated Bundles** — Previously exported evidence bundles with integrity hashes.
- **Integrity Reports** — Hash chain verification status.

### Integrity

Verify that AtlasBridge's core components haven't been tampered with.

- Shows the verification status of each component (Policy Engine, Decision Trace, Prompt Resolver, Audit Logger).
- Each component shows its hash value and verification status.
- Click **Re-verify** to run a fresh integrity check.

### Terminal

A built-in web terminal for running commands directly from the browser.

- Create multiple terminal tabs.
- Run any AtlasBridge CLI command without switching to a separate terminal app.
- Useful for advanced operations like manual policy validation or debugging.

### Settings

Configuration and policy management.

**General tab:**
- View system configuration (config path, database path, version).
- Copy a diagnostics report to share when troubleshooting.
- View feature flags and their status.

**Security tab:**
- Browse security policies by category (Critical, Warning, Info).
- Toggle individual policies on or off.

**Policy tab:**
- See your active policy — name, autonomy mode, and rule count.
- **How policies work** — A 3-step guide: pick a preset, test it, start a session to enforce.
- **Autonomy mode** — Switch between Off, Assist, and Full with one click.
- **Preset selector** — Choose from ready-made policies (Minimal, Assist Mode, Full Mode Safe, Escalation Only).
- **Test a Prompt** — Type a sample prompt, pick a type and confidence level, and see which rule would match and what would happen. Color-coded results (green = auto-reply, amber = ask human, red = blocked).
- **Kill switch** — Emergency button to disable all automation instantly.
- **Rules list** — See every rule in your policy with toggle switches to enable/disable individual rules.

---

## 5. Policies — How They Work

A policy is a YAML file with rules. Each rule says: "When you see this kind of prompt, do this."

**Three things a rule can do:**

| Action | What happens | Example |
|--------|-------------|---------|
| **Auto-reply** | AtlasBridge answers automatically | "Press Enter to continue" → sends Enter |
| **Require human** | Sent to your phone for you to answer | "Delete all files?" → you decide |
| **Deny** | Blocked entirely, no response sent | "Enter your API key" → blocked |

**Three autonomy modes:**

| Mode | Behavior |
|------|----------|
| **Off** | Every prompt goes to your phone. No automation. |
| **Assist** | Policy suggests answers. You confirm from your phone. |
| **Full** | Matching prompts are handled automatically. Unmatched ones go to your phone. |

Rules are evaluated top to bottom. The first rule that matches wins.

---

## 6. Setting Up Your First Policy

The easiest way to get started is to activate a preset from the dashboard.

### Step 1: Go to Settings > Policy

Open the dashboard and click **Settings** in the navigation, then click the **Policy** tab.

### Step 2: Pick a preset

Use the preset selector dropdown to choose one:

- **minimal.yaml** — Only auto-confirms "Press Enter" prompts. Everything else goes to your phone. Best for getting started.
- **assist-mode.yaml** — Handles common prompts (Enter confirmations, yes/no for safe operations). Good for daily use.
- **full-mode-safe.yaml** — Auto-handles most prompts but blocks dangerous ones (credentials, destructive operations). For experienced users.
- **escalation-only.yaml** — Everything goes to your phone. No automation at all.

Click **Activate** and confirm.

### Step 3: Test it

Use the **Test a Prompt** panel on the same page:

1. Type a sample prompt in the text field, e.g., `Continue? [y/n]`
2. Select the prompt type (e.g., "Yes/No")
3. Select the confidence level (e.g., "High")
4. Click **Test**

The result shows:
- Which rule matched (or "no match")
- What action would be taken (auto-reply, require human, deny)
- A plain-English summary like "This prompt would be auto-replied with 'y'"

Try different prompts to understand how your policy behaves:
- `Press Enter to continue` (type: Confirm Enter) → should auto-reply
- `Enter your API key:` (type: Free Text) → should block or escalate
- `Delete everything?` (type: Yes/No) → should require human

### Step 4: Go live

Once you're happy with your policy, start a session from the **Sessions** page to enforce it on a real AI agent.

---

## 7. Running an AI Agent

You can start an AI agent session two ways:

### From the dashboard (recommended)

1. Go to the **Sessions** page.
2. Click **Start Session**.
3. Choose your adapter (Claude Code, OpenAI, Gemini, or Custom).
4. Select an autonomy mode.
5. Set the workspace path (the directory the AI should work in).
6. Click **Start**.

The session appears in the table. Click it to view the transcript, or go to the **Chat** page to interact in real time.

### From the terminal

```bash
atlasbridge run claude          # Claude Code
atlasbridge run openai          # OpenAI Codex CLI
atlasbridge run gemini          # Gemini CLI
atlasbridge run custom -- cmd   # Any interactive CLI
```

When the AI pauses for input, you'll get a notification on your phone (Telegram/Slack) or in the Chat page.

---

## 8. Understanding Decisions

Every time the AI asks a question, AtlasBridge makes a decision. You can review all decisions across three pages:

- **Prompts** — What did the AI ask? How was it classified? What was the response?
- **Traces** — The tamper-evident audit trail. Each entry has a hash linking it to the previous entry.
- **Audit** — All of the above in one place, with export options.

### Decision types

| Decision | Meaning |
|----------|---------|
| **Auto** | Policy handled it automatically |
| **Human** | Sent to you for a response |
| **Escalated** | Low confidence or no matching rule — sent to you for safety |

### Risk levels

| Level | Color | Meaning |
|-------|-------|---------|
| Low | Green | Routine operation |
| Medium | Amber | Needs attention |
| High | Orange | Potentially dangerous |
| Critical | Red | Immediate review needed |

---

## 9. Evidence & Compliance

The **Evidence** page helps you demonstrate that your AI operations are governed and auditable.

### Governance score

A score from 0 to 100 based on:
- How many decisions were handled by policy vs. escalated
- Whether dangerous operations were blocked
- Policy coverage (are there rules for common prompt types?)

### Exporting evidence

Click the export buttons to download:

- **JSON** — Full decision trace in machine-readable format
- **CSV** — Tabular format for spreadsheets
- **Bundle** — A ZIP file with the decision trace, policy snapshot, integrity report, and a manifest hash for verification

### Policy packs

Pre-built policy templates aligned to common requirements. Browse them and click **Activate** to apply one to your system.

---

## 10. Common Tasks

### How do I pause all automation?

**Dashboard:** Settings > Policy > click the Kill Switch button.
**Terminal:** `atlasbridge pause` or send `/pause` in Telegram/Slack.

### How do I change the autonomy mode?

**Dashboard:** Overview page > Operator Panel > click Off, Assist, or Full.
**Terminal:** `atlasbridge autopilot mode off|assist|full`

### How do I see what decisions were made?

**Dashboard:** Go to Audit page. Search and filter by type, risk level, or date.
**Terminal:** `atlasbridge autopilot explain --last 20`

### How do I stop a running session?

**Dashboard:** Sessions page > click the Stop button on the session row.
**Terminal:** `atlasbridge stop`

### How do I check if everything is working?

**Terminal:** `atlasbridge doctor` — runs a full health check.

### How do I update AtlasBridge?

```bash
pip install --upgrade atlasbridge
```

Your configuration, tokens, and database are preserved. See [Upgrading](upgrade.md) for details.

### How do I disable a specific policy rule?

**Dashboard:** Settings > Policy > find the rule in the list > toggle the switch off.

### How do I export my audit log?

**Dashboard:** Audit page > click the JSON or CSV export button.

---

## 11. Troubleshooting

### "command not found" after installing

Your Python scripts directory might not be on your PATH:

```bash
python3 -m site --user-scripts   # shows where scripts are installed
```

Add that directory to your PATH, or use `python3 -m atlasbridge` instead.

### Dashboard won't start

Check if the port is already in use:

```bash
atlasbridge dashboard status
```

If another process is using the port, stop it or set a different port with `--port`.

### Telegram bot not sending messages

1. Make sure you sent `/start` to your bot in Telegram
2. Check that notifications aren't muted for the bot chat
3. Run `atlasbridge doctor` to verify the channel is connected

### "409 Conflict" error on Telegram

Another AtlasBridge instance is already running and polling Telegram:

```bash
atlasbridge stop
```

Only one instance can poll Telegram at a time.

### Policy not taking effect

1. Check the policy is active: Settings > Policy — it should show the policy name
2. Make sure the autonomy mode isn't set to "Off" (Off routes everything to human regardless of rules)
3. Test your policy using the "Test a Prompt" panel to verify rules match as expected

### Need more help?

- Run `atlasbridge doctor` for a full health check
- See [Troubleshooting](troubleshooting.md) for more solutions
- Report issues at https://github.com/abdulraoufatia/atlasbridge/issues
