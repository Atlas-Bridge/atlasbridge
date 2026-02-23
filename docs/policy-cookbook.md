# Policy Cookbook — Real-World Automation Patterns

Copy-paste-ready policy patterns for common automation scenarios. Each recipe is a self-contained YAML snippet you can drop into your policy file.

All snippets in this cookbook have been validated with `atlasbridge policy validate`.

See [Policy Authoring Guide](policy-authoring.md) for fundamentals and [Policy DSL v0 Reference](policy-dsl.md) for full schema.

---

## Table of Contents

1. [Safety Guards (use in every policy)](#1-safety-guards)
2. [Git Workflow Automation](#2-git-workflow-automation)
3. [CI/CD Check Automation](#3-cicd-check-automation)
4. [Dependabot / Renovate Auto-Approve](#4-dependabot--renovate-auto-approve)
5. [Package Manager Prompts](#5-package-manager-prompts)
6. [Session-Scoped Rules (v1)](#6-session-scoped-rules-v1)
7. [Compound Conditions (v1)](#7-compound-conditions-v1)
8. [Rate Limiting](#8-rate-limiting)
9. [Complete Starter Policies](#9-complete-starter-policies)

---

## 1. Safety Guards

Always place safety guards at the top of your rules list. First-match-wins means these must fire before any auto-approve rule.

### Block credential prompts

```yaml
- id: "deny-credentials"
  description: "Never auto-reply to credential prompts"
  match:
    prompt_type:
      - free_text
    contains: "password|token|api.?key|secret|passphrase"
    contains_is_regex: true
    min_confidence: low
  action:
    type: deny
    reason: "Credential prompts require manual input."
```

### Block force-push

```yaml
- id: "deny-force-push"
  description: "Never auto-approve force-push"
  match:
    contains: "force.push|force push|--force"
    contains_is_regex: true
    min_confidence: low
  action:
    type: deny
    reason: "Force-push requires manual approval."
```

### Escalate destructive operations

```yaml
- id: "escalate-destructive"
  description: "Route destructive operations to human"
  match:
    contains: "delete|destroy|drop|purge|wipe|truncate|rm -rf"
    contains_is_regex: true
    min_confidence: low
  action:
    type: require_human
    message: "Destructive operation detected. Please review carefully."
```

### Escalate "are you sure" prompts

```yaml
- id: "escalate-are-you-sure"
  description: "Explicit confirmation prompts always go to human"
  match:
    contains: "are you sure"
    contains_is_regex: false
    min_confidence: low
  action:
    type: require_human
    message: "This prompt asks for explicit confirmation. Please review."
```

---

## 2. Git Workflow Automation

### Auto-approve git commit confirmations

```yaml
- id: "git-commit-yes"
  description: "Auto-approve git commit prompts"
  match:
    prompt_type:
      - yes_no
    contains: "(?i)commit.*changes|create.*commit"
    contains_is_regex: true
    min_confidence: high
  action:
    type: auto_reply
    value: "y"
    constraints:
      allowed_choices: ["y", "n"]
```

### Auto-approve squash-merge

```yaml
- id: "squash-merge-yes"
  description: "Auto-approve squash and merge confirmations"
  match:
    prompt_type:
      - yes_no
    contains: "(?i)squash.and.merge|merge.pr|merge.pull.request"
    contains_is_regex: true
    min_confidence: high
  action:
    type: auto_reply
    value: "y"
    constraints:
      allowed_choices: ["y", "n"]
```

### Block rebase and reset

```yaml
- id: "block-rebase-reset"
  description: "Escalate rebase and reset operations"
  match:
    contains: "(?i)rebase|reset --hard|checkout \\."
    contains_is_regex: true
    min_confidence: low
  action:
    type: require_human
    message: "Rebase or reset detected. These rewrite history — please confirm."
```

---

## 3. CI/CD Check Automation

### Auto-approve "CI checks passed, proceed?"

```yaml
- id: "ci-checks-proceed"
  description: "Auto-proceed when CI checks pass"
  match:
    prompt_type:
      - yes_no
    contains: "(?i)ci.*pass|checks.*pass|all.*green|pipeline.*pass"
    contains_is_regex: true
    min_confidence: high
  action:
    type: auto_reply
    value: "y"
    constraints:
      allowed_choices: ["y", "n"]
```

### Auto-approve test runner prompts

```yaml
- id: "test-runner-yes"
  description: "Auto-approve pytest/test runner confirmations"
  match:
    prompt_type:
      - yes_no
    contains: "(?i)run.*tests?|execute.*tests?"
    contains_is_regex: true
    min_confidence: high
  action:
    type: auto_reply
    value: "y"
    constraints:
      allowed_choices: ["y", "n"]
```

### Escalate deploy prompts

```yaml
- id: "escalate-deploy"
  description: "Deployment prompts always require human approval"
  match:
    contains: "(?i)deploy|push to prod|release to|publish to"
    contains_is_regex: true
    min_confidence: low
  action:
    type: require_human
    message: "Deployment prompt detected. Manual approval required."
```

---

## 4. Dependabot / Renovate Auto-Approve

For repos that process dependency update PRs with an AI agent.

### Auto-approve version bump confirmations

```yaml
- id: "dependabot-bump-yes"
  description: "Auto-approve Dependabot version bump prompts"
  match:
    prompt_type:
      - yes_no
    contains: "(?i)dependabot|renovate|bump|update.*version|version.*update"
    contains_is_regex: true
    min_confidence: high
  action:
    type: auto_reply
    value: "y"
    constraints:
      allowed_choices: ["y", "n"]
```

### Auto-approve PR merge for dependency updates

```yaml
- id: "dep-merge-yes"
  description: "Auto-merge dependency update PRs"
  match:
    prompt_type:
      - yes_no
    contains: "(?i)(merge.*dependabot|merge.*renovate|approve.*merge)"
    contains_is_regex: true
    min_confidence: high
  action:
    type: auto_reply
    value: "y"
    constraints:
      allowed_choices: ["y", "n"]
```

See the full preset at `config/policies/pr-remediation-dependabot.yaml`.

---

## 5. Package Manager Prompts

### Auto-select first option in package manager menus

```yaml
- id: "package-menu-option-1"
  description: "Select option 1 for package manager menus"
  match:
    prompt_type:
      - multiple_choice
    contains: "(?i)npm|pip|yarn|pnpm|cargo|gem"
    contains_is_regex: true
    min_confidence: high
  action:
    type: auto_reply
    value: "1"
    constraints:
      numeric_only: true
      allowed_choices: ["1", "2", "3"]
```

### Auto-approve pip/npm install confirmations

```yaml
- id: "install-proceed-yes"
  description: "Auto-approve package install confirmations"
  match:
    prompt_type:
      - yes_no
    contains: "(?i)proceed.*install|install.*proceed|install.*packages"
    contains_is_regex: true
    min_confidence: high
  action:
    type: auto_reply
    value: "y"
    constraints:
      allowed_choices: ["y", "n"]
```

---

## 6. Session-Scoped Rules (v1)

Policy DSL v1 adds `session_tag` for scoping rules to specific session types. Tag sessions when launching:

```bash
atlasbridge run claude --session-label "ci"
atlasbridge run claude --session-label "dev"
```

### CI sessions: auto-approve everything high-confidence

```yaml
policy_version: "1"
name: "ci-scoped"
autonomy_mode: full

rules:
  - id: "ci-auto-yes"
    description: "Auto-approve all high-confidence yes/no in CI sessions"
    match:
      prompt_type: [yes_no]
      min_confidence: high
      session_tag: "ci"
    action:
      type: auto_reply
      value: "y"
      constraints:
        allowed_choices: ["y", "n"]

  - id: "ci-auto-enter"
    description: "Auto-confirm Enter in CI sessions"
    match:
      prompt_type: [confirm_enter]
      min_confidence: medium
      session_tag: "ci"
    action:
      type: auto_reply
      value: "\n"

  - id: "catch-all"
    match: {}
    action:
      type: require_human

defaults:
  no_match: require_human
  low_confidence: require_human
```

### Dev sessions: conservative (human-in-the-loop)

```yaml
- id: "dev-enter-only"
  description: "Dev sessions: only auto-confirm Enter prompts"
  match:
    prompt_type: [confirm_enter]
    min_confidence: medium
    session_tag: "dev"
  action:
    type: auto_reply
    value: "\n"
```

---

## 7. Compound Conditions (v1)

### OR logic with `any_of`

Match if the prompt is either a yes/no OR a confirm_enter:

```yaml
policy_version: "1"

rules:
  - id: "auto-approve-safe-types"
    description: "Auto-reply to yes/no and confirm_enter"
    match:
      min_confidence: high
      any_of:
        - prompt_type: [yes_no]
        - prompt_type: [confirm_enter]
    action:
      type: auto_reply
      value: "y"
```

### NOT logic with `none_of`

Match yes/no prompts that do NOT contain destructive keywords:

```yaml
policy_version: "1"

rules:
  - id: "safe-yes-no"
    description: "Auto-yes for non-destructive yes/no prompts"
    match:
      prompt_type: [yes_no]
      min_confidence: high
      none_of:
        - contains: "delete|destroy|force"
          contains_is_regex: true
    action:
      type: auto_reply
      value: "y"
      constraints:
        allowed_choices: ["y", "n"]
```

### Confidence range with `max_confidence`

Only match medium-confidence prompts (not high, not low):

```yaml
policy_version: "1"

rules:
  - id: "medium-confidence-escalate"
    description: "Medium-confidence prompts get escalated"
    match:
      min_confidence: medium
      max_confidence: medium
    action:
      type: require_human
      message: "Medium-confidence prompt. Please verify."
```

---

## 8. Rate Limiting

Per-rule rate limits prevent runaway auto-replies.

### Limit auto-replies to 10 per minute

```yaml
- id: "rate-limited-auto-yes"
  description: "Auto-yes with rate limit"
  match:
    prompt_type: [yes_no]
    min_confidence: high
  action:
    type: auto_reply
    value: "y"
    constraints:
      allowed_choices: ["y", "n"]
    rate_limit:
      max_per_minute: 10
```

### Limit free-text auto-replies more aggressively

```yaml
- id: "rate-limited-text"
  description: "Auto-reply text with strict rate limit"
  match:
    prompt_type: [free_text]
    min_confidence: high
  action:
    type: auto_reply
    value: "default-input"
    rate_limit:
      max_per_minute: 3
```

---

## 9. Complete Starter Policies

### Minimal — safest starting point

Use `config/policies/minimal.yaml`. Auto-confirms Enter prompts, routes everything else to your phone.

```bash
atlasbridge run claude --policy config/policies/minimal.yaml
```

### Assist — suggests replies, you confirm

Use `config/policies/assist-mode.yaml`. The engine suggests yes/no for known-safe patterns; you tap to confirm from Telegram/Slack.

```bash
atlasbridge run claude --policy config/policies/assist-mode.yaml
```

### Full — autonomous with safety guards

Use `config/policies/full-mode-safe.yaml`. Auto-injects replies immediately for matched patterns. Dangerous operations blocked or escalated. Read every rule before deploying.

```bash
atlasbridge run claude --policy config/policies/full-mode-safe.yaml
```

### Dependabot PR remediation

Use `config/policies/pr-remediation-dependabot.yaml`. Scoped to claude adapter + workspace repos. Auto-approves merge, bump, and CI-check prompts.

```bash
atlasbridge run claude --policy config/policies/pr-remediation-dependabot.yaml
```

---

## Validation

Always validate before deploying:

```bash
# Validate syntax
atlasbridge policy validate policy.yaml

# Test against a specific prompt
atlasbridge policy test policy.yaml \
  --prompt "Do you want to proceed? [Y/n]" \
  --type yes_no \
  --confidence high \
  --explain

# Review recent decisions
atlasbridge autopilot explain --last 20
```

---

## Tips

1. **Safety guards first.** Credential deny and destructive-operation escalation rules must be at the top of every policy. First-match-wins means they must fire before broader auto-approve rules.
2. **Start with assist mode.** Watch how the policy evaluates for a few sessions before switching to full mode.
3. **Use `--explain` liberally.** The `policy test --explain` flag shows exactly which rule would match and why.
4. **Scope with `tool_id`.** Use `tool_id: "claude"` or `tool_id: "openai"` to write adapter-specific rules without affecting other sessions.
5. **Tag sessions for scoping (v1).** Use `--session-label "ci"` and `session_tag: "ci"` in rules to apply different policies to different workflows.
6. **Test regex patterns.** Complex regex can be surprising. Test each pattern independently with `policy test` before deploying.
7. **Keep a catch-all.** Always end with `match: {}` that routes to `require_human`. This ensures nothing falls through silently.
