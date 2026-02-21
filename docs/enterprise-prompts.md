# Enterprise Evolution — Claude Code Implementation Prompts

Copy-paste ready prompts for each implementation stage of the AtlasBridge enterprise evolution.

Pipeline: **Local Runtime Agent -> Secure Control Channel -> Cloud Governance API -> Policy Evaluation + Decision Trace -> Web Dashboard**

---

## Prompt A1 — Implement Phase A enterprise local runtime scaffolding

```
Branch: feature/enterprise-phase-a-runtime

Create the enterprise local runtime scaffolding for AtlasBridge. This wires enterprise
modules into the core via feature flags and adds new CLI commands. No cloud dependencies.
Everything runs locally.

Scope:
- Create src/atlasbridge/enterprise/__init__.py with edition detection (read from
  pyproject.toml extras or env var ATLASBRIDGE_EDITION, default "community")
- Create src/atlasbridge/enterprise/features.py with a FeatureFlags dataclass that
  exposes boolean flags for every enterprise capability:
    - decision_trace_v2 (default: False)
    - risk_classification (default: False)
    - policy_pinning (default: False)
    - audit_hash_chain (default: False)
    - cloud_sync (default: False)
    - dashboard_api (default: False)
  Flags are resolved from edition + explicit overrides via ATLASBRIDGE_FEATURE_* env vars.
- Create src/atlasbridge/enterprise/edition.py with an Edition enum (COMMUNITY, PRO,
  ENTERPRISE) and a get_edition() function.
- Wire into CLI: add the following commands in src/atlasbridge/cli/_enterprise.py and
  register them in src/atlasbridge/cli/main.py:
    - `atlasbridge edition` — prints current edition name and version
    - `atlasbridge features` — lists all feature flags with enabled/disabled status
    - `atlasbridge policy diff <file1> <file2>` — structural diff of two policy YAML files
    - `atlasbridge policy hash <file>` — prints SHA-256 content hash of a policy file
    - `atlasbridge audit verify` — verifies hash chain integrity of audit log
    - `atlasbridge trace integrity-check` — verifies hash chain of decision trace entries
- All new modules must be importable without any enterprise dependencies installed.
  Guard optional imports with try/except.
- Do NOT modify any existing core/ modules. Enterprise code composes over core, never
  patches it.

Tests to add:
- tests/unit/test_edition.py — edition detection defaults to COMMUNITY; env var override
  works; invalid values fall back to COMMUNITY
- tests/unit/test_feature_flags.py — flags resolve correctly per edition; env var
  overrides work; unknown flags are ignored
- tests/unit/test_enterprise_cli.py — smoke tests for all 6 new CLI commands (verify they
  exist, return exit code 0, produce expected output patterns)

Docs to update:
- Add enterprise CLI commands to docs/cli-reference.md (create section "Enterprise
  Commands" at the bottom if the file exists; if not, note in PR description)

Acceptance criteria:
- `atlasbridge edition` prints "community" when no env var is set
- `atlasbridge features` lists all 6 feature flags with their status
- `atlasbridge policy diff` exits 0 with identical files, exits 1 with differences
- `atlasbridge policy hash` prints a deterministic SHA-256 hex digest
- `atlasbridge audit verify` and `atlasbridge trace integrity-check` exit 0 on valid data
- All new tests pass: pytest tests/unit/test_edition.py tests/unit/test_feature_flags.py tests/unit/test_enterprise_cli.py -v
- ruff check . && ruff format --check . && mypy src/atlasbridge/ all pass
- No changes to any file under src/atlasbridge/core/
```

---

## Prompt A2 — Decision trace v2 + hash chaining + migration

```
Branch: feature/enterprise-trace-v2

Integrate DecisionTraceEntryV2 into the AutopilotEngine and add migration from v1 to v2
format. Hash chain all new entries for tamper evidence.

Scope:
- Create src/atlasbridge/enterprise/trace_v2.py with:
    - DecisionTraceEntryV2 Pydantic model (extends v1 with: entry_id UUID, prev_hash,
      entry_hash, risk_level, policy_version, session_tags list, evaluation_duration_ms,
      schema_version="2.0")
    - hash_entry() function: SHA-256 over canonical JSON of (entry_id, timestamp,
      prompt_text, decision, risk_level, prev_hash)
    - verify_chain() function: given a list of v2 entries, verify every entry_hash matches
      recomputed hash and prev_hash links are consistent
- Create src/atlasbridge/enterprise/trace_migration.py with:
    - migrate_v1_to_v2() function: reads a v1 JSONL trace file, converts each entry to v2
      format (fills in defaults for new fields: risk_level="unknown",
      policy_version="legacy", session_tags=[], evaluation_duration_ms=0), builds hash
      chain, writes v2 JSONL file
    - detect_trace_version() function: reads first line of JSONL, returns "v1" or "v2"
      based on presence of schema_version field
- Modify src/atlasbridge/core/autopilot/engine.py:
    - Import DecisionTraceEntryV2 conditionally (only if enterprise.features flag
      decision_trace_v2 is enabled)
    - When flag is enabled, produce v2 entries instead of v1
    - When flag is disabled, behavior is identical to current (v1 entries)
- Modify src/atlasbridge/core/autopilot/trace.py:
    - Add a write_v2() method that appends a v2 entry and maintains the hash chain
      (stores prev_hash in memory for the session)
    - Existing write() method remains unchanged for v1 compatibility
- Add CLI command: `atlasbridge trace migrate <input.jsonl> <output.jsonl>` in
  src/atlasbridge/cli/_enterprise.py
- Add CLI command: `atlasbridge trace integrity-check <file.jsonl>` — verifies hash chain
  of a v2 trace file (update from A1 stub to real implementation)

Tests to add:
- tests/unit/test_trace_v2.py:
    - hash_entry produces deterministic output for identical inputs
    - verify_chain returns True for a valid chain of 10 entries
    - verify_chain returns False when one entry is tampered (modified decision)
    - verify_chain returns False when entry order is swapped
    - v2 entry serializes to JSON and deserializes back identically
- tests/unit/test_trace_migration.py:
    - migrate_v1_to_v2 converts a 5-entry v1 file correctly
    - migrated entries have valid hash chain
    - detect_trace_version correctly identifies v1 and v2 files
    - migration is idempotent (migrating a v2 file is a no-op or error)
- tests/unit/test_trace_v2_coexistence.py:
    - AutopilotEngine with flag disabled produces v1 entries
    - AutopilotEngine with flag enabled produces v2 entries
    - Mixed v1/v2 trace file can be read (v1 entries ignored by verify_chain)

Docs to update:
- Update docs/policy-dsl.md: add "Decision Trace v2" section documenting the new schema,
  hash chaining algorithm, and migration procedure

Acceptance criteria:
- New decisions with decision_trace_v2 flag enabled produce v2 entries with valid hash
  chains in the JSONL trace file
- Old v1 entries are still readable and writable when flag is disabled
- `atlasbridge trace migrate` converts v1 files to v2 with valid hash chains
- `atlasbridge trace integrity-check` returns exit 0 for valid v2 files, exit 1 for
  tampered files
- All tests pass: pytest tests/unit/test_trace_v2.py tests/unit/test_trace_migration.py tests/unit/test_trace_v2_coexistence.py -v
- ruff check . && ruff format --check . && mypy src/atlasbridge/ all pass
```

---

## Prompt A3 — Deterministic risk classifier + tests

```
Branch: feature/enterprise-risk-classifier

Wire the EnterpriseRiskClassifier into the policy evaluator so every policy decision
includes a deterministic risk level. No ML, no heuristics — pure rule-based classification.

Scope:
- Create src/atlasbridge/enterprise/risk.py with:
    - RiskLevel enum: NONE, LOW, MEDIUM, HIGH, CRITICAL
    - RiskClassifier class with classify(prompt_text, prompt_type, confidence, action,
      session_tags) -> RiskLevel method
    - Classification rules (deterministic decision table):
        - CRITICAL: action is "execute" AND confidence < HIGH
        - CRITICAL: prompt_type is "destructive_confirm" (any confidence)
        - HIGH: action is "execute" AND confidence is HIGH
        - HIGH: action is "auto_respond" AND confidence < HIGH
        - MEDIUM: action is "auto_respond" AND confidence is HIGH
        - MEDIUM: action is "require_human" AND confidence < MEDIUM
        - LOW: action is "require_human" AND confidence >= MEDIUM
        - LOW: action is "skip"
        - NONE: action is "log_only"
    - Override mechanism: if session_tags contains "critical_session", floor is HIGH
    - Override mechanism: if session_tags contains "safe_session", ceiling is MEDIUM
- Modify src/atlasbridge/core/policy/evaluator.py:
    - After evaluate() produces a PolicyDecision, if risk_classification feature flag is
      enabled, run RiskClassifier.classify() and attach risk_level to the decision
    - PolicyDecision model gains an optional risk_level field (None when flag disabled)
- Modify src/atlasbridge/enterprise/trace_v2.py:
    - Populate risk_level from PolicyDecision.risk_level when writing v2 trace entries
- Do NOT change the evaluation logic itself. Risk classification is a post-evaluation
  annotation, not a gate.

Tests to add:
- tests/unit/test_risk_classifier.py:
    - Test every row of the classification decision table (9 rules)
    - Test critical_session tag override raises floor to HIGH
    - Test safe_session tag override caps ceiling at MEDIUM
    - Test both tags simultaneously (critical_session wins — floor HIGH, ceiling ignored)
    - Determinism property test: 100 random inputs, each classified twice, results match
    - Edge case: empty prompt_text, unknown prompt_type, empty session_tags
    - Edge case: multiple tags including both critical_session and safe_session
- tests/unit/test_risk_in_evaluator.py:
    - evaluate() with flag disabled returns risk_level=None
    - evaluate() with flag enabled returns a valid RiskLevel
    - Risk level matches expected value for a known policy rule + prompt combination

Docs to update:
- Update docs/autonomy-modes.md (or create if missing): add "Risk Classification" section
  with the full decision table, override rules, and examples

Acceptance criteria:
- Every policy decision includes a risk_level when risk_classification flag is enabled
- Identical inputs always produce identical risk levels (determinism invariant)
- Session tag overrides work as specified
- Risk classification does not alter evaluation outcomes — it is purely observational
- All tests pass: pytest tests/unit/test_risk_classifier.py tests/unit/test_risk_in_evaluator.py -v
- ruff check . && ruff format --check . && mypy src/atlasbridge/ all pass
```

---

## Prompt B1 — Secure Control Channel spec + interface scaffolding

```
Branch: feature/cloud-control-channel

Implement the secure control channel transport layer that connects the local AtlasBridge
runtime to a cloud governance endpoint. This is the foundational network layer — no
business logic, just reliable authenticated transport with reconnection.

Scope:
- Create src/atlasbridge/cloud/__init__.py (empty, marks package)
- Create src/atlasbridge/cloud/transport.py with:
    - ControlChannelTransport class:
        - __init__(endpoint_url, auth_token, org_id) — all from config
        - connect() -> None — establishes WebSocket connection (use websockets library)
        - disconnect() -> None — clean shutdown
        - send(message: dict) -> None — JSON-serialize and send
        - on_message(callback) — register handler for inbound messages
        - is_connected property
    - Reconnection logic:
        - Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, max 60s
        - Jitter: +/- 20% randomization on each interval
        - Max retries: configurable, default unlimited
        - On reconnect: re-send last heartbeat to re-establish session
    - Connection states: DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING
- Create src/atlasbridge/cloud/heartbeat.py with:
    - HeartbeatManager class:
        - Sends heartbeat every 30s (configurable) via transport
        - Heartbeat payload: {type: "heartbeat", agent_id, timestamp, edition, uptime_s,
          active_sessions_count, policy_version_hash}
        - Tracks last_ack_at — timestamp of last server acknowledgment
        - Fires stale_connection callback if no ack received for 3x heartbeat interval
- Create src/atlasbridge/cloud/config.py with:
    - CloudConfig Pydantic model: endpoint_url, auth_token, org_id, enabled (bool,
      default False), heartbeat_interval_s (default 30)
    - load_cloud_config() — reads from atlasbridge config directory
- Integrate into daemon:
    - Modify src/atlasbridge/core/daemon/manager.py: if cloud is enabled in config,
      start transport + heartbeat on daemon start, stop on daemon shutdown
    - If cloud is disabled (default), no network calls are made, no imports of websockets
- Add CLI command: `atlasbridge cloud status` in src/atlasbridge/cli/_cloud.py
    - Shows: connection state, last heartbeat sent, last ack received, endpoint URL
    - When cloud disabled: prints "Cloud governance: disabled" and exits 0

Tests to add:
- tests/unit/test_cloud_transport.py:
    - Transport initializes in DISCONNECTED state
    - connect() transitions to CONNECTED (mock WebSocket)
    - disconnect() transitions to DISCONNECTED
    - Reconnect backoff sequence is correct (1, 2, 4, 8, 16, 32, 60, 60...)
    - Jitter stays within +/- 20% bounds
    - send() raises when disconnected
- tests/unit/test_heartbeat.py:
    - HeartbeatManager sends heartbeat at configured interval (mock transport)
    - Stale connection callback fires after 3x interval with no ack
    - Heartbeat payload contains all required fields
- tests/unit/test_cloud_config.py:
    - Default config has enabled=False
    - load_cloud_config() returns defaults when no config file exists
    - Config validates endpoint_url format
- tests/unit/test_cloud_disabled.py:
    - DaemonManager with cloud disabled makes zero network calls
    - `atlasbridge cloud status` with cloud disabled exits 0 with expected message
    - No websockets import occurs when cloud is disabled

Docs to update:
- Update docs/architecture.md: add "Cloud Control Channel" section with connection
  lifecycle diagram, heartbeat protocol, and reconnection strategy

Acceptance criteria:
- `atlasbridge cloud status` shows connection state (or "disabled" when cloud is off)
- Cloud disabled mode produces zero network calls (verified by test)
- Reconnection backoff is exponential with jitter, capped at 60s
- HeartbeatManager fires stale callback when server stops responding
- All tests pass: pytest tests/unit/test_cloud_transport.py tests/unit/test_heartbeat.py tests/unit/test_cloud_config.py tests/unit/test_cloud_disabled.py -v
- ruff check . && ruff format --check . && mypy src/atlasbridge/ all pass
```

---

## Prompt B2 — Cloud Governance API spec + client interface scaffolding

```
Branch: feature/cloud-governance-api

Implement the client-side interfaces for the Cloud Governance API. These clients talk to
the governance server (when it exists) to sync policies, stream audit events, and manage
organization state. All clients degrade gracefully when the server is unreachable.

Scope:
- Create src/atlasbridge/cloud/api/__init__.py
- Create src/atlasbridge/cloud/api/base.py with:
    - BaseAPIClient class:
        - __init__(base_url, auth_token, org_id, timeout_s=10)
        - Uses httpx.AsyncClient internally
        - _request(method, path, body=None) -> dict — wraps all HTTP calls with:
            - Auth header injection (Bearer token)
            - Org-ID header injection
            - Timeout enforcement
            - Retry on 429/503 with Retry-After header respect
            - Structured error responses (APIError with status_code, message, request_id)
        - health_check() -> bool — GET /health, returns True if 200
- Create src/atlasbridge/cloud/api/policy_registry.py with:
    - PolicyRegistryClient(BaseAPIClient):
        - get_policy(policy_id) -> PolicyDocument
        - list_policies() -> list[PolicySummary]
        - push_policy(policy_yaml, metadata) -> PolicyDocument
        - get_policy_diff(policy_id_a, policy_id_b) -> PolicyDiff
        - pin_policy(policy_id, agent_id) -> PinRecord
        - PolicyDocument, PolicySummary, PolicyDiff, PinRecord as Pydantic models
- Create src/atlasbridge/cloud/api/audit_stream.py with:
    - AuditStreamClient(BaseAPIClient):
        - stream_events(events: list[AuditEvent]) -> StreamResult
        - get_stream_status() -> StreamStatus
        - flush_buffer() -> int (number of events flushed)
        - Local buffer: holds events when server unreachable, flushes on reconnect
        - Buffer limit: 10,000 events (configurable), oldest dropped when full
        - StreamResult, StreamStatus as Pydantic models
- Create src/atlasbridge/cloud/api/auth.py with:
    - AuthClient:
        - authenticate(api_key) -> AuthToken
        - refresh_token(refresh_token) -> AuthToken
        - validate_token(token) -> TokenInfo
        - AuthToken, TokenInfo as Pydantic models
- Update src/atlasbridge/cloud/config.py:
    - Add api_base_url, api_key fields to CloudConfig
    - Add load_api_clients() factory that creates all clients from config
- Update CLI: extend `atlasbridge cloud status` to show:
    - API health (reachable/unreachable)
    - Auth state (authenticated/unauthenticated)
    - Policy sync state (synced/pending/disabled)
    - Audit buffer depth
- Add CLI command: `atlasbridge cloud setup` — interactive config for cloud endpoint +
  API key (writes to config file)

Tests to add:
- tests/unit/test_api_base.py:
    - Auth header is injected on every request
    - Timeout is enforced (mock slow server)
    - 429 response triggers retry with Retry-After delay
    - 503 response triggers retry with backoff
    - 401 response raises AuthenticationError (no retry)
    - health_check returns True on 200, False on anything else
- tests/unit/test_policy_registry_client.py:
    - get_policy returns deserialized PolicyDocument
    - list_policies handles empty list
    - push_policy sends correct payload
    - pin_policy sends correct agent_id binding
    - All methods raise APIError on server error responses
- tests/unit/test_audit_stream_client.py:
    - stream_events sends batch correctly
    - Buffer fills when server unreachable
    - Buffer flushes on reconnect
    - Buffer drops oldest when limit exceeded
    - get_stream_status reflects buffer depth
- tests/unit/test_auth_client.py:
    - authenticate returns valid AuthToken
    - refresh_token works with valid refresh token
    - validate_token returns token info
    - All methods handle network errors gracefully
- tests/unit/test_cloud_degradation.py:
    - All clients return sensible defaults when server unreachable
    - No exceptions propagate to caller on network failure
    - Audit buffer continues accepting events when disconnected
    - `atlasbridge cloud status` shows degraded state correctly

Docs to update:
- Update docs/architecture.md: add "Cloud Governance API" section with client hierarchy,
  authentication flow, and degradation behavior
- Create docs/cloud-setup.md: step-by-step cloud configuration guide (endpoint, API key,
  org setup, verification)

Acceptance criteria:
- `atlasbridge cloud status` shows full cloud state (health, auth, sync, buffer)
- All API clients degrade gracefully when endpoint is unreachable (no crashes, no
  unhandled exceptions)
- Audit buffer holds events during disconnection and flushes on reconnect
- 429/503 retry logic respects Retry-After headers
- All tests pass: pytest tests/unit/test_api_base.py tests/unit/test_policy_registry_client.py tests/unit/test_audit_stream_client.py tests/unit/test_auth_client.py tests/unit/test_cloud_degradation.py -v
- ruff check . && ruff format --check . && mypy src/atlasbridge/ all pass
```

---

## Prompt C1 — Web Dashboard full architecture spec

```
Branch: feature/dashboard-architecture

Write the complete architecture specification for the AtlasBridge Web Dashboard. This is
a design document only — no code changes.

Scope:
- Create docs/dashboard-architecture.md with the following sections:

1. Overview
   - Purpose: real-time visibility into agent activity, policy decisions, audit trail
   - Users: security engineers, platform teams, engineering managers
   - Non-goal: the dashboard does NOT execute anything — it is read-only + policy config

2. UI Screens (with wireframe descriptions)
   - Login / SSO entry point
   - Organization overview (agent count, active sessions, decision volume, risk summary)
   - Agent detail (live session view, recent decisions, risk timeline)
   - Policy editor (YAML editor with syntax highlighting, validation, diff preview,
     one-click deploy to agents)
   - Audit trail (searchable, filterable log of all decisions with hash chain verification
     indicator)
   - Risk overview (heat map of risk levels across agents and time, drill-down to
     individual decisions)
   - Settings (org config, user management, API keys, notification preferences)

3. API Endpoints (REST + WebSocket)
   - Auth: POST /auth/login, POST /auth/refresh, POST /auth/sso
   - Agents: GET /agents, GET /agents/:id, GET /agents/:id/sessions
   - Decisions: GET /decisions, GET /decisions/:id, GET /decisions/stream (WebSocket)
   - Policies: GET /policies, POST /policies, GET /policies/:id/diff
   - Audit: GET /audit, GET /audit/verify-chain
   - Org: GET /org, PATCH /org/settings

4. Data Model
   - Organization (id, name, plan, created_at)
   - User (id, org_id, email, role, sso_provider)
   - Agent (id, org_id, name, edition, last_heartbeat, status)
   - Session (id, agent_id, adapter, started_at, ended_at)
   - Decision (id, session_id, prompt_hash, action, risk_level, policy_version,
     trace_hash, created_at)
   - Policy (id, org_id, yaml_content, version, hash, deployed_to, created_at)
   - AuditEvent (id, org_id, agent_id, event_type, payload, hash, prev_hash, created_at)

5. Authentication Flow
   - API key for agent-to-server (already in B2)
   - OAuth2/SSO for dashboard users (Google, GitHub, SAML)
   - JWT with 15-minute access token + 7-day refresh token
   - Role-based access: viewer, operator, admin, owner

6. WebSocket Protocol
   - Connection: wss://api.atlasbridge.io/ws?token=JWT
   - Subscribe: {type: "subscribe", channels: ["decisions", "agents:agent-123"]}
   - Events: {type: "decision", data: {...}}, {type: "heartbeat", data: {...}}
   - Ping/pong keepalive every 30s

7. Deployment Model
   - Hosted SaaS (default)
   - Self-hosted option (Docker Compose + Helm chart)
   - Database: PostgreSQL (decisions, audit) + Redis (sessions, WebSocket pub/sub)
   - Object storage: S3-compatible for policy version archive

Tests: None (design document only)

Docs to update: This IS the doc (docs/dashboard-architecture.md)

Acceptance criteria:
- docs/dashboard-architecture.md exists with all 7 sections complete
- Every API endpoint has method, path, request/response schema described
- Data model has all tables with column types and relationships
- Auth flow covers both agent auth and human user auth
- WebSocket protocol is fully specified
- No code changes in this PR — design only
```

---

## Prompt C2 — Governance API implementation plan

```
Branch: feature/governance-api-plan

Write the complete implementation plan for the AtlasBridge Governance API server. This is
a planning document only — no code changes.

Scope:
- Create docs/governance-api-plan.md with the following sections:

1. Technology Stack
   - Language: Python 3.11+ (same as CLI for shared models)
   - Framework: FastAPI (async, OpenAPI spec generation, Pydantic native)
   - Database: PostgreSQL 15+ (JSONB for flexible event payloads)
   - Cache: Redis 7+ (session state, WebSocket pub/sub, rate limiting)
   - Task queue: None initially (inline processing; Celery/ARQ if needed later)
   - WebSocket: FastAPI native WebSocket + Redis pub/sub for multi-instance fan-out
   - Auth: python-jose for JWT, authlib for OAuth2/SSO
   - Deployment: Docker (single image), Kubernetes-ready (Helm chart)

2. Database Schema (PostgreSQL DDL)
   - organizations table
   - users table (with org_id FK, role enum)
   - agents table (with org_id FK, last_heartbeat timestamp)
   - sessions table (with agent_id FK)
   - decisions table (with session_id FK, hash chain columns, JSONB trace)
   - policies table (with org_id FK, version integer, yaml_content text, hash)
   - policy_pins table (policy_id FK, agent_id FK, pinned_at)
   - audit_events table (with org_id FK, agent_id FK, hash chain columns, JSONB payload)
   - Indexes: org_id on all tables, created_at on decisions/audit_events, hash on
     decisions for chain verification
   - Partitioning strategy: audit_events by month (for retention policies)

3. API Implementation Phases
   Phase 1 — Core (2 weeks):
     - Auth endpoints (login, refresh, API key validation)
     - Agent registration + heartbeat
     - Decision ingestion + query
     - Health check + readiness probe

   Phase 2 — Policy Management (2 weeks):
     - Policy CRUD + versioning
     - Policy diff endpoint
     - Policy pin/unpin
     - Policy deploy (push to agents via control channel)

   Phase 3 — Audit + Streaming (2 weeks):
     - Audit event ingestion (batch)
     - Audit query with filtering
     - Hash chain verification endpoint
     - WebSocket decision stream

   Phase 4 — Dashboard API (2 weeks):
     - Organization overview aggregations
     - Risk summary endpoints
     - Agent status aggregation
     - SSO integration (Google, GitHub)

4. Deployment Model
   - Development: docker-compose (API + PostgreSQL + Redis)
   - Staging: single Kubernetes namespace (API deployment + managed PostgreSQL + Redis)
   - Production: multi-AZ Kubernetes (API HPA, PostgreSQL HA, Redis Sentinel)
   - Self-hosted: single Docker Compose file with all dependencies
   - Environment variables for all configuration (12-factor)
   - Secrets via Kubernetes secrets or Docker secrets

5. Test Strategy
   - Unit tests: all business logic, 90%+ coverage target
   - Integration tests: database operations with testcontainers-python (real PostgreSQL)
   - API tests: FastAPI TestClient for all endpoints
   - Load tests: locust for decision ingestion throughput (target: 1000 decisions/sec)
   - Contract tests: shared Pydantic models between CLI and server ensure schema
     compatibility
   - E2E tests: full flow from agent heartbeat through decision query on dashboard

6. Observability
   - Structured logging (structlog)
   - Metrics: Prometheus (request latency, decision throughput, WebSocket connections)
   - Tracing: OpenTelemetry (optional, for distributed tracing)
   - Health endpoints: /health (liveness), /ready (readiness, includes DB + Redis check)
   - Alerting: decision ingestion lag > 5s, hash chain verification failure, agent
     heartbeat timeout

7. Milestone Breakdown
   Milestone 1 (v1.1.0-alpha) — 4 weeks:
     - Repository scaffolding (FastAPI + Docker + CI)
     - Database migrations (Alembic)
     - Auth + agent registration
     - Decision ingestion

   Milestone 2 (v1.1.0-beta) — 4 weeks:
     - Policy management endpoints
     - Audit ingestion + query
     - WebSocket streaming
     - Integration tests with testcontainers

   Milestone 3 (v1.1.0) — 4 weeks:
     - Dashboard aggregation endpoints
     - SSO integration
     - Load testing + performance tuning
     - Self-hosted Docker Compose distribution
     - Documentation: API reference, deployment guide, self-hosted guide

Tests: None (planning document only)

Docs to update: This IS the doc (docs/governance-api-plan.md)

Acceptance criteria:
- docs/governance-api-plan.md exists with all 7 sections complete
- Database schema includes DDL for all tables with types, constraints, and indexes
- Each API implementation phase has a clear scope and estimated duration
- Deployment model covers dev, staging, production, and self-hosted
- Test strategy includes unit, integration, API, load, contract, and E2E levels
- Milestone breakdown has 3 milestones with clear deliverables
- No code changes in this PR — planning document only
```

---

## Execution Order

These prompts are designed to be executed sequentially with each building on the previous:

```
A1 (runtime scaffolding)
 └─> A2 (trace v2)
      └─> A3 (risk classifier)
           └─> B1 (control channel)
                └─> B2 (governance API client)

C1 (dashboard spec)    ← can run in parallel with A/B
C2 (governance plan)   ← can run in parallel with A/B, depends on C1
```

Phase A prompts must be executed in order (A1 -> A2 -> A3).
Phase B prompts must be executed in order (B1 -> B2).
Phase C prompts can be executed in parallel with A/B but C2 depends on C1.
