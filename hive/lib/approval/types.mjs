/**
 * Approval engine core types.
 *
 * Decision shape mirrors multica packages/core/permissions/types.ts so that
 * approval records are structurally compatible with the workspace permission
 * layer and the dashboard can render them with the same machinery.
 *
 * Field mapping from design shorthand to canonical names:
 *   allow  → allowed
 *   reason → reason
 *   copy   → message
 */

/** @typedef {{ allowed: boolean, reason: string, message: string }} Decision */

export const ALLOW = Object.freeze({ allowed: true, reason: 'allowed', message: '' });

/**
 * @param {string} reason
 * @param {string} message
 * @returns {Decision}
 */
export function deny(reason, message) {
  return { allowed: false, reason, message };
}

/** Canonical approval mode identifiers. */
export const MODES = Object.freeze({
  HUMAN_GATE: 'human-gate',
  AGENT_QUORUM: 'agent-quorum',
  MULTI_AGENT_VOTE: 'multi-agent-vote',
});

/** How an approval was resolved — recorded in the audit trail. */
export const AUDIT_METHODS = Object.freeze({
  DASHBOARD_CLICK: 'dashboard-click',
  QUORUM: 'quorum',
  VOTE: 'vote',
});

/**
 * @typedef {Object} AgentLens
 * @property {string}  id           - Lens identifier (e.g. 'duplication-scout')
 * @property {string}  description  - What this lens evaluates
 * @property {boolean} canHardVeto  - Whether a reject from this lens blocks regardless of other votes
 */

/**
 * @typedef {Object} HumanGateOptions
 * @property {string} [defaultNote] - Optional default note text surfaced in the dashboard UI
 */

/**
 * @typedef {Object} AgentQuorumOptions
 * @property {number}   quorumSize     - Number of agents to consult (N)
 * @property {number}   passThreshold  - Fraction of approve votes required (0–1, e.g. 0.67)
 * @property {string[]} [agentRoles]   - Agent persona names to dispatch; falls back to 'reviewer'
 */

/**
 * @typedef {Object} PassRule
 * @property {number}  minApprove      - Minimum approve votes required
 * @property {boolean} hardVetoBlocks  - Whether any hard-veto lens auto-rejects regardless
 */

/**
 * @typedef {Object} MultiAgentVoteOptions
 * @property {AgentLens[]} panel    - Distinct reviewer lenses
 * @property {PassRule}    passRule - How to evaluate the collected votes
 */

/**
 * @typedef {Object} ModeConfig
 * @property {'human-gate'|'agent-quorum'|'multi-agent-vote'} mode
 * @property {boolean} enabled
 * @property {HumanGateOptions|AgentQuorumOptions|MultiAgentVoteOptions} [options]
 */

/**
 * @typedef {Object} ActionConfig
 * @property {string}     actionType
 * @property {ModeConfig} modeConfig
 */

/**
 * @typedef {Object} PendingApproval
 * @property {string} id
 * @property {string} actionType
 * @property {object} actionContext
 * @property {string} requestedAt   - ISO 8601
 * @property {string} requestedBy   - Identity (agent-id, user-id, etc.)
 * @property {'pending'|'resolved'} status
 * @property {'human-gate'|'agent-quorum'|'multi-agent-vote'} mode
 */

/**
 * @typedef {Object} VerdictEntry
 * @property {string}  identity   - Who gave this verdict (agent id, lens id, user id)
 * @property {boolean} approve
 * @property {string}  reasoning
 * @property {boolean} [hardVeto] - Only meaningful in multi-agent-vote; signals a blocking rejection
 */

/**
 * @typedef {Object} AuditRecord
 * @property {string}          id
 * @property {string}          approvalId        - References PendingApproval.id
 * @property {string}          actionType
 * @property {'dashboard-click'|'quorum'|'vote'} method
 * @property {Decision}        decision
 * @property {string}          approverIdentity  - Primary approver or comma-separated quorum members
 * @property {string}          timestamp         - ISO 8601
 * @property {VerdictEntry[]}  verdicts          - All individual verdicts collected
 * @property {boolean}         passCheck         - Whether the configured pass rule was satisfied
 */
