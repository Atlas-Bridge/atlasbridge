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
// Monitor CRUD — browser extension, desktop, VS Code monitoring sessions
// ---------------------------------------------------------------------------

export function createMonitorSession(session: {
  id: string;
  vendor: string;
  conversationId: string;
  tabUrl?: string;
}): void {
  dashboardSqlite
    .prepare(
      `INSERT OR IGNORE INTO monitor_sessions (id, vendor, conversation_id, tab_url)
       VALUES (?, ?, ?, ?)`,
    )
    .run(session.id, session.vendor, session.conversationId, session.tabUrl ?? "");
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
  }[],
): void {
  const stmt = dashboardSqlite.prepare(
    `INSERT INTO monitor_messages (session_id, role, content, vendor, seq, captured_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertMany = dashboardSqlite.transaction(
    (rows: typeof messages) => {
      for (const row of rows) {
        stmt.run(row.sessionId, row.role, row.content, row.vendor, row.seq, row.capturedAt);
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
  return dashboardSqlite
    .prepare(
      `SELECT * FROM monitor_messages WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
    )
    .all(sessionId, afterSeq, limit);
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

export function purgeAllDashboardData(): { tables: string[] } {
  const tables = [
    "monitor_messages", "monitor_sessions",
    "operator_audit_log",
    "quality_scans", "local_scans", "container_scans", "infra_scans",
  ];
  for (const t of tables) {
    dashboardSqlite.exec(`DELETE FROM ${t}`);
  }
  return { tables };
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
