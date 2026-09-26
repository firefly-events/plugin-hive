/**
 * agent-quorum mode: N agents each review and return a reasoned verdict.
 * Passes when (approveCount / quorumSize) >= passThreshold.
 *
 * Every reasoning string is stored verbatim in the audit record.
 */

import { ALLOW, AUDIT_METHODS, deny } from '../types.mjs';

/**
 * @param {import('../types.mjs').VerdictEntry[]} verdicts
 *   One entry per agent consulted. identity = agent id or role name.
 * @param {import('../types.mjs').ModeConfig} config
 *   config.options must satisfy AgentQuorumOptions.
 * @returns {{
 *   decision: import('../types.mjs').Decision,
 *   method: string,
 *   approverIdentity: string,
 *   verdicts: import('../types.mjs').VerdictEntry[],
 *   passCheck: boolean
 * }}
 */
export function evaluate(verdicts, config) {
  if (!config.enabled) {
    return {
      decision: deny('mode_disabled', 'agent-quorum mode is currently disabled'),
      method: AUDIT_METHODS.QUORUM,
      approverIdentity: 'quorum',
      verdicts,
      passCheck: false,
    };
  }

  const opts = config.options ?? {};
  const quorumSize = opts.quorumSize ?? 3;
  const passThreshold = opts.passThreshold ?? 0.67;

  if (!Number.isInteger(quorumSize) || quorumSize < 1) {
    return {
      decision: deny('invalid_config', `quorumSize must be a positive integer (got ${quorumSize})`),
      method: AUDIT_METHODS.QUORUM,
      approverIdentity: 'quorum',
      verdicts,
      passCheck: false,
    };
  }

  // Completeness guard: fewer verdicts than the quorum must not pass by ratio
  // luck, and extra/duplicate verdicts must not inflate the numerator past the
  // denominator. The engine pre-validates this; direct callers fail closed here.
  const identities = verdicts.map(v => v.identity);
  if (verdicts.length !== quorumSize || new Set(identities).size !== identities.length) {
    return {
      decision: deny(
        'incomplete_quorum',
        `Quorum rejected — expected exactly ${quorumSize} distinct verdicts, got ${verdicts.length}`
      ),
      method: AUDIT_METHODS.QUORUM,
      approverIdentity: 'quorum',
      verdicts,
      passCheck: false,
    };
  }

  const approveCount = verdicts.filter(v => v.approve).length;
  // Ratio comparison avoids ceiling rounding surprises (e.g. ceil(3×0.67)=3
  // would require unanimity; instead 2/3 = 0.667 passes a 0.6 threshold cleanly).
  const passCheck = approveCount / quorumSize >= passThreshold;

  const approvers = verdicts.filter(v => v.approve).map(v => v.identity);
  const rejecters = verdicts.filter(v => !v.approve).map(v => v.identity);

  const thresholdPct = Math.round(passThreshold * 100);
  const decision = passCheck
    ? ALLOW
    : deny(
        'quorum_failed',
        `Quorum not reached: ${approveCount}/${quorumSize} approved (required ≥${thresholdPct}%). Rejected by: ${rejecters.join(', ')}`
      );

  return {
    decision,
    method: AUDIT_METHODS.QUORUM,
    approverIdentity: passCheck ? approvers.join(', ') : rejecters.join(', '),
    verdicts,
    passCheck,
  };
}
