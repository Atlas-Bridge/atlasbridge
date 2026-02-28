# Workspace Governance

## Overview

Workspace governance turns the concept of a "workspace" into a first-class
governance boundary within AtlasBridge. It is explicit, deterministic,
auditable, and policy-driven.

Two concepts are deliberately separated:

- **Workspace Trust** = consent for local file/tool access in that path
  (yes/no, with optional TTL)
- **Workspace Posture** = explicit governance binding for that workspace
  (profile, autonomy mode, model tier, tool allowlist)

Trust must NOT implicitly expand permissions. Posture controls permissions
via policy evaluation.

---

## Trust

Trust is a binary consent boundary: does the operator allow the runtime to
perform file and tool operations within this workspace path?

### Granting trust

```bash
# Trust indefinitely
atlasbridge workspace trust /path/to/project

# Trust with time-to-live
atlasbridge workspace trust /path/to/project --ttl 8h
atlasbridge workspace trust /path/to/project --ttl 7d
```

Or via the dashboard API:

```bash
curl -X POST http://127.0.0.1:8787/api/workspaces/trust \
  -H 'Content-Type: application/json' \
  -d '{"path": "/path/to/project", "trust": true, "ttl_seconds": 28800}'
```

### Revoking trust

```bash
atlasbridge workspace revoke /path/to/project
```

### TTL (Time-Bounded Trust)

Trust can be granted with a TTL. When the TTL expires, the runtime treats
the workspace as untrusted until trust is renewed. Supported formats:

| Suffix | Meaning |
|--------|---------|
| `m`    | Minutes |
| `h`    | Hours   |
| `d`    | Days    |

Example: `--ttl 8h` means trust expires 8 hours after grant.

When trust expires, `get_trust()` returns `False` and the runtime will
prompt for consent before allowing file/tool operations.

### Consent flow

When a session starts or requests file/tool access in a workspace:

1. If workspace is untrusted or trust expired: runtime emits a single
   consent message:
   ```
   Trust workspace /path/to/project for local file/tool access?
   Reply: yes or no
   ```
2. User responds via dashboard or local CLI input.
3. Decision is stored in the SoR with optional TTL.

This replaces relaying upstream CLI keystroke prompts.

---

## Posture

Posture is a set of governance bindings that influence how policy rules
evaluate for a workspace. Posture settings are **configuration inputs to
policy evaluation** — they do not directly control execution.

### Setting posture

```bash
atlasbridge workspace posture /path/to/project \
  --profile safe_refactor \
  --autonomy ASSIST \
  --model-tier standard
```

Or via the dashboard API:

```bash
curl -X POST http://127.0.0.1:8787/api/workspaces/posture \
  -H 'Content-Type: application/json' \
  -d '{"workspace_id": "<id>", "profile_name": "plan_only", "autonomy_default": "ASSIST"}'
```

### Posture fields

| Field                    | Description                                          |
|--------------------------|------------------------------------------------------|
| `profile_name`           | Named posture profile (e.g. `safe_refactor`)         |
| `autonomy_default`       | Default autonomy mode: `OFF`, `ASSIST`, or `FULL`    |
| `model_tier`             | Default model tier (placeholder if not tiered yet)   |
| `tool_allowlist_profile` | Reference to a tool allowlist profile name           |
| `posture_notes`          | Optional notes                                       |

### How posture integrates with policy evaluation

The policy evaluator receives workspace context including:

- `workspace_trusted` (bool)
- `workspace_profile` (string)

Policy rules can match on these fields:

```yaml
rules:
  - id: trusted-auto-confirm
    match:
      workspace_trusted: true
      prompt_type: [yes_no]
      min_confidence: high
    action:
      type: auto_reply
      value: "yes"

  - id: readonly-escalate
    match:
      workspace_profile: read_only_analysis
    action:
      type: require_human
      message: "Read-only workspace — requires human approval"
```

This is deterministic: the same workspace state and policy always produce
the same decision.

---

## Advisory Workspace Scan

The scanner produces a read-only, deterministic classification of a
workspace based on its file listing.

```bash
atlasbridge workspace scan /path/to/project
```

### What it does

1. Scans the file listing (bounded to 5000 files)
2. Matches file patterns against risk tag rules
3. Produces risk tags: `iac`, `secrets_present`, `deployment`, `unknown`
4. Suggests a posture profile (advisory only)
5. Stores the result as an SoR artifact with `ruleset_version` + `inputs_hash`

### What it does NOT do

- Does NOT auto-change posture or trust based on scan results
- Does NOT read file contents
- Does NOT infer intent or ethics
- Results are advisory — the user must explicitly apply any suggestion

### Determinism

Same file listing + same ruleset version = same classification + same
`inputs_hash`. Re-running a scan with unchanged files does not create
duplicate artifacts.

### Risk tags

| Tag               | Trigger patterns                                    |
|-------------------|-----------------------------------------------------|
| `iac`             | Terraform, Ansible, Docker, Kubernetes, Helm, etc.  |
| `secrets_present` | `.env`, `.pem`, `.key`, credentials files           |
| `deployment`      | CI/CD configs, deploy scripts, Procfile             |
| `unknown`         | No recognized patterns found                        |

---

## Verification

### Check workspace status

```bash
# CLI
atlasbridge workspace status /path/to/project --json

# Dashboard
curl http://127.0.0.1:8787/api/workspaces
```

### Verify in audit traces

All trust grants, revocations, posture updates, and scans are recorded as
audit events:

- `workspace_trust_granted`
- `workspace_trust_revoked`
- `workspace_posture_updated`
- `workspace_scanned`

These are visible in the audit log:

```bash
atlasbridge autopilot explain --last 20
```

### Dashboard

The Workspaces page at `http://127.0.0.1:8787/workspaces` shows:

- All workspaces with trust state, expiry, posture, and activity
- Detail view with session timeline links
- Export as JSON

---

## Data model

### workspace_trust table

| Column                  | Type    | Description                      |
|-------------------------|---------|----------------------------------|
| `id`                    | TEXT PK | Stable workspace ID              |
| `path`                  | TEXT    | Original path as provided        |
| `path_hash`             | TEXT UQ | SHA-256 of canonical path        |
| `trusted`               | INTEGER | 0 or 1                          |
| `trust_expires_at`      | TEXT    | ISO timestamp, nullable          |
| `actor`                 | TEXT    | Who granted (cli/dashboard)      |
| `channel`               | TEXT    | Channel type                     |
| `session_id`            | TEXT    | Session that triggered grant     |
| `granted_at`            | TEXT    | When trust was granted           |
| `revoked_at`            | TEXT    | When trust was revoked           |
| `profile_name`          | TEXT    | Posture profile name             |
| `autonomy_default`      | TEXT    | OFF/ASSIST/FULL                  |
| `model_tier`            | TEXT    | Model tier placeholder           |
| `tool_allowlist_profile`| TEXT    | Tool allowlist reference         |
| `posture_notes`         | TEXT    | Optional notes                   |
| `created_at`            | TEXT    | Record creation time             |
| `updated_at`            | TEXT    | Last update time                 |

### workspace_scan_artifacts table

| Column             | Type    | Description                        |
|--------------------|---------|------------------------------------|
| `id`               | TEXT PK | Artifact ID                        |
| `workspace_id`     | TEXT    | FK to workspace                    |
| `ruleset_version`  | TEXT    | Scanner ruleset version            |
| `inputs_hash`      | TEXT    | Hash of file listing + ruleset     |
| `risk_tags`        | TEXT    | JSON array of risk tags            |
| `file_count`       | INTEGER | Number of files scanned            |
| `suggested_profile`| TEXT    | Advisory profile suggestion        |
| `raw_results`      | TEXT    | Full scan results JSON             |
| `created_at`       | TEXT    | When scan was performed            |
