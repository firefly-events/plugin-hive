/**
 * ApprovalEngine — main facade for the approval system.
 *
 * Orchestrates the config registry, mode evaluators, and durable store.
 * Stage 2 (dashboard micro-frontend) and Stage 3 (MCP/web fallback) both
 * consume this surface; neither calls the store or mode evaluators directly.
 *
 * Typical lifecycle:
 *   1. engine.request(actionType, context, requestedBy) → { pending, modeConfig }
 *   2. Platform delivers the pending approval to the appropriate resolver
 *      (dashboard for human-gate, agent dispatch for quorum/vote).
 *   3. engine.submit(approvalId, verdicts, timestamp) → { auditRecord }
 */

import { lookup } from './config-registry.mjs';
import { MODES, deny } from './types.mjs';
import { evaluate as evaluateHumanGate } from './modes/human-gate.mjs';
import { evaluate as evaluateAgentQuorum } from './modes/agent-quorum.mjs';
import { evaluate as evaluateMultiAgentVote } from './modes/multi-agent-vote.mjs';
import { ApprovalStore } from './store.mjs';

export class ApprovalEngine {
  /**
   * @param {ApprovalStore} store
   */
  constructor(store) {
    this._store = store;
  }

  // ---------------------------------------------------------------------------
  // Write path
  // ---------------------------------------------------------------------------

  /**
   * Initiate an approval request for a named action type.
   *
   * Returns an error Decision (not a thrown error) when the action type has no
   * config or the mode is disabled — callers can treat this as a gate failure.
   *
   * @param {string} actionType
   * @param {object} actionContext - The action's payload; stored verbatim in the record
   * @param {string} requestedBy  - Identity of the requesting agent or user
   * @returns {
   *   { pending: import('./types.mjs').PendingApproval, modeConfig: import('./types.mjs').ModeConfig }
   *   | { error: import('./types.mjs').Decision }
   * }
   */
  request(actionType, actionContext, requestedBy) {
    const modeConfig = lookup(actionType);
    if (!modeConfig) {
      return { error: deny('no_config', `No approval config registered for action type: ${actionType}`) };
    }
    if (!modeConfig.enabled) {
      return { error: deny('mode_disabled', `Approval mode is disabled for action type: ${actionType}`) };
    }
    const pending = this._store.createPending(actionType, actionContext, requestedBy, modeConfig.mode);
    return { pending, modeConfig };
  }

  /**
   * Submit verdicts for a pending approval and write the immutable audit record.
   *
   * - human-gate:        verdicts is a single { approve, note?, approverIdentity }
   * - agent-quorum:      verdicts is VerdictEntry[]
   * - multi-agent-vote:  verdicts is VerdictEntry[] (entries may carry hardVeto: true)
   *
   * @param {string} approvalId
   * @param {object | import('./types.mjs').VerdictEntry[]} verdicts
   * @param {string} timestamp - ISO 8601 timestamp of when the decision was made
   * @returns {
   *   { auditRecord: import('./types.mjs').AuditRecord }
   *   | { error: import('./types.mjs').Decision }
   * }
   */
  submit(approvalId, verdicts, timestamp) {
    const pending = this._store.getPending(approvalId);
    if (!pending) {
      return { error: deny('not_found', `No pending approval found: ${approvalId}`) };
    }
    if (pending.status === 'resolved') {
      return { error: deny('already_resolved', `Approval ${approvalId} has already been resolved`) };
    }

    const modeConfig = lookup(pending.actionType);
    if (!modeConfig) {
      return { error: deny('no_config', `No config found for action type: ${pending.actionType}`) };
    }

    // Malformed or incomplete submissions must not consume the approval: they
    // return { error } and leave the row pending so the caller can resubmit.
    // A denied *audit record* is reserved for a real, complete judgment.
    const validationError = this._validateVerdicts(pending.mode, verdicts, modeConfig);
    if (validationError) {
      return { error: validationError };
    }

    // Note: mode evaluators re-check modeConfig.enabled themselves. A mode
    // disabled *after* the request was created still resolves here — as a
    // denied ('mode_disabled') audit record, which is the fail-closed intent.
    let evaluation;
    switch (pending.mode) {
      case MODES.HUMAN_GATE:
        evaluation = evaluateHumanGate(verdicts, modeConfig);
        break;
      case MODES.AGENT_QUORUM:
        evaluation = evaluateAgentQuorum(verdicts, modeConfig);
        break;
      case MODES.MULTI_AGENT_VOTE:
        evaluation = evaluateMultiAgentVote(verdicts, modeConfig);
        break;
      default:
        return { error: deny('unknown_mode', `Unknown approval mode: ${pending.mode}`) };
    }

    const auditRecord = this._store.resolveApproval(approvalId, {
      approvalId,
      actionType: pending.actionType,
      method: evaluation.method,
      decision: evaluation.decision,
      approverIdentity: evaluation.approverIdentity,
      timestamp,
      verdicts: evaluation.verdicts,
      passCheck: evaluation.passCheck,
    });

    // The store's status flip is conditional on the row still being 'pending'.
    // If another consumer (dashboard vs MCP fallback) resolved it between our
    // read above and this write, exactly one of us wins; the loser reports it.
    if (!auditRecord) {
      return { error: deny('already_resolved', `Approval ${approvalId} was resolved concurrently by another consumer`) };
    }

    return { auditRecord };
  }

  /**
   * Structural validation of the submitted verdicts for a given mode.
   * Returns a Decision describing the problem, or null when the input is valid.
   *
   * Completeness is enforced here too: a quorum needs exactly quorumSize
   * distinct verdicts, and a vote panel needs exactly one verdict per
   * configured lens — otherwise a dropped hard-veto lens would silently pass
   * (absence-of-vote must never equal absence-of-veto).
   *
   * @param {string} mode
   * @param {object|import('./types.mjs').VerdictEntry[]} verdicts
   * @param {import('./types.mjs').ModeConfig} modeConfig
   * @returns {import('./types.mjs').Decision|null}
   */
  _validateVerdicts(mode, verdicts, modeConfig) {
    const isIdentity = (s) => typeof s === 'string' && s.length > 0;

    if (mode === MODES.HUMAN_GATE) {
      if (!verdicts || typeof verdicts !== 'object' || Array.isArray(verdicts)) {
        return deny('invalid_verdict', 'human-gate expects a single verdict object');
      }
      if (typeof verdicts.approve !== 'boolean') {
        return deny('invalid_verdict', 'Verdict is missing a boolean approve field');
      }
      if (!isIdentity(verdicts.approverIdentity)) {
        return deny('invalid_verdict', 'Verdict is missing approverIdentity');
      }
      return null;
    }

    if (!Array.isArray(verdicts)) {
      return deny('invalid_verdict', `${mode} expects an array of verdict entries`);
    }
    for (const v of verdicts) {
      if (!v || typeof v.approve !== 'boolean' || !isIdentity(v.identity)) {
        return deny('invalid_verdict', 'Each verdict entry needs a non-empty identity and a boolean approve');
      }
    }
    const identities = verdicts.map(v => v.identity);
    if (new Set(identities).size !== identities.length) {
      return deny('invalid_verdict', 'Duplicate verdict identities are not allowed');
    }

    if (mode === MODES.AGENT_QUORUM) {
      const quorumSize = modeConfig.options?.quorumSize ?? 3;
      if (!Number.isInteger(quorumSize) || quorumSize < 1) {
        return deny('invalid_config', `quorumSize must be a positive integer (got ${quorumSize})`);
      }
      if (verdicts.length !== quorumSize) {
        return deny('incomplete_quorum', `Expected exactly ${quorumSize} verdicts, got ${verdicts.length}`);
      }
    }

    if (mode === MODES.MULTI_AGENT_VOTE) {
      const panel = modeConfig.options?.panel;
      if (Array.isArray(panel) && panel.length > 0) {
        const panelIds = new Set(panel.map(l => l.id));
        const unknown = identities.filter(id => !panelIds.has(id));
        if (unknown.length > 0) {
          return deny('invalid_verdict', `Verdicts from lenses not on the panel: ${unknown.join(', ')}`);
        }
        const missing = [...panelIds].filter(id => !identities.includes(id));
        if (missing.length > 0) {
          return deny('incomplete_panel', `Missing verdicts from panel lenses: ${missing.join(', ')}`);
        }
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Read path — consumed by dashboard and MCP fallback
  // ---------------------------------------------------------------------------

  /**
   * @param {string} approvalId
   * @returns {import('./types.mjs').PendingApproval|null}
   */
  getPending(approvalId) {
    return this._store.getPending(approvalId);
  }

  /**
   * @param {{ actionType?: string, status?: string }} [filter]
   * @returns {import('./types.mjs').PendingApproval[]}
   */
  listPending(filter) {
    return this._store.listPending(filter);
  }

  /**
   * @param {string} approvalId
   * @returns {import('./types.mjs').AuditRecord|null}
   */
  getAuditRecord(approvalId) {
    return this._store.getAuditRecord(approvalId);
  }

  /**
   * @param {{ actionType?: string }} [filter]
   * @returns {import('./types.mjs').AuditRecord[]}
   */
  listAuditRecords(filter) {
    return this._store.listAuditRecords(filter);
  }
}

/**
 * Convenience factory: creates an ApprovalEngine backed by a SQLite store.
 *
 * @param {string} [dbPath] - Path to the SQLite file; defaults to .pHive/approval-audit.db
 * @returns {ApprovalEngine}
 */
export function createEngine(dbPath) {
  return new ApprovalEngine(new ApprovalStore(dbPath));
}
