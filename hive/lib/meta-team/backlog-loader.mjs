/**
 * Returns only candidates eligible for the nightly meta-meta-optimize cycle.
 *
 * tier: little-fix → shotgun-only (/meta-shotgun, mir-6/mir-7)
 * tier absent       → treated as structural (backward-compatible)
 * tier: structural  → nightly-eligible
 * tier: strategic   → nightly-eligible (human review still required at step-04)
 *
 * @param {Array<object>} candidates - raw candidates array from backlog YAML
 * @returns {Array<object>} candidates with tier !== 'little-fix'
 */
export function filterNightlyEligible(candidates) {
  return (candidates ?? []).filter(c => c.tier !== 'little-fix');
}
