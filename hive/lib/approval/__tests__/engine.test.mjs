/**
 * End-to-end tests for ApprovalEngine with an in-memory store.
 * Tests the full request → submit → audit lifecycle for all three modes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalEngine } from '../engine.mjs';
import { ApprovalStore } from '../store.mjs';
import { register, setEnabled, lookup, shippedConfigs } from '../config-registry.mjs';
import { ALLOW } from '../types.mjs';

function makeEngine() {
  return new ApprovalEngine(new ApprovalStore(':memory:'));
}

const TS = '2026-07-07T12:00:00.000Z';

// ---------------------------------------------------------------------------
// human-gate lifecycle
// ---------------------------------------------------------------------------

describe('ApprovalEngine — human-gate', () => {
  let engine;

  beforeEach(() => {
    engine = makeEngine();
    register('destructive-op', { mode: 'human-gate', enabled: true, options: {} });
  });

  afterEach(() => {
    engine._store.close();
  });

  it('request creates a pending approval with correct mode', () => {
    const result = engine.request('destructive-op', { target: 'db' }, 'agent-1');
    expect('error' in result).toBe(false);
    expect(result.pending.mode).toBe('human-gate');
    expect(result.pending.status).toBe('pending');
  });

  it('submit approve → audit record with allowed=true, passCheck=true', () => {
    const { pending } = engine.request('destructive-op', { target: 'db' }, 'agent-1');
    const result = engine.submit(
      pending.id,
      { approve: true, note: 'OK', approverIdentity: 'mathew' },
      TS
    );
    expect('error' in result).toBe(false);
    const rec = result.auditRecord;
    expect(rec.decision).toEqual(ALLOW);
    expect(rec.passCheck).toBe(true);
    expect(rec.method).toBe('dashboard-click');
    expect(rec.approverIdentity).toBe('mathew');
    expect(rec.verdicts[0].reasoning).toBe('OK');
  });

  it('submit reject → audit record with allowed=false', () => {
    const { pending } = engine.request('destructive-op', {}, 'agent-1');
    const { auditRecord } = engine.submit(
      pending.id,
      { approve: false, note: 'Too risky', approverIdentity: 'mathew' },
      TS
    );
    expect(auditRecord.decision.allowed).toBe(false);
    expect(auditRecord.decision.reason).toBe('human_rejected');
    expect(auditRecord.passCheck).toBe(false);
  });

  it('getPending after submit → status resolved', () => {
    const { pending } = engine.request('destructive-op', {}, 'agent-1');
    engine.submit(pending.id, { approve: true, approverIdentity: 'mathew' }, TS);
    expect(engine.getPending(pending.id).status).toBe('resolved');
  });

  it('double-submit → already_resolved error', () => {
    const { pending } = engine.request('destructive-op', {}, 'agent-1');
    engine.submit(pending.id, { approve: true, approverIdentity: 'mathew' }, TS);
    const result = engine.submit(pending.id, { approve: true, approverIdentity: 'mathew' }, TS);
    expect(result.error.reason).toBe('already_resolved');
  });

  it('request with unknown action type → no_config error', () => {
    const result = engine.request('unknown-action', {}, 'agent-1');
    expect(result.error.reason).toBe('no_config');
  });

  it('getAuditRecord round-trips correctly', () => {
    const { pending } = engine.request('destructive-op', { payload: 42 }, 'agent-1');
    const { auditRecord } = engine.submit(
      pending.id,
      { approve: true, approverIdentity: 'mathew' },
      TS
    );
    expect(engine.getAuditRecord(pending.id)).toEqual(auditRecord);
  });
});

// ---------------------------------------------------------------------------
// agent-quorum lifecycle
// ---------------------------------------------------------------------------

describe('ApprovalEngine — agent-quorum', () => {
  let engine;

  beforeEach(() => {
    engine = makeEngine();
    register('pr-merge', {
      mode: 'agent-quorum',
      enabled: true,
      options: { quorumSize: 3, passThreshold: 0.6 },
    });
  });

  afterEach(() => {
    engine._store.close();
  });

  it('2/3 approve → allowed audit record', () => {
    const { pending } = engine.request('pr-merge', { pr: 99 }, 'agent-dispatch');
    const verdicts = [
      { identity: 'reviewer', approve: true, reasoning: 'LGTM' },
      { identity: 'peer-validator', approve: true, reasoning: 'Clean' },
      { identity: 'security-reviewer', approve: false, reasoning: 'Needs fix' },
    ];
    const { auditRecord } = engine.submit(pending.id, verdicts, TS);
    expect(auditRecord.decision).toEqual(ALLOW);
    expect(auditRecord.passCheck).toBe(true);
    expect(auditRecord.method).toBe('quorum');
    expect(auditRecord.verdicts).toHaveLength(3);
  });

  it('0/3 approve → quorum_failed', () => {
    const { pending } = engine.request('pr-merge', { pr: 99 }, 'agent-dispatch');
    const verdicts = [
      { identity: 'a', approve: false, reasoning: 'no' },
      { identity: 'b', approve: false, reasoning: 'no' },
      { identity: 'c', approve: false, reasoning: 'no' },
    ];
    const { auditRecord } = engine.submit(pending.id, verdicts, TS);
    expect(auditRecord.decision.reason).toBe('quorum_failed');
    expect(auditRecord.passCheck).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// multi-agent-vote lifecycle
// ---------------------------------------------------------------------------

describe('ApprovalEngine — multi-agent-vote', () => {
  let engine;

  beforeEach(() => {
    engine = makeEngine();
    register('repo-creation', {
      mode: 'multi-agent-vote',
      enabled: true,
      options: {
        panel: [
          { id: 'duplication-scout', description: '...', canHardVeto: true },
          { id: 'fit-check', description: '...', canHardVeto: false },
          { id: 'tech-scout', description: '...', canHardVeto: false },
          { id: 'product-owner', description: '...', canHardVeto: false },
        ],
        passRule: { minApprove: 3, hardVetoBlocks: true },
      },
    });
  });

  afterEach(() => {
    engine._store.close();
  });

  it('3/4 approve, no hard veto → allowed', () => {
    const { pending } = engine.request('repo-creation', { name: 'my-lib' }, 'agent');
    const verdicts = [
      { identity: 'duplication-scout', approve: true, reasoning: 'unique' },
      { identity: 'fit-check', approve: true, reasoning: 'standalone ok' },
      { identity: 'tech-scout', approve: true, reasoning: 'no lib' },
      { identity: 'product-owner', approve: false, reasoning: 'meh' },
    ];
    const { auditRecord } = engine.submit(pending.id, verdicts, TS);
    expect(auditRecord.decision).toEqual(ALLOW);
    expect(auditRecord.passCheck).toBe(true);
    expect(auditRecord.method).toBe('vote');
  });

  it('hard veto from duplication-scout → hard_veto, overrides 3 approvals', () => {
    const { pending } = engine.request('repo-creation', { name: 'my-lib' }, 'agent');
    const verdicts = [
      { identity: 'duplication-scout', approve: false, reasoning: 'already exists', hardVeto: true },
      { identity: 'fit-check', approve: true, reasoning: 'ok' },
      { identity: 'tech-scout', approve: true, reasoning: 'ok' },
      { identity: 'product-owner', approve: true, reasoning: 'ok' },
    ];
    const { auditRecord } = engine.submit(pending.id, verdicts, TS);
    expect(auditRecord.decision.reason).toBe('hard_veto');
    expect(auditRecord.decision.message).toContain('duplication-scout');
    expect(auditRecord.passCheck).toBe(false);
    expect(auditRecord.approverIdentity).toBe('duplication-scout');
  });

  it('2/4 approve, no hard veto → vote_failed', () => {
    const { pending } = engine.request('repo-creation', { name: 'my-lib' }, 'agent');
    const verdicts = [
      { identity: 'duplication-scout', approve: true, reasoning: 'ok' },
      { identity: 'fit-check', approve: true, reasoning: 'ok' },
      { identity: 'tech-scout', approve: false, reasoning: 'use npm' },
      { identity: 'product-owner', approve: false, reasoning: 'unnecessary' },
    ];
    const { auditRecord } = engine.submit(pending.id, verdicts, TS);
    expect(auditRecord.decision.reason).toBe('vote_failed');
    expect(auditRecord.passCheck).toBe(false);
  });

  it('missing hard-veto lens with 3 approvals → incomplete_panel error, approval stays pending', () => {
    // The bypass scenario: duplication-scout (the hard-veto lens) never voted,
    // the other three approve. This must NOT create the repo.
    const { pending } = engine.request('repo-creation', { name: 'my-lib' }, 'agent');
    const result = engine.submit(pending.id, [
      { identity: 'fit-check', approve: true, reasoning: 'ok' },
      { identity: 'tech-scout', approve: true, reasoning: 'ok' },
      { identity: 'product-owner', approve: true, reasoning: 'ok' },
    ], TS);
    expect(result.error.reason).toBe('incomplete_panel');
    expect(result.error.message).toContain('duplication-scout');
    // Not consumed — the dispatcher can re-collect and resubmit the full panel.
    expect(engine.getPending(pending.id).status).toBe('pending');
    expect(engine.getAuditRecord(pending.id)).toBeNull();
  });

  it('verdict from an off-panel identity → invalid_verdict error, approval stays pending', () => {
    const { pending } = engine.request('repo-creation', {}, 'agent');
    const result = engine.submit(pending.id, [
      { identity: 'duplication-scout', approve: true, reasoning: 'ok' },
      { identity: 'fit-check', approve: true, reasoning: 'ok' },
      { identity: 'tech-scout', approve: true, reasoning: 'ok' },
      { identity: 'intruder', approve: true, reasoning: 'ok' },
    ], TS);
    expect(result.error.reason).toBe('invalid_verdict');
    expect(engine.getPending(pending.id).status).toBe('pending');
  });

  it('listPending and listAuditRecords reflect completed approvals', () => {
    const { pending } = engine.request('repo-creation', {}, 'agent');
    expect(engine.listPending({ status: 'pending' })).toHaveLength(1);

    const verdicts = [
      { identity: 'duplication-scout', approve: true, reasoning: 'ok' },
      { identity: 'fit-check', approve: true, reasoning: 'ok' },
      { identity: 'tech-scout', approve: true, reasoning: 'ok' },
      { identity: 'product-owner', approve: false, reasoning: 'meh' },
    ];
    engine.submit(pending.id, verdicts, TS);

    expect(engine.listPending({ status: 'pending' })).toHaveLength(0);
    expect(engine.listPending({ status: 'resolved' })).toHaveLength(1);
    expect(engine.listAuditRecords({ actionType: 'repo-creation' })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Config registry integration
// ---------------------------------------------------------------------------

describe('ApprovalEngine — config registry', () => {
  let engine;

  beforeEach(() => {
    engine = makeEngine();
  });

  afterEach(() => {
    engine._store.close();
  });

  it('setEnabled(false) makes request return mode_disabled error', () => {
    setEnabled('destructive-op', false);
    const result = engine.request('destructive-op', {}, 'agent');
    expect(result.error.reason).toBe('mode_disabled');
    // restore
    setEnabled('destructive-op', true);
  });

  it('submit returns not_found for a non-existent approvalId', () => {
    const result = engine.submit('00000000-0000-0000-0000-000000000000', [], TS);
    expect(result.error.reason).toBe('not_found');
  });

  it('shippedConfigs() is deep-frozen and mutating it cannot reconfigure the registry', () => {
    const shipped = shippedConfigs();
    const repoCreation = shipped.find(c => c.actionType === 'repo-creation');
    expect(Object.isFrozen(shipped)).toBe(true);
    expect(Object.isFrozen(repoCreation.modeConfig)).toBe(true);
    expect(() => { repoCreation.modeConfig.enabled = false; }).toThrow(TypeError);
    expect(lookup('repo-creation').enabled).toBe(true);
  });

  it('setEnabled on the registry does not mutate the shipped examples', () => {
    setEnabled('pr-merge', false);
    expect(shippedConfigs().find(c => c.actionType === 'pr-merge').modeConfig.enabled).toBe(true);
    setEnabled('pr-merge', true);
  });
});

// ---------------------------------------------------------------------------
// Verdict validation — malformed submissions never throw, never resolve
// ---------------------------------------------------------------------------

describe('ApprovalEngine — verdict validation', () => {
  let engine;

  beforeEach(() => {
    engine = makeEngine();
    register('destructive-op', { mode: 'human-gate', enabled: true, options: {} });
    register('pr-merge', {
      mode: 'agent-quorum',
      enabled: true,
      options: { quorumSize: 3, passThreshold: 0.6 },
    });
  });

  afterEach(() => {
    engine._store.close();
  });

  it('human-gate verdict without approverIdentity → invalid_verdict error, no throw, still pending', () => {
    const { pending } = engine.request('destructive-op', {}, 'agent-1');
    const result = engine.submit(pending.id, { approve: true, note: 'ok' }, TS);
    expect(result.error.reason).toBe('invalid_verdict');
    expect(engine.getPending(pending.id).status).toBe('pending');
  });

  it('human-gate verdict without boolean approve → invalid_verdict error', () => {
    const { pending } = engine.request('destructive-op', {}, 'agent-1');
    const result = engine.submit(pending.id, { approve: 'yes', approverIdentity: 'mathew' }, TS);
    expect(result.error.reason).toBe('invalid_verdict');
  });

  it('quorum with fewer verdicts than quorumSize → incomplete_quorum error, still pending', () => {
    const { pending } = engine.request('pr-merge', { pr: 1 }, 'agent');
    const result = engine.submit(pending.id, [
      { identity: 'reviewer', approve: true, reasoning: 'ok' },
      { identity: 'peer-validator', approve: true, reasoning: 'ok' },
    ], TS);
    expect(result.error.reason).toBe('incomplete_quorum');
    expect(engine.getPending(pending.id).status).toBe('pending');
  });

  it('quorum with duplicate identities → invalid_verdict error (no ratio inflation)', () => {
    const { pending } = engine.request('pr-merge', { pr: 1 }, 'agent');
    const result = engine.submit(pending.id, [
      { identity: 'reviewer', approve: true, reasoning: 'ok' },
      { identity: 'reviewer', approve: true, reasoning: 'ok' },
      { identity: 'reviewer', approve: true, reasoning: 'ok' },
    ], TS);
    expect(result.error.reason).toBe('invalid_verdict');
  });

  it('non-array verdicts for quorum → invalid_verdict error', () => {
    const { pending } = engine.request('pr-merge', { pr: 1 }, 'agent');
    const result = engine.submit(pending.id, { approve: true, approverIdentity: 'x' }, TS);
    expect(result.error.reason).toBe('invalid_verdict');
  });
});
