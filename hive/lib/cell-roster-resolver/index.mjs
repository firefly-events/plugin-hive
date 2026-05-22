/**
 * cell-roster-resolver — hive-lib code module (design §10 P2, V1).
 *
 * Resolves a story spec + cell definition into a concrete roster of
 * { 'workflow-phase', role } entries (outline §5.2).
 *
 * NOT an atomic skill — pure resolution logic with no user-callable surface.
 * Skill extraction is a post-2.x candidate (design §10 P2).
 */

import { computeScopeSignals, evaluatePredicate } from './predicates.mjs';

/**
 * Concatenate story spec fields into a single text blob for keyword matching.
 */
function storyText(storySpec) {
  const parts = [
    storySpec?.title ?? '',
    storySpec?.description ?? '',
  ];
  const ac = storySpec?.acceptance_criteria;
  if (Array.isArray(ac)) parts.push(ac.join(' '));
  else if (typeof ac === 'string') parts.push(ac);
  return parts.join(' ');
}

/**
 * Resolve a story spec against a cell definition into an ordered roster.
 *
 * @param {object} storySpec
 *   Story YAML object (or subset). Relevant fields:
 *   - title {string}
 *   - description {string}
 *   - acceptance_criteria {string|string[]}
 *   - planning {object}  — carries `collaborative_review` and similar fields
 *
 * @param {object} cellDef
 *   Parsed cell YAML. Relevant fields:
 *   - core {string[]}   — ordered role names always included
 *   - optional {Array<{role, when, replaces?, appends_after?}>}
 *   - scope_signals {Record<string, {keywords: string[]}>}
 *
 * @returns {Array<{'workflow-phase': string, role: string}>}
 *   Ordered roster. Each entry carries a `workflow-phase` field (never bare
 *   `phase`) per the V2 vocabulary rule (design §10 V2).
 */
export function resolveRoster(storySpec, cellDef) {
  const text = storyText(storySpec);
  const signalDefs = cellDef?.scope_signals ?? {};
  const scopeSignals = computeScopeSignals(text, signalDefs);
  const planningFields = storySpec?.planning ?? {};
  const context = { scope_signals: scopeSignals, planning: planningFields };

  const coreRoles = Array.isArray(cellDef?.core) ? cellDef.core : [];
  const optionalSlots = Array.isArray(cellDef?.optional) ? cellDef.optional : [];

  // Build mutable roster from core[]; workflow-phase == role for core slots.
  const roster = coreRoles.map((role) => ({ 'workflow-phase': role, role }));

  for (const opt of optionalSlots) {
    if (!evaluatePredicate(opt.when, context)) continue;

    if (opt.replaces) {
      // Swap the role at the matching workflow-phase; phase label is preserved.
      const idx = roster.findIndex((s) => s.role === opt.replaces);
      if (idx >= 0) {
        roster[idx] = { 'workflow-phase': roster[idx]['workflow-phase'], role: opt.role };
      }
    } else if (opt.appends_after) {
      // Insert new workflow-phase after the named phase.
      const idx = roster.findIndex((s) => s['workflow-phase'] === opt.appends_after);
      const entry = { 'workflow-phase': opt.role, role: opt.role };
      if (idx >= 0) {
        roster.splice(idx + 1, 0, entry);
      } else {
        roster.push(entry);
      }
    }
  }

  return roster;
}
