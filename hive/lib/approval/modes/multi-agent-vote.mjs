/**
 * multi-agent-vote mode: diverse-lens panel, each reviewer bringing a distinct angle.
 *
 * Pass rule: no hard-veto AND approveCount ≥ passRule.minApprove.
 * Hard vetoes (verdict.hardVeto === true AND verdict.approve === false) short-circuit
 * the result regardless of other votes — a single hard-veto rejects outright when
 * passRule.hardVetoBlocks is true.
 */

import { ALLOW, AUDIT_METHODS, deny } from '../types.mjs';

/**
 * @param {import('../types.mjs').VerdictEntry[]} verdicts
 *   One entry per panel lens. identity = lens id (e.g. 'duplication-scout').
 * @param {import('../types.mjs').ModeConfig} config
 *   config.options must satisfy MultiAgentVoteOptions.
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
      decision: deny('mode_disabled', 'multi-agent-vote mode is currently disabled'),
      method: AUDIT_METHODS.VOTE,
      approverIdentity: 'vote-panel',
      verdicts,
      passCheck: false,
    };
  }

  const opts = config.options ?? {};
  const passRule = opts.passRule ?? { minApprove: 2, hardVetoBlocks: true };
  const panel = Array.isArray(opts.panel) ? opts.panel : null;

  // Panel completeness is a safety property: if the hard-veto lens is dropped
  // from the submission, its veto must not silently disappear. Every configured
  // lens must have exactly one verdict, and no outsider may vote. The engine
  // pre-validates this, but direct callers get the same fail-closed guarantee.
  if (panel && panel.length > 0) {
    const panelIds = new Set(panel.map(l => l.id));
    const identities = verdicts.map(v => v.identity);
    const unknown = identities.filter(id => !panelIds.has(id));
    const missing = [...panelIds].filter(id => !identities.includes(id));
    const hasDuplicates = new Set(identities).size !== identities.length;
    if (unknown.length > 0 || missing.length > 0 || hasDuplicates) {
      const detail = [
        missing.length ? `missing: ${missing.join(', ')}` : '',
        unknown.length ? `unknown: ${unknown.join(', ')}` : '',
        hasDuplicates ? 'duplicate identities' : '',
      ].filter(Boolean).join('; ');
      return {
        decision: deny('incomplete_panel', `Vote rejected — panel verdicts do not match the configured panel (${detail})`),
        method: AUDIT_METHODS.VOTE,
        approverIdentity: 'vote-panel',
        verdicts,
        passCheck: false,
      };
    }
  }

  // Only a lens configured as canHardVeto may cast a blocking rejection; a
  // hardVeto flag from any other lens counts as a plain reject.
  const vetoCapable = panel
    ? new Set(panel.filter(l => l.canHardVeto).map(l => l.id))
    : null;

  // Hard-veto check: a single blocking rejection short-circuits the outcome.
  if (passRule.hardVetoBlocks) {
    const hardVetoVerdict = verdicts.find(
      v => v.hardVeto === true && !v.approve && (vetoCapable === null || vetoCapable.has(v.identity))
    );
    if (hardVetoVerdict) {
      return {
        decision: deny(
          'hard_veto',
          `Hard veto from ${hardVetoVerdict.identity}: ${hardVetoVerdict.reasoning}`
        ),
        method: AUDIT_METHODS.VOTE,
        approverIdentity: hardVetoVerdict.identity,
        verdicts,
        passCheck: false,
      };
    }
  }

  const approveCount = verdicts.filter(v => v.approve).length;
  const passCheck = approveCount >= passRule.minApprove;

  const approvers = verdicts.filter(v => v.approve).map(v => v.identity);
  const rejecters = verdicts.filter(v => !v.approve).map(v => v.identity);

  const decision = passCheck
    ? ALLOW
    : deny(
        'vote_failed',
        `Vote did not pass: ${approveCount}/${verdicts.length} approved (required ≥${passRule.minApprove}). Rejected by: ${rejecters.join(', ')}`
      );

  return {
    decision,
    method: AUDIT_METHODS.VOTE,
    approverIdentity: passCheck ? approvers.join(', ') : rejecters.join(', '),
    verdicts,
    passCheck,
  };
}
