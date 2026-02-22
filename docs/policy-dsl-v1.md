# AtlasBridge Policy DSL v1

Policy DSL v1 is a backward-compatible extension of v0. All v0 files continue to work
unchanged. v1 adds compound conditions, session scoping, confidence bounds, and policy
inheritance.

> **Migrate an existing v0 file:**
> ```bash
> atlasbridge policy migrate ~/.atlasbridge/policy.yaml
> ```

---

## Quick start

```yaml
policy_version: "1"
name: my-policy
autonomy_mode: full

rules:
  - id: ci-auto-yes
    description: Auto-reply y to yes/no prompts in CI sessions.
    match:
      prompt_type: [yes_no]
      min_confidence: high
      session_tag: "ci"
    action:
      type: auto_reply
      value: "y"

  - id: catch-all
    match: {}
    action:
      type: require_human

defaults:
  no_match: require_human
  low_confidence: require_human
```

---

## What's new in v1

| Feature | YAML field | Description |
|---------|-----------|-------------|
| OR logic | `any_of` | Rule matches if ANY sub-criteria block passes |
| NOT logic | `none_of` | Rule fails if ANY sub-criteria block matches |
| Session scope | `session_tag` | Rule only applies to sessions with this exact label |
| Confidence upper bound | `max_confidence` | Rule only applies at or below this confidence level |
| Policy inheritance | `extends` | Inherit rules from a base policy file |

All v0 fields (`tool_id`, `repo`, `prompt_type`, `contains`, `contains_is_regex`,
`min_confidence`) continue to work with the same semantics.

---

## Schema reference

### `match` block (v1)

```yaml
match:
  # ---- v0 fields (unchanged) ----
  tool_id: "claude_code"          # exact match or "*" wildcard
  repo: "/home/user/project"      # prefix match on session cwd
  prompt_type: [yes_no, confirm_enter]
  contains: "continue"            # substring or regex
  contains_is_regex: false
  min_confidence: medium          # low | medium | high

  # ---- v1 additions ----
  max_confidence: medium          # upper bound: low | medium | high
  session_tag: "ci"               # exact match on session label

  any_of:                         # OR: match if ANY sub-block passes
    - prompt_type: [yes_no]
    - prompt_type: [confirm_enter]

  none_of:                        # NOT: fail if ANY sub-block matches
    - contains: "destroy"
    - contains: "delete"
```

**Constraint:** `any_of` and flat criteria are mutually exclusive on the same block.
Put each alternative in a sub-block. `none_of` has no such restriction.

### `any_of` — OR logic

```yaml
match:
  any_of:
    - prompt_type: [yes_no]
      min_confidence: high
    - prompt_type: [confirm_enter]
```

The rule matches if **ANY** sub-block passes (all criteria within a sub-block must pass, AND logic).

### `none_of` — NOT logic

```yaml
match:
  prompt_type: [yes_no]
  none_of:
    - contains: "rm -rf"
    - contains: "destroy"
```

The rule matches only if **NONE** of the `none_of` sub-blocks match. Useful for excluding
dangerous patterns from otherwise broad rules.

### `session_tag` — session scoping

Set the session label when launching a tool:

```bash
atlasbridge run claude --session-label ci
```

Then scope rules to that session:

```yaml
match:
  session_tag: "ci"
```

The match is **exact** (case-sensitive). If `session_tag` is not set on the rule, it matches
any session regardless of label.

### `max_confidence` — confidence upper bound

```yaml
match:
  max_confidence: "low"   # only match LOW confidence signals
```

Useful for routing ambiguous (low-confidence) prompts differently from clear ones:

```yaml
rules:
  - id: low-confidence-notify
    match:
      max_confidence: "low"
    action:
      type: notify_only

  - id: high-confidence-auto
    match:
      prompt_type: [yes_no]
      min_confidence: high
    action:
      type: auto_reply
      value: "y"
```

---

## Policy inheritance (`extends`)

```yaml
policy_version: "1"
name: child-policy
extends: "base.yaml"     # relative or absolute path

rules:
  - id: override-rule
    # Child rules are evaluated first (shadow base rules)
    ...
```

Rules from the child policy are prepended to the base rules. If a rule ID appears in both,
the child's version wins. The base policy's `defaults` are inherited if the child doesn't
override them.

**Cycle detection:** circular `extends` chains (`A → B → A`) raise a `PolicyParseError`.

**Constraint:** the base policy must also be v1 (v0 base policies are not supported).

---

## CLI

```bash
# Validate (v0 and v1)
atlasbridge policy validate policy_v1.yaml

# Test with session_tag
atlasbridge policy test policy_v1.yaml \
  --prompt "Deploy to prod? [y/n]" \
  --type yes_no --confidence high \
  --session-tag ci --explain

# Migrate v0 → v1 (in place)
atlasbridge policy migrate policy.yaml

# Migrate to a new file (preserve original)
atlasbridge policy migrate policy.yaml --output policy_v1.yaml

# Preview migration without writing
atlasbridge policy migrate policy.yaml --dry-run
```

---

## Evaluation semantics

1. Rules are evaluated in order — **first match wins**
2. For each rule, the `match` block is evaluated:
   - If `any_of` is set: OR logic (match if any sub-block passes)
   - Otherwise: flat AND logic (all criteria must pass)
3. If `none_of` is set: NOT filter applied after the primary match
4. If no rule matches: `defaults.no_match` or `defaults.low_confidence` applies

---

## Combined feature examples

### `any_of` + `none_of` — OR with exclusions

```yaml
- id: safe-auto-reply
  description: Auto-reply to yes/no or confirm prompts, but not destructive ones.
  match:
    any_of:
      - prompt_type: [yes_no]
      - prompt_type: [confirm_enter]
    none_of:
      - contains: "rm -rf"
      - contains: "DROP TABLE"
      - contains: "destroy"
  action:
    type: auto_reply
    value: "y"
```

Evaluation: the `any_of` OR block is checked first. If any sub-block matches, the `none_of`
NOT filter is applied. If any `none_of` sub-block matches, the rule fails.

### `session_tag` + `max_confidence` — scoped low-confidence routing

```yaml
- id: ci-low-confidence-deny
  description: Deny ambiguous prompts in CI (no human to escalate to).
  match:
    session_tag: "ci"
    max_confidence: "low"
  action:
    type: deny
    reason: "Low-confidence prompt in CI — cannot escalate."
```

Both `session_tag` and `max_confidence` must pass (AND logic within the flat block).

### `min_confidence` + `max_confidence` — confidence band

```yaml
- id: medium-only-notify
  description: Notify on medium-confidence prompts only.
  match:
    min_confidence: medium
    max_confidence: medium
  action:
    type: notify_only
```

Creates an exact confidence band: only `medium` matches. `low` is below `min_confidence`,
`high` is above `max_confidence`.

### `any_of` with `session_tag` in sub-blocks

```yaml
- id: env-specific-auto
  description: Auto-reply in CI for yes/no, or in staging for confirm.
  match:
    any_of:
      - prompt_type: [yes_no]
        session_tag: "ci"
      - prompt_type: [confirm_enter]
        session_tag: "staging"
  action:
    type: auto_reply
    value: "y"
```

Each `any_of` sub-block can have its own `session_tag`, `min_confidence`, etc.

---

## Evaluation order (detailed)

For each rule, evaluation proceeds in this order:

1. **Primary match** — either `any_of` OR block or flat AND criteria:
   - `any_of`: iterate sub-blocks; match if ANY sub-block passes (short-circuit on first match)
   - Flat AND: check `tool_id` → `repo` → `prompt_type` → `min_confidence` →
     `max_confidence` → `contains` → `session_tag` (short-circuit on first failure)
2. **NOT filter** (`none_of`): iterate sub-blocks; fail if ANY sub-block matches
3. If both pass, the rule matches → execute its action

The `any_of`/flat criteria and `none_of` constraint: `any_of` and flat criteria are mutually
exclusive on the same block (Pydantic validator rejects this at parse time). `none_of` can
coexist with either.

---

## Edge cases

| Scenario | Behavior |
|----------|----------|
| `match: {}` (empty) | Matches all prompts — all defaults pass. Use as a catch-all. |
| Empty `rules: []` | No rule matches → falls to `defaults.no_match` or `defaults.low_confidence`. |
| Overlapping rules | First match wins. Rule order matters. |
| Unknown YAML fields | Rejected at parse time (`extra: "forbid"` on all models). |
| `contains: ""` | Rejected at parse time (empty string not allowed). |
| `max_auto_replies: 0` | Rejected at parse time (must be ≥ 1). |
| `session_tag` not set on rule | Matches any session, including those without a label. |
| `max_confidence` not set | No upper bound — matches all confidence levels. |
| Duplicate rule IDs | Rejected at parse time. |
| `extends` base is v0 | Rejected at parse time — base must be v1. |
| Circular `extends` | Detected at parse time → `PolicyParseError`. |

---

## Migration guide (v0 → v1)

The only required change is `policy_version: "0"` → `"1"`. All v0 syntax is valid v1.

```bash
atlasbridge policy migrate policy.yaml
```

To take advantage of v1 features:

1. Replace chains of similar rules with `any_of` OR blocks
2. Add `session_tag` to scope CI-specific rules
3. Use `max_confidence: low` to handle ambiguous prompts
4. Use `none_of` to exclude dangerous patterns from broad rules
5. Use `extends` to share a base policy across environments

---

## See also

- [Policy DSL v0 reference](policy-dsl.md)
- [Policy authoring guide](policy-authoring.md)
- [Example v1 policy](../config/policy.example_v1.yaml)
