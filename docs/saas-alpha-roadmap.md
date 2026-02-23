# 90-Day SaaS Alpha Roadmap

This document describes the strategic path from v1.0 (local governance runtime) to a SaaS Alpha. This is a **design document** — no implementation is included in v1.0.

---

## Guiding Principles

1. **Cloud OBSERVES, local EXECUTES** — this invariant is permanent.
2. Local runtime remains authoritative for all execution decisions.
3. Policy evaluation remains local.
4. Injection logic remains local.
5. Cloud cannot execute commands.

---

## Phase 1 — Stabilization (Days 0–30)

**Goal:** Validate v1.0 stability under real-world usage before adding any cloud surface.

### Tasks

- Soak testing: run AtlasBridge continuously for 7+ days with mixed workloads
- Performance benchmarks: measure prompt detection latency, injection throughput, SQLite WAL contention under concurrent sessions
- Console usage validation: verify operator console handles daemon + dashboard + agent lifecycle reliably
- Threat model hardening: review local-only attack surface for any gaps missed in v1.0

### Exit Criteria

- Zero invariant violations over 7-day soak period
- P95 prompt detection latency < 500ms
- No deadlocks or resource leaks under 3 concurrent sessions
- Threat model review signed off

---

## Phase 2 — Observe-Only SaaS (Days 30–60)

**Goal:** Build cloud ingestion for observability data. No remote execution.

### Architecture

```
Local Runtime                    Cloud Service
┌──────────────┐                ┌──────────────┐
│ AtlasBridge  │  ── signed ──> │ Ingestion    │
│ v1.x         │     traces     │ API          │
│              │  ── metadata ─>│              │
│ (executes)   │                │ (observes)   │
└──────────────┘                └──────────────┘
                                       │
                                       ▼
                                ┌──────────────┐
                                │ Cloud        │
                                │ Dashboard    │
                                └──────────────┘
```

### Tasks

- Signed trace ingestion: local runtime signs decision trace entries with HMAC before upload
- Metadata-only upload: session metadata, prompt counts, policy match rates — no prompt content by default
- Cloud dashboard: read-only view of ingested traces (replaces local dashboard for multi-machine visibility)
- No remote execution: cloud has no API to trigger actions on local runtime
- No remote policy enforcement: cloud cannot evaluate policies or inject replies

### Required New Contracts

- **Ingestion API schema** — versioned schema for trace upload payloads
- **Signed payload format** — HMAC-SHA256 signature spec for trace authenticity

### Required Security Gates

- Signed payload validation (reject unsigned or tampered traces)
- Rate limiting (per-agent, per-tenant)
- Content redaction options (allow operators to exclude prompt content from uploads)

### Exit Criteria

- Trace ingestion functional with signed payloads
- Cloud dashboard displays session timelines from ingested data
- No local runtime changes required (upload is opt-in via config)
- Penetration test on ingestion API passed

---

## Phase 3 — Multi-Tenant Alpha (Days 60–90)

**Goal:** Add tenant isolation, basic auth, and invite-only access.

### Tasks

- **Tenant IDs** — each organization gets a unique tenant identifier; all cloud data is scoped to tenant
- **Isolation model** — row-level security on PostgreSQL; tenant_id column on all tables; no cross-tenant data access
- **Basic RBAC** — viewer (read traces), operator (manage agents), admin (manage tenant settings)
- **OAuth login** — Google/GitHub OAuth2 for initial access (NOT full SSO/SAML yet)
- **Cloud ingestion auth keys** — per-tenant API keys for trace upload; key rotation support

### Required New Contracts

- **Tenant boundary model** — tenant_id propagation, isolation enforcement, data retention policy
- **Auth token validation** — OAuth2 token verification, API key validation, session management

### Required Security Gates

- Tenant isolation tests — verify no cross-tenant data leakage
- API key rotation without downtime
- OAuth token expiry and refresh handling

### Required CI Expansion

- SaaS service test matrix (PostgreSQL, Redis, OAuth mock)
- Contract compatibility tests (cloud API schema vs. local runtime schema)

### Exit Criteria

- 3+ tenants functional in staging environment
- Zero cross-tenant data leakage in isolation tests
- OAuth login flow complete (Google + GitHub)
- Per-tenant API keys with rotation

---

## Program Gate — Required Before Any SaaS Code Merges

Before any SaaS or cloud-execution code can be merged to main, the following must be completed and documented in a decision record (see `docs/decisions/001-saas-program-gate.md`):

1. Threat model updated with cloud-specific attack surfaces
2. RBAC design documented and reviewed
3. Data residency policy defined
4. SOC2 readiness assessment completed
5. All safety tests passing, new cloud invariant tests added
6. CI governance guard for SaaS-labeled PRs

This gate applies to Phase G (SaaS Observe-Only) and all subsequent phases. Design documents and stubs are permitted without the gate; production code paths are not.

---

## What Must NOT Change

These constraints are permanent across all phases:

| Constraint | Rationale |
|------------|-----------|
| Cloud cannot execute commands | Execution authority stays with the local operator |
| Local runtime remains authoritative | Cloud is advisory; local policy is final |
| Injection logic remains local | No remote code path to PTY stdin |
| Policy evaluation remains local | Cloud may suggest policies; evaluation is always local |
| Dashboard default binding remains loopback | Local dashboard is always localhost-only by default |

---

## 90-Day Milestone Summary

| Day | Milestone | Deliverable |
|-----|-----------|-------------|
| 0 | v1.0 GA | Local governance runtime released |
| 14 | Freeze window ends | Stability validated, no regressions |
| 30 | Phase 1 complete | Soak test, benchmarks, threat model hardened |
| 45 | Ingestion API alpha | Signed trace upload functional |
| 60 | Phase 2 complete | Cloud dashboard with ingested traces |
| 75 | Multi-tenant alpha | Tenant isolation, OAuth login, API keys |
| 90 | Phase 3 complete | Invite-only SaaS Alpha with 3+ tenants |
