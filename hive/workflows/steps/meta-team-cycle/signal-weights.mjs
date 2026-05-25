/**
 * signal-weights.mjs
 *
 * Weight-multiplier helpers for step-03 proposal ranking.
 * Reads `meta_optimize.signal_weights` from hive.config.yaml and applies
 * the multiplier AFTER the base priority score is computed.
 *
 * Formula: weighted_score = weight(source) × Impact × (6 − Risk) / Effort
 */

/** Default weights — all 1.0 preserves existing ranking behaviour byte-for-byte. */
export const DEFAULT_WEIGHTS = {
  metrics: 1.0,
  external_research: 1.0,
  kg_signal: 1.0,
  dreaming_replay: 1.0,
  backlog: 1.0,
};

/**
 * Maps proposal `discovery_source` values to weight-config keys.
 * `internal_audit` proposals originate from the metrics/step-02 analysis pass,
 * so they draw from the `metrics` weight bucket.
 */
export const DISCOVERY_SOURCE_TO_WEIGHT_KEY = {
  internal_audit: 'metrics',
  metric_signal: 'metrics',
  external_research: 'external_research',
  kg_signal: 'kg_signal',
  dreaming_replay: 'dreaming_replay',
  backlog: 'backlog',
};

/**
 * Returns the weight multiplier for a given discovery_source.
 *
 * @param {string} discoverySource - proposal.discovery_source
 * @param {Record<string,number>} [configWeights] - meta_optimize.signal_weights from hive.config.yaml
 * @returns {number}
 */
export function resolveWeight(discoverySource, configWeights = {}) {
  const key = DISCOVERY_SOURCE_TO_WEIGHT_KEY[discoverySource] ?? discoverySource;
  if (Object.prototype.hasOwnProperty.call(configWeights, key)) {
    return configWeights[key];
  }
  if (Object.prototype.hasOwnProperty.call(DEFAULT_WEIGHTS, key)) {
    return DEFAULT_WEIGHTS[key];
  }
  return 1.0; // unknown source → neutral weight
}

/**
 * Base priority score (unweighted).
 * Matches the formula in step-03-proposal.md §3.
 *
 * @param {number} impact  1–5
 * @param {number} risk    1–5 (lower is better)
 * @param {number} effort  1–5
 * @returns {number}
 */
export function computePriorityScore(impact, risk, effort) {
  return (impact * (6 - risk)) / effort;
}

/**
 * Weighted priority score for a single proposal.
 *
 * @param {{ discovery_source: string, impact_score: number, risk_score: number, effort_score: number }} proposal
 * @param {Record<string,number>} [configWeights]
 * @returns {number}
 */
export function computeWeightedScore(proposal, configWeights = {}) {
  const base = computePriorityScore(
    proposal.impact_score,
    proposal.risk_score,
    proposal.effort_score,
  );
  const weight = resolveWeight(proposal.discovery_source, configWeights);
  return weight * base;
}

/**
 * Rank proposals by weighted score (descending).
 * Returns a new array — input is not mutated.
 * Each element gains a `weighted_score` field.
 *
 * @param {Array} proposals
 * @param {Record<string,number>} [configWeights]
 * @returns {Array}
 */
export function rankProposals(proposals, configWeights = {}) {
  return proposals
    .map((p) => ({ ...p, weighted_score: computeWeightedScore(p, configWeights) }))
    .sort((a, b) => b.weighted_score - a.weighted_score);
}
