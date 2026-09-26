/**
 * Integration tests for ApprovalStore using an in-memory SQLite database.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalStore } from '../store.mjs';

describe('ApprovalStore', () => {
  let store;

  beforeEach(() => {
    store = new ApprovalStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  describe('createPending / getPending', () => {
    it('creates a pending record and retrieves it by id', () => {
      const ctx = { repoName: 'foo', owner: 'mathew' };
      const pending = store.createPending('repo-creation', ctx, 'agent-xyz', 'multi-agent-vote');

      expect(pending.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(pending.actionType).toBe('repo-creation');
      expect(pending.actionContext).toEqual(ctx);
      expect(pending.requestedBy).toBe('agent-xyz');
      expect(pending.status).toBe('pending');
      expect(pending.mode).toBe('multi-agent-vote');

      const fetched = store.getPending(pending.id);
      expect(fetched).toEqual(pending);
    });

    it('returns null for unknown id', () => {
      expect(store.getPending('00000000-0000-0000-0000-000000000000')).toBeNull();
    });
  });

  describe('listPending', () => {
    it('returns all pending approvals newest-first when no filter', () => {
      store.createPending('repo-creation', {}, 'a1', 'multi-agent-vote');
      store.createPending('pr-merge', {}, 'a2', 'agent-quorum');
      const list = store.listPending();
      expect(list).toHaveLength(2);
    });

    it('filters by actionType', () => {
      store.createPending('repo-creation', {}, 'a1', 'multi-agent-vote');
      store.createPending('pr-merge', {}, 'a2', 'agent-quorum');
      const list = store.listPending({ actionType: 'repo-creation' });
      expect(list).toHaveLength(1);
      expect(list[0].actionType).toBe('repo-creation');
    });

    it('filters by status', () => {
      const p = store.createPending('repo-creation', {}, 'a1', 'multi-agent-vote');
      store.resolveApproval(p.id, {
        approvalId: p.id, actionType: 'repo-creation', method: 'vote',
        decision: { allowed: true, reason: 'allowed', message: '' },
        approverIdentity: 'a, b, c', timestamp: new Date().toISOString(),
        verdicts: [], passCheck: true,
      });
      const pending = store.listPending({ status: 'pending' });
      const resolved = store.listPending({ status: 'resolved' });
      expect(pending).toHaveLength(0);
      expect(resolved).toHaveLength(1);
    });
  });

  describe('resolveApproval / getAuditRecord', () => {
    it('marks pending resolved and writes audit record atomically', () => {
      const p = store.createPending('repo-creation', { repo: 'x' }, 'requester', 'multi-agent-vote');
      const ts = '2026-07-07T12:00:00.000Z';

      const auditRecord = store.resolveApproval(p.id, {
        approvalId: p.id,
        actionType: 'repo-creation',
        method: 'vote',
        decision: { allowed: true, reason: 'allowed', message: '' },
        approverIdentity: 'duplication-scout, fit-check, tech-scout',
        timestamp: ts,
        verdicts: [
          { identity: 'duplication-scout', approve: true, reasoning: 'no dup' },
          { identity: 'fit-check', approve: true, reasoning: 'standalone ok' },
          { identity: 'tech-scout', approve: true, reasoning: 'no lib' },
          { identity: 'product-owner', approve: false, reasoning: 'meh' },
        ],
        passCheck: true,
      });

      expect(auditRecord.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(auditRecord.approvalId).toBe(p.id);
      expect(auditRecord.decision.allowed).toBe(true);
      expect(auditRecord.verdicts).toHaveLength(4);
      expect(auditRecord.passCheck).toBe(true);
      expect(auditRecord.timestamp).toBe(ts);

      // Pending status updated
      expect(store.getPending(p.id).status).toBe('resolved');

      // Retrievable via getAuditRecord
      const fetched = store.getAuditRecord(p.id);
      expect(fetched).toEqual(auditRecord);
    });

    it('second resolveApproval on the same approval returns null and writes nothing', () => {
      const p = store.createPending('repo-creation', {}, 'agent', 'multi-agent-vote');
      const audit = (who) => ({
        approvalId: p.id, actionType: 'repo-creation', method: 'vote',
        decision: { allowed: true, reason: 'allowed', message: '' },
        approverIdentity: who, timestamp: new Date().toISOString(),
        verdicts: [], passCheck: true,
      });

      const first = store.resolveApproval(p.id, audit('dashboard'));
      const second = store.resolveApproval(p.id, audit('mcp-fallback'));

      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(store.listAuditRecords()).toHaveLength(1);
      expect(store.getAuditRecord(p.id).approverIdentity).toBe('dashboard');
    });

    it('returns null for an unknown approval id (no orphan audit record)', () => {
      const result = store.resolveApproval('00000000-0000-0000-0000-000000000000', {
        approvalId: '00000000-0000-0000-0000-000000000000',
        actionType: 'repo-creation', method: 'vote',
        decision: { allowed: true, reason: 'allowed', message: '' },
        approverIdentity: 'x', timestamp: new Date().toISOString(),
        verdicts: [], passCheck: true,
      });
      expect(result).toBeNull();
      expect(store.listAuditRecords()).toHaveLength(0);
    });

    it('two stores over one database file: exactly one wins the resolution race', () => {
      const dir = mkdtempSync(join(tmpdir(), 'approval-store-'));
      const dbPath = join(dir, 'audit.db');
      const storeA = new ApprovalStore(dbPath);
      const storeB = new ApprovalStore(dbPath);
      try {
        const p = storeA.createPending('repo-creation', {}, 'agent', 'multi-agent-vote');
        const audit = (who) => ({
          approvalId: p.id, actionType: 'repo-creation', method: 'vote',
          decision: { allowed: true, reason: 'allowed', message: '' },
          approverIdentity: who, timestamp: new Date().toISOString(),
          verdicts: [], passCheck: true,
        });

        // Both consumers observed the approval as pending before either wrote.
        expect(storeA.getPending(p.id).status).toBe('pending');
        expect(storeB.getPending(p.id).status).toBe('pending');

        const winner = storeA.resolveApproval(p.id, audit('dashboard'));
        const loser = storeB.resolveApproval(p.id, audit('mcp-fallback'));

        expect(winner).not.toBeNull();
        expect(loser).toBeNull();
        expect(storeB.listAuditRecords()).toHaveLength(1);
        expect(storeB.getAuditRecord(p.id).approverIdentity).toBe('dashboard');
      } finally {
        storeA.close();
        storeB.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('schema forbids a second audit record per approval even on direct insert', () => {
      const p = store.createPending('repo-creation', {}, 'agent', 'multi-agent-vote');
      store.resolveApproval(p.id, {
        approvalId: p.id, actionType: 'repo-creation', method: 'vote',
        decision: { allowed: true, reason: 'allowed', message: '' },
        approverIdentity: 'x', timestamp: new Date().toISOString(),
        verdicts: [], passCheck: true,
      });
      expect(() => store._db.prepare(`
        INSERT INTO audit_records
          (id, approval_id, action_type, method, decision_allowed, decision_reason,
           decision_message, approver_identity, timestamp, verdicts, pass_check)
        VALUES ('dup-id', ?, 'repo-creation', 'vote', 1, 'allowed', '', 'y', '', '[]', 1)
      `).run(p.id)).toThrow(/UNIQUE/);
    });

    it('listPending breaks same-timestamp ties by insertion order, newest first', () => {
      const ts = '2026-07-07T12:00:00.000Z';
      const insert = store._db.prepare(`
        INSERT INTO pending_approvals (id, action_type, action_context, requested_at, requested_by, status, mode)
        VALUES (?, 'repo-creation', '{}', ?, 'a', 'pending', 'multi-agent-vote')
      `);
      insert.run('first', ts);
      insert.run('second', ts);
      insert.run('third', ts);
      expect(store.listPending().map(p => p.id)).toEqual(['third', 'second', 'first']);
    });

    it('stores rejection correctly', () => {
      const p = store.createPending('destructive-op', {}, 'agent', 'human-gate');
      store.resolveApproval(p.id, {
        approvalId: p.id, actionType: 'destructive-op', method: 'dashboard-click',
        decision: { allowed: false, reason: 'human_rejected', message: 'Not now' },
        approverIdentity: 'mathew', timestamp: new Date().toISOString(),
        verdicts: [{ identity: 'mathew', approve: false, reasoning: 'Not now' }],
        passCheck: false,
      });

      const rec = store.getAuditRecord(p.id);
      expect(rec.decision.allowed).toBe(false);
      expect(rec.decision.reason).toBe('human_rejected');
      expect(rec.passCheck).toBe(false);
    });
  });

  describe('listAuditRecords', () => {
    it('returns all audit records when no filter', () => {
      const p1 = store.createPending('repo-creation', {}, 'a', 'multi-agent-vote');
      const p2 = store.createPending('pr-merge', {}, 'b', 'agent-quorum');
      const baseAudit = (id, type) => ({
        approvalId: id, actionType: type, method: 'vote',
        decision: { allowed: true, reason: 'allowed', message: '' },
        approverIdentity: 'x', timestamp: new Date().toISOString(), verdicts: [], passCheck: true,
      });
      store.resolveApproval(p1.id, baseAudit(p1.id, 'repo-creation'));
      store.resolveApproval(p2.id, baseAudit(p2.id, 'pr-merge'));
      expect(store.listAuditRecords()).toHaveLength(2);
    });

    it('filters by actionType', () => {
      const p = store.createPending('repo-creation', {}, 'a', 'multi-agent-vote');
      store.resolveApproval(p.id, {
        approvalId: p.id, actionType: 'repo-creation', method: 'vote',
        decision: { allowed: true, reason: 'allowed', message: '' },
        approverIdentity: 'x', timestamp: new Date().toISOString(), verdicts: [], passCheck: true,
      });
      expect(store.listAuditRecords({ actionType: 'repo-creation' })).toHaveLength(1);
      expect(store.listAuditRecords({ actionType: 'pr-merge' })).toHaveLength(0);
    });
  });
});
