# Enterprise Trust Boundaries

**Maturity: Design Document — No Implementation**

This document defines the trust domains in the AtlasBridge architecture and the rules governing interactions between them. Every component operates within a defined trust domain. Cross-domain interactions are explicit and constrained.

---

## Table of Contents

- [Trust Domain Overview](#trust-domain-overview)
- [Domain 1: Local Runtime](#domain-1-local-runtime)
- [Domain 2: Policy Engine](#domain-2-policy-engine)
- [Domain 3: Channel Relay](#domain-3-channel-relay)
- [Domain 4: Secure Control Channel](#domain-4-secure-control-channel)
- [Domain 5: Cloud Extension](#domain-5-cloud-extension)
- [Domain 6: Web Dashboard](#domain-6-web-dashboard)
- [Cross-Domain Interaction Rules](#cross-domain-interaction-rules)
- [Secret Handling Rules](#secret-handling-rules)
- [Transport Security Assumptions](#transport-security-assumptions)
- [Global Non-Negotiable Invariants](#global-non-negotiable-invariants)

---

## Trust Domain Overview

```
+-----------------------------------------------------------------------+
|  Domain 1: LOCAL RUNTIME (Full Trust)                                 |
|  Executes AI CLI tools. Has PTY access. Source of truth.              |
|                                                                       |
|  +----------------------------+  +------------------------------+     |
|  | Domain 2: POLICY ENGINE   |  | Domain 3: CHANNEL RELAY      |     |
|  | Deterministic. No network.|  | Telegram/Slack. Allowlisted  |     |
|  | Evaluates rules locally.  |  | identities. No execution.    |     |
|  +----------------------------+  +------------------------------+     |
+-----------------------------------------------------------------------+
        |                                    |
        | Decision traces, audit events      | Prompt forwarding,
        | (metadata only, no PTY output)     | human replies
        |                                    |
+-----------------------------------------------------------------------+
|  Domain 4: SECURE CONTROL CHANNEL (Advisory Only)                     |
|  WSS + Ed25519 signed messages. No execution authority.               |
+-----------------------------------------------------------------------+
        |
        | Signed metadata, policy updates
        |
+-----------------------------------------------------------------------+
|  Domain 5: CLOUD EXTENSION (Observation Only)                         |
|  Receives copies of metadata. Does not execute. Cannot reach runtime. |
|                                                                       |
|  +------------------------------+                                     |
|  | Domain 6: WEB DASHBOARD     |                                     |
|  | Read-only view. No execution|                                     |
|  | path to runtime.            |                                     |
|  +------------------------------+                                     |
+-----------------------------------------------------------------------+
```

---

## Domain 1: Local Runtime

**Trust level: Full trust**

The local runtime is the sole execution environment in AtlasBridge. It is the only domain with the authority to execute commands, access the PTY, read/write the filesystem, and interact with AI CLI tools.

### Capabilities

| Capability | Authorized |
|------------|-----------|
| PTY access (read/write) | Yes |
| Shell command execution | Yes |
| Filesystem access | Yes |
| Prompt detection | Yes |
| Reply injection into PTY | Yes |
| Policy evaluation (delegates to Domain 2) | Yes |
| Audit event generation | Yes |
| Decision trace generation | Yes |
| Cloud communication (delegates to Domain 4) | Yes |

### Boundaries

- The local runtime does not expose any network listener. It is a client, not a server.
- The local runtime initiates all outbound connections (to Telegram, Slack, cloud). It never accepts inbound connections.
- All data that leaves the local runtime is explicitly selected: decision traces and audit events (metadata only). PTY output and filesystem contents never leave.

### Components in This Domain

- `DaemonManager`
- `ClaudeCodeAdapter` (and other adapters)
- `MacOSTTY` / `LinuxTTY`
- `PromptDetector`
- `PromptRouter`
- `SessionManager`
- `AuditWriter`
- `SQLite store`

---

## Domain 2: Policy Engine

**Trust level: Deterministic, sandboxed**

The policy engine evaluates rules against prompt events. It is a pure function: given a policy and a prompt event, it returns a decision. It has no network access, no filesystem access (beyond reading the policy file at load time), and no side effects.

### Capabilities

| Capability | Authorized |
|------------|-----------|
| Read policy rules (in memory) | Yes |
| Evaluate prompt against rules | Yes |
| Return PolicyDecision | Yes |
| Network access | No |
| Filesystem access (runtime) | No |
| PTY access | No |
| Modify state | No |

### Boundaries

- The policy engine receives a `PromptEvent` and a loaded `Policy` object. It returns a `PolicyDecision`.
- It does not read the policy file at evaluation time. The policy is loaded once and passed in.
- It does not make network calls. If a rule references external state (e.g., time-of-day), that state is computed by the caller and passed in via the prompt event context.
- Regex evaluation has a safety timeout (configurable, default 100ms per pattern) to prevent ReDoS.

### Components in This Domain

- `PolicyEvaluator` (`evaluate()`)
- `PolicyRule` / `MatchCriteria` (in-memory models)

### Why This Is a Separate Domain

The policy engine is isolated to preserve a critical property: **policy evaluation is deterministic and side-effect-free.** This means:
- The same input always produces the same output.
- Policy evaluation cannot be influenced by network conditions, filesystem state, or other external factors.
- Policy evaluation can be tested exhaustively in unit tests without mocking.

---

## Domain 3: Channel Relay

**Trust level: Constrained; allowlisted identities; no execution authority**

The channel relay forwards prompts to human operators via Telegram or Slack and returns their replies. It has network access (to Telegram/Slack APIs) but no execution authority. It cannot execute commands, access the PTY, or modify policy.

### Capabilities

| Capability | Authorized |
|------------|-----------|
| Send messages to Telegram/Slack | Yes |
| Receive messages from Telegram/Slack | Yes |
| Validate sender identity (allowlist) | Yes |
| Forward prompt text to human | Yes |
| Return human reply to router | Yes |
| Execute commands | No |
| Access PTY | No |
| Modify policy | No |
| Access filesystem | No |

### Boundaries

- Messages from unrecognized senders (not in the allowlist) are silently ignored and logged.
- The channel relay only accepts replies that match a pending prompt (nonce + session_id binding).
- The channel relay does not interpret reply content. It passes the raw reply to the router, which passes it to the adapter for injection.
- The channel relay operates independently of the cloud tier. Cloud availability has no effect on Telegram/Slack relay.

### Identity Allowlisting

| Channel | Identity Mechanism |
|---------|-------------------|
| Telegram | `chat_id` allowlist in config |
| Slack | Workspace ID + user ID allowlist in config |

Only messages from allowlisted identities are processed. All others are dropped.

### Components in This Domain

- `TelegramChannel`
- `SlackChannel`
- `MultiChannel` (fan-out)
- `BaseChannel` ABC

---

## Domain 4: Secure Control Channel

**Trust level: Advisory only; authenticated; signed**

The secure control channel is the communication link between the local runtime and the cloud tier. It uses WebSocket Secure (WSS) with Ed25519 message signing. It carries metadata and policy updates. It has no execution authority.

### Capabilities

| Capability | Authorized |
|------------|-----------|
| Transport signed messages | Yes |
| Deliver policy updates (signed by cloud) | Yes |
| Receive decision traces from runtime | Yes |
| Receive audit events from runtime | Yes |
| Send heartbeats | Yes |
| Execute commands on runtime | **No** |
| Access runtime PTY | **No** |
| Access runtime filesystem | **No** |
| Override local policy decisions | **No** |

### Boundaries

- Every message crossing this channel is signed with Ed25519. Unsigned or incorrectly signed messages are dropped.
- The channel is advisory. Messages from the cloud are informational (policy updates, configuration changes). The runtime decides whether to accept them based on signature verification and local policy.
- The runtime can reject any message from the cloud without consequence. Rejection is logged locally.
- If the control channel disconnects, the runtime continues operating with its cached local state.

### Message Integrity

| Direction | Signing Key | Verification Key |
|-----------|-------------|-----------------|
| Runtime to Cloud | Runtime private key | Runtime public key (registered in cloud) |
| Cloud to Runtime | Cloud private key | Cloud public key (pinned in runtime config) |

### Components in This Domain

- `CloudClient` (Phase B: ABC; Phase C: `AtlasBridgeCloudClient`)
- `ControlMessage` protocol
- WebSocket transport layer

---

## Domain 5: Cloud Extension

**Trust level: Observation only**

The cloud extension tier stores copies of metadata submitted by local runtimes. It computes analytics, manages policy versions, and serves the web dashboard. It does not execute commands, access runtimes directly, or hold any runtime secrets.

### The Core Principle

**Cloud observes, does not execute.**

This is the foundational trust boundary between the local runtime and the cloud tier. The cloud:
- Receives copies of decision traces (metadata).
- Receives copies of audit events (metadata).
- Stores and signs policy YAML.
- Computes risk metrics and analytics.
- Serves the web dashboard.

The cloud does not:
- Execute commands on any runtime.
- Access any runtime's PTY, filesystem, or shell.
- Hold runtime private keys.
- Override local policy decisions.
- Inject prompts or replies.
- Have any network path to reach a runtime's local services.

### Capabilities

| Capability | Authorized |
|------------|-----------|
| Store decision traces (metadata) | Yes |
| Store audit events (metadata) | Yes |
| Compute risk metrics | Yes |
| Sign policy YAML | Yes |
| Distribute signed policies via control channel | Yes |
| Serve dashboard API | Yes |
| Execute commands on runtime | **No** |
| Access runtime PTY | **No** |
| Hold runtime private keys | **No** |
| Override local decisions | **No** |

### Data the Cloud Receives

| Data | Included | Excluded |
|------|----------|----------|
| Decision trace entries | Prompt type, confidence, matched rule, decision, latency | Prompt text content, PTY output |
| Audit events | Event type, timestamp, session ID, decision, chain hash | PTY output, filesystem content |
| Session metadata | Session ID, adapter, start time, prompt count | No raw output |
| Runtime status | Version, hostname, last seen | No filesystem access, no PTY |
| Policy YAML | Full policy text | No runtime secrets |

### Data the Cloud Never Receives

- PTY output (terminal content).
- Filesystem content from the runtime host.
- Runtime private keys.
- Environment variables.
- Credentials or tokens (Telegram bot tokens, Slack tokens, etc.).
- Raw prompt text forwarded to channels.

### Components in This Domain

- Cloud Governance API (FastAPI / Node.js)
- PostgreSQL (org_id-scoped)
- Redis (caching, pub/sub)
- Policy signing service

---

## Domain 6: Web Dashboard

**Trust level: Read-only view; no execution path to runtime**

The web dashboard is a React SPA that consumes the cloud API. It displays data. It does not execute commands, and it has no communication path to any local runtime.

### Capabilities

| Capability | Authorized |
|------------|-----------|
| Display session data | Yes |
| Display audit trail | Yes |
| Display risk metrics | Yes |
| Edit policy YAML (triggers sign + distribute via cloud API) | Yes |
| View runtime status | Yes |
| Execute commands on runtime | **No** |
| Direct communication with runtime | **No** |
| Access runtime PTY | **No** |

### Boundaries

- The dashboard communicates only with the cloud API. It has no direct network path to any local runtime.
- Policy editing in the dashboard triggers the cloud to sign and distribute the policy via the control channel. The dashboard does not send the policy to the runtime.
- The dashboard authenticates users via OAuth 2.0 / OIDC. User permissions are scoped to their org_id.
- Dashboard users cannot see data from other orgs. All API responses are filtered by the authenticated org_id.

### Components in This Domain

- React SPA (TypeScript)
- Browser-side state (React Query)
- OAuth 2.0 / OIDC client

---

## Cross-Domain Interaction Rules

### Permitted Interactions

| From | To | Interaction | Data |
|------|----|-------------|------|
| Domain 1 (Runtime) | Domain 2 (Policy Engine) | Function call | PromptEvent in, PolicyDecision out |
| Domain 1 (Runtime) | Domain 3 (Channel Relay) | Async message | Prompt text to human, reply from human |
| Domain 1 (Runtime) | Domain 4 (Control Channel) | WSS outbound | Decision traces, audit events, heartbeats |
| Domain 4 (Control Channel) | Domain 1 (Runtime) | WSS inbound | Signed policy updates, configuration advisories |
| Domain 4 (Control Channel) | Domain 5 (Cloud) | Internal | Metadata storage, analytics |
| Domain 5 (Cloud) | Domain 6 (Dashboard) | REST API + WSS | Session data, audit, risk, policy |
| Domain 6 (Dashboard) | Domain 5 (Cloud) | REST API | Policy edits, configuration changes |

### Prohibited Interactions

| From | To | Why Prohibited |
|------|----|----------------|
| Domain 5 (Cloud) | Domain 1 (Runtime) | Cloud cannot execute on runtime. Advisory messages flow through Domain 4 only. |
| Domain 6 (Dashboard) | Domain 1 (Runtime) | Dashboard has no network path to runtime. |
| Domain 3 (Channel Relay) | Domain 2 (Policy Engine) | Channel relay does not evaluate policy. |
| Domain 5 (Cloud) | Domain 3 (Channel Relay) | Cloud does not relay messages to humans. That is the runtime's job. |
| Any external domain | Domain 2 (Policy Engine) | Policy engine is only invoked by the local runtime. |

---

## Secret Handling Rules

### Rule 1: Tokens Live in the OS Keyring

All authentication tokens (Telegram bot token, Slack bot token, API keys) are stored in the OS keyring:

| Platform | Keyring Backend |
|----------|----------------|
| macOS | Keychain |
| Linux | secret-tool (freedesktop.org Secret Service) |
| Windows | Windows Credential Manager |

Tokens are read from the keyring at startup and held in memory. They are never written to configuration files, environment variable dumps, log files, or audit events.

### Rule 2: Private Keys Are Local-Only

Runtime Ed25519 private keys are generated locally and stored in the OS keyring. They never leave the local machine. Specifically:

- Private keys are not included in decision traces.
- Private keys are not included in audit events.
- Private keys are not transmitted to the cloud tier.
- Private keys are not logged.
- Private keys are not included in error reports or crash dumps.

The corresponding public key is registered with the cloud tier as the runtime's identity. Only the public key leaves the machine.

### Rule 3: No Secrets in Audit Events

Audit events and decision traces are designed to be safely stored in the cloud tier. They must never contain:

- Authentication tokens (Telegram, Slack, API keys).
- Private keys.
- Environment variable values.
- Filesystem paths containing sensitive data.
- PTY output (which may contain credentials, API responses, etc.).
- Raw prompt text that may have been forwarded to a channel.

If a field might contain sensitive data, it is excluded from the audit event schema. This is enforced by the schema definition: only explicitly listed fields are serialized.

### Rule 4: Credential Rotation

| Secret | Rotation Mechanism | Impact of Rotation |
|--------|-------------------|-------------------|
| Telegram bot token | Regenerate via BotFather; update keyring | Brief channel downtime during update |
| Slack bot token | Regenerate in Slack admin; update keyring | Brief channel downtime during update |
| Runtime Ed25519 keypair | `atlasbridge rotate-key`; old key revoked in cloud | Requires re-handshake with cloud |
| Cloud API JWT | Auto-refreshed (1hr TTL) | Transparent; no manual action |

---

## Transport Security Assumptions

### TLS 1.3 for All Cloud Communications

All communication between the local runtime and the cloud tier uses TLS 1.3 as the minimum version. TLS 1.2 and below are not accepted.

| Connection | Transport | Minimum TLS |
|------------|-----------|-------------|
| Runtime to Cloud API (REST) | HTTPS | TLS 1.3 |
| Runtime to Cloud (WebSocket) | WSS | TLS 1.3 |
| Dashboard to Cloud API | HTTPS | TLS 1.3 |
| Dashboard WebSocket | WSS | TLS 1.3 |

### Ed25519 for Message Signing

All control channel messages are signed with Ed25519. This provides:

- **Authentication:** The recipient verifies the sender's identity via their known public key.
- **Integrity:** Any modification to the message invalidates the signature.
- **Non-repudiation:** The sender cannot deny having sent a signed message.

Ed25519 is used for signing, not encryption. Encryption is provided by the TLS transport layer. Signing provides an additional guarantee that the message originated from the claimed sender, independent of the transport.

### Certificate Pinning (Enterprise Deployments)

Enterprise deployments may optionally pin the cloud tier's TLS certificate to prevent man-in-the-middle attacks via compromised certificate authorities. This is configured in the runtime's config file:

```yaml
cloud:
  api_url: "https://api.atlasbridge.io"
  certificate_pin: "sha256:<base64-encoded-hash>"
```

When a pin is configured, the runtime rejects connections to the cloud if the server certificate does not match the pin. This is an optional hardening measure, not a default requirement.

---

## Global Non-Negotiable Invariants

These invariants hold across all phases (A, B, C) and all trust domains. They are non-negotiable. Any proposed change that would violate these invariants is rejected.

### 1. Execution is local only

All command execution, PTY interaction, and filesystem access happen on the local machine running the AtlasBridge runtime. No remote system (cloud, dashboard, or any other external service) can execute commands on the runtime host.

### 2. Cloud observes, does not execute

The cloud tier receives copies of metadata (decision traces, audit events, session metadata). It does not execute commands, access the PTY, or interact with the runtime's local environment. The cloud is an observer and advisor, not an executor.

### 3. Policy evaluation is local and deterministic

Policy rules are evaluated by the local runtime's policy engine. The cloud may distribute policy files (signed), but evaluation always happens locally. The cloud never evaluates a policy on behalf of the runtime.

### 4. Offline runtime is fully functional

If the cloud tier is unreachable, the local runtime continues to operate with full functionality: prompt detection, policy evaluation, channel relay, audit logging, and reply injection all work without cloud connectivity. Cloud features degrade gracefully; local features never degrade.

### 5. No cross-tenant data access

In the cloud tier, every piece of data is scoped to an `org_id`. No API endpoint, database query, background job, or dashboard view crosses tenant boundaries. This is enforced at the application layer and reinforced by PostgreSQL row-level security.

### 6. Private keys never leave the local machine

Runtime Ed25519 private keys are generated locally, stored in the OS keyring, and never transmitted to any external system. Only the corresponding public key is shared (with the cloud, during registration).

### 7. No secrets in audit or traces

Audit events and decision traces are safe for cloud storage because they contain only structured metadata. They never contain authentication tokens, private keys, PTY output, raw environment variables, or other potentially sensitive data.

### 8. Default-safe on failure

When any component fails (cloud unreachable, policy signature invalid, channel down, unknown message type), the system defaults to the safe state: local operation continues, the failure is logged, and no unsafe action is taken. Failures never cause the runtime to execute unintended commands or bypass policy.

### 9. Append-only audit integrity

Audit events are append-only and hash-chained. No event, once written, can be modified or deleted via any API or runtime operation. Retention policies may archive old events to cold storage, but they do not delete them from the chain.

### 10. Frozen schemas are forever

Once a schema (DecisionTraceEntryV2, ControlMessage protocol) is shipped in a release, it is frozen. Fields cannot be removed, renamed, or have their types changed. Evolution is additive-only. This guarantees that older runtimes and newer cloud tiers (or vice versa) can always interoperate.

---

> **Reminder:** This document defines trust boundaries for the full AtlasBridge architecture across all planned phases.
> Domains 1-3 are implemented today (Phase A). Domains 4-6 are design-only (Phase B and Phase C).
> The invariants listed above apply to all phases, including Phase A.
