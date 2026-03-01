import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";
import { getAtlasBridgeDbPath, getDashboardDbPath } from "./config";

// Dashboard settings DB (read-write) — stores RBAC, settings, etc.
const dashboardDbPath = getDashboardDbPath();
const dashboardSqlite = new Database(dashboardDbPath);
dashboardSqlite.pragma("journal_mode = WAL");
dashboardSqlite.pragma("foreign_keys = ON");

// Create tables if they don't exist
dashboardSqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Viewer',
    status TEXT NOT NULL DEFAULT 'pending',
    mfa_status TEXT NOT NULL DEFAULT 'disabled',
    last_active TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    groups TEXT NOT NULL DEFAULT '[]',
    login_method TEXT NOT NULL DEFAULT 'SSO'
  );
  CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    member_count INTEGER NOT NULL DEFAULT 0,
    roles TEXT NOT NULL DEFAULT '[]',
    permission_level TEXT NOT NULL DEFAULT 'read',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    sync_source TEXT NOT NULL DEFAULT 'Manual',
    last_synced TEXT
  );
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    permissions TEXT NOT NULL DEFAULT '[]',
    is_system INTEGER NOT NULL DEFAULT 0,
    member_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    last_used TEXT,
    rate_limit INTEGER NOT NULL DEFAULT 100
  );
  CREATE TABLE IF NOT EXISTS security_policies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    value TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info'
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    channel TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    destination TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]',
    min_severity TEXT NOT NULL DEFAULT 'info',
    last_delivered TEXT
  );
  CREATE TABLE IF NOT EXISTS rbac_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    resource TEXT NOT NULL,
    actions TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS ip_allowlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    cidr TEXT NOT NULL,
    label TEXT NOT NULL,
    added_by TEXT NOT NULL,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_hit TEXT
  );
  CREATE TABLE IF NOT EXISTS repo_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    branch TEXT NOT NULL DEFAULT 'main',
    url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'connected',
    access_token TEXT,
    connected_by TEXT NOT NULL,
    connected_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_synced TEXT,
    quality_level TEXT NOT NULL DEFAULT 'standard',
    quality_score INTEGER
  );
  CREATE TABLE IF NOT EXISTS quality_scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_connection_id INTEGER NOT NULL,
    scan_date TEXT NOT NULL DEFAULT (datetime('now')),
    quality_level TEXT NOT NULL,
    overall_score INTEGER NOT NULL,
    categories TEXT NOT NULL,
    suggestions TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS local_scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_connection_id INTEGER NOT NULL,
    profile TEXT NOT NULL,
    commit_sha TEXT NOT NULL,
    result TEXT NOT NULL,
    artifact_path TEXT,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
    duration_ms INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS auth_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS container_scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image TEXT NOT NULL,
    tag TEXT NOT NULL,
    result TEXT NOT NULL,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS infra_scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_connection_id INTEGER NOT NULL,
    result TEXT NOT NULL,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS operator_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    action TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT 'ok',
    error TEXT
  );
  CREATE TABLE IF NOT EXISTS monitor_sessions (
    id TEXT PRIMARY KEY,
    vendor TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    tab_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
  );
  CREATE TABLE IF NOT EXISTS monitor_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES monitor_sessions(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    vendor TEXT NOT NULL,
    seq INTEGER NOT NULL,
    captured_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_monitor_messages_session_seq
    ON monitor_messages(session_id, seq);
`);

// Migrations — add columns and tables (idempotent)
try { dashboardSqlite.exec(`ALTER TABLE repo_connections ADD COLUMN auth_provider_id INTEGER`); } catch { /* column already exists */ }
try { dashboardSqlite.exec(`ALTER TABLE notifications ADD COLUMN last_delivery_status TEXT`); } catch { /* column already exists */ }
try { dashboardSqlite.exec(`ALTER TABLE notifications ADD COLUMN last_delivery_error TEXT`); } catch { /* column already exists */ }
try { dashboardSqlite.exec(`ALTER TABLE monitor_messages ADD COLUMN permission_mode TEXT`); } catch { /* column already exists */ }
try { dashboardSqlite.exec(`ALTER TABLE monitor_messages ADD COLUMN tool_name TEXT`); } catch { /* column already exists */ }
try { dashboardSqlite.exec(`ALTER TABLE monitor_messages ADD COLUMN tool_use_id TEXT`); } catch { /* column already exists */ }
try { dashboardSqlite.exec(`ALTER TABLE monitor_sessions ADD COLUMN workspace_key TEXT`); } catch { /* column already exists */ }
// Backfill workspace_key for old sessions (strip :uuid suffix from conversation_id)
dashboardSqlite.exec(`UPDATE monitor_sessions SET workspace_key = conversation_id WHERE workspace_key IS NULL AND conversation_id LIKE 'claude-code-%'`);

dashboardSqlite.exec(`
  CREATE TABLE IF NOT EXISTS evidence_bundles (
    id TEXT PRIMARY KEY,
    generated_at TEXT NOT NULL,
    session_id TEXT,
    format TEXT NOT NULL DEFAULT 'bundle',
    decision_count INTEGER NOT NULL DEFAULT 0,
    escalation_count INTEGER NOT NULL DEFAULT 0,
    integrity_status TEXT NOT NULL DEFAULT 'Unknown',
    governance_score REAL NOT NULL DEFAULT 0,
    manifest_hash TEXT
  );
`);

dashboardSqlite.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0.0',
    description TEXT NOT NULL DEFAULT '',
    capabilities TEXT NOT NULL DEFAULT '[]',
    risk_tier TEXT NOT NULL DEFAULT 'moderate',
    max_autonomy TEXT NOT NULL DEFAULT 'assist',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS retention_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    audit_retention_days INTEGER NOT NULL DEFAULT 730,
    trace_retention_days INTEGER NOT NULL DEFAULT 365,
    session_retention_days INTEGER NOT NULL DEFAULT 180,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

dashboardSqlite.exec(`
  CREATE TABLE IF NOT EXISTS hook_approvals (
    id TEXT PRIMARY KEY,
    tool_name TEXT NOT NULL,
    tool_input TEXT NOT NULL DEFAULT '{}',
    tool_use_id TEXT,
    cwd TEXT,
    workspace TEXT,
    session_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    decided_at TEXT
  );
`);
// Migration: add columns to hook_approvals if missing
try { dashboardSqlite.exec(`ALTER TABLE hook_approvals ADD COLUMN tool_use_id TEXT`); } catch { /* already exists */ }
try { dashboardSqlite.exec(`ALTER TABLE hook_approvals ADD COLUMN cwd TEXT`); } catch { /* already exists */ }

export const db = drizzle(dashboardSqlite, { schema });

export function insertOperatorAuditLog(entry: {
  method: string;
  path: string;
  action: string;
  body: Record<string, unknown>;
  result: "ok" | "error";
  error?: string;
}): void {
  dashboardSqlite
    .prepare(
      `INSERT INTO operator_audit_log (method, path, action, body, result, error)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.method,
      entry.path,
      entry.action,
      JSON.stringify(entry.body),
      entry.result,
      entry.error ?? null,
    );
}

export function queryOperatorAuditLog(limit = 100): unknown[] {
  return dashboardSqlite
    .prepare(`SELECT * FROM operator_audit_log ORDER BY id DESC LIMIT ?`)
    .all(limit);
}

// ---------------------------------------------------------------------------
// Hook approvals — PreToolUse hook → dashboard approval flow
// ---------------------------------------------------------------------------

export function createHookApproval(approval: {
  id: string;
  toolName: string;
  toolInput: string;
  toolUseId?: string;
  cwd?: string;
  workspace?: string;
  sessionId?: string;
}): void {
  dashboardSqlite
    .prepare(
      `INSERT OR IGNORE INTO hook_approvals (id, tool_name, tool_input, tool_use_id, cwd, workspace, session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      approval.id, approval.toolName, approval.toolInput,
      approval.toolUseId ?? null, approval.cwd ?? null,
      approval.workspace ?? null, approval.sessionId ?? null,
    );
}

export function listPendingHookApprovals(): unknown[] {
  return dashboardSqlite
    .prepare(`SELECT * FROM hook_approvals WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50`)
    .all();
}

export function decideHookApproval(id: string, decision: "allowed" | "denied"): boolean {
  const result = dashboardSqlite
    .prepare(`UPDATE hook_approvals SET status = ?, decided_at = datetime('now') WHERE id = ? AND status = 'pending'`)
    .run(decision, id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Monitor CRUD — browser extension, desktop, VS Code monitoring sessions
// ---------------------------------------------------------------------------

export function createMonitorSession(session: {
  id: string;
  vendor: string;
  conversationId: string;
  tabUrl?: string;
  workspaceKey?: string;
}): void {
  dashboardSqlite
    .prepare(
      `INSERT OR IGNORE INTO monitor_sessions (id, vendor, conversation_id, tab_url, workspace_key)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(session.id, session.vendor, session.conversationId, session.tabUrl ?? "", session.workspaceKey ?? null);
}

export function listMonitorSessions(status?: string): unknown[] {
  if (status) {
    return dashboardSqlite
      .prepare(`SELECT * FROM monitor_sessions WHERE status = ? ORDER BY created_at DESC LIMIT 100`)
      .all(status);
  }
  return dashboardSqlite
    .prepare(`SELECT * FROM monitor_sessions ORDER BY created_at DESC LIMIT 100`)
    .all();
}

export function getMonitorSession(id: string): unknown {
  return dashboardSqlite
    .prepare(`SELECT * FROM monitor_sessions WHERE id = ?`)
    .get(id);
}

export function endMonitorSession(id: string): void {
  dashboardSqlite
    .prepare(`UPDATE monitor_sessions SET status = 'ended', ended_at = datetime('now') WHERE id = ?`)
    .run(id);
}

export function insertMonitorMessages(
  messages: {
    sessionId: string;
    role: string;
    content: string;
    vendor: string;
    seq: number;
    capturedAt: string;
    permissionMode?: string | null;
    toolName?: string | null;
    toolUseId?: string | null;
  }[],
): void {
  const stmt = dashboardSqlite.prepare(
    `INSERT INTO monitor_messages (session_id, role, content, vendor, seq, captured_at, permission_mode, tool_name, tool_use_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMany = dashboardSqlite.transaction(
    (rows: typeof messages) => {
      for (const row of rows) {
        stmt.run(row.sessionId, row.role, row.content, row.vendor, row.seq, row.capturedAt, row.permissionMode ?? null, row.toolName ?? null, row.toolUseId ?? null);
      }
    },
  );
  insertMany(messages);
}

export function listMonitorMessages(
  sessionId: string,
  afterSeq = 0,
  limit = 200,
): unknown[] {
  // Subquery grabs the NEWEST `limit` rows, then outer query re-sorts ascending
  return dashboardSqlite
    .prepare(
      `SELECT * FROM (
         SELECT * FROM monitor_messages WHERE session_id = ? AND seq > ?
         ORDER BY captured_at DESC, seq DESC LIMIT ?
       ) sub ORDER BY captured_at ASC, seq ASC`,
    )
    .all(sessionId, afterSeq, limit);
}

export function listAllMonitorMessages(
  limit = 200,
  offset = 0,
  role?: string,
): unknown[] {
  if (role) {
    return dashboardSqlite
      .prepare(
        `SELECT m.*, s.vendor as session_vendor, s.conversation_id, s.tab_url
         FROM monitor_messages m
         JOIN monitor_sessions s ON m.session_id = s.id
         WHERE m.role = ?
         ORDER BY m.captured_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(role, limit, offset);
  }
  return dashboardSqlite
    .prepare(
      `SELECT m.*, s.vendor as session_vendor, s.conversation_id, s.tab_url
       FROM monitor_messages m
       JOIN monitor_sessions s ON m.session_id = s.id
       ORDER BY m.captured_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(limit, offset);
}

export function listMonitorSessionsWithCounts(): unknown[] {
  return dashboardSqlite
    .prepare(
      `SELECT s.*,
              COUNT(m.id) as message_count,
              MAX(m.captured_at) as last_message_at,
              SUM(CASE WHEN m.permission_mode IN ('approved', 'rejected') THEN 1 ELSE 0 END) as approval_count,
              SUM(CASE WHEN m.permission_mode = 'pending' AND m.tool_use_id IS NOT NULL
                        AND NOT EXISTS (
                          SELECT 1 FROM monitor_messages r
                          WHERE r.tool_use_id = m.tool_use_id
                            AND r.permission_mode IN ('approved', 'rejected')
                        )
                   THEN 1 ELSE 0 END) as pending_count
       FROM monitor_sessions s
       LEFT JOIN monitor_messages m ON s.id = m.session_id
       GROUP BY s.id
       ORDER BY COALESCE(MAX(m.captured_at), s.created_at) DESC`,
    )
    .all();
}

export function countAllMonitorMessages(role?: string): number {
  if (role) {
    const row = dashboardSqlite
      .prepare(`SELECT COUNT(*) as count FROM monitor_messages WHERE role = ?`)
      .get(role) as { count: number } | undefined;
    return row?.count ?? 0;
  }
  const row = dashboardSqlite
    .prepare(`SELECT COUNT(*) as count FROM monitor_messages`)
    .get() as { count: number } | undefined;
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Evidence bundles — persistent storage
// ---------------------------------------------------------------------------

export interface EvidenceBundleRow {
  id: string;
  generated_at: string;
  session_id: string | null;
  format: string;
  decision_count: number;
  escalation_count: number;
  integrity_status: string;
  governance_score: number;
  manifest_hash: string | null;
}

export function insertEvidenceBundle(bundle: {
  id: string;
  generatedAt: string;
  sessionId?: string;
  format: string;
  decisionCount: number;
  escalationCount: number;
  integrityStatus: string;
  governanceScore: number;
  manifestHash?: string;
}): void {
  dashboardSqlite
    .prepare(
      `INSERT INTO evidence_bundles (id, generated_at, session_id, format, decision_count, escalation_count, integrity_status, governance_score, manifest_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      bundle.id,
      bundle.generatedAt,
      bundle.sessionId ?? null,
      bundle.format,
      bundle.decisionCount,
      bundle.escalationCount,
      bundle.integrityStatus,
      bundle.governanceScore,
      bundle.manifestHash ?? null,
    );
}

export function queryEvidenceBundles(limit = 50): EvidenceBundleRow[] {
  return dashboardSqlite
    .prepare(`SELECT * FROM evidence_bundles ORDER BY generated_at DESC LIMIT ?`)
    .all(limit) as EvidenceBundleRow[];
}

// ---------------------------------------------------------------------------
// Danger zone — delete data / reset settings
// ---------------------------------------------------------------------------

export function purgeMonitorData(): { sessions: number; messages: number } {
  const msgCount = dashboardSqlite.prepare(`SELECT COUNT(*) as c FROM monitor_messages`).get() as { c: number };
  const sesCount = dashboardSqlite.prepare(`SELECT COUNT(*) as c FROM monitor_sessions`).get() as { c: number };
  dashboardSqlite.exec(`DELETE FROM monitor_messages`);
  dashboardSqlite.exec(`DELETE FROM monitor_sessions`);
  return { sessions: sesCount.c, messages: msgCount.c };
}

export function purgeAllDashboardData(): { tables: string[]; operationalTables: string[] } {
  // 1. Purge dashboard DB tables
  const tables = [
    "monitor_messages", "monitor_sessions",
    "operator_audit_log",
    "quality_scans", "local_scans", "container_scans", "infra_scans",
    "evidence_bundles", "agents",
  ];
  for (const t of tables) {
    dashboardSqlite.exec(`DELETE FROM ${t}`);
  }

  // 2. Purge AtlasBridge operational DB (sessions, prompts, transcripts, etc.)
  const operationalTables: string[] = [];
  const abDb = getAtlasBridgeDbRW();
  if (abDb) {
    try {
      const opTables = [
        "sessions", "prompts", "replies", "audit_events",
        "prompt_deliveries", "processed_messages",
        "transcript_chunks",
        "agent_turns", "agent_plans", "agent_decisions",
        "agent_tool_runs", "agent_outcomes",
        "operator_directives",
      ];
      for (const t of opTables) {
        try {
          abDb.exec(`DELETE FROM ${t}`);
          operationalTables.push(t);
        } catch {
          // Table may not exist in older DB schemas — skip
        }
      }
      // Force WAL checkpoint so readers see the deletions immediately
      try {
        abDb.exec(`PRAGMA wal_checkpoint(TRUNCATE)`);
      } catch {
        // WAL checkpoint is best-effort
      }
    } finally {
      abDb.close();
    }
    // Reset cached read-only connection so it picks up the changes
    if (_abDb) {
      try { _abDb.close(); } catch { /* ignore */ }
      _abDb = null;
    }
  } else {
    console.error(
      `purgeAllDashboardData: could not open AtlasBridge operational DB at ${getAtlasBridgeDbPath()} — sessions/prompts not purged`
    );
  }

  return { tables, operationalTables };
}

export function resetDashboardSettings(): { tables: string[] } {
  const tables = [
    "users", "groups", "roles", "api_keys",
    "security_policies", "notifications", "rbac_permissions",
    "ip_allowlist", "repo_connections", "auth_providers",
  ];
  for (const t of tables) {
    dashboardSqlite.exec(`DELETE FROM ${t}`);
  }
  return { tables };
}

// AtlasBridge operational DB (read-only) — sessions, prompts, audit
let _abDb: Database.Database | null = null;
export function getAtlasBridgeDb(): Database.Database | null {
  if (_abDb) return _abDb;
  const abPath = getAtlasBridgeDbPath();
  try {
    _abDb = new Database(abPath, { readonly: true });
    return _abDb;
  } catch {
    console.warn(`AtlasBridge DB not found at ${abPath} — operational data unavailable`);
    return null;
  }
}

/**
 * Open a read-write connection to the AtlasBridge operational DB.
 * Returns null if the DB file doesn't exist. Caller must close when done.
 */
export function getAtlasBridgeDbRW(): Database.Database | null {
  const abPath = getAtlasBridgeDbPath();
  try {
    return new Database(abPath);
  } catch {
    return null;
  }
}
