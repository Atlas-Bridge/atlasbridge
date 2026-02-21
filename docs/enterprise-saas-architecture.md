# Phase C — Enterprise SaaS Architecture

**Maturity: Design Document — No Implementation**

> **Disclaimer:** Phase C — Design Only. Not implemented. Execution stays local.
> This document describes the target-state SaaS architecture for AtlasBridge Enterprise.
> No cloud components exist today. The local runtime is the only execution environment.
> All cloud functionality described here is planned design, not shipped software.

---

## Table of Contents

- [Overview](#overview)
- [Multi-Tenant Architecture](#multi-tenant-architecture)
- [Trust Boundaries](#trust-boundaries)
- [Local Runtime Agent to Cloud Handshake Protocol](#local-runtime-agent-to-cloud-handshake-protocol)
- [Policy Signing Strategy](#policy-signing-strategy)
- [Runtime Agent Authentication Model](#runtime-agent-authentication-model)
- [Data Isolation Model](#data-isolation-model)
- [Failure Fallback Model](#failure-fallback-model)
- [Offline Behavior Guarantees](#offline-behavior-guarantees)
- [Tenant-Level Audit Segregation](#tenant-level-audit-segregation)
- [Web Dashboard Architecture](#web-dashboard-architecture)
- [End-State Dataflow Diagram](#end-state-dataflow-diagram)
- [Open Questions](#open-questions)

---

## Overview

AtlasBridge Enterprise extends the open-source local runtime with optional cloud governance capabilities. The fundamental design principle is:

**Execution stays local. The cloud observes and advises. It never executes.**

The cloud tier provides centralized policy management, audit aggregation, risk dashboards, and team-wide session visibility. It does not gain PTY access, shell execution authority, or any path to inject commands into a local runtime.

---

## Multi-Tenant Architecture

Every enterprise deployment is scoped to an `org_id`. This is the root isolation boundary for all cloud-side data.

### Tenant Identity

| Field | Type | Description |
|-------|------|-------------|
| `org_id` | UUID v4 | Immutable tenant identifier, assigned at provisioning |
| `org_slug` | string | Human-readable org name (unique, URL-safe) |
| `plan` | enum | `free`, `team`, `enterprise` |
| `created_at` | timestamp | Provisioning timestamp (UTC) |

### Isolation via org_id

- Every database table in the cloud tier includes an `org_id` column.
- Every API request is scoped to the authenticated org_id extracted from the bearer token.
- No API endpoint permits cross-org_id queries. There is no superuser query path that returns data across tenants in the application layer.
- Database-level row security policies (PostgreSQL RLS) enforce org_id filtering as a second layer, independent of application logic.
- Background jobs (aggregation, retention) are partitioned by org_id.

### Tenant Provisioning

1. Organization created via admin API or self-service signup.
2. `org_id` generated and stored.
3. Dedicated audit partition created in PostgreSQL.
4. API keys issued, scoped to org_id.
5. First runtime agent registered via handshake protocol.

---

## Trust Boundaries

Two trust domains interact in Phase C:

| Domain | Trust Level | Authority |
|--------|-------------|-----------|
| Local Runtime | **Trusted execution** | Full PTY access, shell execution, policy evaluation, prompt detection, reply injection |
| Cloud Tier | **Trusted observation only** | Receives metadata copies, stores audit, serves dashboard, distributes signed policies |

The cloud tier has no execution authority. It cannot:
- Send commands to the local runtime for execution.
- Modify the local policy cache without a valid Ed25519 signature.
- Access the local PTY, filesystem, or shell environment.
- Override a local policy decision.
- Inject prompts or replies into the runtime.

The local runtime is the sole execution environment. The cloud is an optional, degradable extension.

---

## Local Runtime Agent to Cloud Handshake Protocol

### Overview

When a local runtime agent connects to the cloud tier, a mutual authentication handshake establishes identity and trust.

### Handshake Sequence

```
Runtime Agent                         Cloud Governance API
     |                                        |
     |  1. WSS connect (TLS 1.3)              |
     |--------------------------------------->|
     |                                        |
     |  2. Challenge (32-byte random nonce)   |
     |<---------------------------------------|
     |                                        |
     |  3. ChallengeResponse {                |
     |       runtime_id: <public key>,        |
     |       org_id: <org UUID>,              |
     |       nonce_signature: Ed25519(nonce), |
     |       agent_version: "0.8.1",          |
     |       timestamp: <ISO 8601 UTC>        |
     |     }                                  |
     |--------------------------------------->|
     |                                        |
     |  4. Cloud verifies:                    |
     |     - runtime_id registered to org_id  |
     |     - nonce_signature valid            |
     |     - timestamp within 30s skew        |
     |                                        |
     |  5. HandshakeAck {                     |
     |       session_token: <JWT, 1hr TTL>,   |
     |       cloud_signature: Ed25519(ack),   |
     |       policy_version: <hash>           |
     |     }                                  |
     |<---------------------------------------|
     |                                        |
     |  6. Runtime verifies:                  |
     |     - cloud_signature against pinned   |
     |       cloud public key                 |
     |     - session_token claims match       |
     |                                        |
     |  === Secure channel established ===    |
```

### Transport Security

- All cloud communication uses TLS 1.3 (minimum). TLS 1.2 is not accepted.
- WebSocket Secure (WSS) is the only permitted transport for the control channel.
- Certificate pinning is recommended for enterprise deployments.

### Message Signing

- Every control message from cloud to runtime is signed with Ed25519.
- The runtime holds a pinned copy of the cloud's public key (distributed at provisioning).
- Messages with invalid or missing signatures are dropped silently and logged locally.

---

## Policy Signing Strategy

### Signing Authority

The cloud tier is the signing authority for enterprise policies. Policies are signed server-side using the cloud's Ed25519 private key.

### Signing Flow

```
Policy Author (Dashboard)
      |
      v
Cloud API validates YAML schema
      |
      v
Cloud signs policy bundle:
  Ed25519(SHA-256(canonical_yaml) || org_id || version || timestamp)
      |
      v
Signed policy distributed to runtime agents
      |
      v
Runtime verifies signature against pinned cloud public key
      |
      v
If valid: replace local policy cache
If invalid: reject, log warning, continue with previous policy
```

### Key Management

| Key | Location | Purpose |
|-----|----------|---------|
| Cloud signing private key | Cloud HSM / secrets vault | Signs policies and control messages |
| Cloud signing public key | Pinned in runtime config | Verifies policy signatures and control messages |
| Runtime private key | Local keyring only | Signs handshake responses and audit submissions |
| Runtime public key | Registered in cloud | Identifies runtime agent; verifies audit provenance |

### Signature Envelope

```json
{
  "policy_hash": "sha256:<hex>",
  "org_id": "uuid",
  "version": 42,
  "timestamp": "2026-01-15T10:30:00Z",
  "signature": "ed25519:<base64>"
}
```

### Rejection Behavior

If the runtime receives a policy with an invalid signature:
1. The policy is rejected entirely.
2. The previous valid policy remains active.
3. A local audit event is written: `policy_signature_rejected`.
4. The cloud is notified (if reachable) that the policy was rejected.
5. No partial policy application occurs. Policies are atomic.

---

## Runtime Agent Authentication Model

### Identity Model

Each runtime agent generates a local Ed25519 keypair on first registration. The public key becomes the runtime's identity.

| Property | Value |
|----------|-------|
| Algorithm | Ed25519 |
| Key generation | Local, on first `atlasbridge register` |
| Private key storage | OS keyring (macOS Keychain, Linux secret-tool, Windows Credential Manager) |
| Public key registration | Sent to cloud during initial handshake; stored in cloud DB bound to org_id |
| Key rotation | Manual via `atlasbridge rotate-key`; old key revoked in cloud |

### Runtime Identity Record (Cloud-Side)

```json
{
  "runtime_id": "ed25519:<public_key_base64>",
  "org_id": "uuid",
  "hostname": "dev-macbook.local",
  "registered_at": "2026-01-10T08:00:00Z",
  "last_seen": "2026-01-15T14:22:00Z",
  "status": "active",
  "agent_version": "0.8.1"
}
```

### Authentication per Request

- Control channel: authenticated via handshake (see above); session token used for subsequent messages.
- REST API uploads (audit, traces): bearer token (JWT) issued during handshake, scoped to org_id + runtime_id, 1-hour TTL with refresh.

---

## Data Isolation Model

### Principle

Tenant data is scoped to `org_id` at every layer. No API, query, or background job crosses tenant boundaries.

### Storage Isolation

| Layer | Isolation Mechanism |
|-------|---------------------|
| PostgreSQL | Row-level security (RLS) on org_id; application-layer filtering as primary; RLS as defense-in-depth |
| Redis | Key prefix: `org:{org_id}:*`; no shared keyspaces |
| Object storage (audit archives) | Bucket prefix: `org/{org_id}/`; IAM policy restricts cross-prefix access |
| Search index (if applicable) | Index-per-tenant or filtered alias scoped to org_id |

### Data Categories

| Category | Stored in Cloud | Contains Secrets | Retention |
|----------|----------------|-----------------|-----------|
| Decision traces | Yes (metadata only) | No | Configurable per org (default 90 days) |
| Audit events | Yes (hash-chained) | No | Configurable per org (default 1 year) |
| Session metadata | Yes | No | Configurable per org (default 90 days) |
| Policy YAML | Yes (signed) | No | All versions retained |
| PTY output | **No** — never leaves local runtime | May contain secrets | Local only |
| Prompt text | Forwarded to channel (Telegram/Slack) | May contain context | Not stored in cloud |
| Private keys | **No** — local keyring only | Yes | Local only |

### Non-Negotiable

- PTY output never leaves the local runtime.
- Private keys never leave the local machine.
- No secrets appear in audit events or decision traces.

---

## Failure Fallback Model

### Principle

Cloud unreachable does not degrade local runtime functionality. The runtime is self-sufficient.

### Fallback Behavior Matrix

| Cloud State | Policy Evaluation | Prompt Detection | Reply Injection | Audit Logging | Dashboard |
|-------------|-------------------|------------------|-----------------|---------------|-----------|
| Connected | Local (signed policy from cloud) | Local | Local | Local + cloud sync | Live |
| Disconnected | Local (cached policy) | Local | Local | Local only (queued for sync) | Stale |
| Never connected | Local (local policy file) | Local | Local | Local only | Unavailable |

### Reconnection Behavior

1. Runtime detects cloud disconnect (WebSocket close or ping timeout).
2. Runtime continues operating with cached policy.
3. Runtime queues audit events and decision traces locally.
4. Runtime attempts reconnection with exponential backoff (1s, 2s, 4s, ... max 300s).
5. On reconnection: re-handshake, sync queued audit/traces, check for policy updates.
6. No data loss occurs during disconnection. Local SQLite is the source of truth.

### Degradation Summary

| Feature | Online | Offline |
|---------|--------|---------|
| Policy evaluation | Full | Full (cached policy) |
| Prompt detection | Full | Full |
| Telegram/Slack relay | Full | Full (independent of cloud) |
| Audit logging | Local + cloud | Local only |
| Dashboard visibility | Real-time | Stale until reconnect |
| Policy distribution | Push from cloud | Manual local file |
| Risk scoring | Cloud-computed | Unavailable |

---

## Offline Behavior Guarantees

These guarantees are absolute and non-negotiable:

1. **The local runtime never blocks on cloud availability.** All execution paths that touch the cloud are asynchronous and timeout-protected.
2. **Policy evaluation is always local.** Even cloud-distributed policies are cached locally and evaluated locally. The cloud never evaluates a policy on behalf of the runtime.
3. **Audit events are never lost.** If the cloud is unreachable, events queue locally in SQLite and sync on reconnection.
4. **The channel relay (Telegram/Slack) operates independently of the cloud tier.** Cloud downtime does not affect human escalation.
5. **No cloud feature, when unavailable, causes the runtime to enter an error state, pause, or degrade its core functionality.**

---

## Tenant-Level Audit Segregation

### Audit Storage Model

Each `org_id` has logically isolated audit storage. Audit events from one tenant are never visible to, or queryable by, another tenant.

### Implementation

| Component | Isolation Mechanism |
|-----------|---------------------|
| PostgreSQL audit table | Partitioned by org_id; RLS enforced |
| Audit hash chain | Per-org_id chain; each org has its own chain root |
| Audit archive (cold storage) | Per-org_id object storage prefix |
| Audit API | All queries filtered by org_id from JWT claims |

### Audit Event Schema (Cloud)

```json
{
  "event_id": "uuid",
  "org_id": "uuid",
  "runtime_id": "ed25519:<pubkey>",
  "timestamp": "2026-01-15T14:22:00.123Z",
  "event_type": "prompt_detected | policy_evaluated | reply_injected | escalated | ...",
  "session_id": "uuid",
  "prompt_nonce": "uuid",
  "decision": "auto_approve | escalate | deny | ...",
  "policy_rule_id": "string | null",
  "confidence": "high | medium | low",
  "chain_hash": "sha256:<hex>",
  "previous_hash": "sha256:<hex>"
}
```

### Audit Integrity

- The hash chain is maintained per-org_id. Each event includes `chain_hash` = SHA-256(previous_hash + event_id + timestamp + event_type + decision).
- The cloud verifies chain integrity on ingestion.
- Gaps in the chain (from offline periods) are flagged but accepted; the runtime provides the missing links on reconnection.
- Audit events are append-only. No mutation or deletion via API. Retention policies archive to cold storage; they do not delete.

---

## Web Dashboard Architecture

### Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | React SPA (TypeScript) | Dashboard UI |
| State management | React Query + Context | Server state caching, UI state |
| API layer | REST (JSON) over HTTPS | CRUD + queries |
| Real-time | WebSocket (WSS) | Live session updates, status changes |
| Backend API | Python (FastAPI) or Node.js | REST endpoints, WebSocket server, auth |
| Database | PostgreSQL 15+ | Persistent storage, RLS |
| Cache | Redis | Session cache, rate limiting, pub/sub for WebSocket fan-out |
| Auth | OAuth 2.0 / OIDC + JWT | User authentication, org_id scoping |

### Screens

#### 1. Login

- OAuth 2.0 / OIDC login (SSO for enterprise; email/password for team plan).
- Org selection if user belongs to multiple orgs.
- MFA support (TOTP).

#### 2. Dashboard Overview

- Summary cards: active runtimes, active sessions, prompts today, escalation rate.
- Trend charts: prompts over time, auto-approve vs. escalate ratio, risk score trend.
- Recent activity feed (last 20 events across all runtimes).

#### 3. Sessions List

- Table of all sessions across all runtime agents in the org.
- Columns: session_id, runtime hostname, adapter, started_at, status, prompt count, escalation count.
- Filters: date range, runtime, adapter, status.
- Click to drill into session detail.

#### 4. Session Detail

- Session metadata (runtime, adapter, started, duration).
- Timeline of prompt events with decisions.
- Each event shows: prompt type, confidence, policy rule matched, decision, latency.
- Escalation events show channel, response time, human reply.
- No PTY output displayed (PTY output never leaves the local runtime).

#### 5. Policy Editor

- YAML editor with syntax highlighting and inline validation.
- Policy version history with diff view.
- "Sign and Distribute" action (signs with cloud key, pushes to connected runtimes).
- Policy test simulator (enter a mock prompt, see which rule matches).
- Per-rule hit count statistics from decision traces.

#### 6. Audit Trail

- Searchable, filterable audit event log.
- Filters: date range, runtime, event type, decision, session.
- Hash chain integrity indicator per event.
- Export to CSV/JSON.
- Gap detection (offline periods flagged visually).

#### 7. Risk Overview

- Aggregated risk metrics per runtime and per session.
- Metrics: escalation rate, low-confidence prompt rate, policy miss rate, average response time.
- Trend analysis over configurable time windows.
- Alerting configuration (email, Slack, PagerDuty) for risk threshold breaches.

#### 8. Settings

- Org profile management.
- Runtime agent registry (list, revoke, rotate keys).
- User management (invite, roles: admin, viewer).
- Policy retention and audit retention configuration.
- API key management.
- Notification preferences.

### API Endpoints

#### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/sessions` | List sessions (paginated, filterable) |
| GET | `/api/v1/sessions/{session_id}` | Session detail with event timeline |
| GET | `/api/v1/sessions/{session_id}/events` | Paginated events for a session |

#### Policies

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/policies` | List policy versions |
| GET | `/api/v1/policies/{version}` | Get specific policy version |
| POST | `/api/v1/policies` | Create new policy version (validates, signs) |
| POST | `/api/v1/policies/{version}/distribute` | Push signed policy to connected runtimes |
| POST | `/api/v1/policies/test` | Simulate a prompt against a policy |

#### Audit

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/audit` | Query audit events (paginated, filterable) |
| GET | `/api/v1/audit/integrity` | Hash chain integrity report |
| GET | `/api/v1/audit/export` | Export audit events (CSV/JSON) |

#### Risk

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/risk` | Current risk summary |
| GET | `/api/v1/risk/trends` | Risk metrics over time |
| GET | `/api/v1/risk/alerts` | Active risk alerts |
| PUT | `/api/v1/risk/alerts/config` | Configure alert thresholds |

#### Runtime Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/runtime` | List registered runtime agents |
| GET | `/api/v1/runtime/{id}/status` | Runtime agent status (last seen, version, session count) |
| DELETE | `/api/v1/runtime/{id}` | Revoke a runtime agent |
| POST | `/api/v1/runtime/{id}/rotate-key` | Initiate key rotation |

### Real-Time: WebSocket

The dashboard connects via WSS to receive live updates:

```
wss://api.atlasbridge.io/ws/v1/live?token=<JWT>
```

#### Event Types

| Event | Payload | Trigger |
|-------|---------|---------|
| `session.started` | session metadata | Runtime starts a new session |
| `session.ended` | session metadata + summary | Runtime session ends |
| `prompt.detected` | prompt event (no PTY content) | Prompt detected by runtime |
| `prompt.decided` | decision + rule matched | Policy evaluation complete |
| `prompt.escalated` | escalation metadata | Prompt forwarded to human |
| `prompt.resolved` | resolution metadata | Reply injected |
| `runtime.connected` | runtime metadata | Handshake complete |
| `runtime.disconnected` | runtime_id + last_seen | Connection lost |
| `policy.distributed` | policy version + target runtimes | Policy push initiated |

All WebSocket events are scoped to the authenticated org_id. No cross-tenant events are delivered.

---

## End-State Dataflow Diagram

```
Local Runtime Agent
      |
      | Decision traces, audit events, session metadata
      | (no PTY output, no secrets)
      |
      v
Secure Control Channel (WSS + Ed25519)
      |
      | Mutual TLS 1.3 transport
      | Every message signed with Ed25519
      | Advisory only — no execution authority
      |
      v
Cloud Governance API
      |
      | Stores metadata in PostgreSQL (org_id scoped)
      | Validates audit chain integrity
      | Computes risk metrics
      | Signs and distributes policies
      |
      v
Policy Evaluation + Decision Trace
      |
      | Policy evaluation always happens locally
      | Cloud stores copies of decision traces for dashboard
      | Cloud never evaluates on behalf of runtime
      |
      v
Web Dashboard (React SPA)
      |
      | Read-only view of cloud data
      | Policy editing triggers sign + distribute
      | No execution path to local runtime
      | WebSocket for live updates
```

---

## Open Questions

These are unresolved design questions for Phase C. They do not block Phase A or Phase B work.

1. **Multi-region deployment** — Should cloud tier be multi-region? If so, how is audit chain integrity maintained across regions?
2. **Tenant data export** — What format for full tenant data export (GDPR compliance)?
3. **Runtime agent groups** — Should runtimes be groupable (e.g., "production" vs. "development") for policy targeting?
4. **Policy approval workflow** — Should policy changes require approval from a second admin before signing?
5. **Audit cold storage** — S3-compatible object storage vs. PostgreSQL partitioning for long-term audit retention?

---

> **Reminder:** Phase C — Design Only. Not implemented. Execution stays local.
> The local runtime is fully functional without any cloud component.
> Cloud features are additive and degradable. They never become required.
