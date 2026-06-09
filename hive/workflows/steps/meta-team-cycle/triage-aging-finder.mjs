/**
 * Triage queue aging finder for step-02 analysis.
 *
 * Pure-function helpers over the parsed `.pHive/triage/queue.yaml` shape
 * documented in `hive/references/triage-queue-schema.md`. The caller reads
 * the file (or treats it as absent → empty queue per the schema's fail-open
 * semantics) and passes the parsed object here. No fs, no fetch, no clock —
 * the clock is injected via `nowIso` so cycle scripts stay deterministic.
 *
 * Goal: detect triage items that have been sitting in a non-closed state
 * for too long. Stuck items are real signals: either the report needs
 * clarification, a prioritization decision is overdue, or a plan-ready item
 * never reached execution. All of these are meta-team-actionable — the cycle
 * can surface them so the operator (or a follow-up automation) addresses
 * the root cause.
 *
 * Per step-02-analysis.md §TASK SEQUENCE, the finder emits zero-or-more
 * `STUCK_TRIAGE_ITEM` findings into the standard findings list — the
 * AND-of-empty routing gate treats them as ordinary signal.
 */

'use strict';

/**
 * Days between two ISO 8601 timestamps. Local copy so this finder does not
 * depend on the sibling stale-pr-finder.mjs landing first — the function is
 * trivial and stacking would force PR ordering that doesn't matter for
 * unrelated finders.
 */
function daysBetween(isoEarlier, nowIso) {
  const earlier = Date.parse(isoEarlier);
  const now = Date.parse(nowIso);
  if (Number.isNaN(earlier) || Number.isNaN(now)) return null;
  return (now - earlier) / (1000 * 60 * 60 * 24);
}

// ---------------------------------------------------------------------------
// Aging tiers per state
//
// Tier choice reflects what the staleness means for that state:
//   - inbox        — user filed a report and nobody looked → critical fastest
//   - clarified    — clarified but not prioritized → process gap
//   - prioritized  — prioritized but not planned → planning bottleneck
//   - plan-ready   — planned but not executed → execution bottleneck (slower OK)
//   - closed       — never emitted (filtered out by the audit)
// ---------------------------------------------------------------------------

const STATE_AGING_RULES = {
  inbox:        { staleDays: 7,  criticalDays: 14, message: 'never clarified' },
  clarified:    { staleDays: 7,  criticalDays: 14, message: 'awaiting prioritization' },
  prioritized:  { staleDays: 7,  criticalDays: 14, message: 'awaiting plan hand-off' },
  'plan-ready': { staleDays: 14, criticalDays: 30, message: 'planned but never executed' },
};

const TIER_TO_SEVERITY = {
  critical: 'high',
  medium: 'medium',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the most recent state-anchor timestamp for an item — the last
 * `state_history[*].at` if available, else `reported_at`. Returns null when
 * neither is present (malformed item; caller should skip).
 */
export function resolveAnchor(item) {
  if (!item || typeof item !== 'object') return null;
  const history = Array.isArray(item.state_history) ? item.state_history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry && typeof entry.at === 'string') return entry.at;
  }
  if (typeof item.reported_at === 'string') return item.reported_at;
  return null;
}

/**
 * Classify a triage item. Returns one of:
 *   - { tier: 'critical', ageDays, rule } — past criticalDays for the state
 *   - { tier: 'medium',   ageDays, rule } — past staleDays for the state
 *   - null — closed, fresh, or unknown state
 */
export function classifyItem(item, nowIso) {
  if (!item || typeof item !== 'object') return null;
  if (item.state === 'closed') return null;
  const rule = STATE_AGING_RULES[item.state];
  if (!rule) return null;

  const anchor = resolveAnchor(item);
  if (!anchor) return null;
  const ageDays = daysBetween(anchor, nowIso);
  if (ageDays == null || ageDays <= rule.staleDays) return null;

  if (ageDays > rule.criticalDays) return { tier: 'critical', ageDays, rule };
  return { tier: 'medium', ageDays, rule };
}

// ---------------------------------------------------------------------------
// Findings emission
// ---------------------------------------------------------------------------

/**
 * Build findings from a parsed triage queue object.
 *
 * @param {object|null} queue   — parsed `.pHive/triage/queue.yaml` (or null when absent)
 * @param {object}      opts
 * @param {string}      opts.nowIso  — required; pin the clock
 * @returns {Array<object>}
 */
export function findStuckTriageItems(queue, opts = {}) {
  if (!opts.nowIso) {
    throw new Error('findStuckTriageItems: opts.nowIso is required (callers must pin the clock)');
  }
  if (!queue || !Array.isArray(queue.items)) return [];

  const findings = [];
  for (const item of queue.items) {
    const verdict = classifyItem(item, opts.nowIso);
    if (!verdict) continue;
    const ageRounded = Math.floor(verdict.ageDays);
    findings.push({
      id: `finding-triage-${item.id ?? 'unknown'}`,
      category: 'STUCK_TRIAGE_ITEM',
      severity: TIER_TO_SEVERITY[verdict.tier],
      location: `triage:${item.id ?? 'unknown'}`,
      description: `Triage ${item.id ?? '?'} (${item.kind ?? '?'}) "${(item.title ?? '').slice(0, 80)}" stuck in ${item.state} ${ageRounded}d — ${verdict.rule.message}`,
      evidence: {
        triage_id: item.id ?? null,
        kind: item.kind ?? null,
        state: item.state,
        age_days: ageRounded,
        tier: verdict.tier,
        title: item.title ?? null,
        priority: item.priority ?? null,
        severity_reported: item.severity ?? null,
        anchor: resolveAnchor(item),
      },
    });
  }

  // Sort by severity-desc, then age-desc within tier so the oldest stuck
  // item floats to the top.
  const severityRank = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => {
    const sevDiff = (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99);
    if (sevDiff !== 0) return sevDiff;
    return (b.evidence.age_days ?? 0) - (a.evidence.age_days ?? 0);
  });

  return findings;
}
