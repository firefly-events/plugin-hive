/**
 * human-gate mode: one human Approve/Reject via the dashboard.
 *
 * evaluate() is called when the dashboard submit fires, carrying the single
 * human verdict. The result is fed directly into ApprovalStore.resolveApproval().
 */

import { ALLOW, AUDIT_METHODS, deny } from '../types.mjs';

/**
 * @param {{ approve: boolean, note?: string, approverIdentity: string }} verdict
 *   Single human verdict from the dashboard.
 * @param {import('../types.mjs').ModeConfig} config
 * @returns {{
 *   decision: import('../types.mjs').Decision,
 *   method: string,
 *   approverIdentity: string,
 *   verdicts: import('../types.mjs').VerdictEntry[],
 *   passCheck: boolean
 * }}
 */
export function evaluate(verdict, config) {
  if (!config.enabled) {
    return {
      decision: deny('mode_disabled', 'human-gate mode is currently disabled'),
      method: AUDIT_METHODS.DASHBOARD_CLICK,
      approverIdentity: verdict.approverIdentity ?? 'unknown',
      verdicts: [],
      passCheck: false,
    };
  }

  // An unidentified approver cannot gate an action — the audit record's whole
  // point is provenance. The engine pre-validates this; fail closed regardless.
  if (typeof verdict.approverIdentity !== 'string' || verdict.approverIdentity.length === 0) {
    return {
      decision: deny('invalid_verdict', 'An identified approver is required to resolve a human-gate approval'),
      method: AUDIT_METHODS.DASHBOARD_CLICK,
      approverIdentity: 'unknown',
      verdicts: [],
      passCheck: false,
    };
  }

  const decision = verdict.approve
    ? ALLOW
    : deny('human_rejected', verdict.note || 'Rejected by human reviewer');

  return {
    decision,
    method: AUDIT_METHODS.DASHBOARD_CLICK,
    approverIdentity: verdict.approverIdentity,
    verdicts: [{
      identity: verdict.approverIdentity,
      approve: verdict.approve,
      reasoning: verdict.note ?? '',
    }],
    passCheck: verdict.approve,
  };
}
