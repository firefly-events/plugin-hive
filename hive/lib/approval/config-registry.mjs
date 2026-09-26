/**
 * Action-type → approval mode config registry.
 *
 * Shipped configs are the authoritative defaults and double as authoring examples.
 * Callers can override or extend at runtime via register().
 */

import { MODES } from './types.mjs';

/** @type {Map<string, import('./types.mjs').ModeConfig>} */
const _registry = new Map();

/**
 * Shipped defaults — one entry per first-class action type.
 * New action types should follow the same shape and add an entry here.
 */
const SHIPPED_CONFIGS = [
  {
    // Four-reviewer panel; duplication-scout carries a hard veto.
    // Pass rule: no hard-veto AND ≥3 of 4 approve.
    actionType: 'repo-creation',
    modeConfig: {
      mode: MODES.MULTI_AGENT_VOTE,
      enabled: true,
      options: {
        panel: [
          {
            id: 'duplication-scout',
            description: 'Deep-dive: does this repo already exist? Hard-veto if it duplicates.',
            canHardVeto: true,
          },
          {
            id: 'fit-check',
            description: 'Should this fold into an existing repo instead?',
            canHardVeto: false,
          },
          {
            id: 'tech-scout',
            description: 'Is there a solid 3rd-party library we should use instead of building?',
            canHardVeto: false,
          },
          {
            id: 'product-owner',
            description: 'Is this feature actually needed, or is it a repo out of silliness?',
            canHardVeto: false,
          },
        ],
        passRule: { minApprove: 3, hardVetoBlocks: true },
      },
    },
  },
  {
    // 3-agent review quorum; 2 of 3 must approve (≥60% → 2/3=0.667≥0.6).
    actionType: 'pr-merge',
    modeConfig: {
      mode: MODES.AGENT_QUORUM,
      enabled: true,
      options: {
        quorumSize: 3,
        passThreshold: 0.6,
        agentRoles: ['reviewer', 'peer-validator', 'security-reviewer'],
      },
    },
  },
  {
    // Irreversible ops require a single human sign-off.
    actionType: 'destructive-op',
    modeConfig: {
      mode: MODES.HUMAN_GATE,
      enabled: true,
      options: {},
    },
  },
  {
    // Outward / client-facing actions require human approval.
    actionType: 'client-facing-send',
    modeConfig: {
      mode: MODES.HUMAN_GATE,
      enabled: true,
      options: {},
    },
  },
];

// Freeze the shipped examples and seed the live registry with clones: mutating
// the authoring examples must never reconfigure a running engine, and vice versa.
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}
deepFreeze(SHIPPED_CONFIGS);

for (const { actionType, modeConfig } of SHIPPED_CONFIGS) {
  _registry.set(actionType, structuredClone(modeConfig));
}

/**
 * Register or override a mode config for an action type.
 * @param {string} actionType
 * @param {import('./types.mjs').ModeConfig} modeConfig
 */
export function register(actionType, modeConfig) {
  _registry.set(actionType, modeConfig);
}

/**
 * Look up the mode config for an action type.
 * Returns null when the action type has no registered config.
 * @param {string} actionType
 * @returns {import('./types.mjs').ModeConfig|null}
 */
export function lookup(actionType) {
  return _registry.get(actionType) ?? null;
}

/**
 * List all registered configs as { actionType, modeConfig } pairs.
 * @returns {{ actionType: string, modeConfig: import('./types.mjs').ModeConfig }[]}
 */
export function listAll() {
  return [..._registry.entries()].map(([actionType, modeConfig]) => ({ actionType, modeConfig }));
}

/**
 * Toggle a mode on/off for a given action type.
 * @param {string} actionType
 * @param {boolean} enabled
 * @returns {boolean} true if the action type was found; false if not registered
 */
export function setEnabled(actionType, enabled) {
  const existing = _registry.get(actionType);
  if (!existing) return false;
  _registry.set(actionType, { ...existing, enabled });
  return true;
}

/**
 * Returns the immutable shipped default configs array (useful as authoring examples).
 * The array and every object inside it are deep-frozen — attempts to mutate
 * them throw in strict mode and never affect the live registry.
 * @returns {ReadonlyArray<{ actionType: string, modeConfig: import('./types.mjs').ModeConfig }>}
 */
export function shippedConfigs() {
  return SHIPPED_CONFIGS;
}
