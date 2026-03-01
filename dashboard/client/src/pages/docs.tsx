import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen, Search, ChevronRight, ExternalLink, FileText, ScrollText,
  Zap, Shield, Terminal as TerminalIcon, HelpCircle, Github,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Documentation sections
// ---------------------------------------------------------------------------

interface DocSection {
  id: string;
  title: string;
  icon: React.ElementType;
  description: string;
  content: string;
}

const DOC_SECTIONS: DocSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: Zap,
    description: "What AtlasBridge is and how it works",
    content: `# Getting Started with AtlasBridge

## What is AtlasBridge?

AtlasBridge is a **policy-driven autonomous runtime** for AI tools. It watches your AI tools (like Claude Code in VS Code, Claude Desktop, ChatGPT, etc.) and manages what they can do automatically.

## How it works

1. **Monitor** — AtlasBridge watches your AI tools in real-time
2. **Detect** — When an AI tool asks a question or needs input, AtlasBridge detects it
3. **Evaluate** — The prompt is evaluated against your policy rules
4. **Act** — Based on the policy: auto-respond, escalate to you, or deny

## Autonomy Modes

| Mode | Behaviour |
|------|-----------|
| **Off** | All prompts forwarded to you. No automatic decisions. |
| **Assist** | Policy handles known prompts. Unknown ones escalated to you. |
| **Full** | Policy auto-executes everything it can. Only unknowns escalated. |

## Key Concepts

- **Policy** — A YAML file containing rules that tell AtlasBridge what to do
- **Rule** — A single instruction matching a prompt pattern to an action
- **Monitor** — A background process watching an AI tool for activity
- **Session** — A running instance of an AI tool being monitored
- **Prompt** — A question or input request from an AI tool
`,
  },
  {
    id: "policy-authoring",
    title: "Policy Authoring Guide",
    icon: ScrollText,
    description: "How to write policy rules from scratch",
    content: `# Policy Authoring Guide

## Quick Start (5 minutes)

Create a file called \`policy.yaml\` with this minimal example:

\`\`\`yaml
policy_version: "0"
name: my-first-policy
autonomy_mode: assist

rules:
  - id: auto-continue
    description: Auto-approve simple continue prompts
    match:
      prompt_type: [yes_no]
      contains: "Continue"
      min_confidence: high
    action: auto_reply
    value: "y"

  - id: catch-all
    description: Everything else needs human approval
    match: {}
    action: require_human
\`\`\`

## Rule Structure

Every rule has three parts:

### 1. Match Criteria — When does this rule apply?

| Field | Type | Description |
|-------|------|-------------|
| \`tool_id\` | string | Which tool (\`claude\`, \`openai\`, \`*\`) |
| \`prompt_type\` | list | Types: \`yes_no\`, \`confirm_enter\`, \`multiple_choice\`, \`free_text\`, \`tool_use\` |
| \`contains\` | string | Text the prompt must contain (substring or regex) |
| \`contains_is_regex\` | boolean | Treat \`contains\` as regex (default: false) |
| \`min_confidence\` | string | Minimum confidence: \`low\`, \`medium\`, \`high\` |
| \`repo\` | string | Working directory prefix match |

### 2. Action — What should happen?

| Action | Description |
|--------|-------------|
| \`auto_reply\` | Automatically respond with a fixed value |
| \`require_human\` | Send to you for manual response |
| \`deny\` | Block the prompt silently |
| \`notify_only\` | Send notification but don't block |

### 3. Value/Constraints (for auto_reply)

\`\`\`yaml
action: auto_reply
value: "y"
constraints:
  allowed_choices: ["y", "n"]
  max_length: 10
\`\`\`

## Evaluation Rules

- Rules are evaluated **top to bottom** (first match wins)
- All match criteria are **AND-combined** (all must match)
- Empty match \`{}\` matches everything (catch-all)
- Always put your catch-all rule **last**

## Common Patterns

### Auto-approve yes/no prompts
\`\`\`yaml
- id: auto-yes
  match:
    prompt_type: [yes_no]
    min_confidence: high
  action: auto_reply
  value: "y"
\`\`\`

### Block credential prompts
\`\`\`yaml
- id: block-credentials
  match:
    contains: "(password|token|secret|api.key)"
    contains_is_regex: true
  action: deny
  reason: "Credential prompts blocked by policy"
\`\`\`

### Escalate destructive actions
\`\`\`yaml
- id: escalate-destructive
  match:
    contains: "(delete|remove|drop|force.push)"
    contains_is_regex: true
  action: require_human
  message: "Destructive action detected"
\`\`\`

### Auto-press Enter for confirmations
\`\`\`yaml
- id: auto-enter
  match:
    prompt_type: [confirm_enter]
    min_confidence: high
  action: auto_reply
  value: "\\n"
\`\`\`
`,
  },
  {
    id: "policy-dsl",
    title: "Policy DSL Reference",
    icon: FileText,
    description: "Complete schema and field reference",
    content: `# Policy DSL Reference

## Full Schema

\`\`\`yaml
policy_version: "0"          # Required. Always "0" for now.
name: my-policy               # Optional. Human-readable label.
autonomy_mode: assist          # Required. One of: off, assist, full.

rules:                         # Required. Ordered list of rules.
  - id: rule-id                # Required. Unique identifier.
    description: "..."         # Optional. Shown in decision traces.
    match:                     # Required. Match criteria (AND-combined).
      tool_id: "*"             # Optional. Tool filter.
      prompt_type: [yes_no]    # Optional. List of prompt types.
      contains: "pattern"      # Optional. Substring or regex.
      contains_is_regex: false # Optional. Default: false.
      min_confidence: high     # Optional. Minimum confidence level.
      repo: "/path/prefix"    # Optional. Working directory prefix.
    action: auto_reply         # Required. Action to take.
    value: "y"                 # Required for auto_reply.
    message: "..."             # Optional for require_human.
    reason: "..."              # Optional for deny.
    max_auto_replies: 10       # Optional. Per-session limit.
    constraints:               # Optional. For auto_reply only.
      allowed_choices: ["y","n"]
      numeric_only: false
      allow_free_text: true
      max_length: 100

defaults:                      # Optional. Fallback behaviour.
  no_match: require_human      # What to do when no rule matches.
  low_confidence: require_human # What to do on low confidence.
\`\`\`

## Field Types

| Field | Type | Values |
|-------|------|--------|
| \`policy_version\` | string | \`"0"\` |
| \`autonomy_mode\` | enum | \`off\`, \`assist\`, \`full\` |
| \`prompt_type\` | list[enum] | \`yes_no\`, \`confirm_enter\`, \`multiple_choice\`, \`free_text\`, \`tool_use\`, \`*\` |
| \`min_confidence\` | enum | \`low\`, \`medium\`, \`high\` (ordering: low < medium < high) |
| \`action\` | enum | \`auto_reply\`, \`require_human\`, \`deny\`, \`notify_only\` |

## Confidence Levels

| Level | Meaning |
|-------|---------|
| **high** | Pattern matched with high certainty |
| **medium** | TTY blocked-on-read detected |
| **low** | Silence threshold exceeded (stall) |

## Regex Safety

- Maximum pattern length: 200 characters
- Timeout: 100ms per evaluation
- No backreferences allowed
- Empty-string matches rejected

## Idempotency

Every decision is deduplicated via \`SHA-256(policy_hash:prompt_id:session_id)[:16]\`. The same prompt will never be evaluated twice.
`,
  },
  {
    id: "settings-guide",
    title: "Settings Guide",
    icon: Shield,
    description: "What each settings tab does and when to use it",
    content: `# Settings Guide

This guide explains every tab on the Settings page in plain language.

## General

**What it shows:** Read-only system information — where your config files live, your AtlasBridge version, database path, and which features are enabled.

**When to use it:** Check this if something isn't working and you need to share diagnostics. Click "Copy Diagnostics" to get a safe-to-share summary.

**Layman tip:** You don't need to change anything here. It's for reference only.

## Policy

**What it does:** Controls what AtlasBridge does automatically vs what it asks you about.

**Key concepts:**
- **Autonomy Mode** — Off (ask me everything), Assist (handle known things, ask about unknowns), Full (handle everything possible)
- **Presets** — Pre-made rule sets you can activate with one click
- **Rules** — Individual instructions like "if the AI asks Continue? [y/n], automatically reply y"
- **Test a Prompt** — Type a sample prompt to see what AtlasBridge would do

**When to use it:** When you want to change how much AtlasBridge does on its own.

**Layman tip:** Start with the "Assist" mode and a preset policy. Use "Test a Prompt" to understand what each rule does before changing anything.

## Providers

**What it does:** Stores API keys for AI services (OpenAI, Anthropic, Google Gemini).

**When to use it:** If you want AtlasBridge to interact with AI services on your behalf (e.g. for CVE lookups or cloud scanning).

**Layman tip:** You only need to add keys for services you actually use. Keys are stored in your OS keychain — they never leave your machine.

## Workspaces

**What it does:** Manages which project directories AtlasBridge trusts. Trusted workspaces skip the approval prompt when starting a session.

**When to use it:** After you've used AtlasBridge in a project directory and want to pre-approve it for future sessions.

**Layman tip:** Your workspaces appear here automatically after your first session. Click "Trust" to skip the approval step next time.

## Alerts

**What it does:** Configures notification channels (email, webhooks) so AtlasBridge can tell you when something needs attention.

**When to use it:** If you want push notifications when the AI needs your input or when scans complete.

**Layman tip:** This is optional. The dashboard itself shows all notifications. Set this up only if you want alerts via email or webhooks.

## Retention

**What it does:** Controls how long AtlasBridge keeps historical data — audit logs, decision traces, and session records.

**When to use it:** If your disk is running low, or if you want to keep records for compliance reasons.

**Layman tip:** The defaults (2 years for audit, 1 year for traces, 6 months for sessions) are fine for most users.

## Security

**What it does:** Manages security policies — rules about session timeouts, concurrent session limits, and risk thresholds.

**When to use it:** If you're running AtlasBridge in a team environment and want to enforce safety limits.

**Layman tip:** The defaults are sensible. You can leave this tab alone unless you have specific security requirements.

## Authentication

**What it does:** Manages authentication providers (GitHub App tokens, OIDC providers like Okta, Azure AD).

**When to use it:** If you need authenticated access to private GitHub repositories for scanning, or if you want single sign-on for the dashboard.

**Layman tip:** Most individual users don't need this. It's designed for team/organisation setups.

## Agents

**What it does:** Registers AI agent profiles with risk tiers, capability lists, and autonomy caps.

**When to use it:** If you're running multiple AI agents and want per-agent risk controls.

**Layman tip:** This is an advanced feature for multi-agent setups. Skip it unless you're managing several different AI tools with different trust levels.

## Danger Zone

**What it does:** Destructive operations — delete all activity data, purge everything, or reset to factory defaults.

**When to use it:** To start fresh or clear out old data. All actions require confirmation.

**Layman tip:** Use "Delete Activity Data" to clear browser/desktop monitor history. "Reset All Settings" returns everything to defaults — useful if you've misconfigured something.
`,
  },
  {
    id: "faq",
    title: "Frequently Asked Questions",
    icon: HelpCircle,
    description: "Common questions and answers",
    content: `# Frequently Asked Questions

## General

**Q: Does AtlasBridge send my data anywhere?**
A: No. Everything runs locally on your machine. No data is transmitted externally. The dashboard binds to localhost only.

**Q: Can AtlasBridge access my AI conversations?**
A: Only if you enable a monitor for that tool. The monitor reads visible text from the AI tool's interface. It does not access API keys, tokens, or account data.

**Q: What happens if AtlasBridge crashes?**
A: Your AI tools continue running normally. AtlasBridge is a passive observer — it doesn't intercept or block your tools. If it crashes, you just lose the monitoring and automation features until you restart.

## Policy

**Q: What happens when no rule matches?**
A: The default behaviour depends on your \`defaults.no_match\` setting. If not set, it falls back to \`require_human\` (safest default).

**Q: Can I have multiple policies?**
A: Yes. Save your current policy as a custom preset, then switch between presets. Only one policy is active at a time.

**Q: Are rules case-sensitive?**
A: The \`contains\` field is case-insensitive by default. Regex patterns (\`contains_is_regex: true\`) follow standard regex case rules — add \`(?i)\` for case-insensitive regex.

**Q: What's the maximum number of rules?**
A: There's no hard limit, but evaluation is sequential (first-match-wins). Keep your policy focused — 10-20 rules is typical.

## Monitors

**Q: Why does the Desktop Monitor need Accessibility permission?**
A: On macOS, reading text from other apps requires Accessibility API access. This is a macOS security requirement. AtlasBridge only reads visible text — it cannot click, type, or modify other apps.

**Q: Does the VS Code Monitor work with other editors?**
A: Currently it monitors Claude Code sessions specifically (via lock files). Support for other IDE extensions may be added in the future.

**Q: How does the Browser Extension work?**
A: It uses DOM mutation observers to detect new messages in supported AI chat services (Claude.ai, ChatGPT, Gemini). It runs only on those specific domains and sends data to your local dashboard.
`,
  },
];

// ---------------------------------------------------------------------------
// Simple Markdown Renderer
// ---------------------------------------------------------------------------

function renderMarkdown(md: string): JSX.Element {
  const lines = md.split("\n");
  const elements: JSX.Element[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLang = "";
  let inTable = false;
  let tableRows: string[][] = [];
  let tableHeader: string[] = [];
  let key = 0;

  function flushTable() {
    if (tableRows.length === 0) return;
    elements.push(
      <div key={key++} className="overflow-x-auto my-4">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b">
              {tableHeader.map((h, i) => (
                <th key={i} className="text-left p-2 font-medium text-muted-foreground">{h.trim()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row, ri) => (
              <tr key={ri} className="border-b last:border-0">
                {row.map((cell, ci) => (
                  <td key={ci} className="p-2">{renderInline(cell.trim())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    tableRows = [];
    tableHeader = [];
    inTable = false;
  }

  function renderInline(text: string): JSX.Element {
    // Bold
    const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
    return (
      <>
        {parts.map((part, i) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return <strong key={i}>{part.slice(2, -2)}</strong>;
          }
          if (part.startsWith("`") && part.endsWith("`")) {
            return (
              <code key={i} className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono">
                {part.slice(1, -1)}
              </code>
            );
          }
          return <span key={i}>{part}</span>;
        })}
      </>
    );
  }

  for (const line of lines) {
    // Code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={key++} className="bg-muted/50 border rounded-lg p-4 overflow-x-auto my-3">
            <code className="text-xs font-mono">{codeBlockContent.join("\n")}</code>
          </pre>,
        );
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        if (inTable) flushTable();
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
      }
      continue;
    }
    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Tables
    if (line.includes("|") && line.trim().startsWith("|")) {
      const cells = line.split("|").filter((c) => c.trim() !== "");
      // Check if separator row
      if (cells.every((c) => /^[\s-:]+$/.test(c))) continue;
      if (!inTable) {
        inTable = true;
        tableHeader = cells;
      } else {
        tableRows.push(cells);
      }
      continue;
    } else if (inTable) {
      flushTable();
    }

    // Headers
    if (line.startsWith("# ")) {
      elements.push(
        <h1 key={key++} className="text-xl font-semibold mt-6 mb-3">{line.slice(2)}</h1>,
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2 key={key++} className="text-lg font-semibold mt-5 mb-2">{line.slice(3)}</h2>,
      );
    } else if (line.startsWith("### ")) {
      elements.push(
        <h3 key={key++} className="text-base font-semibold mt-4 mb-2">{line.slice(4)}</h3>,
      );
    } else if (line.trim() === "") {
      // Skip empty lines
    } else if (line.startsWith("- ")) {
      elements.push(
        <li key={key++} className="text-sm text-muted-foreground ml-4 list-disc">
          {renderInline(line.slice(2))}
        </li>,
      );
    } else {
      elements.push(
        <p key={key++} className="text-sm text-muted-foreground leading-relaxed my-2">
          {renderInline(line)}
        </p>,
      );
    }
  }

  if (inTable) flushTable();

  return <>{elements}</>;
}

// ---------------------------------------------------------------------------
// Main Docs Page
// ---------------------------------------------------------------------------

export default function DocsPage() {
  const [selectedSection, setSelectedSection] = useState<string>("getting-started");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredSections = searchQuery
    ? DOC_SECTIONS.filter(
        (s) =>
          s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.content.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : DOC_SECTIONS;

  const activeSection = DOC_SECTIONS.find((s) => s.id === selectedSection);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          Documentation
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everything you need to know about AtlasBridge.
        </p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search documentation..."
          className="pl-9"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="space-y-1">
          {filteredSections.map((section) => (
            <button
              key={section.id}
              onClick={() => setSelectedSection(section.id)}
              className={cn(
                "w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors",
                selectedSection === section.id
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted text-muted-foreground",
              )}
            >
              <section.icon className="w-4 h-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{section.title}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {section.description}
                </p>
              </div>
            </button>
          ))}

          {/* Developer links */}
          <div className="border-t pt-3 mt-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 mb-2">
              For Developers
            </p>
            <a
              href="https://github.com/auredia/atlasbridge"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-3 p-3 rounded-lg text-left hover:bg-muted transition-colors text-muted-foreground"
            >
              <Github className="w-4 h-4 shrink-0" />
              <span className="text-sm">GitHub Repository</span>
              <ExternalLink className="w-3 h-3 ml-auto" />
            </a>
            <a
              href="https://github.com/auredia/atlasbridge/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-3 p-3 rounded-lg text-left hover:bg-muted transition-colors text-muted-foreground"
            >
              <HelpCircle className="w-4 h-4 shrink-0" />
              <span className="text-sm">Report an Issue</span>
              <ExternalLink className="w-3 h-3 ml-auto" />
            </a>
          </div>
        </div>

        {/* Content */}
        <div className="lg:col-span-3">
          <Card>
            <CardContent className="p-6 prose-sm max-w-none">
              {activeSection ? (
                renderMarkdown(activeSection.content)
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select a section from the sidebar.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
