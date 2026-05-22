/**
 * Signal detection + predicate evaluation for cell-roster-resolver.
 *
 * Predicates are intentionally "dumb" (design §2.2): equality checks and
 * boolean field tests only. OR / NOT compile is post-2.x.
 */

/**
 * Resolve a dot-path like "scope_signals.backend" against a context object.
 * Returns undefined when any segment is missing.
 */
function resolvePath(obj, dotPath) {
  return dotPath.split('.').reduce((acc, key) => acc?.[key], obj);
}

/**
 * Parse a scalar literal from a predicate RHS ("true", "false", numbers).
 */
function parseScalar(s) {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  return s;
}

/**
 * Evaluate a single predicate string against a context object.
 *
 * Supported forms:
 *   "scope_signals.backend"              → truthy field check
 *   "planning.collaborative_review == true" → equality check
 */
export function evaluatePredicate(predicate, context) {
  const trimmed = String(predicate).trim();
  const eqMatch = trimmed.match(/^(.+?)\s*==\s*(.+)$/);
  if (eqMatch) {
    const lhs = resolvePath(context, eqMatch[1].trim());
    const rhs = parseScalar(eqMatch[2].trim());
    return lhs === rhs;
  }
  return Boolean(resolvePath(context, trimmed));
}

/**
 * Compute scope signal booleans from story text using keyword lists.
 *
 * @param {string} storyText  Concatenated story title + description + criteria.
 * @param {Record<string, { keywords: string[] }>} signalDefs
 *   Map of signal name → keyword list, sourced from the cell YAML
 *   `scope_signals:` block.
 * @returns {Record<string, boolean>}
 */
export function computeScopeSignals(storyText, signalDefs) {
  const lower = storyText.toLowerCase();
  const result = {};
  for (const [signal, def] of Object.entries(signalDefs ?? {})) {
    const keywords = Array.isArray(def?.keywords) ? def.keywords : [];
    result[signal] = keywords.some((kw) => {
      // Word-boundary match prevents short tokens like "orm" matching inside "form".
      const pattern = new RegExp(`\\b${kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      return pattern.test(lower);
    });
  }
  return result;
}
