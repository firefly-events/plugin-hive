/**
 * Durable approval store backed by SQLite (better-sqlite3).
 *
 * Provides the stable read/write contract for:
 *  - "pending approvals"  — what is waiting on a human/agent decision
 *  - "decision records"   — immutable audit trail once resolved
 *
 * Both the dashboard micro-frontend and the MCP/web fallback consume this
 * contract via the ApprovalEngine facade; neither touches SQL directly.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_DB_PATH = resolve(
  process.env.HOME ?? process.cwd(),
  'Code/plugin-hive/.pHive/approval-audit.db'
);

export class ApprovalStore {
  /**
   * @param {string} [dbPath] - Absolute path to the SQLite file.
   *   Pass ':memory:' for an ephemeral in-process database (useful in tests).
   */
  constructor(dbPath = DEFAULT_DB_PATH) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this._db = new Database(dbPath);
    this._db.pragma('journal_mode = WAL');
    this._migrate();
  }

  _migrate() {
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS pending_approvals (
        id              TEXT PRIMARY KEY,
        action_type     TEXT NOT NULL,
        action_context  TEXT NOT NULL,
        requested_at    TEXT NOT NULL,
        requested_by    TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        mode            TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_records (
        id                  TEXT PRIMARY KEY,
        approval_id         TEXT NOT NULL,
        action_type         TEXT NOT NULL,
        method              TEXT NOT NULL,
        decision_allowed    INTEGER NOT NULL,
        decision_reason     TEXT NOT NULL,
        decision_message    TEXT NOT NULL,
        approver_identity   TEXT NOT NULL,
        timestamp           TEXT NOT NULL,
        verdicts            TEXT NOT NULL,
        pass_check          INTEGER NOT NULL,
        FOREIGN KEY (approval_id) REFERENCES pending_approvals(id)
      );

      CREATE INDEX IF NOT EXISTS idx_pending_action_type ON pending_approvals(action_type);
      CREATE INDEX IF NOT EXISTS idx_pending_status      ON pending_approvals(status);
      CREATE INDEX IF NOT EXISTS idx_audit_approval_id   ON audit_records(approval_id);
      CREATE INDEX IF NOT EXISTS idx_audit_action_type   ON audit_records(action_type);
    `);

    // One audit record per approval, enforced at the schema level. Databases
    // written before this constraint existed may hold duplicates from the
    // double-resolution race; keep the earliest record per approval so the
    // unique index can be created.
    this._db.exec(`
      DELETE FROM audit_records WHERE rowid NOT IN (
        SELECT MIN(rowid) FROM audit_records GROUP BY approval_id
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_approval_unique ON audit_records(approval_id);
    `);
  }

  /**
   * Persist a new pending approval and return its full record.
   *
   * @param {string} actionType
   * @param {object} actionContext
   * @param {string} requestedBy
   * @param {'human-gate'|'agent-quorum'|'multi-agent-vote'} mode
   * @returns {import('./types.mjs').PendingApproval}
   */
  createPending(actionType, actionContext, requestedBy, mode) {
    const id = randomUUID();
    const requestedAt = new Date().toISOString();
    this._db.prepare(`
      INSERT INTO pending_approvals (id, action_type, action_context, requested_at, requested_by, status, mode)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, actionType, JSON.stringify(actionContext), requestedAt, requestedBy, mode);
    return { id, actionType, actionContext, requestedAt, requestedBy, status: 'pending', mode };
  }

  /**
   * Fetch a pending approval by its ID.
   *
   * @param {string} id
   * @returns {import('./types.mjs').PendingApproval|null}
   */
  getPending(id) {
    const row = this._db.prepare('SELECT * FROM pending_approvals WHERE id = ?').get(id);
    return row ? this._hydratePending(row) : null;
  }

  /**
   * List pending approvals, newest first.
   *
   * @param {{ actionType?: string, status?: string }} [filter]
   * @returns {import('./types.mjs').PendingApproval[]}
   */
  listPending(filter = {}) {
    const conditions = [];
    const params = [];
    if (filter.actionType) { conditions.push('action_type = ?'); params.push(filter.actionType); }
    if (filter.status)     { conditions.push('status = ?');      params.push(filter.status); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this._db
      .prepare(`SELECT * FROM pending_approvals ${where} ORDER BY requested_at DESC, rowid DESC`)
      .all(...params);
    return rows.map(r => this._hydratePending(r));
  }

  /**
   * Mark a pending approval as resolved and write the immutable audit record atomically.
   *
   * The status flip is conditional on the row still being 'pending', so when two
   * consumers (dashboard and MCP fallback) race on the same approval exactly one
   * wins; the loser gets null and must not act on the approval.
   *
   * @param {string} approvalId
   * @param {Omit<import('./types.mjs').AuditRecord, 'id'>} auditData
   * @returns {import('./types.mjs').AuditRecord|null} null when the approval was
   *   not in 'pending' state (already resolved by another consumer, or unknown id)
   */
  resolveApproval(approvalId, auditData) {
    const id = randomUUID();
    const txn = this._db.transaction(() => {
      const updated = this._db
        .prepare("UPDATE pending_approvals SET status = 'resolved' WHERE id = ? AND status = 'pending'")
        .run(approvalId);
      if (updated.changes !== 1) return null;
      this._db.prepare(`
        INSERT INTO audit_records
          (id, approval_id, action_type, method,
           decision_allowed, decision_reason, decision_message,
           approver_identity, timestamp, verdicts, pass_check)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, approvalId, auditData.actionType, auditData.method,
        auditData.decision.allowed ? 1 : 0,
        auditData.decision.reason,
        auditData.decision.message,
        auditData.approverIdentity,
        auditData.timestamp,
        JSON.stringify(auditData.verdicts),
        auditData.passCheck ? 1 : 0,
      );
      return { id, ...auditData };
    });
    return txn();
  }

  /**
   * Get the audit record for a given approval.
   *
   * @param {string} approvalId
   * @returns {import('./types.mjs').AuditRecord|null}
   */
  getAuditRecord(approvalId) {
    const row = this._db
      .prepare('SELECT * FROM audit_records WHERE approval_id = ?')
      .get(approvalId);
    return row ? this._hydrateAudit(row) : null;
  }

  /**
   * List audit records, newest first.
   *
   * @param {{ actionType?: string }} [filter]
   * @returns {import('./types.mjs').AuditRecord[]}
   */
  listAuditRecords(filter = {}) {
    const conditions = [];
    const params = [];
    if (filter.actionType) { conditions.push('action_type = ?'); params.push(filter.actionType); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this._db
      .prepare(`SELECT * FROM audit_records ${where} ORDER BY timestamp DESC, rowid DESC`)
      .all(...params);
    return rows.map(r => this._hydrateAudit(r));
  }

  close() {
    this._db.close();
  }

  // -- private helpers ---------------------------------------------------------

  _hydratePending(row) {
    return {
      id: row.id,
      actionType: row.action_type,
      actionContext: JSON.parse(row.action_context),
      requestedAt: row.requested_at,
      requestedBy: row.requested_by,
      status: row.status,
      mode: row.mode,
    };
  }

  _hydrateAudit(row) {
    return {
      id: row.id,
      approvalId: row.approval_id,
      actionType: row.action_type,
      method: row.method,
      decision: {
        allowed: row.decision_allowed === 1,
        reason: row.decision_reason,
        message: row.decision_message,
      },
      approverIdentity: row.approver_identity,
      timestamp: row.timestamp,
      verdicts: JSON.parse(row.verdicts),
      passCheck: row.pass_check === 1,
    };
  }
}
