/**
 * Unit tests for the three approval mode evaluators.
 * These are pure functions — no I/O, no store.
 */
import { describe, expect, it } from 'vitest';
import { ALLOW } from '../types.mjs';
import { evaluate as evaluateHumanGate } from '../modes/human-gate.mjs';
import { evaluate as evaluateAgentQuorum } from '../modes/agent-quorum.mjs';
import { evaluate as evaluateMultiAgentVote } from '../modes/multi-agent-vote.mjs';

// ---------------------------------------------------------------------------
// human-gate
// ---------------------------------------------------------------------------

describe('human-gate', () => {
  const config = { mode: 'human-gate', enabled: true, options: {} };
  const disabledConfig = { mode: 'human-gate', enabled: false, options: {} };

  it('approve → allowed decision, dashboard-click method, passCheck true', () => {
    const result = evaluateHumanGate(
      { approve: true, note: 'LGTM', approverIdentity: 'mathew' },
      config
    );
    expect(result.decision).toEqual(ALLOW);
    expect(result.method).toBe('dashboard-click');
    expect(result.passCheck).toBe(true);
    expect(result.verdicts).toHaveLength(1);
    expect(result.verdicts[0].approve).toBe(true);
  });

  it('reject → denied decision, passCheck false', () => {
    const result = evaluateHumanGate(
      { approve: false, note: 'Not now', approverIdentity: 'mathew' },
      config
    );
    expect(result.decision.allowed).toBe(false);
    expect(result.decision.reason).toBe('human_rejected');
    expect(result.decision.message).toBe('Not now');
    expect(result.passCheck).toBe(false);
  });

  it('reject with no note → fallback message', () => {
    const result = evaluateHumanGate(
      { approve: false, approverIdentity: 'mathew' },
      config
    );
    expect(result.decision.message).toBe('Rejected by human reviewer');
  });

  it('mode disabled → mode_disabled reason, passCheck false', () => {
    const result = evaluateHumanGate(
      { approve: true, approverIdentity: 'mathew' },
      disabledConfig
    );
    expect(result.decision.reason).toBe('mode_disabled');
    expect(result.passCheck).toBe(false);
  });

  it('missing approverIdentity → invalid_verdict deny, never throws', () => {
    const result = evaluateHumanGate({ approve: true }, config);
    expect(result.decision.allowed).toBe(false);
    expect(result.decision.reason).toBe('invalid_verdict');
    expect(result.passCheck).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// agent-quorum
// ---------------------------------------------------------------------------

describe('agent-quorum', () => {
  // threshold 0.6: 2/3 = 0.667 >= 0.6 → passes; 1/3 = 0.333 < 0.6 → fails
  const config = {
    mode: 'agent-quorum',
    enabled: true,
    options: { quorumSize: 3, passThreshold: 0.6 },
  };

  const v = (id, approve, reasoning = '') => ({ identity: id, approve, reasoning });

  it('2 of 3 approve at threshold 0.6 (2/3=0.667≥0.6) → ALLOW', () => {
    const result = evaluateAgentQuorum([v('a', true), v('b', true), v('c', false)], config);
    expect(result.decision).toEqual(ALLOW);
    expect(result.passCheck).toBe(true);
    expect(result.method).toBe('quorum');
  });

  it('1 of 3 approve → quorum_failed', () => {
    const result = evaluateAgentQuorum([v('a', true), v('b', false), v('c', false)], config);
    expect(result.decision.allowed).toBe(false);
    expect(result.decision.reason).toBe('quorum_failed');
    expect(result.passCheck).toBe(false);
  });

  it('all approve → ALLOW', () => {
    const result = evaluateAgentQuorum([v('a', true), v('b', true), v('c', true)], config);
    expect(result.decision).toEqual(ALLOW);
  });

  it('0.5 threshold: 2 of 4 approve → ALLOW (2/4=0.5≥0.5)', () => {
    const cfg = { ...config, options: { quorumSize: 4, passThreshold: 0.5 } };
    const result = evaluateAgentQuorum([v('a', true), v('b', true), v('c', false), v('d', false)], cfg);
    expect(result.passCheck).toBe(true);
  });

  it('all verdicts stored in audit record', () => {
    const verdicts = [v('a', true, 'ok'), v('b', false, 'nope'), v('c', true, 'yes')];
    const result = evaluateAgentQuorum(verdicts, config);
    expect(result.verdicts).toHaveLength(3);
    expect(result.verdicts[1].reasoning).toBe('nope');
  });

  it('disabled config → mode_disabled', () => {
    const result = evaluateAgentQuorum([v('a', true)], { ...config, enabled: false });
    expect(result.decision.reason).toBe('mode_disabled');
  });

  // --- completeness / config guards (fail-closed) ---

  it('quorumSize 0 → invalid_config deny (no Infinity pass)', () => {
    const cfg = { ...config, options: { quorumSize: 0, passThreshold: 0.6 } };
    const result = evaluateAgentQuorum([], cfg);
    expect(result.decision.allowed).toBe(false);
    expect(result.decision.reason).toBe('invalid_config');
    expect(result.passCheck).toBe(false);
  });

  it('fewer verdicts than quorumSize → incomplete_quorum deny', () => {
    const result = evaluateAgentQuorum([v('a', true), v('b', true)], config);
    expect(result.decision.reason).toBe('incomplete_quorum');
    expect(result.passCheck).toBe(false);
  });

  it('duplicate identities → incomplete_quorum deny (no ratio inflation)', () => {
    const result = evaluateAgentQuorum([v('a', true), v('a', true), v('a', true)], config);
    expect(result.decision.reason).toBe('incomplete_quorum');
    expect(result.passCheck).toBe(false);
  });

  it('more verdicts than quorumSize → incomplete_quorum deny', () => {
    const result = evaluateAgentQuorum(
      [v('a', true), v('b', true), v('c', true), v('d', true)],
      config
    );
    expect(result.decision.reason).toBe('incomplete_quorum');
  });
});

// ---------------------------------------------------------------------------
// multi-agent-vote
// ---------------------------------------------------------------------------

describe('multi-agent-vote', () => {
  const config = {
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
  };

  const v = (id, approve, reasoning = '', hardVeto = false) => ({ identity: id, approve, reasoning, hardVeto });

  it('3 of 4 approve, no hard veto → ALLOW', () => {
    const result = evaluateMultiAgentVote(
      [v('duplication-scout', true), v('fit-check', true), v('tech-scout', true), v('product-owner', false)],
      config
    );
    expect(result.decision).toEqual(ALLOW);
    expect(result.passCheck).toBe(true);
    expect(result.method).toBe('vote');
  });

  it('hard veto from duplication-scout → hard_veto regardless of other votes', () => {
    const result = evaluateMultiAgentVote(
      [
        v('duplication-scout', false, 'exact duplicate exists', true),
        v('fit-check', true), v('tech-scout', true), v('product-owner', true),
      ],
      config
    );
    expect(result.decision.reason).toBe('hard_veto');
    expect(result.decision.message).toContain('duplication-scout');
    expect(result.passCheck).toBe(false);
  });

  it('2 of 4 approve, no hard veto → vote_failed', () => {
    const result = evaluateMultiAgentVote(
      [v('duplication-scout', true), v('fit-check', false), v('tech-scout', true), v('product-owner', false)],
      config
    );
    expect(result.decision.reason).toBe('vote_failed');
    expect(result.passCheck).toBe(false);
  });

  it('hardVetoBlocks:false — hard-veto flag is ignored, minApprove rule applies', () => {
    const cfg = {
      ...config,
      options: { ...config.options, passRule: { minApprove: 2, hardVetoBlocks: false } },
    };
    const result = evaluateMultiAgentVote(
      [
        v('duplication-scout', false, 'dup', true), // would veto if hardVetoBlocks were on
        v('fit-check', true), v('tech-scout', true), v('product-owner', false),
      ],
      cfg
    );
    expect(result.decision).toEqual(ALLOW);
    expect(result.passCheck).toBe(true);
  });

  it('all verdicts preserved in audit output', () => {
    const verdicts = [
      v('duplication-scout', true, 'r1'), v('fit-check', true, 'r2'),
      v('tech-scout', true, 'r3'), v('product-owner', false, 'r4'),
    ];
    const result = evaluateMultiAgentVote(verdicts, config);
    expect(result.verdicts).toHaveLength(4);
    expect(result.verdicts[3].reasoning).toBe('r4');
  });

  it('disabled config → mode_disabled', () => {
    const result = evaluateMultiAgentVote([v('a', true)], { ...config, enabled: false });
    expect(result.decision.reason).toBe('mode_disabled');
  });

  // --- panel completeness (fail-closed: absence-of-vote ≠ absence-of-veto) ---

  it('missing hard-veto lens → incomplete_panel deny, NOT a pass', () => {
    // duplication-scout (the only canHardVeto lens) did not vote; the other
    // three approve. minApprove:3 is numerically met — but the vote must fail.
    const result = evaluateMultiAgentVote(
      [v('fit-check', true), v('tech-scout', true), v('product-owner', true)],
      config
    );
    expect(result.decision.allowed).toBe(false);
    expect(result.decision.reason).toBe('incomplete_panel');
    expect(result.decision.message).toContain('duplication-scout');
    expect(result.passCheck).toBe(false);
  });

  it('verdict from an unknown lens → incomplete_panel deny', () => {
    const result = evaluateMultiAgentVote(
      [
        v('duplication-scout', true), v('fit-check', true),
        v('tech-scout', true), v('intruder', true),
      ],
      config
    );
    expect(result.decision.reason).toBe('incomplete_panel');
    expect(result.decision.message).toContain('intruder');
  });

  it('duplicate lens verdicts → incomplete_panel deny', () => {
    const result = evaluateMultiAgentVote(
      [
        v('duplication-scout', true), v('duplication-scout', true),
        v('fit-check', true), v('tech-scout', true), v('product-owner', true),
      ],
      config
    );
    expect(result.decision.reason).toBe('incomplete_panel');
    expect(result.decision.message).toContain('duplicate');
  });

  it('hardVeto from a non-veto-capable lens counts as a plain reject', () => {
    // fit-check is not canHardVeto; its hardVeto flag must not block a 3/4 pass.
    const result = evaluateMultiAgentVote(
      [
        v('duplication-scout', true), v('fit-check', false, 'fold it in', true),
        v('tech-scout', true), v('product-owner', true),
      ],
      config
    );
    expect(result.decision).toEqual(ALLOW);
    expect(result.passCheck).toBe(true);
  });
});
